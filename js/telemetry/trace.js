// ============================================================
// LumaRoK — telemetry/trace.js
// Structured trace log. Loaded first — no dependencies.
// ============================================================
const Trace = (() => {
  const MAX    = 200;
  const _log   = [];
  const _subs  = [];

  function _push(level, tag, data) {
    const entry = { ts: Date.now(), level, tag, data: data || null };
    _log.push(entry);
    if (_log.length > MAX) _log.shift();
    _subs.forEach(fn => fn(entry));
    if (level === 'error') console.error(`[${tag}]`, data);
    else if (level === 'warn') console.warn(`[${tag}]`, data);
    else console.log(`[${tag}]`, data);
  }

  return {
    info:  (tag, data) => _push('info',  tag, data),
    warn:  (tag, data) => _push('warn',  tag, data),
    error: (tag, data) => _push('error', tag, data),
    event: (tag, data) => _push('event', tag, data),

    /** Returns copy of recent log entries, newest-last */
    dump: (n = 50) => _log.slice(-n).map(e => ({ ...e })),

    /** Subscribe to new entries: fn(entry) */
    subscribe: fn => { _subs.push(fn); return () => { const i = _subs.indexOf(fn); if (i > -1) _subs.splice(i, 1); }; },

    /** Export as downloadable JSON for support */
    export() {
      const blob = new Blob([JSON.stringify(_log, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `lumarok-trace-${Date.now()}.json`;
      a.click();
    },
  };
})();
