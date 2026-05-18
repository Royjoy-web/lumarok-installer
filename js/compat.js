// ============================================================
// LumaRoK — compat.js
// Migration shim. Bridges old global function names → new engines.
// Loaded LAST. Preserves all data-action attrs and inline calls.
// ============================================================

// ── Legacy global aliases (read-only bridges) ─────────────
// APP — keep alive for existing HTML that reads APP.user, APP.unit_id, etc.
const APP = Store.state; // direct reference — Store.set() keeps it in sync

// INS — legacy installer state
Object.defineProperties(window, {
  INS: { get: () => ({ overview: Store.get('unit'), selectedDeviceId: Store.get('commissioning.selectedDeviceId'), checklist: Store.get('commissioning.checklist') }), configurable: true }
});

// WIZ — legacy wizard state
Object.defineProperties(window, {
  WIZ: { get: () => ({ step: _stepNum(), total: 5, unitId: Store.get('wizard.unitId') }), configurable: true }
});

function _stepNum() {
  const STEPS = ['UNIT_VALIDATION','WIFI_PROVISION','DEVICE_BINDING','CHECKLIST_REVIEW','SIGN_OFF'];
  const idx = STEPS.indexOf(Store.get('wizard.step'));
  return idx === -1 ? 1 : idx + 1;
}

// ── Provisioning shims ────────────────────────────────────
function openProvision() {
  document.getElementById('prov-ssid').value    = '';
  document.getElementById('prov-pass').value    = '';
  document.getElementById('prov-ssid-ble') && (document.getElementById('prov-ssid-ble').value = '');
  document.getElementById('prov-pass-ble') && (document.getElementById('prov-pass-ble').value = '');
  document.getElementById('prov-result').classList.remove('show');
  ProvisionFSM.reset();
  goTo('installer-provision');
}

async function doBLEProvision() {
  const ssid = document.getElementById('prov-ssid-ble')?.value.trim();
  const pass = document.getElementById('prov-pass-ble')?.value;
  await ProvisionFSM.startBLE(ssid, pass);
}

async function doProvision() {
  const ssid = document.getElementById('prov-ssid')?.value.trim();
  const pass = document.getElementById('prov-pass')?.value;
  await ProvisionFSM.startRelay(ssid, pass);
}

function switchProvTab(tab) {
  const isBle = tab === 'ble';
  document.getElementById('prov-tab-ble')?.classList.toggle('active', isBle);
  document.getElementById('prov-tab-wifi')?.classList.toggle('active', !isBle);
  document.getElementById('prov-panel-ble')?.classList.toggle('hidden', !isBle);
  document.getElementById('prov-panel-wifi')?.classList.toggle('hidden', isBle);
}

// ── Installer hub ─────────────────────────────────────────
async function openInstaller() {
  if (!APP.user || !['installer', 'admin'].includes(APP.user.role)) {
    toast('Installer access required', 'error'); return;
  }
  goTo('installer-hub');
  await CommissioningEngine.loadOverview(APP.unit_id);
}

async function loadInstallerOverview() {
  await CommissioningEngine.loadOverview(APP.unit_id);
}

// ── Binding shims ─────────────────────────────────────────
function openBindScreen(deviceId) { CommissioningEngine.openBindScreen(deviceId); }
async function doBind()           { await CommissioningEngine.bind(); }
async function doIdentify(deviceId) { await CommissioningEngine.identify(deviceId, 10); }
async function doTest(deviceId)     { await CommissioningEngine.test(deviceId); }
async function loadChecklist()      { await CommissioningEngine.loadChecklist(); }

// ── Wizard shims ──────────────────────────────────────────
function openWizard(unitId) { OnboardingWorkflow.open(unitId); }
async function wizNext()    { await OnboardingWorkflow.next(); }
function wizBack()          { OnboardingWorkflow.back(); }
async function wizComplete(){ await OnboardingWorkflow.complete(); }
function wizRender()        { /* noop — render driven by Store */ }

// ── GPIO shims (unchanged logic, now routed through engine) ─
async function renderGpioPicker(unitId) { await CommissioningEngine.renderGpioPicker(unitId); }

function selectGpio(pin) {
  document.getElementById('bind-gpio').value = pin;
  const lbl = document.getElementById('gpio-selected-label');
  if (lbl) lbl.textContent = `→ GPIO ${pin} selected`;
  document.querySelectorAll('.gpio-tile').forEach(t => t.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
}

// ── Complete install modal (preserved as-is) ───────────────
let _completeUnitId = null;

function openCompleteModal(unit_id) {
  _completeUnitId = unit_id;
  document.getElementById('owner-name-input').value  = '';
  document.getElementById('owner-email-input').value = '';
  document.getElementById('complete-modal').classList.add('show');
  setTimeout(() => document.getElementById('owner-name-input').focus(), 100);
}

function closeCompleteModal() {
  document.getElementById('complete-modal').classList.remove('show');
  _completeUnitId = null;
}

async function submitCompleteInstall() {
  const owner_email = document.getElementById('owner-email-input').value.trim();
  const owner_name  = document.getElementById('owner-name-input').value.trim();
  if (!owner_email?.includes('@')) { toast('Valid homeowner email required', 'error'); return; }
  const btn = document.getElementById('complete-modal-submit');
  btn.disabled = true; btn.textContent = 'Completing…';
  try {
    const data = await CommissioningEngine.complete(_completeUnitId, owner_email, owner_name);
    if (!data.queued) toast(data.message || 'Installation complete — owner emailed ✓', 'success');
    closeCompleteModal();
    await CommissioningEngine.loadOverview(_completeUnitId);
    setTimeout(() => goTo('installer-hub'), 800);
  } catch (err) {
    toast(err.message || 'Could not complete', 'error');
  } finally {
    btn.disabled = false; btn.textContent = '✅ Complete & Email Owner';
  }
}

async function doCompleteInstall() { openCompleteModal(APP.unit_id); }

// ── GPIO template helpers (unchanged — delegate to existing logic) ─
// These remain in installer.js and are called as before.

// ── Diagnostics shortcut ──────────────────────────────────
function openDiagnostics() { DiagnosticsPipeline.open(APP.unit_id); }

// ── Code push polling — cleanup on logout ─────────────────
let _codePushPollTimer = null;

// startCodePushPolling defined in app.js);
}

function stopCodePushPolling() {
  if (_codePushPollTimer) { clearInterval(_codePushPollTimer); _codePushPollTimer = null; }
  Trace.info('codepush:polling:stop', {});
}

async function _checkPendingCodePush() {
  try {
    const res = await fetch(API_URL + '/api/activation/pending-push', { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    if (!data.pending?.length) return;
    const item = data.pending[0];
    _showCodePushNotification(item);
    await fetch(API_URL + '/api/activation/pending-push/' + item.code + '/ack', {
      method: 'PATCH', headers: authHeaders()
    });
  } catch { /* silent */ }
}

function _showCodePushNotification(item) {
  document.getElementById('code-push-banner')?.remove();
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
    <div style="display:flex;gap:8px">
      <button onclick="navigator.clipboard?.writeText('${item.code}');toast('Code copied','success')" style="flex:1;padding:8px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer">📋 Copy</button>
      <button onclick="APP.unit_id='${item.unit_id}';Store.set('unit_id','${item.unit_id}');this.closest('#code-push-banner').remove();openWizard('${item.unit_id}')" style="flex:1;padding:8px;background:rgba(96,165,250,.25);border:1px solid rgba(96,165,250,.5);border-radius:8px;color:#fff;font-size:13px;font-weight:600;cursor:pointer">⚡ Wizard</button>
    </div>`;
  document.body.prepend(el);
  setTimeout(() => el.remove(), 60000);
}

// ── Auth logout cleanup ───────────────────────────────────
const _originalLogout = Auth.logout.bind(Auth);
Auth.logout = function() {
  stopCodePushPolling();
  SyncChannel.disconnect();
  _originalLogout();
};

// ── Store → APP sync (keep APP.unit_id writable for legacy code) ─
Store.subscribe('unit_id', v => { APP.unit_id = v; });
Store.subscribe('devices', v => { APP.devices = v; });
Store.subscribe('rooms',   v => { APP.rooms   = v; });
Store.subscribe('user',    v => { APP.user    = v; });

Trace.info('compat:loaded', { ts: Date.now() });
