// ============================================
// LUMAROK — js/scanner.js
// QR Scanner (html5-qrcode wrapper)
// ============================================

let _qrInstance   = null;
let _qrRunning    = false;
let _qrCallerCtx  = null; // 'activation' | 'dashboard' | 'unit-id' | 'flash-unit-id' | null

// ── OPEN ─────────────────────────────────────
function openQRScanner(context) {
  _qrCallerCtx = context || null;

  // Update overlay title based on context
  const titleEl = document.getElementById('qr-overlay-title');
  const subEl   = document.getElementById('qr-overlay-sub');
  if (titleEl) {
    titleEl.textContent = (context === 'unit-id' || context === 'flash-unit-id')
      ? '📷 Scan Unit QR Code'
      : '📷 Scan Device QR Code';
  }
  if (subEl) {
    subEl.textContent = (context === 'unit-id' || context === 'flash-unit-id')
      ? 'Point camera at the QR code on the LumaRoK unit box or enclosure label'
      : 'Point your camera at the QR code on your LumaRoK unit or accessory';
  }

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
  } else if (_qrCallerCtx === 'unit-id' || _qrCallerCtx === 'flash-unit-id') {
    _handleUnitIdQR(decodedText, _qrCallerCtx);
  } else {
    // Generic — just toast it
    toast('QR: ' + _truncate(decodedText, 50), 'info');
    setTimeout(closeQRScanner, 1800);
  }
}

// ── UNIT ID SCAN (installer wizard + flash tab) ───────────────
// QR on unit box encodes the Unit ID.
// Formats supported:
//   Plain:   "LMR-A4CF12345678"
//   URL:     "lumarok://unit?id=LMR-A4CF12345678"
//   JSON:    {"unit_id":"LMR-A4CF12345678","..."}
function _handleUnitIdQR(text, targetInputId) {
  let unitId = text.trim();

  // URL format
  const urlMatch = unitId.match(/[?&]id=([A-Z0-9\-]{6,24})/i);
  if (urlMatch) unitId = urlMatch[1].toUpperCase();

  // JSON format
  try {
    const parsed = JSON.parse(text);
    if (parsed.unit_id) unitId = parsed.unit_id;
  } catch {}

  unitId = unitId.toUpperCase().trim();

  // Validate: LMR- prefix + alphanumeric, 8-24 chars total
  if (!/^LMR-[A-Z0-9]{4,20}$/.test(unitId)) {
    _showQRResult('⚠️ QR code not recognised as a LumaRoK Unit ID.', false);
    setTimeout(() => _restartCamera(), 2000);
    return;
  }

  // Fill both the wizard input and APP.unit_id
  const wizInp   = document.getElementById('wiz-unit-id');
  const flashInp = document.getElementById('flash-unit-id');
  if (wizInp)   wizInp.value   = unitId;
  if (flashInp) flashInp.value = unitId;
  if (typeof APP !== 'undefined') APP.unit_id = unitId;
  if (typeof WIZ !== 'undefined') WIZ.unitId  = unitId;

  _showQRResult('✅ Unit ID: ' + unitId, true);
  toast('Unit ID scanned: ' + unitId, 'success');
  setTimeout(closeQRScanner, 1200);
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
