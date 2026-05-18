// ============================================================
// LumaRoK — commissioning/engine.js
// Device binding, GPIO management, identify, test, checklist,
// installation completion. Replaces INS global + installer.js logic.
// Depends on: Store, Trace, Retry, OfflineQueue, Installer (api.js)
// ============================================================
const CommissioningEngine = (() => {

  // ── Overview ───────────────────────────────────────────────
  async function loadOverview(unit_id) {
    if (!unit_id) { toast('No unit selected', 'error'); return; }

    const statusEl  = document.getElementById('ins-status-badge');
    const summaryEl = document.getElementById('ins-summary');
    const devListEl = document.getElementById('ins-device-list');
    if (statusEl) statusEl.textContent = 'Loading…';

    try {
      const data = await Retry.attempt(() => Installer.getOverview(unit_id), { max: 3, tag: 'commission:overview' });
      Store.set('unit', data.unit);
      Store.set('devices', data.devices);

      const st = data.unit.status || 'UNKNOWN';
      if (statusEl) { statusEl.textContent = st; statusEl.className = `ins-status-badge ${st.toLowerCase()}`; }
      const unitIdEl = document.getElementById('ins-unit-id');
      if (unitIdEl) unitIdEl.textContent = unit_id;

      if (summaryEl) {
        const s = data.summary;
        summaryEl.innerHTML = `
          <div class="ins-stat"><div class="ins-stat-val">${s.total_devices}</div><div class="ins-stat-lbl">Devices</div></div>
          <div class="ins-stat"><div class="ins-stat-val ok">${s.bound}</div><div class="ins-stat-lbl">Bound</div></div>
          <div class="ins-stat"><div class="ins-stat-val ${s.unbound > 0 ? 'warn' : 'ok'}">${s.unbound}</div><div class="ins-stat-lbl">Unbound</div></div>
          <div class="ins-stat"><div class="ins-stat-val ok">${s.online}</div><div class="ins-stat-lbl">Online</div></div>`;
      }
      if (devListEl) {
        devListEl.innerHTML = data.devices.length
          ? data.devices.map(d => _deviceRow(d)).join('')
          : '<div class="ins-empty">No devices yet. Ask the owner to add devices first.</div>';
      }
      await loadChecklist(unit_id);
      Trace.info('commission:overview', { unit_id, devices: data.devices.length });
      return data;
    } catch (err) {
      toast('Could not load unit: ' + err.message, 'error');
      if (statusEl) statusEl.textContent = 'ERROR';
    }
  }

  function _deviceRow(d) {
    const stClass = d.status === 'ONLINE' ? 'online' : d.status === 'OFFLINE' ? 'offline' : 'unbound';
    const gpio    = d.is_bound ? `GPIO ${d.gpio_pin}` : 'Not bound';
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
          ${d.is_bound ? `<button class="ins-icon-btn" data-id="${esc(d._id)}" onclick="event.stopPropagation();doIdentify(this.dataset.id)">💡</button>` : ''}
          ${d.is_bound ? `<button class="ins-icon-btn test" data-id="${esc(d._id)}" onclick="event.stopPropagation();doTest(this.dataset.id)">▶</button>` : ''}
        </div>
      </div>`;
  }

  // ── Bind ───────────────────────────────────────────────────
  function openBindScreen(deviceId) {
    Store.set('commissioning.selectedDeviceId', deviceId);
    const d = Store.get('devices')?.find(x => x._id === deviceId);
    if (!d) return;

    document.getElementById('bind-device-name').textContent  = d.name;
    document.getElementById('bind-device-room').textContent  = d.room;
    document.getElementById('bind-device-emoji').textContent = d.emoji || '💡';
    document.getElementById('bind-gpio').value               = d.gpio_pin ?? '';
    document.getElementById('bind-node').value               = d.node_id  ?? '';

    const statusEl = document.getElementById('bind-current-status');
    if (statusEl) {
      statusEl.textContent = d.is_bound ? `Currently: GPIO ${d.gpio_pin}` : 'Not yet bound';
      statusEl.className   = `bind-status-tag ${d.is_bound ? 'bound' : 'unbound'}`;
    }
    document.getElementById('bind-result').classList.remove('show');
    goTo('installer-bind');
    renderGpioPicker(Store.get('unit_id'));
  }

  async function bind() {
    const gpio     = parseInt(document.getElementById('bind-gpio')?.value);
    const node     = document.getElementById('bind-node')?.value.trim() || null;
    const unit_id  = Store.get('unit_id');
    const deviceId = Store.get('commissioning.selectedDeviceId');

    if (isNaN(gpio) || gpio < 0 || gpio > 48) { toast('Enter a valid GPIO pin (0–48)', 'error'); return; }

    setLoading('bind-btn', true);
    try {
      const data = await Retry.attempt(
        () => Installer.bind(unit_id, deviceId, gpio, node),
        { max: 3, tag: 'commission:bind', bail: e => e.message?.includes('409') || e.message?.includes('conflict') }
      );
      document.getElementById('bind-result-msg').textContent = data.message;
      document.getElementById('bind-result').classList.add('show');
      toast(data.message, 'success');
      Trace.event('commission:bound', { deviceId, gpio });
      setTimeout(() => loadOverview(unit_id), 600);
    } catch (err) {
      if (!navigator.onLine) {
        await OfflineQueue.enqueue('BIND', { unit_id, device_id: deviceId, gpio_pin: gpio, node_id: node }, unit_id);
        toast('Offline — bind queued, will sync when online', 'warn');
      } else {
        toast(err.message || 'Bind failed', 'error');
      }
    } finally {
      setLoading('bind-btn', false);
    }
  }

  // ── Identify / Test ────────────────────────────────────────
  async function identify(deviceId, duration = 10) {
    const unit_id = Store.get('unit_id');
    try {
      const data = await Installer.identify(unit_id, deviceId, duration);
      toast(data.message, data.mqtt_sent ? 'success' : 'warn');
      Trace.event('commission:identify', { deviceId, mqtt_sent: data.mqtt_sent });
    } catch (err) {
      toast(err.message || 'Identify failed', 'error');
    }
  }

  async function test(deviceId) {
    const unit_id = Store.get('unit_id');
    try {
      if (!navigator.onLine) {
        await OfflineQueue.enqueue('TEST', { unit_id, device_id: deviceId }, unit_id);
        toast('Offline — test queued', 'warn'); return;
      }
      const data = await Installer.test(unit_id, deviceId);
      toast(data.message, 'success');
      Trace.event('commission:test', { deviceId });
    } catch (err) {
      toast(err.message || 'Test failed', 'error');
    }
  }

  // ── Checklist ──────────────────────────────────────────────
  async function loadChecklist(unit_id) {
    const el = document.getElementById('ins-checklist');
    if (!el) return null;
    try {
      const data = await Installer.getChecklist(unit_id || Store.get('unit_id'));
      Store.set('commissioning.checklist', data);
      const req  = data.checks.filter(c => c.required);
      const done = req.filter(c => c.done);
      const pct  = req.length ? Math.round(done.length / req.length * 100) : 0;

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
              ${!c.done && c.unbound_names?.length ? `<div class="chk-sub">Remaining: ${c.unbound_names.map(n => esc(n)).join(', ')}</div>` : ''}
              ${c.firmware_version ? `<div class="chk-sub">v${esc(c.firmware_version)}</div>` : ''}
            </div>
            <span class="chk-tag ${c.required ? 'req' : 'opt'}">${c.required ? 'Required' : 'Optional'}</span>
          </div>`).join('')}
        ${data.setup_complete ? `<button class="btn-primary full green" style="margin-top:16px" onclick="doCompleteInstall()">✅ Mark Installation Complete</button>` : ''}`;
      return data;
    } catch (err) {
      el.innerHTML = '<div class="ins-empty">Could not load checklist</div>';
    }
  }

  // ── GPIO Picker ────────────────────────────────────────────
  const GPIO_USABLE = [2,4,5,12,13,14,15,18,19,21,22,23,25,26,27,32,33,34,35,36,39];

  async function renderGpioPicker(unit_id) {
    const container = document.getElementById('gpio-picker-grid');
    if (!container) return;
    container.innerHTML = '<span style="font-size:12px;color:var(--t3)">Loading pins…</span>';

    let takenMap = {};
    try {
      const data = await Devices.getAll(unit_id);
      const devId = Store.get('commissioning.selectedDeviceId');
      (data.devices || []).filter(d => d.is_bound && d.gpio_pin != null && d._id !== devId)
        .forEach(d => { takenMap[d.gpio_pin] = d.name; });
    } catch {}

    const currentVal = parseInt(document.getElementById('bind-gpio')?.value) || null;
    container.innerHTML = GPIO_USABLE.map(pin => {
      const taken    = takenMap[pin];
      const selected = pin === currentVal;
      const cls      = selected ? 'gpio-tile selected' : taken ? 'gpio-tile taken' : 'gpio-tile free';
      const label    = taken ? `❌ ${taken.substring(0, 10)}` : '✅ Free';
      const click    = !taken ? `onclick="selectGpio(${pin})"` : '';
      return `<div class="${cls}" ${click} title="GPIO ${pin}${taken ? ' — ' + taken : ''}">
        <span style="font-size:11px;font-weight:700">GPIO ${pin}</span>
        <span style="font-size:10px">${label}</span>
      </div>`;
    }).join('');
  }

  // ── Complete ───────────────────────────────────────────────
  async function complete(unit_id, owner_email, owner_name) {
    if (!navigator.onLine) {
      await OfflineQueue.enqueue('COMPLETE', { unit_id, owner_email, owner_name }, unit_id);
      toast('Offline — completion queued, will sync when online', 'warn');
      return { queued: true };
    }
    return Retry.attempt(
      () => Installer.complete(unit_id, owner_email, owner_name),
      { max: 3, tag: 'commission:complete' }
    );
  }

  return { loadOverview, openBindScreen, bind, identify, test, loadChecklist, renderGpioPicker, complete };
})();
