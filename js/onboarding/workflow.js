// ============================================================
// LumaRoK — onboarding/workflow.js
// 5-step commissioning wizard. Replaces WIZ global + wizard fns.
// Named states replace integer step counter.
// Depends on: Store, Trace, Retry, CommissioningEngine, ProvisionFSM
// ============================================================
const OnboardingWorkflow = (() => {
  const STEPS = [
    'UNIT_VALIDATION',  // step 1 — enter/scan unit ID, status gate, OTA check
    'WIFI_PROVISION',   // step 2 — provision WiFi (delegates to ProvisionFSM)
    'DEVICE_BINDING',   // step 3 — bind devices
    'CHECKLIST_REVIEW', // step 4 — review checklist
    'SIGN_OFF',         // step 5 — OTA update + handoff
  ];
  const TOTAL = STEPS.length;

  function _idx()     { return STEPS.indexOf(Store.get('wizard.step')); }
  function _stepNum() { return _idx() + 1; }

  // ── Open ───────────────────────────────────────────────────
  function open(unitId) {
    Store.merge('wizard', { step: STEPS[0], unitId: unitId || Store.get('unit_id') || '' });
    if (unitId) Store.set('unit_id', unitId);
    const inp = document.getElementById('wiz-unit-id');
    if (inp) inp.value = Store.get('wizard.unitId');
    ProvisionFSM.reset();
    _render();
    goTo('installer-wizard');
    Trace.event('wizard:open', { unitId });
  }

  // ── Render current step ────────────────────────────────────
  function _render() {
    const idx = _idx();
    const lbl = document.getElementById('wiz-step-label');
    const bar = document.getElementById('wiz-progress');
    if (lbl) lbl.textContent = `Step ${_stepNum()} / ${TOTAL}`;
    if (bar) bar.style.width = `${Math.round(_stepNum() / TOTAL * 100)}%`;

    document.querySelectorAll('.wiz-panel').forEach((p, i) => {
      p.style.display = (i === idx) ? 'block' : 'none';
    });

    // Step-specific setup
    const step = STEPS[idx];
    if (step === 'UNIT_VALIDATION')  _onEnterUnitValidation();
    if (step === 'CHECKLIST_REVIEW') _onEnterChecklist();
    if (step === 'SIGN_OFF')         _onEnterSignOff();
  }

  // ── Navigation ─────────────────────────────────────────────
  async function next() {
    const step = Store.get('wizard.step');

    if (step === 'UNIT_VALIDATION') {
      const v = document.getElementById('wiz-unit-id')?.value?.trim();
      if (!v) { toast('Enter a unit ID', 'error'); return; }
      Store.merge('wizard', { unitId: v });
      Store.set('unit_id', v);

      // Status gate
      try {
        const { status } = await apiRequest(`/api/units/${encodeURIComponent(v)}/status`);
        if (status === 'BATCH_QUEUED') { toast('Unit not yet flashed. Contact factory.', 'error'); return; }
        if (status === 'NVS_FLASHED')  { toast('Unit flashed but not confirmed. Re-run station.py confirm.', 'error'); return; }
      } catch (err) {
        Trace.warn('wizard:status_gate', err.message); // non-blocking
      }
      await _checkOTA(v);
    }

    const idx = _idx();
    if (idx < TOTAL - 1) {
      Store.set('wizard.step', STEPS[idx + 1]);
      _render();
      Trace.event('wizard:next', { step: STEPS[idx + 1] });
    }
  }

  function back() {
    const idx = _idx();
    if (idx > 0) { Store.set('wizard.step', STEPS[idx - 1]); _render(); }
    else goTo('installer-hub');
  }

  async function complete() {
    openCompleteModal(Store.get('wizard.unitId'));
  }

  // ── Step handlers ──────────────────────────────────────────
  function _onEnterUnitValidation() {
    const unitId = Store.get('wizard.unitId');
    if (unitId) _checkOTA(unitId);
  }

  async function _onEnterChecklist() {
    const el = document.getElementById('wiz-checklist-preview');
    if (!el) return;
    const unitId = Store.get('wizard.unitId');
    try {
      const data = await Installer.getChecklist(unitId);
      el.innerHTML = data.checks.map(c =>
        `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--s2);font-size:13px">
          <span>${c.done ? '✅' : '⏳'}</span>
          <span style="color:${c.done ? 'var(--t1)' : 'var(--t3)'}">${esc(c.label)}</span>
        </div>`
      ).join('');
    } catch { el.innerHTML = '<div style="color:var(--t3);font-size:12px">Could not load checklist</div>'; }
  }

  async function _onEnterSignOff() {
    const el  = document.getElementById('wiz-complete-status');
    const btn = document.getElementById('wiz-complete-btn');
    const otaBanner = document.getElementById('wiz-ota-update-banner');
    if (!el) return;

    const unitId = Store.get('wizard.unitId');
    try {
      // OTA check (fix: use actual firmware version from unit overview)
      const unit = Store.get('unit');
      const currentFw = unit?.firmware_version || '0.0.0';
      try {
        const { has_update, latest_version, url } = await apiRequest(
          `/api/firmware/latest?unit_id=${encodeURIComponent(unitId)}&current_version=${encodeURIComponent(currentFw)}`
        );
        if (otaBanner && has_update) {
          otaBanner.style.display = 'block';
          otaBanner.innerHTML = `⚡ Firmware update available (v${latest_version}) — <button class="btn-sm btn-primary" onclick="openOTAForUnit('${esc(unitId)}','${esc(latest_version)}','${esc(url)}')">Install over WiFi</button>`;
        } else if (otaBanner) {
          otaBanner.style.display = 'none';
        }
      } catch {}

      const data = await Installer.getChecklist(unitId);
      if (data.setup_complete) {
        el.innerHTML = '<span style="color:#10B981">✅ All required steps complete. Ready to activate.</span>';
        if (btn) btn.disabled = false;
      } else {
        el.innerHTML = `<span style="color:#f87171">⚠️ ${data.progress} steps done — complete remaining steps first.</span>`;
        if (btn) btn.disabled = true;
      }
    } catch { el.textContent = 'Could not verify checklist.'; }
  }

  async function _checkOTA(unitId) {
    const banner = document.getElementById('wiz-ota-banner');
    if (!banner || !unitId) return;
    try {
      const unit = Store.get('unit');
      const currentFw = unit?.firmware_version || '0.0.0';
      const { has_update, latest_version } = await apiRequest(
        `/api/firmware/latest?unit_id=${encodeURIComponent(unitId)}&current_version=${encodeURIComponent(currentFw)}`
      );
      banner.style.display = has_update ? 'block' : 'none';
      if (has_update) banner.innerHTML = `⚡ Firmware update available (v${latest_version}). Come back to Step 5 after WiFi provisioning.`;
    } catch { banner.style.display = 'none'; }
  }

  return { open, next, back, complete };
})();

// ── OTA helper (preserved from original) ──────────────────────
async function openOTAForUnit(unitId, version, url) {
  try {
    const firmwareUrl = url || (await apiRequest(`/api/firmware/latest?unit_id=${encodeURIComponent(unitId)}&current_version=0.0.0`)).url;
    if (!firmwareUrl) { toast('No firmware URL available', 'error'); return; }
    await apiRequest('/api/firmware/ota', 'POST', { unit_id: unitId, firmware_url: firmwareUrl, version });
    toast(`OTA v${version} sent to ${unitId} ✓`, 'success');
    Trace.event('ota:triggered', { unitId, version });
  } catch (err) { toast(err.message || 'OTA failed', 'error'); }
}
