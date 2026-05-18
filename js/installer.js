// ============================================================
// LumaRoK — installer.js  (TRIMMED)
// Retained: insTab(), GPIO_MAP, GPIO template helpers,
//           renderGpioPicker(), selectGpio()
// Removed:  Everything now handled by commissioning/engine.js,
//           provisioning/fsm.js, onboarding/workflow.js, compat.js
// ============================================================

function insTab(tab) {
  document.querySelectorAll('.ins-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.ins-tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector(`.ins-tab-btn[data-tab="${tab}"]`)?.classList.add('active');
  document.getElementById(`ins-tab-${tab}`)?.classList.add('active');
}

// ── GPIO reference map ─────────────────────────────────────
// ISS-015 FIX: Removed GPIO 37, 38, 40, 41, 42 — these don't exist on standard ESP32-WROOM-32 (range: 0-39).
// GPIO 34-39 are input-only; GPIO 37 and 38 are reserved (SPI flash) on most WROOM modules.
// Verify GPIO 36/39 against your specific PCB schematic before use.
const GPIO_MAP = [
  { gpio: 2,  label: 'Pool Pump',          type: 'relay' },
  { gpio: 4,  label: 'Door Lock',          type: 'relay' },
  { gpio: 5,  label: 'Gate (Stepper IN1)', type: 'stepper' },
  { gpio: 12, label: 'Bedroom 1 Fan',      type: 'relay' },
  { gpio: 13, label: 'Bedroom 2 Light',    type: 'relay' },
  { gpio: 14, label: 'Bedroom 1 Light',    type: 'relay' },
  { gpio: 15, label: 'Kitchen Light',      type: 'relay' },
  { gpio: 18, label: 'Servo (Blinds)',     type: 'servo' },
  { gpio: 19, label: 'Gate (Stepper IN2)', type: 'stepper' },
  { gpio: 21, label: 'Gate (Stepper IN3)', type: 'stepper' },
  { gpio: 22, label: 'Gate (Stepper IN4)', type: 'stepper' },
  { gpio: 23, label: 'Alarm Siren',        type: 'relay' },
  { gpio: 25, label: 'Geyser',             type: 'relay' },
  { gpio: 26, label: 'Living Room Light',  type: 'relay' },
  { gpio: 27, label: 'Living Room Fan',    type: 'relay' },
  { gpio: 32, label: 'Outdoor Socket',     type: 'relay' },
  { gpio: 33, label: 'Outdoor Light',      type: 'relay' },
  { gpio: 34, label: 'IR Sensor',          type: 'input-only' },
  { gpio: 35, label: 'Gas Analog',         type: 'input-only' },
  { gpio: 36, label: 'Gas Digital (VP)',   type: 'input-only' },
  { gpio: 39, label: 'DHT22 Temp/Humid (VN)', type: 'input-only' },
];

function buildGpioRef() {
  const el = document.getElementById('ins-gpio-ref');
  if (!el) return;
  el.innerHTML = GPIO_MAP.map(g => `
    <div class="gpio-row ${g.type}">
      <span class="gpio-num">GPIO ${g.gpio}</span>
      <span class="gpio-lbl">${g.label}</span>
      <span class="gpio-type">${g.type}</span>
    </div>`).join('');
  gpioLoadTemplateList();
}

// ── GPIO Templates ─────────────────────────────────────────
let _gpioTemplates = [];

async function gpioLoadTemplateList() {
  try {
    const data = await GpioTemplates.getAll();
    _gpioTemplates = data.templates || [];
    const sel = document.getElementById('gpio-tmpl-select');
    if (!sel) return;
    sel.innerHTML = '<option value="">— Load a saved template —</option>' +
      _gpioTemplates.map(t =>
        `<option value="${esc(t._id)}">${esc(t.label)}${t.tag ? ' · ' + esc(t.tag) : ''}</option>`
      ).join('');
  } catch { /* non-critical */ }
}

function gpioLoadTemplate() {
  const sel = document.getElementById('gpio-tmpl-select');
  if (!sel?.value) { toast('Select a template first', 'warn'); return; }
  const tmpl = _gpioTemplates.find(t => t._id === sel.value);
  if (!tmpl) return;
  const el = document.getElementById('ins-gpio-ref');
  if (!el) return;
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
  // Use inline modal instead of prompt() — blocked in iOS standalone PWA
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1100;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:var(--elevated);border-radius:16px;padding:24px;width:100%;max-width:340px">
      <div style="font-size:16px;font-weight:700;color:var(--t1);margin-bottom:16px">Save GPIO Template</div>
      <input id="_gpio-tmpl-name" type="text" placeholder='e.g. "3-Bedroom House"'
        style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);
               background:var(--surface);color:var(--t1);font-size:14px;box-sizing:border-box;margin-bottom:10px"/>
      <input id="_gpio-tmpl-tag" type="text" placeholder="Tag / type (optional)"
        style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid var(--border);
               background:var(--surface);color:var(--t1);font-size:14px;box-sizing:border-box;margin-bottom:16px"/>
      <div style="display:flex;gap:10px">
        <button onclick="this.closest('[style]').remove()" 
          style="flex:1;padding:11px;background:none;border:1px solid var(--border);border-radius:10px;color:var(--t2);cursor:pointer;font-family:inherit">Cancel</button>
        <button id="_gpio-tmpl-save"
          style="flex:2;padding:11px;background:var(--navy);color:#fff;border:none;border-radius:10px;font-weight:600;cursor:pointer;font-family:inherit">Save</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('_gpio-tmpl-name').focus();
  document.getElementById('_gpio-tmpl-save').onclick = async () => {
    const label = document.getElementById('_gpio-tmpl-name').value.trim();
    const tag   = document.getElementById('_gpio-tmpl-tag').value.trim();
    if (!label) { toast('Enter a template name', 'warn'); return; }
    overlay.remove();
    try {
      await GpioTemplates.save(label, tag,
        GPIO_MAP.map(g => ({ gpio: g.gpio, label: g.label, type: g.type, room: '' })));
      toast('Template saved!', 'success');
      gpioLoadTemplateList();
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  };
}
