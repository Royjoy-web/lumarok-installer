// ============================================
// LUMAROK — js/router.js
// Hash-based SPA router — fixes broken browser back button
// Replaces manual show/hide screen switching
// ============================================

const Router = (() => {
  // Screens that require auth
  const AUTH_SCREENS = ['dashboard','rooms','scenes','members','energy','settings','aichat','homestatus','installer-hub','installer-bind','installer-provision','installer-wizard','installer-diagnostics'];
  // Screens that redirect to dashboard if already authed
  const PUBLIC_SCREENS = ['login','register','splash','account-setup'];

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

    const isAuthed = !!getToken() && !!loadUser();

    // Auth guard
    if (AUTH_SCREENS.includes(screen) && !isAuthed) {
      navigate('login', { replace:true }); return;
    }
    if (PUBLIC_SCREENS.includes(screen) && isAuthed && screen !== 'splash') {
      const user = loadUser();
      if (user && (user.role === 'installer' || user.role === 'admin')) {
        navigate('installer-hub', { replace:true });
      } else {
        navigate('dashboard', { replace:true });
      }
      return;
    }

    // Show the screen
    if (typeof goTo === 'function') {
      goTo(screen);
    }
  };

  // Listen for hash changes
  window.addEventListener('hashchange', handleRoute);
  
  // Initial route
  window.addEventListener('DOMContentLoaded', () => {
    // Small delay to let initApp handle splash logic if it wants
    setTimeout(handleRoute, 100);
  });

  return { navigate, handleRoute };
})();
