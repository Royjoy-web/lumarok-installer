// ============================================================
// LumaRoK — core/store.js
// Observable state store. Replaces APP / INS / WIZ flat globals.
// Depends on: Trace
// ============================================================
const Store = (() => {
  const _state = {
    user:         null,
    unit_id:      null,
    theme:        localStorage.getItem('lmr_theme') || 'dark',
    unit:         null,      // live overview from backend
    devices:      [],
    rooms:        [],
    wizard:       { step: null, unitId: null, total: 5 },
    provisioning: { state: 'IDLE', mode: null, error: null, history: [] },
    commissioning:{ selectedDeviceId: null, checklist: null },
    offlineQueue: [],
    diagnostics:  null,
  };

  const _subs = {}; // path → [fn]

  function _getPath(path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), _state);
  }

  function _setPath(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    const obj  = keys.reduce((o, k) => (o == null ? undefined : o[k]), _state);
    if (!obj) { Trace.warn('store:set', `Bad path: ${path}`); return; }
    const prev = obj[last];
    if (prev === value) return;
    obj[last] = value;
    (_subs[path] || []).forEach(fn => { try { fn(value, prev); } catch (e) { Trace.error('store:sub', e.message); } });
    (_subs['*']  || []).forEach(fn => { try { fn({ path, value, prev }); } catch {} });
    Trace.info('store:set', { path, value });
  }

  function _merge(path, patch) {
    const current = _getPath(path) || {};
    _setPath(path, { ...current, ...patch });
  }

  return {
    get:       path => _getPath(path),
    set:       (path, value) => _setPath(path, value),
    merge:     (path, patch) => _merge(path, patch),
    snapshot:  () => JSON.parse(JSON.stringify(_state)),
    state:     _state, // direct reference for legacy compat reads

    /**
     * Subscribe to path changes. Returns unsubscribe fn.
     * Use '*' to subscribe to all changes.
     */
    subscribe(path, fn) {
      (_subs[path] = _subs[path] || []).push(fn);
      return () => { _subs[path] = (_subs[path] || []).filter(f => f !== fn); };
    },
  };
})();
