// ============================================
// LUMAROK — js/quickadd.js
// Quick Add Device — FAB sheet
// Works in cloud mode (unit_id present) AND
// local mode (no unit_id, persists to localStorage)
// ============================================

const QA = {
  selectedRoomId:  null,   // _id of chosen room
  selectedType:    null,   // { e, n, t } from DEV_TYPES
  creatingRoom:    false
};

// ── OPEN ─────────────────────────────────────
function openQuickAddDevice() {
  QA.selectedRoomId = null;
  QA.selectedType   = null;
  QA.creatingRoom   = false;

  _qaRenderRooms();
  _qaRenderTypes();

  const nameInp = document.getElementById('qa-dev-name');
  if (nameInp) nameInp.value = '';

  const newRow = document.getElementById('qa-new-room-row');
  if (newRow) newRow.style.display = 'none';

  document.getElementById('qa-modal')?.classList.add('show');
  document.body.style.overflow = 'hidden';
}

function closeQuickAddDevice() {
  document.getElementById('qa-modal')?.classList.remove('show');
  document.body.style.overflow = '';
}

// ── ROOM CHIPS ───────────────────────────────
function _qaRenderRooms() {
  const row = document.getElementById('qa-room-row');
  if (!row) return;
  row.innerHTML = '';

  APP.rooms.forEach(room => {
    const chip = document.createElement('button');
    chip.className = 'qa-room-chip' + (QA.selectedRoomId === room._id ? ' sel' : '');
    chip.textContent = (room.emoji || '🏠') + ' ' + room.name;
    chip.onclick = () => {
      QA.selectedRoomId = room._id;
      QA.creatingRoom   = false;
      document.getElementById('qa-new-room-row').style.display = 'none';
      document.querySelectorAll('.qa-room-chip').forEach(c => c.classList.remove('sel'));
      chip.classList.add('sel');
    };
    row.appendChild(chip);
  });

  // "+ New Room" chip
  const addChip = document.createElement('button');
  addChip.className = 'qa-room-chip';
  addChip.textContent = '＋ New Room';
  addChip.onclick = () => {
    QA.creatingRoom = true;
    QA.selectedRoomId = null;
    document.querySelectorAll('.qa-room-chip').forEach(c => c.classList.remove('sel'));
    addChip.classList.add('sel');
    const newRow = document.getElementById('qa-new-room-row');
    if (newRow) {
      newRow.style.display = 'flex';
      setTimeout(() => document.getElementById('qa-new-room-inp')?.focus(), 80);
    }
  };
  row.appendChild(addChip);
}

// Save inline new room (creates in APP.rooms right away)
async function qaSaveNewRoom() {
  const inp = document.getElementById('qa-new-room-inp');
  const name = inp?.value.trim();
  if (!name) { toast('Enter a room name', 'error'); return; }

  const emoji = '🏠';
  let newRoom;

  if (APP.unit_id) {
    try {
      const data = await Rooms.create(APP.unit_id, name, emoji);
      newRoom = data.room;
    } catch (err) {
      toast('Could not create room: ' + (err.message || 'Error'), 'error');
      return;
    }
  } else {
    // Local mode
    newRoom = {
      _id:   'local_room_' + Date.now(),
      name,
      emoji
    };
    APP.rooms.push(newRoom);
    _persistLocal();
  }

  if (!APP.rooms.find(r => r._id === newRoom._id)) APP.rooms.push(newRoom);
  QA.selectedRoomId = newRoom._id;
  QA.creatingRoom   = false;

  if (inp) inp.value = '';
  document.getElementById('qa-new-room-row').style.display = 'none';
  _qaRenderRooms();

  // Re-select the chip for the new room
  const chips = document.querySelectorAll('.qa-room-chip');
  chips.forEach(c => {
    if (c.textContent.includes(name)) c.classList.add('sel');
  });

  toast(name + ' room created ✓', 'success');
}

// ── DEVICE TYPE GRID ─────────────────────────
function _qaRenderTypes() {
  const grid = document.getElementById('qa-type-grid');
  if (!grid) return;
  grid.innerHTML = '';

  // Use DEV_TYPES from setup.js (always loaded before quickadd.js)
  const types = typeof DEV_TYPES !== 'undefined' ? DEV_TYPES : [
    {e:'💡',n:'Light',t:'light'},{e:'🔌',n:'Plug',t:'socket'},
    {e:'🌀',n:'Fan',t:'fan'},{e:'🚿',n:'Geyser',t:'geyser'},
    {e:'🚪',n:'Gate',t:'gate'},{e:'💧',n:'Pump',t:'pump'},
    {e:'📡',n:'Sensor',t:'sensor'},{e:'⚙️',n:'Custom',t:'custom'}
  ];

  types.forEach(dt => {
    const card = document.createElement('button');
    card.className = 'qa-type-card' + (QA.selectedType?.t === dt.t ? ' sel' : '');
    card.innerHTML = `<div class="qt-ico">${dt.e}</div><div class="qt-lbl">${dt.n}</div>`;
    card.onclick = () => {
      QA.selectedType = dt;
      document.querySelectorAll('.qa-type-card').forEach(c => c.classList.remove('sel'));
      card.classList.add('sel');
      // Auto-fill name if blank
      const nameInp = document.getElementById('qa-dev-name');
      if (nameInp && !nameInp.value.trim()) nameInp.value = dt.n;
    };
    grid.appendChild(card);
  });
}

// ── SUBMIT ───────────────────────────────────
async function qaSubmit() {
  if (!QA.selectedRoomId) { toast('Select a room first', 'error'); return; }
  if (!QA.selectedType)   { toast('Select a device type', 'error'); return; }

  const rawName = document.getElementById('qa-dev-name')?.value.trim();
  const name    = rawName || QA.selectedType.n;

  const btn = document.getElementById('qa-add-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }

  try {
    if (APP.unit_id && !String(QA.selectedRoomId).startsWith('local_')) {
      // ── Cloud mode ──────────────────────────
      const mappedType = (typeof TYPE_MAP !== 'undefined' && TYPE_MAP[QA.selectedType.t])
        || QA.selectedType.t;
      const data = await Devices.addToHome({
        unit_id:  APP.unit_id,
        room_id:  QA.selectedRoomId,
        name,
        emoji:    QA.selectedType.e,
        type:     mappedType
      });
      APP.devices.push(data.device || {
        _id:         'tmp_' + Date.now(),
        room_id:     QA.selectedRoomId,
        name,
        emoji:       QA.selectedType.e,
        type:        QA.selectedType.t,
        power_state: false,
        energy:      { kwh_today: 0, kwh_month: 0 }
      });
    } else {
      // ── Local mode ──────────────────────────
      const newDev = {
        _id:         'local_dev_' + Date.now(),
        room_id:     QA.selectedRoomId,
        name,
        emoji:       QA.selectedType.e,
        type:        QA.selectedType.t,
        power_state: false,
        energy:      { kwh_today: 0, kwh_month: 0 }
      };
      APP.devices.push(newDev);
      _persistLocal();
    }

    toast(name + ' added ✓', 'success');
    closeQuickAddDevice();

    // Refresh dashboard in-place
    if (typeof buildDashboard === 'function') buildDashboard();
    else if (typeof loadInstallerOverview === 'function') loadInstallerOverview();

  } catch (err) {
    toast('Failed to add device: ' + (err.message || 'Error'), 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Add Device'; }
  }
}

// ── LOCAL PERSIST HELPER ─────────────────────
function _persistLocal() {
  try {
    localStorage.setItem('lmr_local_rooms',   JSON.stringify(APP.rooms));
    localStorage.setItem('lmr_local_devices', JSON.stringify(APP.devices));
  } catch (_) {}
}

// ── KEYBOARD / BACKDROP CLOSE ─────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeQuickAddDevice();
});
