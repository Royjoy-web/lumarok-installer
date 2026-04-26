// ============================================
// LUMAROK — js/scanner.js
// QR Scanner (html5-qrcode wrapper)
// ============================================

let _qrInstance   = null;
let _qrRunning    = false;
let _qrCallerCtx  = null; // 'activation' | 'dashboard' | null

// ── OPEN ─────────────────────────────────────
function openQRScanner(context) {
  _qrCallerCtx = context || null;

  const overlay = document.getElementById('qr-overlay');
  const resultEl = document.getElementById('qr-result');
  if (resultEl) { resultEl.textContent = ''; resultEl.classList.remove('show'); }

  overlay?.classList.add('show');
  document.body.style.overflow = 'hidden';

  // Small delay lets the transition play before camera starts
  setTimeout(() => _startCamera(), 300);
}

// ── START CAMERA ─────────────────────────────
function _startCamera() {
  if (_qrRunning) return;

  _qrInstance = new Html5Qrcode('qr-reader');

  const config = {
    fps: 10,
    qrbox: { width: 200, height: 200 },
    aspectRatio: 1.0,
    rememberLastUsedCamera: true
  };

  _qrInstance.start(
    { facingMode: 'environment' },
    config,
    _onScanSuccess,
    _onScanError
  ).then(() => {
    _qrRunning = true;
  }).catch(err => {
    console.warn('[QR] Camera start failed:', err);
    _showQRResult('⚠️ Camera access denied. Please allow camera permission.', false);
  });
}

// ── ON SUCCESS ───────────────────────────────
async function _onScanSuccess(decodedText) {
  if (!_qrRunning) return;

  // Stop immediately — prevent double-fire
  await _stopCamera();

  const resultEl = document.getElementById('qr-result');
  if (resultEl) {
    resultEl.textContent = '✅ Scanned: ' + _truncate(decodedText, 40);
    resultEl.classList.add('show');
  }

  // Route based on context
  if (_qrCallerCtx === 'activation') {
    _handleActivationQR(decodedText);
  } else {
    // Generic — just toast it
    toast('QR: ' + _truncate(decodedText, 50), 'info');
    setTimeout(closeQRScanner, 1800);
  }
}

// ── ACTIVATION FLOW ──────────────────────────
function _handleActivationQR(text) {
  // QR codes on LumaRoK units encode the 8-char activation code
  // Format may be: "LMRA3F2B" or "lumarok://activate?code=LMRA3F2B"
  let code = text.trim().toUpperCase();

  const urlMatch = code.match(/CODE=([A-Z0-9]{8})/);
  if (urlMatch) code = urlMatch[1];

  // If it looks like a valid 8-char code, fill the input
  if (/^[A-Z0-9]{8}$/.test(code)) {
    const inp = document.getElementById('act-code');
    if (inp) {
      inp.value = code;
      inp.dispatchEvent(new Event('input')); // trigger onCodeInput
    }
    toast('Code scanned! Tap Activate to continue.', 'success');
    setTimeout(() => {
      closeQRScanner();
    }, 1200);
  } else {
    _showQRResult('⚠️ QR code not recognised as a LumaRoK unit.', false);
    setTimeout(() => _restartCamera(), 2000);
  }
}

// ── CLOSE / STOP ─────────────────────────────
async function closeQRScanner() {
  await _stopCamera();

  const overlay = document.getElementById('qr-overlay');
  overlay?.classList.remove('show');
  document.body.style.overflow = '';

  _qrCallerCtx = null;
}

async function _stopCamera() {
  if (_qrInstance && _qrRunning) {
    try {
      await _qrInstance.stop();
    } catch { /* already stopped */ }
    _qrRunning = false;
  }
}

async function _restartCamera() {
  await _stopCamera();
  const resultEl = document.getElementById('qr-result');
  if (resultEl) { resultEl.textContent = ''; resultEl.classList.remove('show'); }
  _startCamera();
}

// ── HELPERS ──────────────────────────────────
function _onScanError() { /* silent — fires constantly while scanning */ }

function _submitManualQRCode() {
  const val = (document.getElementById('qr-manual-input')?.value || '').trim().toUpperCase();
  if (!val) { toast('Enter a code first', 'error'); return; }
  _onScanSuccess(val);
  const inp = document.getElementById('qr-manual-input');
  if (inp) inp.value = '';
}

function _showQRResult(msg, ok) {
  const el = document.getElementById('qr-result');
  if (!el) return;
  el.textContent = msg;
  el.style.background = ok
    ? 'rgba(34,197,94,.08)'
    : 'rgba(239,68,68,.08)';
  el.style.borderColor = ok
    ? 'rgba(34,197,94,.25)'
    : 'rgba(239,68,68,.25)';
  el.style.color = ok ? 'var(--ok)' : 'var(--err)';
  el.classList.add('show');
}

function _truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

// Close on backdrop click
document.addEventListener('click', e => {
  const overlay = document.getElementById('qr-overlay');
  if (e.target === overlay) closeQRScanner();
});

// Close on Escape
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeQRScanner();
});
