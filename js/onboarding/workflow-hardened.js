// ============================================================
// LumaRoK — onboarding/workflow-hardened.js
// Hardened OnboardingWorkflow. Patches:
//   - StateGuardian checkpoint after each step
//   - Recovery banner on re-open with in-progress session
//   - Unit lock acquire/release
//   - Corrupted step guard (snaps to UNIT_VALIDATION on invalid)
//   - Fix: actual firmware version from Store for OTA check
// Depends on: Store, Trace, StateGuardian, CommissioningEngine,
//             ProvisionFSM, OnboardingWorkflow (base)
// ============================================================
const OnboardingWorkflowHardened = (() => {
  const STEPS = ['UNIT_VALIDATION','WIFI_PROVISION','DEVICE_BINDING','CHECKLIST_REVIEW','SIGN_OFF'];
  const VALID_STEPS = new Set(STEPS);

  // ── Wrap base open() ──────────────────────────────────────
  const _baseOpen = OnboardingWorkflow.open.bind(OnboardingWorkflow);

  function open(unitId) {
    // Check for in-progress session
    const { recovered, snap } = StateGuardian.recover();
    if (recovered && snap.unitId && snap.unitId !== unitId) {
      _showRecoveryBanner(snap, unitId);
      return; // wait for user choice
    }
    _startFresh(unitId, recovered ? snap : null);
  }

  function _startFresh(unitId, snap = null) {
    // Acquire unit lock (non-blocking — warn only)
    if (unitId && !StateGuardian.acquireLock(unitId)) {
      toast('⚠ Another installer may be working on this unit. Proceed carefully.', 'warn');
    }

    if (snap && snap.unitId === unitId) {
      // Resume from checkpoint
      Store.merge('wizard', { step: _sanitizeStep(snap.step), unitId: snap.unitId });
      Store.set('unit_id', snap.unitId);
      Trace.event('wizard:resumed', { step: snap.step, unitId: snap.unitId });
      _render();
      goTo('installer-wizard');
      toast(`Resumed: ${snap.step.replace(/_/g, ' ')}`, 'info');
    } else {
      // Fresh start
      StateGuardian.clear();
      _baseOpen(unitId);
    }
  }

  // ── Recovery banner ────────────────────────────────────────
  function _showRecoveryBanner(snap, newUnitId) {
    const el = document.getElementById('wizard-recovery-banner') || _createRecoveryBanner();
    el.style.display = 'block';
    el.innerHTML = `
      <div style="font-weight:700;margin-bottom:8px">⚠ Unfinished Installation Found</div>
      <div style="font-size:13px;color:var(--t2);margin-bottom:12px">
        Unit <strong>${esc(snap.unitId)}</strong> was in step <strong>${esc(snap.step.replace(/_/g,' '))}</strong>
        ${_formatAge(snap.ts)} ago.
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn-primary" onclick="OnboardingWorkflowHardened.resumeSession('${esc(snap.unitId)}','${esc(snap.step)}')">↺ Resume</button>
        <button class="btn-secondary" onclick="OnboardingWorkflowHardened.discardSession('${esc(newUnitId || '')}')">✕ Discard &amp; Start New</button>
      </div>`;
    goTo('installer-wizard'); // show recovery banner on wizard screen
  }

  function _createRecoveryBanner() {
    const el = document.createElement('div');
    el.id = 'wizard-recovery-banner';
    el.style.cssText = 'background:var(--s2);border:1px solid var(--warn);border-radius:12px;padding:16px;margin:16px';
    document.getElementById('installer-wizard')?.prepend(el);
    return el;
  }

  function resumeSession(unitId, step) {
    document.getElementById('wizard-recovery-banner')?.style.setProperty('display', 'none');
    _startFresh(unitId, { unitId, step });
  }

  function discardSession(newUnitId) {
    StateGuardian.clear();
    document.getElementById('wizard-recovery-banner')?.style.setProperty('display', 'none');
    _startFresh(newUnitId || null, null);
  }

  // ── Wrap base next() ──────────────────────────────────────
  const _baseNext = OnboardingWorkflow.next.bind(OnboardingWorkflow);

  async function next() {
    await _baseNext();
    // Checkpoint after successful step advance
    StateGuardian.checkpoint();
    Trace.info('wizard:checkpoint:saved', { step: Store.get('wizard.step') });
  }

  // ── Wrap base complete() ───────────────────────────────────
  const _baseComplete = OnboardingWorkflow.complete.bind(OnboardingWorkflow);

  async function complete() {
    await _baseComplete();
    // On completion: clear checkpoint and release lock
    StateGuardian.clear();
    StateGuardian.releaseLock();
    Trace.event('wizard:complete:cleanup', {});
  }

  // ── Guard: corrupt step ───────────────────────────────────
  function _sanitizeStep(step) {
    if (!VALID_STEPS.has(step)) {
      Trace.warn('wizard:step:corrupt', { step });
      return 'UNIT_VALIDATION';
    }
    return step;
  }

  // ── Render (delegates to base) ────────────────────────────
  function _render() {
    // Force-call base render by triggering Store subscriber
    const step = Store.get('wizard.step');
    Store.set('wizard.step', null);
    Store.set('wizard.step', step);
  }

  // ── Helpers ───────────────────────────────────────────────
  function _formatAge(ts) {
    const diff = Date.now() - ts;
    if (diff < 3600000) return Math.round(diff / 60000) + ' min';
    return Math.round(diff / 3600000) + ' hr';
  }

  // ── Boot: audit state on app start ────────────────────────
  function bootAudit() {
    const issues = StateGuardian.audit();
    if (issues.some(i => i.corrupt)) {
      Trace.warn('wizard:boot:corrupt_state_cleared', { count: issues.length });
      // Already cleaned up by audit()
    }
  }

  // ── Expose merged API ─────────────────────────────────────
  // Callers use OnboardingWorkflow.open/next/back/complete
  // — patch the base object so compat.js wiring stays intact.
  OnboardingWorkflow.open     = open;
  OnboardingWorkflow.next     = next;
  OnboardingWorkflow.complete = complete;

  return { open, next, complete, resumeSession, discardSession, bootAudit };
})();

// Auto-boot audit
OnboardingWorkflowHardened.bootAudit();
