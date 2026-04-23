// ============================================
// LUMAROK — js/app.js
// Navigation, global state, utilities
// ============================================

// ── GLOBAL STATE ─────────────────────────────
const APP = {
  currentScreen: 'splash',
  user: null,
  unit_id: null,
  rooms: [],
  devices: [],
  theme: localStorage.getItem('lmr_theme') || 'dark'
};

// ── XSS SANITIZER ────────────────────────────
// Use esc() on ALL user/API data rendered into innerHTML
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── NAVIGATION ───────────────────────────────
function goTo(id) {
  document.querySelectorAll('.screen').forEach(s => {
    s.classList.remove('active');
  });
  const el = document.getElementById(id);
  if (el) {
    APP.prevScreen    = APP.currentScreen;
    APP.currentScreen = id;
    el.classList.add('active');
    el.scrollTop = 0; // scroll to top on navigate
  }
}

// ── TOAST QUEUE ──────────────────────────────────────────────
const _toastQueue = [];
let   _toastActive = false;
let   _toastTimer;

function toast(msg, type = 'success') {
  _toastQueue.push({ msg, type });
  if (!_toastActive) _toastNext();
}

function _toastNext() {
  if (!_toastQueue.length) { _toastActive = false; return; }
  _toastActive = true;
  const { msg, type } = _toastQueue.shift();
  const t   = document.getElementById('toast');
  const txt = document.getElementById('toast-msg');
  if (!t) { _toastActive = false; return; }
  txt.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    t.classList.remove('show');
    setTimeout(_toastNext, 300);
  }, 3000);
}

// ── LOADING STATE ────────────────────────────
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  if (loading) {
    btn.dataset.original = btn.textContent;
    btn.disabled = true;
    btn.classList.add('loading');
  } else {
    btn.textContent = btn.dataset.original || btn.textContent;
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

// ── THEME ────────────────────────────────────
function applyTheme(theme) {
  APP.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('lmr_theme', theme);
}

// ── TIME GREETING ────────────────────────────
function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ── PERMISSION HELPER ────────────────────────
// canDo('schedules') | canDo('gate') | canDo('energy') etc.
// owners/admins always return true
function canDo(permission) {
  if (!APP.user) return false;
  const role = APP.user.role || 'owner';
  if (role === 'owner' || role === 'admin' || role === 'installer') return true;
  // Check per-unit permissions
  const unit = (APP.user.units || []).find(u => u.unit_id === APP.unit_id);
  if (!unit) return false;
  return !!(unit.permissions && unit.permissions[permission]);
}

// Apply gating to elements that depend on permissions
// Called after login / loadHomeData
function applyPermissionGates() {
  // Schedule add button (device detail)
  const schedBtn = document.querySelector('.add-sched-btn');
  if (schedBtn) schedBtn.style.display = canDo('schedules') ? '' : 'none';

  // Settings nav item — only owner/admin/installer
  const settingsNav = document.querySelector('.n-item[onclick*="settings"]');
  if (settingsNav) settingsNav.style.display = canDo('energy') ? '' : 'none';

  // Gate device toggle protection — handled inline in toggleDevice
}



// ── PASSWORD STRENGTH ────────────────────────
function pwStrength(val) {
  let s = 0;
  if (val.length >= 6)  s++;
  if (val.length >= 10) s++;
  if (/[0-9]/.test(val) && /[a-zA-Z]/.test(val)) s++;
  if (/[^a-zA-Z0-9]/.test(val)) s++;
  const bars  = document.querySelectorAll('.pw-bar');
  const label = document.getElementById('pw-label');
  const cls   = ['', 'weak', 'fair', 'good', 'strong'];
  const lbl   = ['', 'Too short', 'Fair', 'Good', 'Strong ✓'];
  bars.forEach((b, i) => {
    b.className = 'pw-bar';
    if (i < s) b.classList.add(cls[s]);
  });
  if (label) label.textContent = s ? lbl[s] : 'Use 8+ chars, numbers & symbols';
}

// ── TOGGLE PASSWORD VISIBILITY ───────────────
function togglePw(inputId) {
  const inp = document.getElementById(inputId);
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// ── NAV BAR ──────────────────────────────────
function setNav(btn, screen) {
  document.querySelectorAll('.n-item').forEach(n => n.classList.remove('active'));
  btn.classList.add('active');
  const id = screen.toLowerCase();
  if (id === 'dashboard' || id === 'hub') { goTo('installer-hub'); loadInstallerOverview(); }
  else if (id === 'bind')     { goTo('installer-bind'); }
  else if (id === 'provision') { goTo('installer-provision'); }
  else goTo(id);
}

// ── ONLINE / OFFLINE BANNER ──────────────────
window.addEventListener('offline', () => {
  document.getElementById('offline-banner')?.classList.add('show');
});
window.addEventListener('online', () => {
  document.getElementById('offline-banner')?.classList.remove('show');
});

// ── APP INIT ─────────────────────────────────
async function initApp() {
  // Apply saved theme
  applyTheme(APP.theme);

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(() => console.log('[SW] Registered'))
      .catch(e => console.warn('[SW] Failed:', e));
  }

  // Splash loading sequence
  const hints = [
    'Initializing system...',
    'Connecting to LumaRoK...',
    'Loading your home...',
    'Ready'
  ];
  let i = 0;
  const hintEl = document.getElementById('splash-hint');
  const hintInterval = setInterval(() => {
    if (hintEl && i < hints.length) hintEl.textContent = hints[i++];
  }, 600);

  // Check existing session
  setTimeout(async () => {
    clearInterval(hintInterval);
    const token = localStorage.getItem('lmr_token');
    const user  = loadUser();
    if (token && user) {
      if (hintEl) hintEl.textContent = 'Authenticating session…';
      try {
        const data = await Auth.me();
        APP.user    = data.user;
        APP.unit_id = data.user.units?.[0]?.unit_id || null;
        if (!['installer', 'admin'].includes(data.user.role)) {
          clearAuth();
          document.getElementById('splash-cta')?.classList.add('show');
          return;
        }
        goTo('installer-hub');
        await loadInstallerOverview();
        return;
      } catch (e) {
        clearAuth();
        if (hintEl) hintEl.textContent = e?.name === 'AbortError'
          ? 'Server cold-starting — sign in again.'
          : 'Session expired.';
      }
    }
    // Show CTA button
    document.getElementById('splash-cta')?.classList.add('show');
  }, 2600);
}

// ── LOAD HOME DATA ───────────────────────────
async function loadHomeData() {
  if (!APP.unit_id) {
    // Load from local storage if setup was done without a unit activation
    try {
      const localRooms   = localStorage.getItem('lmr_local_rooms');
      const localDevices = localStorage.getItem('lmr_local_devices');
      if (localRooms)   APP.rooms   = JSON.parse(localRooms);
      if (localDevices) APP.devices = JSON.parse(localDevices);
    } catch(_) {}
    return;
  }
  try {
    const [rData, dData] = await Promise.all([
      Rooms.getAll(APP.unit_id),
      Devices.getAll(APP.unit_id)
    ]);
    APP.rooms   = rData.rooms   || [];
    APP.devices = dData.devices || [];
  } catch (err) {
    console.warn('[App] loadHomeData failed:', err.message);
    // Fall back to local storage if API call fails
    try {
      const localRooms   = localStorage.getItem('lmr_local_rooms');
      const localDevices = localStorage.getItem('lmr_local_devices');
      if (localRooms)   APP.rooms   = JSON.parse(localRooms);
      if (localDevices) APP.devices = JSON.parse(localDevices);
    } catch(_) {}
  }
}

// Note: DOMContentLoaded / initApp registration is handled by the
// host HTML's inline <script> block, which provides the correct
// app-specific initApp for each context (installer vs user app).
// Do NOT re-register here to avoid double-init.

// ── ACTIVATION CODE PUSH POLLING ─────────────────────────────
// Polls every 30s for codes pushed from admin
let _codePushPollTimer = null;

function startCodePushPolling() {
  if (_codePushPollTimer) return;
  _checkPendingCodePush();
  _codePushPollTimer = setInterval(_checkPendingCodePush, 30000);
}

async function _checkPendingCodePush() {
  try {
    const res = await fetch(API_URL + '/api/activation/pending-push', { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.pending?.length) return;

    const item = data.pending[0]; // show first pending
    _showCodePushNotification(item);

    // Acknowledge
    await fetch(API_URL + '/api/activation/pending-push/' + item.code + '/ack', {
      method: 'PATCH', headers: authHeaders()
    });
  } catch { /* silent */ }
}

function _showCodePushNotification(item) {
  const existing = document.getElementById('code-push-banner');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.id = 'code-push-banner';
  el.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#1e3a8a;color:#fff;padding:14px 16px;display:flex;flex-direction:column;gap:8px;box-shadow:0 4px 20px rgba(0,0,0,.4)';
  el.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between">
      <div style="font-size:14px;font-weight:700">📲 Activation Code Received</div>
      <button onclick="this.closest('#code-push-banner').remove()" style="background:none;border:none;color:#fff;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div style="font-family:monospace;font-size:22px;font-weight:800;letter-spacing:4px;color:#60a5fa">${item.code}</div>
    <div style="font-size:12px;color:#93c5fd">Unit: ${item.unit_id}${item.note ? ' · ' + item.note : ''}</div>
    <button onclick="navigator.clipboard?.writeText('${item.code}');toast('Code copied','success')" style="padding:8px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:8px;color:#fff;font-family:inherit;font-size:13px;font-weight:600;cursor:pointer">Copy Code</button>
  `;
  document.body.prepend(el);
  // Auto-dismiss after 60s
  setTimeout(() => el.remove(), 60000);
}
