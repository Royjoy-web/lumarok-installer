// ============================================================
// LumaRoK — diagnostics/pipeline.js
// Unified diagnostics: unit health, connectivity, log tail,
// offline queue viewer, RSSI, trace export.
// Depends on: Store, Trace, Retry, Installer (api.js)
// ============================================================
const DiagnosticsPipeline = (() => {

  // ── Unit health card ───────────────────────────────────────
  async function loadHealth(unit_id) {
    const el = document.getElementById('diag-health-card');
    if (!el) return;
    el.innerHTML = '<div style="color:var(--t3);font-size:12px">Loading…</div>';

    try {
      const data = await Installer.getOverview(unit_id);
      const u    = data.unit;
      const rssi = u.rssi ? _rssiBar(u.rssi) : '—';
      el.innerHTML = `
        <div class="diag-row"><span>Status</span><span class="ins-dev-badge ${(u.status||'').toLowerCase()}">${esc(u.status || '—')}</span></div>
        <div class="diag-row"><span>Firmware</span><span>${esc(u.firmware_version || '—')}</span></div>
        <div class="diag-row"><span>IP Address</span><span>${esc(u.ip_address || '—')}</span></div>
        <div class="diag-row"><span>Signal (RSSI)</span><span>${rssi} ${u.rssi ? `(${u.rssi} dBm)` : ''}</span></div>
        <div class="diag-row"><span>Last Seen</span><span>${u.last_seen ? _relTime(u.last_seen) : '—'}</span></div>
        <div class="diag-row"><span>Devices</span><span>${data.summary.bound}/${data.summary.total_devices} bound, ${data.summary.online} online</span></div>`;
      Trace.info('diag:health', { unit_id, status: u.status, rssi: u.rssi });
      return data;
    } catch (err) {
      el.innerHTML = `<div style="color:var(--err);font-size:12px">Failed: ${esc(err.message)}</div>`;
      Trace.error('diag:health', err.message);
    }
  }

  // ── Connectivity test (round-trip via identify echo) ──────
  async function runConnectivityTest(unit_id, device_id) {
    const el = document.getElementById('diag-ping-result');
    if (el) el.textContent = 'Testing…';
    const t0 = Date.now();
    try {
      const data = await Installer.identify(unit_id, device_id, 1);
      const rtt  = Date.now() - t0;
      const msg  = data.mqtt_sent
        ? `✅ MQTT round-trip: ${rtt}ms`
        : `⚠️ MQTT offline — unit not reachable`;
      if (el) el.textContent = msg;
      Trace.event('diag:ping', { unit_id, device_id, rtt, mqtt_sent: data.mqtt_sent });
      return { rtt, mqtt_sent: data.mqtt_sent };
    } catch (err) {
      if (el) el.textContent = `❌ ${err.message}`;
      Trace.error('diag:ping', err.message);
    }
  }

  // ── Log tail ───────────────────────────────────────────────
  async function loadLogTail(unit_id, limit = 20) {
    const el = document.getElementById('diag-log-tail');
    if (!el) return;
    try {
      const data = await apiRequest(`/api/logs?unit_id=${encodeURIComponent(unit_id)}&limit=${limit}&category=installer`);
      const logs = data.logs || [];
      if (!logs.length) { el.innerHTML = '<div style="color:var(--t3);font-size:12px">No installer logs yet</div>'; return; }
      el.innerHTML = logs.map(l => `
        <div class="diag-log-row">
          <span class="diag-log-ts">${_relTime(l.created_at)}</span>
          <span class="diag-log-action">${esc(l.action)}</span>
          <span class="diag-log-user">${esc(l.user_name || '—')}</span>
        </div>`).join('');
    } catch (err) {
      el.innerHTML = `<div style="color:var(--t3);font-size:12px">Could not load logs: ${esc(err.message)}</div>`;
    }
  }

  // ── Offline queue viewer ───────────────────────────────────
  async function renderQueueViewer() {
    const el = document.getElementById('diag-queue-list');
    if (!el) return;
    const items = await OfflineQueue.list();
    if (!items.length) { el.innerHTML = '<div style="color:var(--t3);font-size:12px">No pending actions</div>'; return; }
    el.innerHTML = items.map(item => `
      <div class="diag-queue-row">
        <span>${esc(item.type)}</span>
        <span style="color:var(--t3);font-size:11px">${esc(item.unitId)} · ${item.retries} retries</span>
        <button class="btn-sm" onclick="OfflineQueue.remove(${item.id}).then(()=>DiagnosticsPipeline.renderQueueViewer())">✕</button>
      </div>`).join('');
  }

  // ── Trace viewer ──────────────────────────────────────────
  function renderTraceViewer() {
    const el = document.getElementById('diag-trace-log');
    if (!el) return;
    const entries = Trace.dump(50);
    el.innerHTML = entries.reverse().map(e => `
      <div class="diag-trace-row ${e.level}">
        <span class="diag-trace-ts">${new Date(e.ts).toLocaleTimeString()}</span>
        <span class="diag-trace-tag">${esc(e.tag)}</span>
        <span class="diag-trace-data">${esc(typeof e.data === 'object' ? JSON.stringify(e.data) : String(e.data || ''))}</span>
      </div>`).join('');
  }

  // ── Open diagnostics screen ────────────────────────────────
  async function open(unit_id) {
    const uid = unit_id || Store.get('unit_id');
    if (!uid) { toast('No unit selected', 'error'); return; }
    goTo('installer-diagnostics');
    await Promise.allSettled([loadHealth(uid), loadLogTail(uid), renderQueueViewer()]);
    renderTraceViewer();
  }

  // ── Helpers ───────────────────────────────────────────────
  function _rssiBar(dBm) {
    if (dBm >= -50) return '████ Excellent';
    if (dBm >= -65) return '███░ Good';
    if (dBm >= -75) return '██░░ Fair';
    return '█░░░ Weak';
  }

  function _relTime(iso) {
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60000)   return 'just now';
    if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
    if (diff < 86400000)return Math.floor(diff / 3600000) + 'h ago';
    return Math.floor(diff / 86400000) + 'd ago';
  }

  return { open, loadHealth, runConnectivityTest, loadLogTail, renderQueueViewer, renderTraceViewer };
})();
