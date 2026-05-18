// ============================================================
// LumaRoK — sync/channel-hardened.js
// Hardened SyncChannel / Realtime with:
//   - Custom exponential backoff (override Socket.io defaults)
//   - Auth token refresh before reconnect
//   - Stale subscription cleanup on reconnect
//   - Heartbeat watchdog — detects silent disconnects
//   - Reconnect event triggers offlineQueue flush + overview refresh
//   - Network quality gating (don't attempt on OFFLINE)
// Depends on: Store, Trace, OfflineQueue, NetworkMonitor
// ============================================================
const SyncChannel = (() => {
  let _socket        = null;
  let _watchedDevices = new Set();
  let _heartbeatTimer = null;
  let _lastPong       = null;
  let _manualClose    = false;

  // ── Connect ────────────────────────────────────────────────
  function connect() {
    const token = getToken();
    if (!token || _socket?.connected) return;
    if (NetworkMonitor.quality === 'OFFLINE') {
      Trace.warn('sync:connect:skipped', 'Offline — deferring socket connection');
      return;
    }

    _manualClose = false;
    _socket = io(API_URL, {
      auth:                    { token },
      transports:              ['websocket'],
      reconnection:            true,
      reconnectionDelay:       3000,
      reconnectionDelayMax:    60000,
      randomizationFactor:     0.5,
      reconnectionAttempts:    Infinity,
      timeout:                 10000,
    });

    _socket.on('connect', _onConnect);
    _socket.on('disconnect', _onDisconnect);
    _socket.on('connect_error', _onConnectError);
    _socket.on('pong', () => { _lastPong = Date.now(); });

    _socket.on('device:state',  _handleDeviceState);
    _socket.on('sensor:data',   _handleSensor);
    _socket.on('unit:status',   _handleUnitStatus);
    _socket.on('unit:alert',    _handleAlert);
    _socket.on('ota:progress',  _handleOTA);
  }

  // ── Event handlers ─────────────────────────────────────────
  async function _onConnect() {
    Trace.info('sync:connected', { id: _socket.id });
    setOfflineBanner(false);

    // Re-subscribe all watched devices (survives reconnect)
    _watchedDevices.forEach(id => _socket.emit('watch:device', id));

    // Flush offline action queue
    OfflineQueue.flush().catch(e => Trace.warn('sync:flush:err', e.message));

    // Refresh installer overview if on installer screen
    const screen = Store.get('currentScreen');
    if (screen === 'installer-hub' || screen === 'installer-bind') {
      CommissioningEngine?.loadOverview(Store.get('unit_id')).catch(() => {});
    }

    _startHeartbeat();
  }

  function _onDisconnect(reason) {
    Trace.warn('sync:disconnected', { reason });
    _stopHeartbeat();
    if (_manualClose) return;
    if (reason === 'io server disconnect') {
      // Server explicitly kicked us — try token refresh then reconnect
      _refreshAndReconnect();
    }
    // All other reasons: Socket.io handles reconnect with backoff
  }

  function _onConnectError(err) {
    Trace.warn('sync:connect_error', { msg: err.message });
    setOfflineBanner(true);
  }

  async function _refreshAndReconnect() {
    try {
      await apiRequest('/api/auth/refresh', 'POST');
      const newToken = getToken();
      if (_socket) _socket.auth = { token: newToken };
      _socket?.connect();
    } catch {
      Trace.error('sync:refresh:failed', 'Could not refresh — logging out');
      clearAuth(); goTo('login');
    }
  }

  // ── Heartbeat watchdog ─────────────────────────────────────
  // Socket.io WS pings every 25s by default. If we haven't heard
  // a pong in 90s, the connection is silently dead.
  function _startHeartbeat() {
    _stopHeartbeat();
    _lastPong = Date.now();
    _heartbeatTimer = setInterval(() => {
      if (!_socket?.connected) return;
      if (Date.now() - _lastPong > 90000) {
        Trace.error('sync:heartbeat:dead', 'No pong for 90s — forcing reconnect');
        _socket.disconnect();
        setTimeout(() => { if (!_manualClose) _socket.connect(); }, 2000);
      }
    }, 30000);
  }

  function _stopHeartbeat() {
    clearInterval(_heartbeatTimer);
    _heartbeatTimer = null;
  }

  // ── Message handlers ───────────────────────────────────────
  function _handleDeviceState(data) {
    const devices = Store.get('devices') || [];
    const dev = devices.find(d => d._id === data.deviceId);
    if (dev) {
      dev.power_state = data.power_state;
      dev.status      = data.status || dev.status;
      if (data.watts !== undefined) dev.energy = { ...dev.energy, watts_current: data.watts };
      Store.set('devices', [...devices]);
    }
    updateDeviceToggleUI(data.deviceId, data.power_state);
    if (data.source !== 'app') haptic('light');
    Trace.event('sync:device:state', { deviceId: data.deviceId, power_state: data.power_state });
  }

  function _handleSensor(data) {
    updateSensorUI(data);
    Trace.event('sync:sensor', { unitId: data.unitId });
  }

  function _handleUnitStatus(data) {
    Store.merge('unit', { status: data.status });
    updateUnitStatusUI(data.unitId, data.status);
    Trace.event('sync:unit:status', data);
  }

  function _handleAlert(data) {
    const icons = { GAS_ALERT: '⚠️', MOTION: '🚶', DOOR_OPEN: '🚪', TEMP_HIGH: '🌡️' };
    toast(`${icons[data.type] || '🔔'} ${data.message || data.type}`, 'warning');
    haptic('heavy');
    Trace.event('sync:alert', data);
  }

  function _handleOTA(data) {
    const el = document.getElementById('ota-progress-bar');
    if (el) el.style.width = (data.percent || 0) + '%';
    if (data.status === 'complete') toast('Firmware updated ✓', 'success');
    if (data.status === 'failed')   toast('Firmware update failed', 'error');
    Trace.event('sync:ota', data);
  }

  // ── Watch / unwatch ────────────────────────────────────────
  function watchDevice(deviceId) {
    _watchedDevices.add(deviceId);
    if (_socket?.connected) _socket.emit('watch:device', deviceId);
  }

  function unwatchDevice(deviceId) {
    _watchedDevices.delete(deviceId);
    if (_socket?.connected) _socket.emit('unwatch:device', deviceId);
  }

  function watchUnit(unit_id) {
    const devices = Store.get('devices') || [];
    devices.forEach(d => watchDevice(d._id));
    Trace.info('sync:watch:unit', { unit_id, count: devices.length });
  }

  // ── Network-aware reconnect ────────────────────────────────
  window.addEventListener('online', () => {
    Trace.info('sync:online', 'Network restored');
    setOfflineBanner(false);
    if (!_socket?.connected && !_manualClose) {
      Trace.info('sync:reconnect', 'Attempting socket reconnect after network restore');
      connect();
    }
  });

  window.addEventListener('offline', () => {
    setOfflineBanner(true);
    Trace.warn('sync:offline', 'Network lost');
  });

  // ── Disconnect ─────────────────────────────────────────────
  function disconnect() {
    _manualClose = true;
    _stopHeartbeat();
    _socket?.disconnect();
    _socket = null;
    _watchedDevices.clear();
    Trace.info('sync:disconnected:manual', {});
  }

  return {
    connect, disconnect, watchDevice, unwatchDevice, watchUnit,
    get connected() { return !!_socket?.connected; },
  };
})();

// Legacy alias
const Realtime = SyncChannel;

function setOfflineBanner(show) {
  document.getElementById('offline-banner')?.classList.toggle('show', show);
}
