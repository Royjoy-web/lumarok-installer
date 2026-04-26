// ============================================
// LUMAROK — js/biometric.js
// WebAuthn / Biometric Login + Registration
// ============================================

const BIO_KEY        = 'lmr_bio_enabled';
const BIO_CRED_KEY   = 'lmr_bio_cred_id';
const BIO_USER_KEY   = 'lmr_bio_user';

// ── CHECK SUPPORT ────────────────────────────
function isBiometricSupported() {
  return !!(
    window.PublicKeyCredential &&
    typeof navigator.credentials?.get === 'function' &&
    typeof navigator.credentials?.create === 'function'
  );
}

async function isBiometricAvailable() {
  if (!isBiometricSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ── INIT (called on page load) ────────────────
async function initBiometric() {
  const btn = document.getElementById('bio-btn');
  if (!btn) return;

  const available = await isBiometricAvailable();
  const enrolled  = localStorage.getItem(BIO_KEY) === '1';

  if (!available) {
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"/><path d="M4.93 17.44A9.97 9.97 0 0 0 12 20a9.97 9.97 0 0 0 7.07-2.56"/><path d="M9 12.5c.83.5 1.63.75 3 .75s2.17-.25 3-.75"/></svg><span>Use Biometrics</span>`;
    btn.disabled = true; btn.style.opacity = '0.45'; btn.style.cursor = 'default'; btn.title = 'Biometrics available on HTTPS deployment';
    return;
  }

  if (enrolled) {
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"/>
        <path d="M4.93 17.44A9.97 9.97 0 0 0 12 20a9.97 9.97 0 0 0 7.07-2.56"/>
        <path d="M9 12.5c.83.5 1.63.75 3 .75s2.17-.25 3-.75"/>
      </svg>
      <span>Sign in with Face ID / Fingerprint</span>
    `;
  } else {
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"/>
        <path d="M4.93 17.44A9.97 9.97 0 0 0 12 20a9.97 9.97 0 0 0 7.07-2.56"/>
        <path d="M9 12.5c.83.5 1.63.75 3 .75s2.17-.25 3-.75"/>
      </svg>
      <span>Enable Biometric Login</span>
    `;
  }
}

// ── MAIN ENTRY (button tap) ──────────────────
async function doBiometricLogin() {
  const available = await isBiometricAvailable();

  if (!available) {
    toast('Biometrics not available on this device', 'error');
    return;
  }

  const enrolled = localStorage.getItem(BIO_KEY) === '1';

  if (enrolled) {
    await _authenticateBiometric();
  } else {
    _showBioEnrollPrompt();
  }
}

// ── ENROLL PROMPT ────────────────────────────
function _showBioEnrollPrompt() {
  // Check if user is logged in — need to be logged in to enroll
  if (!APP?.user) {
    toast('Sign in with email first, then enable biometrics', 'info');
    return;
  }
  _enrollBiometric();
}

// ── REGISTER / ENROLL ────────────────────────
async function _enrollBiometric() {
  const btn = document.getElementById('bio-btn');
  if (btn) btn.classList.add('loading');

  try {
    // Random challenge
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const user = APP.user;
    const userId = new TextEncoder().encode(
      user?.id || user?.email || 'lumarok-user'
    );

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: {
          name:  'LumaRoK',
          id:    location.hostname === 'localhost' ? 'localhost' : location.hostname
        },
        user: {
          id:          userId,
          name:        user?.email || 'user@lumarok.com',
          displayName: user?.name  || 'LumaRoK User'
        },
        pubKeyCredParams: [
          { alg: -7,   type: 'public-key' }, // ES256
          { alg: -257, type: 'public-key' }  // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification:        'required',
          requireResidentKey:      false
        },
        timeout: 60000,
        attestation: 'none'
      }
    });

    if (credential) {
      // Store credential ID for later authentication
      const credId = _bufferToBase64(credential.rawId);
      localStorage.setItem(BIO_KEY,       '1');
      localStorage.setItem(BIO_CRED_KEY,  credId);
      localStorage.setItem(BIO_USER_KEY,  JSON.stringify({
        email: user?.email,
        name:  user?.name,
        id:    user?.id
      }));

      toast('Biometric login enabled! ✅', 'success');

      // Update button label
      if (btn) {
        btn.classList.remove('loading');
        btn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"/>
            <path d="M4.93 17.44A9.97 9.97 0 0 0 12 20a9.97 9.97 0 0 0 7.07-2.56"/>
            <path d="M9 12.5c.83.5 1.63.75 3 .75s2.17-.25 3-.75"/>
          </svg>
          <span>Sign in with Face ID / Fingerprint</span>
        `;
      }

      // Register credential with backend
      await fetch(API_URL + '/api/webauthn/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'Authorization': 'Bearer ' + localStorage.getItem('lmr_token') },
        body: JSON.stringify({ credentialId: credId })
      });
    }

  } catch (err) {
    if (err.name === 'NotAllowedError') {
      toast('Biometric prompt cancelled', 'info');
    } else {
      console.error('[Bio] Enroll error:', err);
      const msg = err.message && err.message.includes('user agent') ? 'Biometrics require HTTPS on a real device — not available in preview' : 'Could not enable biometrics: ' + err.message;
      toast(msg, 'info');
    }
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

// ── AUTHENTICATE ─────────────────────────────
async function _authenticateBiometric() {
  const btn = document.getElementById('bio-btn');
  if (btn) btn.classList.add('loading');

  try {
    const challenge  = crypto.getRandomValues(new Uint8Array(32));
    const credIdB64  = localStorage.getItem(BIO_CRED_KEY);

    const assertionOptions = {
      publicKey: {
        challenge,
        timeout: 60000,
        userVerification: 'required',
        rpId: location.hostname === 'localhost' ? 'localhost' : location.hostname
      }
    };

    // If we have a stored credential ID, narrow to it for faster UX
    if (credIdB64) {
      assertionOptions.publicKey.allowCredentials = [{
        id:         _base64ToBuffer(credIdB64),
        type:       'public-key',
        transports: ['internal']
      }];
    }

    const assertion = await navigator.credentials.get(assertionOptions);

    if (assertion) {
      // ── Backend authentication
      const credId = _bufferToBase64(assertion.rawId);
      const authRes = await fetch(API_URL + '/api/webauthn/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credentialId: credId })
      });
      if (!authRes.ok) throw new Error('Server rejected biometric credential');
      const authData = await authRes.json();
      localStorage.setItem('lmr_token',   authData.token);
      localStorage.setItem('lmr_refresh_token', authData.refresh_token);

      if (savedUser?.email) {
        APP.user    = savedUser;
        APP.unit_id = savedUser.units?.[0]?.unit_id || null;

        toast('Welcome back, ' + (savedUser.name?.split(' ')[0] || 'there') + '! 👋', 'success');

        if (APP.unit_id) {
          if(typeof loadInstallerOverview==='function') await loadInstallerOverview().catch(()=>{});
          goTo('installer-hub');
          if(typeof loadInstallerOverview==='function') loadInstallerOverview();
        } else {
          goTo('activation');
        }
      } else {
        toast('Please sign in once with email to re-link biometrics', 'info');
      }
    }

  } catch (err) {
    if (err.name === 'NotAllowedError') {
      toast('Authentication cancelled or timed out', 'info');
    } else if (err.name === 'InvalidStateError') {
      // Credential gone — reset enrollment
      _clearBiometric();
      toast('Biometric data changed. Please re-enable in settings.', 'error');
    } else {
      console.error('[Bio] Auth error:', err);
      toast('Biometric failed: ' + err.message, 'error');
    }
  } finally {
    if (btn) btn.classList.remove('loading');
  }
}

// ── DISABLE (called from settings) ───────────
function disableBiometric() {
  _clearBiometric();
  toast('Biometric login disabled', 'info');
  initBiometric(); // refresh button label
}

function _clearBiometric() {
  localStorage.removeItem(BIO_KEY);
  localStorage.removeItem(BIO_CRED_KEY);
  localStorage.removeItem(BIO_USER_KEY);
}

// ── UTILS ────────────────────────────────────
function _bufferToBase64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function _base64ToBuffer(b64) {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

// ── AUTO-INIT on DOM ready ───────────────────
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', initBiometric); } else { initBiometric(); }

// ── SETTINGS PAGE HELPER ─────────────────────
async function onBioSettingsBtn() {
  const enrolled = localStorage.getItem(BIO_KEY) === '1';
  const label    = document.getElementById('bio-settings-label');

  if (enrolled) {
    if (confirm('Disable biometric login?')) {
      disableBiometric();
      if (label) label.textContent = 'Enable Biometric Login';
    }
  } else {
    if (!APP?.user) {
      toast('Sign in first to enable biometrics', 'info');
      return;
    }
    await _enrollBiometric();
    if (label && localStorage.getItem(BIO_KEY) === '1') {
      label.textContent = 'Disable Biometric Login';
    }
  }
}

// Update settings label whenever settings screen becomes visible — connect once only
const _bioObserver = new MutationObserver(() => {
  const label    = document.getElementById('bio-settings-label');
  const enrolled = localStorage.getItem(BIO_KEY) === '1';
  if (label) label.textContent = enrolled ? 'Disable Biometric Login' : 'Enable Biometric Login';
});
let _bioObserverConnected = false;
document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('settings');
  if (el && !_bioObserverConnected) {
    _bioObserver.observe(el, { attributeFilter: ['class'] });
    _bioObserverConnected = true;
  }
});
