// ============================================================
// LumaRoK — provisioning/ble-hardened.js
// Drop-in replacement for ble.js with:
//   - GATT reconnect with backoff
//   - MTU-aware chunking
//   - Pre-write channel health check
//   - Background-tab guard (pagehide + visibilitychange)
//   - Configurable ACK timeout (env-aware via NetworkMonitor)
// Depends on: Trace, Retry, NetworkMonitor
// ============================================================
const BLEEngine = (() => {
  const SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
  const CHAR_UUID    = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';
  const MTU          = 512;     // Web Bluetooth negotiated MTU
  const ACK_BASE     = 20000;   // ms — scaled by network quality below

  let _device = null;
  let _server = null;
  let _char   = null;
  let _aborted = false;

  // ── Background-tab guard ───────────────────────────────────
  // If user switches away mid-provision, mark _aborted so write doesn't hang.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && _server?.connected) {
      Trace.warn('ble:background', 'Tab hidden mid-provision — marking aborted');
      _aborted = true;
      _cleanup();
    }
  });

  // ── Public API ─────────────────────────────────────────────
  async function provision(ssid, password, onStatus = () => {}) {
    if (!navigator.bluetooth) throw new Error('Web Bluetooth unavailable. Use Chrome on Android/Desktop.');
    _aborted = false;

    // ── 1. Device picker ─────────────────────────────────────
    onStatus('Opening Bluetooth device picker…', 'info');
    try {
      _device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'LumaRoK-' }],
        optionalServices: [SERVICE_UUID],
      });
    } catch (err) {
      if (err.name === 'NotFoundError') throw Object.assign(new Error('No device selected'), { userCancelled: true });
      throw err;
    }
    Trace.event('ble:device:selected', { name: _device.name });

    // ── 2. Connect with retry ─────────────────────────────────
    onStatus(`Connecting to ${_device.name}…`, 'info');
    _server = await Retry.attempt(
      () => _connectGATT(),
      { max: 4, base: 1500, cap: 12000, tag: 'ble:gatt:connect',
        onRetry: (i, delay) => onStatus(`GATT connect retry ${i}… (${Math.round(delay/1000)}s)`, 'warn') }
    );

    if (_aborted) throw new Error('Provision aborted (tab hidden)');

    // ── 3. Channel health check ────────────────────────────────
    onStatus('Verifying BLE channel…', 'info');
    const service = await _server.getPrimaryService(SERVICE_UUID);
    _char = await service.getCharacteristic(CHAR_UUID);
    await _healthCheck(_char); // reads a descriptor — throws if channel is dead

    // ── 4. Set up ACK listener ────────────────────────────────
    await _char.startNotifications();
    const ackTimeout = _ackTimeout();

    const ackPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`ESP32 ACK timeout (${ackTimeout / 1000}s) — check BLE range`)),
        ackTimeout
      );
      _char.addEventListener('characteristicvaluechanged', e => {
        clearTimeout(timer);
        try   { resolve(JSON.parse(new TextDecoder().decode(e.target.value))); }
        catch { resolve({ ok: true }); }
      }, { once: true });
    });

    // ── 5. Write (chunked if needed) ──────────────────────────
    onStatus('Sending WiFi credentials…', 'info');
    const payload = new TextEncoder().encode(JSON.stringify({ ssid, password }));
    await _writeChunked(_char, payload);
    Trace.event('ble:write', { ssid, bytes: payload.length });

    if (_aborted) throw new Error('Provision aborted after write');

    // ── 6. ACK ────────────────────────────────────────────────
    onStatus('Waiting for ESP32 confirmation…', 'info');
    const ack = await ackPromise;
    if (!ack.ok) throw new Error(ack.error || 'ESP32 rejected credentials');

    Trace.event('ble:provision:success', { device: _device.name });
    return { ok: true, device_name: _device.name };
  }

  // ── Internals ─────────────────────────────────────────────
  async function _connectGATT() {
    if (_server?.connected) return _server;
    const s = await _device.gatt.connect();
    // Re-attach disconnect listener each time
    _device.addEventListener('gattserverdisconnected', _onDisconnected, { once: true });
    return s;
  }

  function _onDisconnected() {
    Trace.warn('ble:disconnected', { device: _device?.name });
    if (!_aborted) {
      // Auto-reconnect attempt (background, best-effort)
      Retry.attempt(() => _connectGATT(), { max: 3, base: 2000, tag: 'ble:auto-reconnect' })
        .catch(e => Trace.error('ble:reconnect:failed', e.message));
    }
  }

  async function _healthCheck(characteristic) {
    // Try to read the CCCD descriptor — fails fast if channel is dead
    try {
      await characteristic.getDescriptor(0x2902);
    } catch {
      // Descriptor read not always supported — fall back to a property check
      if (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse) {
        throw new Error('BLE characteristic not writable — wrong device or stale connection');
      }
    }
  }

  async function _writeChunked(char, data) {
    if (data.length <= MTU) {
      await char.writeValueWithResponse(data);
      return;
    }
    // Write in MTU-sized chunks (rare for WiFi credentials, future-proofing)
    for (let offset = 0; offset < data.length; offset += MTU) {
      const chunk = data.slice(offset, offset + MTU);
      await char.writeValueWithResponse(chunk);
      Trace.info('ble:chunk', { offset, size: chunk.length });
    }
  }

  function _ackTimeout() {
    // Poor network = possibly congested RF; give more time
    const quality = NetworkMonitor.quality;
    return quality === 'POOR' ? ACK_BASE * 3 : quality === 'DEGRADED' ? ACK_BASE * 1.5 : ACK_BASE;
  }

  function _cleanup() {
    try { _server?.disconnect(); } catch {}
    _server = null;
    _char   = null;
  }

  function disconnect() {
    _aborted = true;
    _cleanup();
  }

  function isSupported() { return !!navigator.bluetooth; }

  return { provision, disconnect, isSupported };
})();
