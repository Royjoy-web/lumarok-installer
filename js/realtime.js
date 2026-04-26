// ============================================
// LUMAROK — js/realtime.js
// Socket.io WebSocket client — replaces polling
// Emits events that dashboard/device UI listens to
// ============================================

// Loaded after Socket.io CDN script in index.html

const Realtime = (() => {
  let socket = null;
  let reconnectTimer = null;

  const connect = () => {
    const token = getToken();
    if (!token || socket?.connected) return;

    socket = io(API_URL, {
      auth:        { token },
      transports:  ['websocket'],
      reconnection: true,
      reconnectionDelay: 2000,
      reconnectionAttempts: Infinity,
    });

    socket.on('connect', () => {
      console.log('[WS] Connected');
      setOfflineBanner(false);
      // Watch all current unit devices
      (APP.devices || []).forEach(d => socket.emit('watch:device', d._id));
    });

    socket.on('disconnect', (reason) => {
      console.warn('[WS] Disconnected:', reason);
      if (reason === 'io server disconnect') {
        // Server kicked us (token expired?) — re-auth
        clearAuth(); goTo('login');
      }
    });

    socket.on('connect_error', (err) => {
      console.error('[WS] Connect error:', err.message);
      setOfflineBanner(true);
    });

    // ── Device state change ───────────────────────────────────
    socket.on('device:state', (data) => {
      // Update APP state
      const dev = APP.devices?.find(d => d._id === data.deviceId);
      if (dev) {
        dev.power_state = data.power_state;
        dev.status      = data.status || dev.status;
        if (data.watts !== undefined) dev.energy = { ...dev.energy, watts_current: data.watts };
      }
      // Update DOM without full re-render
      updateDeviceToggleUI(data.deviceId, data.power_state);
      // Haptic feedback on physical switch changes
      if (data.source !== 'app') haptic('light');
    });

    // ── Sensor data ──────────────────────────────────────────
    socket.on('sensor:data', (data) => {
      if (APP.sensors) {
        const s = APP.sensors.find(s => s.unit_id === data.unitId);
        if (s) Object.assign(s, data);
        else APP.sensors.push(data);
      }
      updateSensorUI(data);
    });

    // ── Unit online/offline ───────────────────────────────────
    socket.on('unit:status', (data) => {
      updateUnitStatusUI(data.unitId, data.status);
    });

    // ── Alerts ───────────────────────────────────────────────
    socket.on('unit:alert', (data) => {
      const icons = { GAS_ALERT:'⚠️', MOTION:'🚶', DOOR_OPEN:'🚪', TEMP_HIGH:'🌡️' };
      const icon  = icons[data.type] || '🔔';
      toast(`${icon} ${data.message || data.type}`, 'warning');
      haptic('heavy');
    });

    // ── OTA Progress ─────────────────────────────────────────
    socket.on('ota:progress', (data) => {
      const el = document.getElementById('ota-progress-bar');
      if (el) el.style.width = (data.percent||0) + '%';
      if (data.status === 'complete') toast('Firmware updated ✓', 'success');
      if (data.status === 'failed')   toast('Firmware update failed', 'error');
    });
  };

  const disconnect = () => { socket?.disconnect(); socket = null; };

  const watchDevice = (deviceId) => socket?.emit('watch:device', deviceId);
  const unwatchDevice = (deviceId) => socket?.emit('unwatch:device', deviceId);

  return { connect, disconnect, watchDevice, unwatchDevice, get connected() { return socket?.connected; } };
})();

// ── Update device toggle in DOM without re-render ─────────────
function updateDeviceToggleUI(deviceId, powerState) {
  const toggle  = document.querySelector(`[data-device-id="${deviceId}"] .dev-toggle`);
  const card    = document.querySelector(`[data-device-id="${deviceId}"]`);
  const wattEl  = document.querySelector(`[data-device-id="${deviceId}"] .dev-watts`);
  const dev     = APP.devices?.find(d => d._id === deviceId);

  if (toggle) toggle.checked = powerState;
  if (card)   card.classList.toggle('on', powerState);
  if (wattEl && dev?.energy?.watts_current) {
    wattEl.textContent = dev.energy.watts_current + 'W';
  }
  // Update active device count in dashboard header
  const activeCount = (APP.devices || []).filter(d => d.power_state).length;
  const el = document.getElementById('hm-active');
  if (el) el.textContent = activeCount + ' active';
}

// ── Update sensor readings in DOM ─────────────────────────────
function updateSensorUI(data) {
  const map = {
    temperature:   '#sens-temp',
    humidity:      '#sens-hum',
    gas_level:     '#sens-gas',
    occupancy:     '#sens-occ',
  };
  Object.entries(map).forEach(([key, sel]) => {
    const el = document.querySelector(sel);
    if (el && data[key] !== undefined) el.textContent = data[key];
  });
}

// ── Unit status indicator ──────────────────────────────────────
function updateUnitStatusUI(unitId, status) {
  const dot = document.getElementById('unit-status-dot');
  const lbl = document.getElementById('unit-status-label');
  if (dot) dot.className = 'status-dot ' + (status==='ONLINE'?'online':'offline');
  if (lbl) lbl.textContent = status;
}

// ── Haptic feedback (mobile) ──────────────────────────────────
function haptic(type='light') {
  if (!navigator.vibrate) return;
  const patterns = { light:[10], medium:[20], heavy:[30,20,30] };
  navigator.vibrate(patterns[type]||[10]);
}
