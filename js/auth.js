// ============================================
// LUMAROK — Installer App — js/auth.js
// Login logic — installer/admin only
// ============================================

async function doLogin() {
  const email = document.getElementById('l-email')?.value.trim();
  const pass  = document.getElementById('l-pass')?.value;

  document.querySelectorAll('.f-err').forEach(e => e.classList.remove('show'));
  document.querySelectorAll('.f-inp').forEach(e => e.classList.remove('err'));

  let ok = true;
  if (!email || !email.includes('@')) {
    document.getElementById('le-err')?.classList.add('show');
    document.getElementById('l-email')?.classList.add('err');
    ok = false;
  }
  if (!pass || pass.length < 8) {
    document.getElementById('lp-err')?.classList.add('show');
    document.getElementById('l-pass')?.classList.add('err');
    ok = false;
  }
  if (!ok) return;

  setLoading('login-btn', true);
  try {
    const data = await Auth.login(email, pass);
    APP.user    = data.user;
    APP.unit_id = data.user.units?.[0]?.unit_id || null;

    // ── INSTALLER APP: enforce role ──────────
    if (!['installer', 'admin'].includes(APP.user.role)) {
      Auth.logout();
      APP.user = null;
      const leErr = document.getElementById('le-err');
      if (leErr) {
        leErr.textContent = 'Installer or Admin role required. Use the LumaRoK user app instead.';
        leErr.classList.add('show');
      }
      return;
    }

    loadPermissions(data.user, APP.unit_id);
    applyPermissionGates();
    toast('Welcome, ' + data.user.name.split(' ')[0] + ' 🔧', 'success');
    if (typeof initBiometric === 'function') initBiometric();

    setTimeout(async () => {
      goTo('installer-hub');
  startCodePushPolling();
      await loadInstallerOverview();
    }, 400);

  } catch (err) {
    const leErr = document.getElementById('le-err');
    if (leErr) {
      leErr.textContent = err.message || 'Invalid credentials';
      leErr.classList.add('show');
    }
    document.getElementById('l-email')?.classList.add('err');
  } finally {
    setLoading('login-btn', false);
  }
}

// Stub — register not needed in installer app
async function doRegister() {
  toast('Account creation is handled by the Admin. Contact your system administrator.', 'info');
}

// Helpers
const delay = ms => new Promise(r => setTimeout(r, ms));

// ── FORGOT PASSWORD ──────────────────────────────────────────
async function doForgotPassword() {
  const overlay = document.createElement('div');
  overlay.id = 'fp-overlay';
  overlay.innerHTML = `
<div style="position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1100;display:flex;align-items:center;justify-content:center;padding:20px">
<div style="background:var(--elevated);border-radius:16px;padding:24px;width:100%;max-width:360px">
  <div style="font-size:17px;font-weight:600;margin-bottom:6px;color:var(--t1)">Reset Password</div>
  <div id="fp-step1">
    <p style="font-size:13px;color:var(--t2);margin-bottom:16px">Enter your email to receive a reset code.</p>
    <input id="fp-email" type="email" placeholder="you@example.com" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg2);color:var(--t1);font-size:14px;box-sizing:border-box;margin-bottom:12px"/>
    <button onclick="_fpRequestCode()" style="width:100%;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Send Code</button>
  </div>
  <div id="fp-step2" style="display:none">
    <p style="font-size:13px;color:var(--t2);margin-bottom:16px">Enter the 6-digit code and your new password.</p>
    <input id="fp-code" type="text" placeholder="6-digit code" maxlength="6" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg2);color:var(--t1);font-size:14px;box-sizing:border-box;margin-bottom:8px"/>
    <input id="fp-newpass" type="password" placeholder="New password (8+ chars)" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--bg2);color:var(--t1);font-size:14px;box-sizing:border-box;margin-bottom:12px"/>
    <button onclick="_fpResetPass()" style="width:100%;padding:12px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer">Reset Password</button>
  </div>
  <button onclick="document.getElementById('fp-overlay').remove()" style="width:100%;padding:10px;background:none;color:var(--t3);border:none;font-size:13px;cursor:pointer;margin-top:8px">Cancel</button>
</div></div>`;
  document.body.appendChild(overlay);
}

async function _fpRequestCode() {
  const email = document.getElementById('fp-email')?.value.trim();
  if (!email) { toast('Enter your email', 'error'); return; }
  try {
    const res = await fetch((window.API_URL || 'https://lumarok-backend.onrender.com') + '/api/auth/forgot-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    const d = await res.json();
    if (!d.success) { toast(d.message || 'Request failed', 'error'); return; }
    document.getElementById('fp-step1').style.display = 'none';
    document.getElementById('fp-step2').style.display = '';
    toast(d.dev_code ? `Dev code: ${d.dev_code}` : 'Code sent to your email', 'info');
  } catch { toast('Network error', 'error'); }
}

async function _fpResetPass() {
  const email   = document.getElementById('fp-email')?.value.trim();
  const code    = document.getElementById('fp-code')?.value.trim();
  const newpass = document.getElementById('fp-newpass')?.value;
  if (!code || !newpass) { toast('Fill all fields', 'error'); return; }
  try {
    const res = await fetch((window.API_URL || 'https://lumarok-backend.onrender.com') + '/api/auth/reset-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, new_password: newpass })
    });
    const d = await res.json();
    if (!d.success) { toast(d.message || 'Reset failed', 'error'); return; }
    document.getElementById('fp-overlay')?.remove();
    toast('Password reset! Please sign in.', 'success');
  } catch { toast('Network error', 'error'); }
}

// ── REGISTER FLOW HELPERS ────────────────────────────────────
let regStep = 1;
function regNext(to) {
  document.getElementById('rp' + regStep)?.classList.remove('active');
  for (let i = 1; i <= 3; i++) {
    const dot = document.getElementById('rd' + i);
    if (!dot) continue;
    dot.classList.remove('active', 'done');
    if (i < to)  dot.classList.add('done');
    if (i === to) dot.classList.add('active');
  }
  regStep = to;
  document.getElementById('rp' + to)?.classList.add('active');
}

function pickChip(el) {
  el.closest('.chip-row, .chips, [class*="chip"]')
    ?.querySelectorAll('.chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
}
