// ============================================
// LUMAROK — js/roles.js  (Phase 4)
// Role system — permissions gate for the UI
// ============================================

// ── Permission defaults (mirrors backend ROLE_DEFAULTS) ──────
const ROLE_DEFAULTS = {
  owner: {
    devices:   true,
    schedules: true,
    security:  true,
    gate:      true,
    energy:    true,
    manage:    true,
  },
  family: {
    devices:   true,
    schedules: true,
    security:  false,
    gate:      false,
    energy:    true,
    manage:    false,
  },
  guest: {
    devices:   true,
    schedules: false,
    security:  false,
    gate:      false,
    energy:    false,
    manage:    false,
  },
};

// ── Cache permissions in APP state ───────────────────────────
// Called on login and on /me/permissions response
function loadPermissions(user, unitId) {
  if (!user || !unitId) {
    APP.permissions = {};
    APP.userRole    = null;
    return;
  }

  // Admin shortcut
  if (user.role === 'admin' || user.role === 'installer') {
    APP.permissions = Object.keys(ROLE_DEFAULTS.owner).reduce((acc, k) => {
      acc[k] = true; return acc;
    }, {});
    APP.userRole = user.role;
    return;
  }

  const unitEntry = user.units?.find(u => u.unit_id === unitId);
  if (!unitEntry) {
    APP.permissions = {};
    APP.userRole    = 'guest';
    return;
  }

  const defaults = ROLE_DEFAULTS[unitEntry.role] || ROLE_DEFAULTS.guest;
  APP.permissions = { ...defaults, ...(unitEntry.permissions || {}), role: unitEntry.role };
  APP.userRole    = unitEntry.role;
}

// ── Check a single permission ─────────────────────────────────
function can(permission) {
  if (!APP.permissions) return false;
  return APP.permissions[permission] === true;
}

// ── Check user's role ────────────────────────────────────────
function isRole(...roles) {
  return roles.includes(APP.userRole) || roles.includes(APP.user?.role);
}

// ── Apply permission gates to DOM ─────────────────────────────
// Elements with data-perm="manage" are hidden if user lacks that permission
// Elements with data-role="owner" are hidden for non-owners
function applyPermissionGates() {
  // Permission-based gates
  document.querySelectorAll('[data-perm]').forEach(el => {
    const perm = el.getAttribute('data-perm');
    if (!can(perm)) {
      el.style.display = 'none';
    } else {
      el.style.display = '';
    }
  });

  // Role-based gates
  document.querySelectorAll('[data-role]').forEach(el => {
    const roles = el.getAttribute('data-role').split(',').map(r => r.trim());
    if (!isRole(...roles)) {
      el.style.display = 'none';
    } else {
      el.style.display = '';
    }
  });

  // Hide add-device, add-room buttons for non-owners
  if (!can('manage')) {
    document.querySelectorAll('.add-device-btn, .add-room-btn, .edit-room-btn').forEach(el => {
      el.style.display = 'none';
    });
  }

  // Hide schedule controls for guests
  if (!can('schedules')) {
    document.querySelectorAll('.schedule-btn, .schedule-section').forEach(el => {
      el.style.display = 'none';
    });
  }

  // Dim security devices for users without security permission
  if (!can('security')) {
    document.querySelectorAll('[data-device-type="alarm"], [data-device-type="door_lock"]').forEach(el => {
      el.classList.add('perm-locked');
      el.querySelector('.toggle-btn')?.setAttribute('disabled', 'true');
      const lockBadge = document.createElement('span');
      lockBadge.className = 'perm-badge';
      lockBadge.textContent = '🔒';
      if (!el.querySelector('.perm-badge')) el.appendChild(lockBadge);
    });
  }

  // Dim gate for users without gate permission
  if (!can('gate')) {
    document.querySelectorAll('[data-device-type="gate"]').forEach(el => {
      el.classList.add('perm-locked');
      el.querySelector('.toggle-btn')?.setAttribute('disabled', 'true');
    });
  }

  // Show installer panel for installer/admin only
  const insRow = document.getElementById('installer-settings-row');
  if (insRow) {
    insRow.style.display = (APP.user?.role === 'installer' || APP.user?.role === 'admin') ? 'flex' : 'none';
  }

  // Update role badge in header
  const roleBadge = document.getElementById('role-badge');
  if (roleBadge && APP.userRole) {
    roleBadge.textContent = APP.userRole;
    roleBadge.className   = `role-badge role-${APP.userRole}`;
    roleBadge.style.display = '';
  }
}

// ── Refresh permissions from backend ─────────────────────────
async function refreshPermissions() {
  if (!APP.unit_id || !APP.user) return;
  try {
    const data = await api('GET', `/api/users/me/permissions/${APP.unit_id}`);
    APP.permissions = data.permissions;
    APP.userRole    = data.role;
    applyPermissionGates();
  } catch (err) {
    console.warn('[Roles] Could not refresh permissions:', err.message);
  }
}

// ── Render role badge HTML ────────────────────────────────────
function getRoleBadgeHTML(role) {
  const icons = { owner: '👑', family: '👨‍👩‍👧', guest: '🔑', installer: '🔧', admin: '⚡' };
  const colors = { owner: '#F59E0B', family: '#3B82F6', guest: '#6B7280', installer: '#10B981', admin: '#EF4444' };
  return `<span class="role-badge" style="background:${colors[role] || '#6B7280'}">${icons[role] || ''} ${role}</span>`;
}
