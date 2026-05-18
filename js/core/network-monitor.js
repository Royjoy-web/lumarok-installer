// ============================================================
// LumaRoK — core/network-monitor.js
// Adaptive network quality monitor.
// Grades: GOOD | DEGRADED | POOR | OFFLINE
// Patches fetchWithTimeout with adaptive timeouts.
// Depends on: Store, Trace
// ============================================================
const NetworkMonitor = (() => {
  // Quality → timeout multiplier
  const TIMEOUT_MULT = { GOOD: 1, DEGRADED: 2.5, POOR: 5, OFFLINE: 1 };
  const BASE_TIMEOUT = 15000; // ms — replaces the 60s default (which masks failures)

  let _quality  = 'GOOD';
  let _rttSamples = [];
  let _pingTimer  = null;

  // ── Quality assessment ─────────────────────────────────────
  function _grade(rtt) {
    if (!navigator.onLine) return 'OFFLINE';
    const conn = navigator.connection;
    if (conn) {
      if (conn.effectiveType === '2g' || conn.downlink < 0.5) return 'POOR';
      if (conn.effectiveType === '3g' || conn.rtt > 400)      return 'DEGRADED';
    }
    if (rtt > 800) return 'POOR';
    if (rtt > 300) return 'DEGRADED';
    return 'GOOD';
  }

  async function _measureRTT() {
    if (document.visibilityState === 'hidden') return; // skip when backgrounded
    if (!navigator.onLine) { _setQuality('OFFLINE'); return; }
    const t0 = Date.now();
    try {
      await fetch(API_URL + '/health', {
        method: 'GET',
        signal: (AbortSignal.timeout ? AbortSignal.timeout(8000) : (()=>{const c=new AbortController();setTimeout(()=>c.abort(),8000);return c.signal;})()),
        cache:  'no-store',
      });
      const rtt = Date.now() - t0;
      _rttSamples.push(rtt);
      if (_rttSamples.length > 5) _rttSamples.shift();
      const avg = _rttSamples.reduce((a, b) => a + b, 0) / _rttSamples.length;
      _setQuality(_grade(avg));
      Trace.info('net:rtt', { rtt, avg: Math.round(avg), quality: _quality });
    } catch {
      _setQuality(navigator.onLine ? 'POOR' : 'OFFLINE');
    }
  }

  function _setQuality(q) {
    if (_quality === q) return;
    _quality = q;
    Store.set('networkQuality', q);
    Trace.event('net:quality', { quality: q });
    if (q === 'OFFLINE' || q === 'POOR') {
      document.getElementById('net-quality-badge')
        ?.setAttribute('data-quality', q);
    }
  }

  // ── Adaptive timeout ───────────────────────────────────────
  /**
   * Returns a timeout in ms scaled to current network quality.
   * @param {number} base  Base ms (default BASE_TIMEOUT)
   */
  function adaptiveTimeout(base = BASE_TIMEOUT) {
    return Math.round(base * (TIMEOUT_MULT[_quality] || 1));
  }

  // ── Patch fetchWithTimeout in api.js ─────────────────────
  // Intercept after api.js is loaded to inject adaptive timeouts.
  function _patchFetchTimeout() {
    if (typeof fetchWithTimeout !== 'function') return;
    const _orig = fetchWithTimeout;
    window.fetchWithTimeout = function(url, opts, ms) {
      // Only adapt non-auth endpoints
      const isAuth = url.includes('/auth/');
      const timeout = isAuth ? (ms || 15000) : adaptiveTimeout(ms || BASE_TIMEOUT);
      return _orig(url, opts, timeout);
    };
    Trace.info('net:patch', 'fetchWithTimeout patched with adaptive timeouts');
  }

  // ── Network Information API listeners ─────────────────────
  function _bindConnectionEvents() {
    window.addEventListener('offline', () => _setQuality('OFFLINE'));
    window.addEventListener('online',  () => { _quality = 'GOOD'; _measureRTT(); });
    navigator.connection?.addEventListener('change', () => {
      _setQuality(_grade(_rttSamples.at(-1) || 200));
    });
  }

  // ── Start ─────────────────────────────────────────────────
  function start() {
    _patchFetchTimeout();
    _bindConnectionEvents();
    _measureRTT();
    // Re-probe every 45s
    _pingTimer = setInterval(_measureRTT, 45000);
    Trace.info('net:monitor:start', {});
  }

  function stop() {
    clearInterval(_pingTimer);
    _pingTimer = null;
  }

  return {
    start, stop,
    get quality()  { return _quality; },
    get rtt()      { return _rttSamples.at(-1) || null; },
    get avgRTT()   { return _rttSamples.length ? Math.round(_rttSamples.reduce((a, b) => a + b, 0) / _rttSamples.length) : null; },
    adaptiveTimeout,
  };
})();
