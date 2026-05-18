// ============================================================
// LumaRoK — provisioning/wifi.js
// WiFi provisioning: backend MQTT relay + AP mode captive portal.
// Depends on: Trace, Retry, Installer (api.js)
// ============================================================
const WiFiEngine = (() => {
  const AP_PORTAL   = 'http://192.168.4.1';
  const AP_ENDPOINT = '/provision';

  /**
   * Send WiFi credentials via backend → MQTT relay.
   * Used when device is already on network (re-provision) or
   * as fallback when BLE is unavailable.
   */
  async function provisionViaRelay(unit_id, ssid, password, onStatus = () => {}) {
    onStatus('Sending credentials via server…', 'info');
    Trace.event('wifi:relay:start', { unit_id, ssid });

    const data = await Retry.attempt(
      () => Installer.provisionWifi(unit_id, ssid, password),
      { max: 3, base: 1500, tag: 'wifi:relay', bail: e => e.message?.includes('unreachable') }
    );

    if (!data.mqtt_sent) {
      Trace.warn('wifi:relay:offline', { unit_id });
      onStatus('Backend offline — credentials queued for delivery', 'warn');
    } else {
      Trace.event('wifi:relay:sent', { unit_id });
      onStatus('Credentials sent via MQTT ✓', 'success');
    }
    return data;
  }

  /**
   * Provision via ESP32 AP mode captive portal.
   * Requires installer to manually connect phone to the ESP32 WiFi AP
   * (named LumaRoK-XXXXXX). Then call this function.
   */
  async function provisionViaAP(ssid, password, onStatus = () => {}) {
    onStatus('Posting credentials to ESP32 AP portal…', 'info');
    Trace.event('wifi:ap:start', { ssid });

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);

    try {
      const res = await fetch(AP_PORTAL + AP_ENDPOINT, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ ssid, password }),
        signal:  ctrl.signal,
      });
      const data = await res.json().catch(() => ({ ok: res.ok }));
      if (!res.ok && !data.ok) throw new Error(data.error || `AP returned ${res.status}`);
      Trace.event('wifi:ap:success', { ssid });
      onStatus('AP portal accepted credentials ✓', 'success');
      return { ok: true };
    } catch (err) {
      Trace.error('wifi:ap:failed', err.message);
      if (err.name === 'AbortError') throw new Error('AP portal timeout — check you are connected to the LumaRoK WiFi AP');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Poll backend until unit comes ONLINE or timeout (90s).
   */
  async function verifyOnline(unit_id, onTick = () => {}) {
    Trace.info('wifi:verify:start', { unit_id });
    return Retry.poll(
      async () => {
        const { status } = await apiRequest(`/api/units/${encodeURIComponent(unit_id)}/status`);
        return status === 'ONLINE' ? status : false;
      },
      { interval: 5000, timeout: 90000, tag: 'wifi:verify', onTick }
    );
  }

  return { provisionViaRelay, provisionViaAP, verifyOnline };
})();
