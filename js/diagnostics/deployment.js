// ============================================================
// LumaRoK — diagnostics/deployment.js
// Enterprise deployment diagnostics.
// Runs on demand or on hard errors. Emits structured JSON report
// for support escalation. Extends DiagnosticsPipeline.
// Depends on: Store, Trace, NetworkMonitor, StateGuardian, OfflineQueue
// ============================================================
const DeploymentDiagnostics = (() => {

  // ── Full diagnostic run ────────────────────────────────────
  async function run(unit_id) {
    const uid = unit_id || Store.get('unit_id');
    const report = {
      generated_at:    new Date().toISOString(),
      installer_id:    Store.get('user')?._id,
      installer_name:  Store.get('user')?.name,
      unit_id:         uid,
      environment:     _environmentSnapshot(),
      network:         _networkSnapshot(),
      provisioning:    _provisioningSnapshot(),
      wizard:          _wizardSnapshot(),
      queue:           await _queueSnapshot(),
      state_integrity: _integritySnapshot(),
      unit_health:     null,
      trace:           Trace.dump(100),
    };

    if (uid) {
      report.unit_health = await _fetchUnitHealth(uid);
    }

    Trace.event('diag:report:generated', { unit_id: uid });
    return report;
  }

  // ── Run and render into diagnostics screen ─────────────────
  async function runAndRender(unit_id) {
    const el = document.getElementById('diag-deployment-report');
    if (el) el.innerHTML = '<div style="color:var(--t3);font-size:12px">Running diagnostics…</div>';

    const report = await run(unit_id);
    if (el) el.innerHTML = _renderReport(report);
    return report;
  }

  // ── Snapshots ─────────────────────────────────────────────
  function _environmentSnapshot() {
    return {
      user_agent:     navigator.userAgent,
      platform:       navigator.platform,
      bluetooth:      !!navigator.bluetooth,
      serial:         !!navigator.serial,
      indexed_db:     !!window.indexedDB,
      service_worker: !!navigator.serviceWorker,
      online:         navigator.onLine,
      pwa_installed:  window.matchMedia('(display-mode: standalone)').matches,
      screen:         `${screen.width}x${screen.height}`,
      memory_mb:      navigator.deviceMemory || 'unknown',
      cpu_cores:      navigator.hardwareConcurrency || 'unknown',
    };
  }

  function _networkSnapshot() {
    const conn = navigator.connection || {};
    return {
      quality:          NetworkMonitor.quality,
      rtt_ms:           NetworkMonitor.rtt,
      avg_rtt_ms:       NetworkMonitor.avgRTT,
      effective_type:   conn.effectiveType || 'unknown',
      downlink_mbps:    conn.downlink      || 'unknown',
      save_data:        conn.saveData      || false,
      api_url:          API_URL,
    };
  }

  function _provisioningSnapshot() {
    return {
      state:   Store.get('provisioning.state'),
      mode:    Store.get('provisioning.mode'),
      error:   Store.get('provisioning.error'),
      history: Store.get('provisioning.history') || [],
    };
  }

  function _wizardSnapshot() {
    return {
      step:   Store.get('wizard.step'),
      unitId: Store.get('wizard.unitId'),
    };
  }

  async function _queueSnapshot() {
    try {
      const items = await OfflineQueue.list();
      return {
        count:  items.length,
        types:  items.reduce((acc, i) => { acc[i.type] = (acc[i.type] || 0) + 1; return acc; }, {}),
        oldest: items.length ? new Date(items[0].queued_at).toISOString() : null,
      };
    } catch { return { error: 'Could not read queue' }; }
  }

  function _integritySnapshot() {
    const issues = StateGuardian.audit();
    return {
      issues_found: issues.length,
      issues,
      ls_keys: Object.keys(localStorage).filter(k => k.startsWith('lmr_')),
    };
  }

  async function _fetchUnitHealth(unit_id) {
    try {
      const data = await Installer.getOverview(unit_id);
      const u    = data.unit;
      return {
        status:           u.status,
        firmware_version: u.firmware_version,
        rssi_dbm:         u.rssi,
        ip_address:       u.ip_address,
        last_seen:        u.last_seen,
        devices_total:    data.summary.total_devices,
        devices_bound:    data.summary.bound,
        devices_online:   data.summary.online,
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  // ── Render ─────────────────────────────────────────────────
  function _renderReport(report) {
    const { environment: env, network, provisioning, wizard, queue, state_integrity, unit_health } = report;
    const _row = (label, value, warn = false) =>
      `<div class="diag-row ${warn ? 'warn' : ''}"><span>${label}</span><span>${esc(String(value))}</span></div>`;
    const _section = (title, rows) =>
      `<div class="diag-section"><div class="diag-section-title">${title}</div>${rows}</div>`;

    const envSec = _section('Environment',
      _row('Browser', env.user_agent.split(' ').slice(-2).join(' ')) +
      _row('Bluetooth', env.bluetooth ? '✅ Available' : '❌ Not available', !env.bluetooth) +
      _row('PWA Installed', env.pwa_installed ? '✅ Yes' : '⚠ Running in browser', !env.pwa_installed) +
      _row('IndexedDB', env.indexed_db ? '✅ Yes' : '❌ No', !env.indexed_db) +
      _row('RAM', env.memory_mb !== 'unknown' ? `${env.memory_mb} GB` : 'Unknown') +
      _row('CPU Cores', env.cpu_cores));

    const netSec = _section('Network',
      _row('Quality', network.quality, network.quality === 'POOR' || network.quality === 'OFFLINE') +
      _row('RTT', network.rtt_ms != null ? `${network.rtt_ms}ms` : '—') +
      _row('Avg RTT', network.avg_rtt_ms != null ? `${network.avg_rtt_ms}ms` : '—') +
      _row('Type', network.effective_type) +
      _row('Downlink', network.downlink_mbps !== 'unknown' ? `${network.downlink_mbps} Mbps` : '—') +
      _row('API URL', network.api_url));

    const provSec = _section('Provisioning',
      _row('State', provisioning.state, provisioning.state === 'FAILED') +
      _row('Mode', provisioning.mode || '—') +
      (provisioning.error ? _row('Error', provisioning.error, true) : '') +
      _row('History steps', provisioning.history.length));

    const queueSec = _section('Offline Queue',
      _row('Pending actions', queue.count, queue.count > 0) +
      _row('Types', queue.types ? Object.entries(queue.types).map(([k, v]) => `${k}×${v}`).join(', ') : '—') +
      _row('Oldest', queue.oldest || '—'));

    const integritySec = _section('State Integrity',
      _row('Issues', state_integrity.issues_found, state_integrity.issues_found > 0) +
      state_integrity.issues.map(i => _row(i.key, i.reason, true)).join(''));

    const unitSec = unit_health ? _section('Unit Health',
      _row('Status', unit_health.status, unit_health.status !== 'ONLINE') +
      _row('Firmware', unit_health.firmware_version || '—') +
      _row('RSSI', unit_health.rssi_dbm != null ? `${unit_health.rssi_dbm} dBm` : '—',
           unit_health.rssi_dbm != null && unit_health.rssi_dbm < -75) +
      _row('IP', unit_health.ip_address || '—') +
      _row('Devices', `${unit_health.devices_bound}/${unit_health.devices_total} bound, ${unit_health.devices_online} online`))
      : '';

    return `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <span style="font-size:12px;color:var(--t3)">${report.generated_at}</span>
        <div style="display:flex;gap:8px">
          <button class="btn-sm" onclick="DeploymentDiagnostics.exportReport()">📥 Export</button>
          <button class="btn-sm btn-primary" onclick="DeploymentDiagnostics.runAndRender()">↺ Refresh</button>
        </div>
      </div>
      ${envSec}${netSec}${provSec}${queueSec}${integritySec}${unitSec}`;
  }

  // ── Export ─────────────────────────────────────────────────
  let _lastReport = null;

  async function exportReport(unit_id) {
    _lastReport = await run(unit_id);
    const blob = new Blob([JSON.stringify(_lastReport, null, 2)], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `lumarok-diag-${Store.get('unit_id') || 'nounit'}-${Date.now()}.json`;
    a.click();
    Trace.event('diag:exported', {});
  }

  // ── Auto-run on hard errors ────────────────────────────────
  window.addEventListener('unhandledrejection', async e => {
    const msg = e.reason?.message || String(e.reason);
    if (msg.includes('provision') || msg.includes('BLE') || msg.includes('GATT')) {
      Trace.error('diag:auto-run:unhandled', msg);
      await run(Store.get('unit_id')).then(r => { _lastReport = r; }).catch(() => {});
    }
  });

  return { run, runAndRender, exportReport };
})();
