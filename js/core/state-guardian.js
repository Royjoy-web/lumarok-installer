// ============================================================
// LumaRoK — core/state-guardian.js
// Onboarding state integrity layer.
// Detects corrupted / stale wizard states and repairs them.
// Depends on: Store, Trace
// ============================================================
const StateGuardian = (() => {
  const VERSION  = 3;
  const SLOT     = 'lmr_wiz_state_v3';
  const MAX_AGE  = 24 * 60 * 60 * 1000; // 24h — stale state is discarded

  const VALID_STEPS = ['UNIT_VALIDATION','WIFI_PROVISION','DEVICE_BINDING','CHECKLIST_REVIEW','SIGN_OFF'];

  // ── Checkpoint ─────────────────────────────────────────────
  /**
   * Write wizard state checkpoint to localStorage.
   * Called by OnboardingWorkflow after each successful step.
   */
  function checkpoint(patch = {}) {
    const snap = {
      v:          VERSION,
      ts:         Date.now(),
      step:       Store.get('wizard.step'),
      unitId:     Store.get('wizard.unitId') || Store.get('unit_id'),
      devices:    (Store.get('devices') || []).map(d => ({ _id: d._id, is_bound: d.is_bound, gpio_pin: d.gpio_pin })),
      fsm:        Store.get('provisioning.state'),
      ...patch,
    };
    try {
      localStorage.setItem(SLOT, JSON.stringify(snap));
      Trace.info('guardian:checkpoint', { step: snap.step, unitId: snap.unitId });
    } catch (e) {
      // localStorage full — rotate old keys, retry once
      _rotateLs();
      try { localStorage.setItem(SLOT, JSON.stringify(snap)); } catch {}
    }
  }

  // ── Recover ────────────────────────────────────────────────
  /**
   * Attempt to restore a previous onboarding session.
   * Returns { recovered: bool, snap }
   */
  function recover() {
    let raw;
    try { raw = JSON.parse(localStorage.getItem(SLOT)); } catch { raw = null; }

    const result = _validate(raw);
    if (!result.ok) {
      Trace.warn('guardian:recover', { reason: result.reason });
      if (result.corrupt) clear(); // discard irreparable state
      return { recovered: false, reason: result.reason };
    }

    const snap = raw;
    Store.merge('wizard',       { step: snap.step, unitId: snap.unitId });
    Store.set('unit_id',       snap.unitId);
    Store.merge('provisioning', { state: snap.fsm || 'IDLE' });
    Trace.event('guardian:recovered', { step: snap.step, unitId: snap.unitId });
    return { recovered: true, snap };
  }

  // ── Validate ───────────────────────────────────────────────
  function _validate(snap) {
    if (!snap)                               return { ok: false, reason: 'no_state' };
    if (snap.v !== VERSION)                  return { ok: false, reason: 'version_mismatch', corrupt: true };
    if (Date.now() - snap.ts > MAX_AGE)      return { ok: false, reason: 'stale', corrupt: true };
    if (!snap.unitId || !snap.unitId.match(/^LMR-/))
                                             return { ok: false, reason: 'invalid_unit_id', corrupt: true };
    if (!VALID_STEPS.includes(snap.step))    return { ok: false, reason: 'invalid_step', corrupt: true };
    return { ok: true };
  }

  // ── Integrity check (run on app boot) ─────────────────────
  /**
   * Scans all lmr_* localStorage keys for corruption.
   * Logs findings. Returns array of issues.
   */
  function audit() {
    const issues = [];
    const raw = localStorage.getItem(SLOT);

    if (raw) {
      try {
        const snap = JSON.parse(raw);
        const v = _validate(snap);
        if (!v.ok) issues.push({ key: SLOT, reason: v.reason, corrupt: v.corrupt });
      } catch {
        issues.push({ key: SLOT, reason: 'parse_error', corrupt: true });
        localStorage.removeItem(SLOT);
      }
    }

    // Check for conflicting unit locks
    const lockKey = 'lmr_unit_lock';
    try {
      const lock = JSON.parse(localStorage.getItem(lockKey) || 'null');
      if (lock && Date.now() - lock.ts > 2 * 60 * 60 * 1000) {
        issues.push({ key: lockKey, reason: 'stale_lock' });
        localStorage.removeItem(lockKey);
      }
    } catch { localStorage.removeItem(lockKey); }

    Trace.info('guardian:audit', { issues: issues.length, details: issues });
    return issues;
  }

  // ── Unit lock (prevents two installers on same unit) ──────
  function acquireLock(unit_id) {
    const lockKey = 'lmr_unit_lock';
    const existing = _parseLock(lockKey);
    if (existing && existing.unit_id !== unit_id && Date.now() - existing.ts < 7200000) {
      Trace.warn('guardian:lock:conflict', { unit_id, held_by: existing.installer_id });
      return false; // conflict — another installer has it
    }
    localStorage.setItem(lockKey, JSON.stringify({
      unit_id,
      installer_id: Store.get('user')?._id || 'unknown',
      ts: Date.now(),
    }));
    Trace.info('guardian:lock:acquired', { unit_id });
    return true;
  }

  function releaseLock() {
    localStorage.removeItem('lmr_unit_lock');
    Trace.info('guardian:lock:released', {});
  }

  function _parseLock(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  }

  // ── Clear ─────────────────────────────────────────────────
  function clear() {
    localStorage.removeItem(SLOT);
    Trace.info('guardian:cleared', {});
  }

  function _rotateLs() {
    // Remove oldest lmr_ keys to free space
    const lmrKeys = Object.keys(localStorage).filter(k => k.startsWith('lmr_'));
    lmrKeys.slice(0, Math.max(1, Math.floor(lmrKeys.length / 2))).forEach(k => localStorage.removeItem(k));
  }

  return { checkpoint, recover, audit, acquireLock, releaseLock, clear };
})();
