// ── HOME STATUS INDICATOR ─────────────────────────────────────
const HomeStatus = (() => {
  const STATUS = {
    live:        { label:'Home is Live',            sub:'Everything is running',              color:'#22c55e', pulse:true  },
    connecting:  { label:'Connecting\u2026',         sub:'Waking up your home',                color:'#f59e0b', pulse:true  },
    offline:     { label:'Home is Offline',          sub:'Check your internet connection',     color:'#ef4444', pulse:false },
    unreachable: { label:'Temporarily Unreachable',  sub:'Controls will resume automatically', color:'#f59e0b', pulse:false },
  };

  let _el = null;

  function render(status, lastSeen) {
    const s = STATUS[status] || STATUS.offline;
    const sub = (status === 'offline' && lastSeen) ? `Last seen ${lastSeen}` : s.sub;
    if (!_el) return;
    _el.innerHTML = `
      <span class="hs-dot-wrap">
        ${s.pulse ? `<span class="hs-ripple" style="background:${s.color}"></span>` : ''}
        <span class="hs-dot ${s.pulse?'hs-pulse':''}" style="background:${s.color}"></span>
      </span>
      <span class="hs-text">
        <span class="hs-label">${s.label}</span>
        <span class="hs-sub">${sub}</span>
      </span>`;
  }

  function init() {
    _el = document.getElementById('home-status-bar');
    if (!_el) return;
    set('connecting');
    // Listen to API health via polling
    _poll();
  }

  async function _poll() {
    try {
      const r = await fetch((typeof API_URL !== 'undefined' ? API_URL : '') + '/api/health', { headers: authHeaders?.() || {} });
      set(r.ok ? 'live' : 'offline');
    } catch { set('offline'); }
    setTimeout(_poll, 30000);
  }

  function set(status, lastSeen) { render(status, lastSeen); }

  return { init, set };
})();

document.addEventListener('DOMContentLoaded', HomeStatus.init);
