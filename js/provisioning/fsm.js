// ============================================================
// LumaRoK — provisioning/fsm-hardened.js
// Hardened ProvisionFSM with:
//   - State corruption guards
//   - Idempotent transition guards (no double-fire)
//   - AP mode full UI flow
//   - Verify loop with network-quality-aware timeout
//   - Per-step timestamp for stuck-state detection
//   - Post-provision unit status poll with exponential falloff
// Depends on: Store, Trace, Retry, BLEEngine, WiFiEngine,
//             StateGuardian, NetworkMonitor
// ============================================================
const ProvisionFSM = (() => {

  const STATES = new Set([
    'IDLE','BLE_SCANNING','BLE_CONNECTING','BLE_WRITING','BLE_ACK',
    'AP_PENDING','AP_WRITING',
    'RELAY_SENDING',
    'VERIFY_POLLING','SUCCESS','FAILED',
  ]);

  const VERIFY_TIMEOUT_MS = { GOOD: 90000, DEGRADED: 150000, POOR: 240000, OFFLINE: 0 };
  const STUCK_THRESHOLD   = 5 * 60 * 1000; // 5 min — consider a non-terminal state "stuck"

  let _apCredentials  = null;
  let _lastTransition = null;

  // ── Transition ─────────────────────────────────────────────
  function _transition(state, extra = {}) {
    if (!STATES.has(state)) {
      Trace.error('fsm:invalid_state', state); return;
    }
    const prev = Store.get('provisioning.state');
    if (prev === state) return; // idempotent

    _lastTransition = Date.now();
    const history = [...(Store.get('provisioning.history') || []).slice(-19),
                    { from: prev, to: state, ts: _lastTransition, ...extra }];
    Store.merge('provisioning', { state, error: null, history });
    StateGuardian.checkpoint({ fsm: state });
    Trace.event('fsm:transition', { from: prev, to: state });
  }

  function _fail(msg, extra = {}) {
    Store.merge('provisioning', { state: 'FAILED', error: msg });
    StateGuardian.checkpoint({ fsm: 'FAILED', error: msg });
    Trace.error('fsm:failed', { msg, ...extra });
  }

  // ── Stuck-state watchdog ───────────────────────────────────
  function _checkStuck() {
    const state = Store.get('provisioning.state');
    if (['SUCCESS','FAILED','IDLE'].includes(state)) return;
    if (_lastTransition && Date.now() - _lastTransition > STUCK_THRESHOLD) {
      Trace.error('fsm:stuck', { state, age_min: Math.round((Date.now() - _lastTransition) / 60000) });
      _fail(`Provisioning stuck in ${state} for over 5 minutes — reset and retry`);
      toast('Provisioning appears stuck. Please reset and try again.', 'error');
    }
  }
  setInterval(_checkStuck, 60000);

  // ── BLE path ───────────────────────────────────────────────
  async function startBLE(ssid, password) {
    if (!_validateCreds(ssid, password)) return;
    if (!BLEEngine.isSupported()) {
      toast('Web Bluetooth not available — using WiFi relay instead', 'warn');
      return startRelay(ssid, password);
    }

    _transition('BLE_SCANNING', { mode: 'BLE' });
    setLoading('prov-ble-btn', true);
    _setStatus('Opening Bluetooth device picker…', 'info');

    try {
      _transition('BLE_CONNECTING');
      const result = await BLEEngine.provision(ssid, password, _setStatus);
      _transition('BLE_ACK');
      await _postVerify();
    } catch (err) {
      if (err.userCancelled) { _transition('IDLE'); _setStatus('No device selected', ''); return; }

      Trace.warn('fsm:ble:fail', { msg: err.message });
      toast(`BLE failed: ${err.message}`, 'warn');
      _setStatus('BLE failed — switching to AP mode…', 'warn');
      await _offerAPFallback(ssid, password);
    } finally {
      setLoading('prov-ble-btn', false);
    }
  }

  // ── Relay path ─────────────────────────────────────────────
  async function startRelay(ssid, password) {
    if (!_validateCreds(ssid, password)) return;
    const unit_id = Store.get('unit_id');
    if (!unit_id) { toast('No unit selected', 'error'); return; }

    _transition('RELAY_SENDING', { mode: 'RELAY' });
    setLoading('prov-btn', true);
    try {
      const data = await WiFiEngine.provisionViaRelay(unit_id, ssid, password, _setStatus);
      _showRelayResult(data);
      if (data.mqtt_sent) {
        await _postVerify();
      } else {
        // Queue delivery — still optimistically transition to SUCCESS
        await OfflineQueue.enqueue('PROVISION_WIFI', { unit_id, ssid, password }, unit_id);
        _transition('SUCCESS');
        _setStatus('Credentials queued — will deliver when ESP32 connects', 'warn');
      }
    } catch (err) {
      _fail(err.message);
      toast(err.message, 'error');
    } finally {
      setLoading('prov-btn', false);
    }
  }

  // ── AP mode path ───────────────────────────────────────────
  async function _offerAPFallback(ssid, password) {
    _transition('AP_PENDING', { mode: 'AP' });
    _apCredentials = { ssid, password };

    // Show AP instructions panel
    const banner = document.getElementById('prov-ap-instructions');
    if (banner) {
      banner.style.display = 'block';
      banner.innerHTML = `
        <strong>AP Mode Fallback</strong><br>
        Connect your phone's WiFi to <code>LumaRoK-XXXXXX</code>,
        then tap <button class="btn-sm btn-primary" onclick="ProvisionFSM.confirmAP()">Continue</button>
        or <button class="btn-sm" onclick="ProvisionFSM.skipToRelay()">Use relay instead</button>`;
    }
    _setStatus('Waiting for you to connect to ESP32 AP…', 'warn');
  }

  async function confirmAP() {
    if (!_apCredentials || Store.get('provisioning.state') !== 'AP_PENDING') return;
    const { ssid, password } = _apCredentials;
    _transition('AP_WRITING');
    try {
      await WiFiEngine.provisionViaAP(ssid, password, _setStatus);
      _apCredentials = null;
      document.getElementById('prov-ap-instructions')?.style.setProperty('display', 'none');
      await _postVerify();
    } catch (err) {
      Trace.warn('fsm:ap:fail', err.message);
      _setStatus('AP mode failed — falling back to relay…', 'warn');
      const unit_id = Store.get('unit_id');
      if (unit_id) await startRelay(ssid, password);
      else _fail('AP failed and no unit_id for relay fallback');
    }
  }

  function skipToRelay() {
    if (!_apCredentials) return;
    const { ssid, password } = _apCredentials;
    _apCredentials = null;
    document.getElementById('prov-ap-instructions')?.style.setProperty('display', 'none');
    startRelay(ssid, password);
  }

  // ── Post-provision verify ──────────────────────────────────
  async function _postVerify() {
    const unit_id = Store.get('unit_id');
    if (!unit_id) { _transition('SUCCESS'); _showSuccess(); return; }

    _transition('VERIFY_POLLING');
    const quality  = NetworkMonitor.quality;
    const timeout  = VERIFY_TIMEOUT_MS[quality] || 90000;

    if (quality === 'OFFLINE') {
      // Offline — can't verify; optimistic success
      _transition('SUCCESS');
      _setStatus('Offline — cannot verify online status. Check later.', 'warn');
      return;
    }

    _setStatus(`Waiting for ESP32 to connect… (up to ${Math.round(timeout / 1000)}s)`, 'info');

    try {
      await Retry.poll(
        async () => {
          const { status } = await apiRequest(`/api/units/${encodeURIComponent(unit_id)}/status`);
          return status === 'ONLINE';
        },
        {
          interval: quality === 'POOR' ? 10000 : 5000,
          timeout,
          tag: 'fsm:verify',
          onTick: elapsed => _setStatus(`Waiting for ESP32… (${Math.round(elapsed / 1000)}s / ${Math.round(timeout / 1000)}s)`, 'info'),
        }
      );
      _transition('SUCCESS');
      _showSuccess();
    } catch {
      // Timeout — not a hard failure
      Trace.warn('fsm:verify:timeout', { unit_id, quality });
      _transition('SUCCESS'); // optimistic
      _setStatus('Credentials sent. ESP32 still connecting — check signal if it stays offline.', 'warn');
      document.getElementById('prov-result')?.classList.add('show');
    }
  }

  // ── UI helpers ─────────────────────────────────────────────
  function _setStatus(msg, level = 'info') {
    ['prov-ble-status','prov-result-msg'].forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = msg; el.className = el.className.replace(/\b(info|success|warn|error)\b/g, '') + ' ' + level; }
    });
    if (level === 'warn' || level === 'error') toast(msg, level);
  }

  function _showSuccess() {
    toast('Provisioning complete ✓', 'success');
    document.getElementById('prov-result')?.classList.add('show');
    document.getElementById('prov-result-msg').textContent = 'ESP32 online ✓ — proceed to device binding.';
  }

  function _showRelayResult(data) {
    const el = document.getElementById('prov-result');
    if (el) el.classList.add('show');
    const msg = document.getElementById('prov-result-msg');
    if (msg) msg.textContent = data.message;
    const mqtt = document.getElementById('prov-mqtt');
    if (mqtt) mqtt.textContent = data.mqtt_sent ? '✓ MQTT published' : '⚠ MQTT offline — credentials queued';
  }

  function _validateCreds(ssid, password) {
    if (!ssid?.trim()) { toast('Enter WiFi SSID', 'error'); return false; }
    if (!password || password.length < 8) { toast('Password must be 8+ characters', 'error'); return false; }
    return true;
  }

  // ── Recovery ───────────────────────────────────────────────
  function recover() {
    const saved = Store.get('provisioning.state');
    if (saved === 'SUCCESS') return; // already done
    // Stale non-terminal states should reset to IDLE on recovery
    if (!['IDLE','SUCCESS','FAILED'].includes(saved)) {
      Trace.warn('fsm:recover:reset', { from: saved });
      reset();
    }
  }

  function reset() {
    _apCredentials = null;
    _lastTransition = null;
    Store.merge('provisioning', { state: 'IDLE', error: null, mode: null, history: [] });
    Trace.info('fsm:reset', {});
  }

  return { startBLE, startRelay, confirmAP, skipToRelay, recover, reset };
})();
