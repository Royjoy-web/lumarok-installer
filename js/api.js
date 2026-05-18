// ============================================
// LUMAROK — js/api.js
// All backend API calls
// ============================================

// ISS-012 FIX: API_URL reads from window.LMR_API_URL (set per-env in index.html) with fallback
const API_URL = window.LMR_API_URL || 'https://lumarok-backend.onrender.com';

// ── Token helpers ────────────────────────────
// ISS-011 FIX: Access token stored in-memory only (never localStorage — XSS-safe).
// Refresh token lives in httpOnly SameSite=Strict cookie set by backend on login/refresh.
// On page reload, silentRefresh() is called with credentials:'include'; the browser
// sends the httpOnly cookie automatically — no JS can read or steal the refresh token.
let _accessToken = '';
const getToken        = ()     => _accessToken;
const getRefreshToken = ()     => null; // refresh token now lives in httpOnly cookie only
const setToken  = (t, _r)     => { _accessToken = t || ''; };
const clearAuth = ()           => {
  _accessToken = '';
  localStorage.removeItem('lmr_user');
  // Clear any legacy token keys left from previous versions
  localStorage.removeItem('lmr_token');
  localStorage.removeItem('lmr_refresh_token');
};

// ISS-011 FIX: Restore in-memory access token from httpOnly cookie on every page load.
// Called before any app logic so getToken() returns a valid token from line 1.
(function _cookieBootRefresh() {
  const _doBootRefresh = async () => {
    try {
      const res = await fetch(API_URL + "/api/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: "{}",
      });
      if (res.ok) {
        const d = await res.json();
        if (d.token) setToken(d.token);
      }
    } catch { /* offline or no cookie — app will redirect to login */ }
  };
  // Run immediately — API_URL and setToken are defined above this block
  _doBootRefresh();
})();

// Auto-refresh on 401
// ISS-018 FIX: Removed _refreshAccessToken() — unguarded duplicate of silentRefresh().
// Parallel calls (WS reconnect + failed API) both consume the same refresh token; second always fails.
// All callers now use silentRefresh() which has a _refreshing mutex guard.
const saveUser  = u  => localStorage.setItem('lmr_user', JSON.stringify(u));
const loadUser  = () => { try { return JSON.parse(localStorage.getItem('lmr_user')); } catch { return null; } };

// ── Silent token refresh ─────────────────────
let _refreshing = false;
let _refreshQueue = [];

async function silentRefresh() {
  if (_refreshing) {
    return new Promise((resolve, reject) => _refreshQueue.push({ resolve, reject }));
  }
  _refreshing = true;
  try {
    // ISS-011 FIX: credentials:'include' sends the httpOnly lmr_refresh cookie automatically.
    // No refresh_token in body — JS never touches it, eliminating XSS token theft vector.
    const res = await fetchWithTimeout(API_URL + '/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}',
    });
    if (!res.ok) { clearAuth(); throw new Error('refresh failed'); }
    const data = await res.json();
    setToken(data.token); // access token in memory; refresh cookie rotated by server
    _refreshQueue.forEach(p => p.resolve());
  } catch (err) {
    _refreshQueue.forEach(p => p.reject(err));
    throw err;
  } finally {
    _refreshing = false;
    _refreshQueue = [];
  }
}

// ── Auth headers helper (used by app.js polling) ──────────────
function authHeaders() {
  return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' };
}

// ── Core fetch wrapper ───────────────────────
function fetchWithTimeout(url, opts, ms = 15000) {
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(id));
}

async function api(method, path, body = null, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) headers['Authorization'] = 'Bearer ' + getToken();
  let res, data;
  try {
    res  = await fetchWithTimeout(API_URL + path, { method, headers, credentials: 'include', body: body ? JSON.stringify(body) : null });
    data = await res.json();
  } catch (networkErr) {
    throw new Error('Backend unreachable — check your connection');
  }
  if (res.status === 401) {
    if (auth && path !== '/api/auth/refresh' && path !== '/api/auth/login') {
      try {
        await silentRefresh();
        headers['Authorization'] = 'Bearer ' + getToken();
        res  = await fetchWithTimeout(API_URL + path, { method, headers, credentials: 'include', body: body ? JSON.stringify(body) : null });
        data = await res.json();
        if (res.ok) return data;
      } catch { /* fall through to logout */ }
      clearAuth();
      if (typeof showScreen === 'function') goTo('login');
      throw new Error('Session expired — please log in again');
    }
    throw new Error(data?.message || 'Invalid email or password');
  }
  if (res.status === 429) throw new Error('Too many requests — slow down');
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}

// ── AUTH ─────────────────────────────────────
const Auth = {
  async register(name, email, password) {
    const data = await api('POST', '/api/auth/register', { name, email, password }, false);
    setToken(data.token);
    saveUser(data.user);
    return data;
  },
  async login(email, password) {
    const data = await api('POST', '/api/auth/login', { email, password }, false);
    if (data.token) { setToken(data.token, data.refresh_token); saveUser(data.user); }
    return data;
  },
  async me() {
    return await api('GET', '/api/auth/me');
  },
  logout() {
    clearAuth();
  }
};

// ── ACTIVATION ───────────────────────────────
const Activation = {
  async validate(code) {
    return await api('POST', '/api/activation/validate', { code });
  }
  // confirm intentionally removed — homeowners claim ownership via user app
};

// ── ROOMS ────────────────────────────────────
const Rooms = {
  async getAll(unit_id) {
    return await api('GET', `/api/rooms/${unit_id}`);
  },
  async create(unit_id, name, emoji) {
    return await api('POST', '/api/rooms', { unit_id, name, emoji });
  },
  async update(id, name, emoji) {
    return await api('PATCH', `/api/rooms/${id}`, { name, emoji });
  },
  async delete(id) {
    return await api('DELETE', `/api/rooms/${id}`);
  }
};

// ── DEVICES ──────────────────────────────────
const Devices = {
  async getAll(unit_id) {
    return await api('GET', `/api/devices/${unit_id}`);
  },
  async create(data) {
    return await api('POST', '/api/devices', data);
  },
  async toggle(id, power_state) {
    return await api('POST', `/api/devices/${id}/toggle`, { power_state, source: 'app' });
  },
  async setPosition(id, position) {
    return await api('POST', `/api/devices/${id}/position`, { position, source: 'app' });
  },
  async update(id, data) {
    return await api('PATCH', `/api/devices/${id}`, data);
  },
  async guestAccess(id, guest_allowed) {
    return await api('PATCH', `/api/devices/${id}/guest-access`, { guest_allowed });
  },
  async delete(id) {
    return await api('DELETE', `/api/devices/${id}`);
  },
  async addSchedule(id, entry) {
    return await api('POST', `/api/devices/${id}/schedule`, entry);
  },
  async deleteSchedule(id, scheduleId) {
    return await api('DELETE', `/api/devices/${id}/schedule/${scheduleId}`);
  }
};

// ── USERS / MEMBERS (Phase 4) ─────────────────
const Users = {
  async getMembers(unit_id) {
    return await api('GET', `/api/users/${unit_id}/members`);
  },
  async createInvite(unit_id, role = 'guest', permissions = null) {
    return await api('POST', `/api/users/${unit_id}/invite`, { role, permissions });
  },
  async joinUnit(invite_token) {
    return await api('POST', '/api/users/join', { invite_token });
  },
  async updateMember(unit_id, user_id, role, permissions = null) {
    return await api('PATCH', `/api/users/${unit_id}/member/${user_id}`, { role, permissions });
  },
  async removeMember(unit_id, user_id) {
    return await api('DELETE', `/api/users/${unit_id}/member/${user_id}`);
  },
  async getMyPermissions(unit_id) {
    return await api('GET', `/api/users/me/permissions/${unit_id}`);
  },
};

// ── SCENES ───────────────────────────────────
const Scenes = {
  async getAll(unit_id) {
    return await api('GET', `/api/scenes/${unit_id}`);
  },
  async create(data) {
    return await api('POST', '/api/scenes', data);
  },
  async run(id) {
    return await api('POST', `/api/scenes/${id}/run`, {});
  },
  async delete(id) {
    return await api('DELETE', `/api/scenes/${id}`);
  }
};

// ── ENERGY (from unit status) ─────────────────
const Energy = {
  async getStatus(unit_id) {
    return await api('GET', `/api/units/${unit_id}/status`);
  }
};

// ── SENSORS (Phase 5) ─────────────────────────
const Sensors = {
  async getLatest(unit_id) {
    return await api('GET', `/api/sensors/${unit_id}/latest`);
  },
  async getHistory(unit_id, limit = 50) {
    return await api('GET', `/api/sensors/${unit_id}/history?limit=${limit}`);
  },
};

// ── INSTALLER (Phase 5) ───────────────────────
const Installer = {
  async getOverview(unit_id) {
    return await api('GET', `/api/installer/${unit_id}/overview`);
  },
  async getUnbound(unit_id) {
    return await api('GET', `/api/installer/${unit_id}/unbound`);
  },
  async provisionWifi(unit_id, ssid, password) {
    return await api('POST', `/api/installer/${unit_id}/provision-wifi`, { ssid, password });
  },
  async identify(unit_id, device_id, duration_seconds = 10) {
    return await api('POST', `/api/installer/${unit_id}/identify/${device_id}`, { duration_seconds });
  },
  async bind(unit_id, device_id, gpio_pin, node_id = null, room_id = null, room_name = null) {
    return await api('PATCH', `/api/installer/${unit_id}/bind/${device_id}`, { gpio_pin, node_id, room_id, room_name });
  },
  async test(unit_id, device_id) {
    return await api('POST', `/api/installer/${unit_id}/test/${device_id}`, {});
  },
  async getChecklist(unit_id) {
    return await api('GET', `/api/installer/${unit_id}/checklist`);
  },
  async complete(unit_id, owner_email, owner_name) {
    return await api('POST', `/api/installer/${unit_id}/complete`, { owner_email, owner_name });
  },
};

// ── GPIO TEMPLATES ────────────────────────────
const GpioTemplates = {
  async getAll() {
    return await api('GET', '/api/gpio-templates');
  },
  async save(label, tag, pins) {
    return await api('POST', '/api/gpio-templates', { label, tag, pins });
  },
  async remove(id) {
    return await api('DELETE', `/api/gpio-templates/${id}`);
  },
};
