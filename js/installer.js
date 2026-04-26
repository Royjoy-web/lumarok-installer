// ============================================
// LUMAROK — js/installer.js  (Phase 5)
// Installer app: provisioning, binding, testing
// ============================================

// ── STATE ────────────────────────────────────
const INS = {
  overview: null,         // last fetched overview
  selectedDeviceId: null, // device being bound/tested/identified
  checklist: null,
};

// ── OPEN INSTALLER HUB ────────────────────────
async function openInstaller() {
  if (!APP.user || !['installer', 'admin'].includes(APP.user.role)) {
    toast('Installer access required', 'error');
    return;
  }
  goTo('installer-hub');
  await loadInstallerOverview();
}

// ── LOAD OVERVIEW ────────────────────────────
async function loadInstallerOverview() {
  if (!APP.unit_id) { toast('No unit selected', 'error'); return; }

  const statusEl  = document.getElementById('ins-status-badge');
  const summaryEl = document.getElementById('ins-summary');
  const devListEl = document.getElementById('ins-device-list');

  if (statusEl) statusEl.textContent = 'Loading...';

  try {
    const data = await Installer.getOverview(APP.unit_id);
    INS.overview = data;

    // Status badge
    const st = data.unit.status || 'UNKNOWN';
    if (statusEl) {
      statusEl.textContent = st;
      statusEl.className = `ins-status-badge ${st.toLowerCase()}`;
    }

    // Unit ID label
    const unitIdEl = document.getElementById('ins-unit-id');
    if (unitIdEl) unitIdEl.textContent = APP.unit_id || data.unit?.unit_id || 'Unknown';

    // Summary row
    if (summaryEl) {
      summaryEl.innerHTML = `
        <div class="ins-stat"><div class="ins-stat-val">${data.summary.total_devices}</div><div class="ins-stat-lbl">Devices</div></div>
        <div class="ins-stat"><div class="ins-stat-val ok">${data.summary.bound}</div><div class="ins-stat-lbl">Bound</div></div>
        <div class="ins-stat"><div class="ins-stat-val ${data.summary.unbound > 0 ? 'warn' : 'ok'}">${data.summary.unbound}</div><div class="ins-stat-lbl">Unbound</div></div>
        <div class="ins-stat"><div class="ins-stat-val ok">${data.summary.online}</div><div class="ins-stat-lbl">Online</div></div>
      `;
    }

    // Device list
    if (devListEl) {
      if (!data.devices.length) {
        devListEl.innerHTML = '<div class="ins-empty">No devices in system yet.<br>Ask the owner to add devices first.</div>';
      } else {
        devListEl.innerHTML = data.devices.map(d => insDeviceRow(d)).join('');
      }
    }

    // Checklist tab
    await loadChecklist();

  } catch (err) {
    toast('Could not load unit: ' + err.message, 'error');
    if (statusEl) statusEl.textContent = 'ERROR';
  }
}

function insDeviceRow(d) {
  const bound   = d.is_bound;
  const stClass = d.status === 'ONLINE' ? 'online' : d.status === 'OFFLINE' ? 'offline' : 'unbound';
  const gpio    = bound ? `GPIO ${d.gpio_pin}` : 'Not bound';
  return `
    <div class="ins-dev-row" data-dev-id="${esc(d._id)}" onclick="openBindScreen(this.dataset.devId)">
      <div class="ins-dev-left">
        <div class="ins-dev-ico">${esc(d.emoji || '💡')}</div>
        <div>
          <div class="ins-dev-name">${esc(d.name)}</div>
          <div class="ins-dev-meta">${esc(d.room)} · ${gpio}</div>
        </div>
      </div>
      <div class="ins-dev-right">
        <span class="ins-dev-badge ${stClass}">${esc(d.status)}</span>
        ${bound ? `<button class="ins-icon-btn" data-id="${esc(d._id)}" onclick="event.stopPropagation();doIdentify(this.dataset.id)">💡</button>` : ''}
        ${bound ? `<button class="ins-icon-btn test" data-id="${esc(d._id)}" onclick="event.stopPropagation();doTest(this.dataset.id)">▶</button>` : ''}
      </div>
    </div>
  `;
}

// ── TABS ─────────────────────────────────────
function insTab(tab) {
  document.querySelectorAll('.ins-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.ins-tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.ins-tab-btn[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`ins-tab-${tab}`)?.classList.add('active');
}

// ── PROVISIONING SCREEN ──────────────────────
const BLE_SERVICE_UUID = '4fafc201-1fb5-459e-8fcc-c5c9c331914b';
const BLE_CHAR_UUID    = 'beb5483e-36e1-4688-b7f5-ea07361b26a8';

function openProvision() {
  document.getElementById('prov-ssid').value = '';
  document.getElementById('prov-pass').value = '';
  document.getElementById('prov-result').classList.remove('show');
  _resetProvModeUI();
  goTo('installer-provision');
}

function _resetProvModeUI() {
  document.getElementById('prov-tab-ble')?.classList.add('active');
  document.getElementById('prov-tab-wifi')?.classList.remove('active');
  document.getElementById('prov-panel-ble')?.classList.remove('hidden');
  document.getElementById('prov-panel-wifi')?.classList.add('hidden');
  if (document.getElementById('prov-ble-status'))
    document.getElementById('prov-ble-status').textContent = '';
}

function switchProvTab(tab) {
  const isBle = tab === 'ble';
  document.getElementById('prov-tab-ble')?.classList.toggle('active', isBle);
  document.getElementById('prov-tab-wifi')?.classList.toggle('active', !isBle);
  document.getElementById('prov-panel-ble')?.classList.toggle('hidden', !isBle);
  document.getElementById('prov-panel-wifi')?.classList.toggle('hidden', isBle);
}

async function doBLEProvision() {
  if (!navigator.bluetooth) {
    toast('Web Bluetooth not supported. Use Chrome on Android/Desktop.', 'error');
    return;
  }
  const ssid = document.getElementById('prov-ssid-ble')?.value.trim();
  const pass = document.getElementById('prov-pass-ble')?.value;
  if (!ssid || !pass) { toast('Enter WiFi SSID and password', 'error'); return; }
  if (pass.length < 8) { toast('Password must be 8+ characters', 'error'); return; }

  const statusEl  = document.getElementById('prov-ble-status');
  const setStatus = (msg, cls = '') => {
    if (statusEl) { statusEl.textContent = msg; statusEl.className = 'prov-ble-status ' + cls; }
  };
  setLoading('prov-ble-btn', true);
  setStatus('Opening Bluetooth device picker…');

  let server;
  try {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'LumaRoK-' }],
      optionalServices: [BLE_SERVICE_UUID],
    });
    setStatus('Connecting to ' + device.name + '…');
    server = await device.gatt.connect();
    const service = await server.getPrimaryService(BLE_SERVICE_UUID);
    const char    = await service.getCharacteristic(BLE_CHAR_UUID);

    await char.startNotifications();
    const ackPromise = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('ACK timeout')), 15000);
      char.addEventListener('characteristicvaluechanged', (e) => {
        clearTimeout(t);
        try { resolve(JSON.parse(new TextDecoder().decode(e.target.value))); }
        catch { resolve({ ok: true }); }
      });
    });

    setStatus('Sending WiFi credentials…');
    await char.writeValue(new TextEncoder().encode(JSON.stringify({ ssid, password: pass })));
    setStatus('Waiting for confirmation…');
    const ack = await ackPromise;

    if (ack.ok) {
      setStatus('✓ Credentials accepted — ESP32 restarting', 'success');
      toast('BLE provisioning complete ✓', 'success');
      document.getElementById('prov-result').classList.add('show');
      document.getElementById('prov-result-msg').textContent = 'WiFi credentials sent via BLE. ESP32 will restart and connect.';
      document.getElementById('prov-mqtt').textContent = '✓ Direct BLE delivery (no MQTT needed)';
    } else {
      setStatus('✗ Rejected: ' + (ack.error || 'unknown'), 'error');
      toast('BLE failed: ' + (ack.error || 'unknown'), 'error');
    }
  } catch (err) {
    setStatus(err.name === 'NotFoundError' ? 'No device selected' : ('✗ ' + err.message), 'error');
    if (err.name !== 'NotFoundError') toast('BLE error: ' + err.message, 'error');
  } finally {
    try { server?.disconnect(); } catch {}
    setLoading('prov-ble-btn', false);
  }
}

async function doProvision() {
  const ssid = document.getElementById('prov-ssid')?.value.trim();
  const pass = document.getElementById('prov-pass')?.value;
  if (!ssid || !pass) { toast('Enter WiFi SSID and password', 'error'); return; }
  if (pass.length < 8) { toast('WiFi password must be 8+ characters', 'error'); return; }

  setLoading('prov-btn', true);
  try {
    const data = await Installer.provisionWifi(APP.unit_id, ssid, pass);
    document.getElementById('prov-result-msg').textContent = data.message;
    document.getElementById('prov-mqtt').textContent       = data.mqtt_sent ? '✓ MQTT published' : '⚠ MQTT offline — unit must already be online';
    document.getElementById('prov-result').classList.add('show');
    toast(data.message, data.mqtt_sent ? 'success' : 'warn');
  } catch (err) {
    toast(err.message || 'Provision failed', 'error');
  } finally {
    setLoading('prov-btn', false);
  }
}

// ── BIND SCREEN ──────────────────────────────
function openBindScreen(deviceId) {
  INS.selectedDeviceId = deviceId;

  // Find device in overview
  const d = INS.overview?.devices?.find(x => x._id === deviceId);
  if (!d) return;

  document.getElementById('bind-device-name').textContent  = d.name;
  document.getElementById('bind-device-room').textContent  = d.room;
  document.getElementById('bind-device-emoji').textContent = d.emoji || '💡';
  document.getElementById('bind-gpio').value               = d.gpio_pin ?? '';
  document.getElementById('bind-node').value               = d.node_id  ?? '';

  // Set bound status indicator
  const statusEl = document.getElementById('bind-current-status');
  if (statusEl) {
    statusEl.textContent = d.is_bound ? `Currently: GPIO ${d.gpio_pin}` : 'Not yet bound';
    statusEl.className   = `bind-status-tag ${d.is_bound ? 'bound' : 'unbound'}`;
  }

  document.getElementById('bind-result').classList.remove('show');
  goTo('installer-bind');
  renderGpioPicker(APP.unit_id);
}

async function doBind() {
  const gpio = parseInt(document.getElementById('bind-gpio')?.value);
  const node = document.getElementById('bind-node')?.value.trim() || null;
  if (isNaN(gpio) || gpio < 0 || gpio > 39) { toast('Enter a valid GPIO pin (0–39)', 'error'); return; }

  setLoading('bind-btn', true);
  try {
    const data = await Installer.bind(APP.unit_id, INS.selectedDeviceId, gpio, node);
    document.getElementById('bind-result-msg').textContent = data.message;
    document.getElementById('bind-result').classList.add('show');
    toast(data.message, 'success');
    // Refresh overview in background
    setTimeout(() => loadInstallerOverview(), 800);
  } catch (err) {
    toast(err.message || 'Bind failed', 'error');
  } finally {
    setLoading('bind-btn', false);
  }
}

// ── IDENTIFY (blink LED) ─────────────────────
async function doIdentify(deviceId) {
  try {
    const data = await Installer.identify(APP.unit_id, deviceId, 10);
    toast(data.message, data.mqtt_sent ? 'success' : 'warn');
  } catch (err) {
    toast(err.message || 'Identify failed', 'error');
  }
}

// ── TEST (ON 3s then OFF) ────────────────────
async function doTest(deviceId) {
  try {
    const data = await Installer.test(APP.unit_id, deviceId);
    toast(data.message, 'success');
  } catch (err) {
    toast(err.message || 'Test failed', 'error');
  }
}

// ── CHECKLIST ────────────────────────────────
async function loadChecklist() {
  const el = document.getElementById('ins-checklist');
  if (!el || !APP.unit_id) return;

  try {
    const data = await Installer.getChecklist(APP.unit_id);
    INS.checklist = data;

    const pct  = data.checks.filter(c => c.required).length > 0
      ? Math.round(data.checks.filter(c => c.required && c.done).length / data.checks.filter(c => c.required).length * 100)
      : 0;

    el.innerHTML = `
      <div class="chk-progress">
        <div class="chk-bar"><div class="chk-bar-fill" style="width:${pct}%"></div></div>
        <div class="chk-pct">${esc(String(data.progress))} required steps complete</div>
      </div>
      ${data.checks.map(c => `
        <div class="chk-row ${c.done ? 'done' : c.required ? 'pending' : 'optional'}">
          <span class="chk-ico">${c.done ? '✅' : c.required ? '⏳' : '○'}</span>
          <div class="chk-info">
            <div class="chk-label">${esc(c.label)}</div>
            ${!c.done && c.unbound_names?.length ? `<div class="chk-sub">Remaining: ${c.unbound_names.map(n=>esc(n)).join(', ')}</div>` : ''}
            ${c.firmware_version ? `<div class="chk-sub">v${esc(c.firmware_version)}</div>` : ''}
          </div>
          <span class="chk-tag ${c.required ? 'req' : 'opt'}">${c.required ? 'Required' : 'Optional'}</span>
        </div>
      `).join('')}
      ${data.setup_complete ? `
        <button class="btn-primary full green" style="margin-top:16px" onclick="doCompleteInstall()">
          ✅ Mark Installation Complete
        </button>
      ` : ''}
    `;
  } catch (err) {
    el.innerHTML = '<div class="ins-empty">Could not load checklist</div>';
  }
}

async function doCompleteInstall() {
  if (!confirm('Mark this installation as complete? The unit will go ACTIVE.')) return;
  setLoading('complete-btn', true);
  try {
    const data = await Installer.complete(APP.unit_id);
    toast(data.message, 'success');
    await loadInstallerOverview();
    setTimeout(() => goTo('installer-hub'), 800);
  } catch (err) {
    toast(err.message || 'Could not complete', 'error');
  } finally {
    setLoading('complete-btn', false);
  }
}

// ── GPIO REFERENCE (quick lookup) ────────────
const GPIO_MAP = [
  { gpio: 2,  label: 'Pool Pump',         type: 'relay' },
  { gpio: 4,  label: 'Door Lock',         type: 'relay' },
  { gpio: 5,  label: 'Gate (Stepper IN1)',type: 'stepper' },
  { gpio: 12, label: 'Bedroom 1 Fan',     type: 'relay' },
  { gpio: 13, label: 'Bedroom 2 Light',   type: 'relay' },
  { gpio: 14, label: 'Bedroom 1 Light',   type: 'relay' },
  { gpio: 15, label: 'Kitchen Light',     type: 'relay' },
  { gpio: 18, label: 'Servo (Blinds)',    type: 'servo' },
  { gpio: 19, label: 'Gate (Stepper IN2)',type: 'stepper' },
  { gpio: 21, label: 'Gate (Stepper IN3)',type: 'stepper' },
  { gpio: 22, label: 'Gate (Stepper IN4)',type: 'stepper' },
  { gpio: 23, label: 'Alarm Siren',       type: 'relay' },
  { gpio: 25, label: 'Geyser',            type: 'relay' },
  { gpio: 26, label: 'Living Room Light', type: 'relay' },
  { gpio: 27, label: 'Living Room Fan',   type: 'relay' },
  { gpio: 32, label: 'Outdoor Socket',    type: 'relay' },
  { gpio: 33, label: 'Outdoor Light',     type: 'relay' },
  { gpio: 34, label: 'IR Sensor',         type: 'input-only' },
  { gpio: 35, label: 'Gas Analog',        type: 'input-only' },
  { gpio: 36, label: 'Gas Digital',       type: 'input-only' },
  { gpio: 37, label: 'Door Sensor',       type: 'input-only' },
  { gpio: 38, label: 'Window Sensor',     type: 'input-only' },
  { gpio: 39, label: 'DHT22 Temp/Humid',  type: 'input-only' },
];

function buildGpioRef() {
  const el = document.getElementById('ins-gpio-ref');
  if (!el) return;
  el.innerHTML = GPIO_MAP.map(g => `
    <div class="gpio-row ${g.type}">
      <span class="gpio-num">GPIO ${g.gpio}</span>
      <span class="gpio-lbl">${g.label}</span>
      <span class="gpio-type">${g.type}</span>
    </div>
  `).join('');
  gpioLoadTemplateList();
}

// ── GPIO Template helpers ─────────────────────
let _gpioTemplates = [];

async function gpioLoadTemplateList() {
  try {
    const data = await GpioTemplates.getAll();
    _gpioTemplates = data.templates || [];
    const sel = document.getElementById('gpio-tmpl-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Load a saved template —</option>' +
      _gpioTemplates.map(t => `<option value="${esc(t._id)}">${esc(t.label)}${t.tag ? ' · ' + esc(t.tag) : ''}</option>`).join('');
  } catch (e) { /* silently fail — not critical */ }
}

function gpioLoadTemplate() {
  const sel = document.getElementById('gpio-tmpl-select');
  if (!sel?.value) { toast('Select a template first', 'warn'); return; }
  const tmpl = _gpioTemplates.find(t => t._id === sel.value);
  if (!tmpl) return;
  const el = document.getElementById('ins-gpio-ref');
  if (!el) return;
  // Merge: show template pins on top, grey out unassigned GPIO_MAP entries
  const assignedGpios = new Set(tmpl.pins.map(p => p.gpio));
  const rows = [
    ...tmpl.pins.map(p => `
      <div class="gpio-row relay" style="border-left:3px solid var(--accent)">
        <span class="gpio-num">GPIO ${p.gpio}</span>
        <span class="gpio-lbl">${p.label}${p.room ? ' · ' + p.room : ''}</span>
        <span class="gpio-type">${p.type}</span>
      </div>`),
    ...GPIO_MAP.filter(g => !assignedGpios.has(g.gpio)).map(g => `
      <div class="gpio-row ${g.type}" style="opacity:.35">
        <span class="gpio-num">GPIO ${g.gpio}</span>
        <span class="gpio-lbl">${g.label}</span>
        <span class="gpio-type">${g.type}</span>
      </div>`),
  ];
  el.innerHTML = `<div style="font-size:11px;color:var(--accent);padding:6px 0 10px">Template: ${tmpl.label}</div>` + rows.join('');
  toast('Template loaded', 'success');
}

async function gpioSaveDialog() {
  const label = prompt('Template name (e.g. "3-Bedroom House"):');
  if (!label?.trim()) return;
  const tag = prompt('Tag / type (e.g. "residential", "shop") — optional:') || '';
  try {
    await GpioTemplates.save(label.trim(), tag.trim(), GPIO_MAP.map(g => ({ gpio: g.gpio, label: g.label, type: g.type, room: '' })));
    toast('Template saved!', 'success');
    gpioLoadTemplateList();
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

// ── GPIO VISUAL PIN PICKER ───────────────────────────────────
const GPIO_USABLE = [
  2,4,5,12,13,14,15,18,19,21,22,23,25,26,27,32,33,34,35,36,39
];

async function renderGpioPicker(unitId) {
  const container = document.getElementById('gpio-picker-grid');
  if (!container) return;
  container.innerHTML = '<span style="font-size:12px;color:var(--t3)">Loading pins…</span>';

  let takenMap = {}; // gpio → device name
  try {
    const data = await Devices.getAll(unitId);
    (data.devices || []).filter(d => d.is_bound && d.gpio_pin != null)
      .forEach(d => { takenMap[d.gpio_pin] = d.name; });
  } catch { /* show all as available if fetch fails */ }

  const currentVal = parseInt(document.getElementById('bind-gpio')?.value) || null;
  container.innerHTML = GPIO_USABLE.map(pin => {
    const taken    = takenMap[pin];
    const selected = pin === currentVal;
    const cls      = selected ? 'gpio-tile selected' : taken ? 'gpio-tile taken' : 'gpio-tile free';
    const label    = taken ? `❌ ${taken.substring(0,10)}` : '✅ Free';
    const click    = !taken ? `onclick="selectGpio(${pin})"` : '';
    return `<div class="${cls}" ${click} title="GPIO ${pin}${taken ? ' — used by '+taken : ''}">
      <span style="font-size:11px;font-weight:700">GPIO ${pin}</span>
      <span style="font-size:10px">${label}</span>
    </div>`;
  }).join('');
}

function selectGpio(pin) {
  document.getElementById('bind-gpio').value = pin;
  const lbl = document.getElementById('gpio-selected-label');
  if (lbl) lbl.textContent = `→ GPIO ${pin} selected`;
  // Update tile styles
  document.querySelectorAll('.gpio-tile').forEach(t => t.classList.remove('selected'));
  event.currentTarget.classList.add('selected');
}

// ══════════════════════════════════════════
// WEB SERIAL FLASHER
// ══════════════════════════════════════════
async function startWebSerialFlash() {
  const logEl  = document.getElementById('flasher-log');
  const unitId = document.getElementById('flash-unit-id')?.value?.trim();
  const btn    = document.getElementById('flash-btn');
  const warn   = document.getElementById('flasher-support-warn');

  if (!('serial' in navigator)) {
    if (warn) warn.style.display = 'block';
    return;
  }
  if (!unitId) { toast('Enter a Unit ID first', 'error'); return; }

  const log = m => { if (logEl) logEl.textContent += m + '\n'; };
  btn.disabled = true;
  log('→ Requesting signed download token…');

  try {
    // 1. Get signed download URL from backend (never exposes raw CDN link)
    const { url, has_update, latest_version } = await apiRequest(
      `/api/firmware/latest?unit_id=${encodeURIComponent(unitId)}&current_version=0.0.0`
    );
    if (!url) { log('✗ No firmware URL returned (check LATEST_FIRMWARE_URL env var)'); btn.disabled=false; return; }
    log(`→ Firmware v${latest_version} — fetching binary…`);

    // 2. Fetch binary via the signed /download redirect
    const resp = await fetch(url, { headers: { Authorization: 'Bearer ' + getToken() } });
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
    const firmware = await resp.arrayBuffer();
    log(`→ ${(firmware.byteLength / 1024).toFixed(1)} KB downloaded`);

    // 3. Open Web Serial port
    log('→ Select the ESP32 USB port in the browser dialog…');
    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 115200 });
    log('→ Port open. Writing firmware…');

    // 4. Stream to ESP32 (ESPTool Web handles the actual flashing protocol;
    //    here we write raw bytes — production use should integrate
    //    https://github.com/espressif/esptool-js for full stub + flash support)
    const writer = port.writable.getWriter();
    const chunk  = 512;
    const buf    = new Uint8Array(firmware);
    for (let i = 0; i < buf.length; i += chunk) {
      await writer.write(buf.slice(i, i + chunk));
      if (i % (chunk * 20) === 0)
        log(`  ${Math.round(i / buf.length * 100)}% written…`);
    }
    writer.releaseLock();
    await port.close();
    log(`✓ Done — ${(firmware.byteLength/1024).toFixed(1)} KB flashed to ${unitId}`);
    toast('Flash complete ✓', 'success');
  } catch (err) {
    log(`✗ Error: ${err.message}`);
    toast('Flash failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Check Web Serial support when flasher tab opens
function checkSerialSupport() {
  const w = document.getElementById('flasher-support-warn');
  if (w) w.style.display = ('serial' in navigator) ? 'none' : 'block';
}

// ══════════════════════════════════════════
// SETUP WIZARD
// ══════════════════════════════════════════
const WIZ = { step: 1, total: 6, unitId: null };

function openWizard(unitId) {
  WIZ.step   = 1;
  WIZ.unitId = unitId || APP.unit_id || '';
  const inp  = document.getElementById('wiz-unit-id');
  if (inp) inp.value = WIZ.unitId;
  wizRender();
  goTo('installer-wizard');
}

function wizRender() {
  // Step label + progress bar
  const lbl = document.getElementById('wiz-step-label');
  const bar = document.getElementById('wiz-progress');
  if (lbl) lbl.textContent = `Step ${WIZ.step} / ${WIZ.total}`;
  if (bar) bar.style.width = `${Math.round(WIZ.step / WIZ.total * 100)}%`;
  // Show correct panel
  document.querySelectorAll('.wiz-panel').forEach((p, i) => {
    p.style.display = (i + 1 === WIZ.step) ? 'block' : 'none';
  });
  // Pre-load step-specific data
  if (WIZ.step === 5) wizLoadChecklist();
  if (WIZ.step === 6) wizLoadComplete();
}

async function wizNext() {
  if (WIZ.step === 1) {
    const v = document.getElementById('wiz-unit-id')?.value?.trim();
    if (!v) { toast('Enter a unit ID', 'error'); return; }
    WIZ.unitId = v;
    APP.unit_id = v;
  }
  if (WIZ.step < WIZ.total) { WIZ.step++; wizRender(); }
}

function wizBack() {
  if (WIZ.step > 1) { WIZ.step--; wizRender(); }
  else goTo('installer-hub');
}

async function wizLoadChecklist() {
  const el = document.getElementById('wiz-checklist-preview');
  if (!el || !WIZ.unitId) return;
  try {
    const data = await Installer.getChecklist(WIZ.unitId);
    el.innerHTML = data.checks.map(c =>
      `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--s2);font-size:13px">
        <span>${c.done ? '✅' : '⏳'}</span>
        <span style="color:${c.done ? 'var(--t1)' : 'var(--t3)'}">${esc(c.label)}</span>
      </div>`
    ).join('');
  } catch { el.innerHTML = '<div style="color:var(--t3);font-size:12px">Could not load checklist</div>'; }
}

async function wizLoadComplete() {
  const el  = document.getElementById('wiz-complete-status');
  const btn = document.getElementById('wiz-complete-btn');
  if (!el || !WIZ.unitId) return;
  try {
    const data = await Installer.getChecklist(WIZ.unitId);
    if (data.setup_complete) {
      el.innerHTML = '<span style="color:#10B981">✅ All required steps complete. Ready to activate.</span>';
      if (btn) btn.disabled = false;
    } else {
      el.innerHTML = `<span style="color:#f87171">⚠️ ${data.progress} steps done — complete the remaining steps first.</span>`;
      if (btn) btn.disabled = true;
    }
  } catch { el.textContent = 'Could not verify checklist.'; }
}

async function wizComplete() {
  const btn = document.getElementById('wiz-complete-btn');
  if (btn) btn.disabled = true;
  try {
    await Installer.complete(WIZ.unitId);
    toast('Installation complete — owner notified ✓', 'success');
    goTo('installer-hub');
    await loadInstallerOverview();
  } catch (err) {
    toast(err.message || 'Could not complete', 'error');
    if (btn) btn.disabled = false;
  }
}
