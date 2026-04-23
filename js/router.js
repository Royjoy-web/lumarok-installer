// ============================================
// LUMAROK — js/router.js
// Hash-based SPA router — fixes broken browser back button
// Replaces manual show/hide screen switching
// ============================================

const Router = (() => {
  // Screens that require auth
  const AUTH_SCREENS = ['dashboard','rooms','scenes','members','energy','settings','aichat','homestatus'];
  // Screens that redirect to dashboard if already authed
  const PUBLIC_SCREENS = ['login','register','splash'];

  const navigate = (screenId, opts={}) => {
    const { replace=false, params={} } = opts;
    const hash = '#' + screenId + (Object.keys(params).length ? '?' + new URLSearchParams(params) : '');
    if (replace) window.location.replace(hash);
    else         window.location.hash = hash;
  };

  const handleRoute = () => {
    let [screen, query=''] = window.location.hash.replace('#','').split('?');
    screen = screen || 'splash';
    const params = Object.fromEntries(new URLSearchParams(query));

    const isAuthed = !!getToken() && !!APP.user;

    // Auth guard
    if (AUTH_SCREENS.includes(screen) && !isAuthed) {
      navigate('login', { replace:true }); return;
    }
    if (PUBLIC_SCREENS.includes(screen) && isAuthed && screen !== 'splash') {
      navigate('dashboard', { replace:true }); return;
    }

    // Show screen
    goTo(screen);

    // Trigger screen-specific load
    switch (screen) {
      case 'dashboard':  buildDashboard?.();   break;
      case 'rooms':      loadRooms?.();        break;
      case 'scenes':     loadScenes?.();       break;
      case 'members':    loadMembers?.();      break;
      case 'energy':     loadEnergy?.();       break;
      case 'settings':   loadSettings?.();     break;
      case 'aichat':     initAiChat?.();       break;
      case 'homestatus': loadHomeStatus?.();   break;
    }
  };

  const init = () => {
    window.addEventListener('hashchange', handleRoute);
    handleRoute(); // handle initial load
  };

  return { init, navigate };
})();

// ── Upgrade global goTo to use router ────────────────────────
// Keep goTo() working for legacy calls but push to hash
const _origGoTo = typeof goTo === 'function' ? goTo : null;
// goTo is redefined below to also update hash
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(id);
  if (el) {
    APP.prevScreen    = APP.currentScreen;
    APP.currentScreen = id;
    el.classList.add('active');
    el.scrollTop = 0;
    // Keep URL in sync
    if (window.location.hash !== '#'+id) {
      history.replaceState(null, '', '#'+id);
    }
  }
}
