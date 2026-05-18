// ============================================================
// LumaRoK — core/queue-hardened.js
// Drop-in replacement for queue.js. Adds:
//   - Action deduplication (idempotency key)
//   - Priority ordering (COMPLETE > BIND > TEST > IDENTIFY > PROVISION_WIFI)
//   - Per-type max retry limits
//   - Flush guard (prevents concurrent flush runs)
//   - Pause / resume (for intentional offline work sessions)
// Depends on: Trace, Store, Retry, NetworkMonitor
// ============================================================
const OfflineQueue = (() => {
  const DB_NAME  = 'lumarok_queue_v2';
  const STORE    = 'actions';

  // Max retries per action type before abandonment
  const MAX_RETRIES = {
    BIND:           6,
    TEST:           4,
    IDENTIFY:       3,
    PROVISION_WIFI: 5,
    COMPLETE:       8,   // most important — try hardest
  };

  // Priority: lower = flushed first
  const PRIORITY = { COMPLETE: 0, BIND: 1, TEST: 2, IDENTIFY: 3, PROVISION_WIFI: 4 };

  let _db        = null;
  let _flushing  = false;
  let _paused    = false;

  // ── DB ────────────────────────────────────────────────────
  function _open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        const s  = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        s.createIndex('ikey', 'ikey', { unique: false }); // idempotency key
      };
      req.onsuccess = e => { _db = e.target.result; res(_db); };
      req.onerror   = () => rej(req.error);
    });
  }

  function _tx(mode, fn) {
    return _open().then(db => new Promise((res, rej) => {
      const tx = db.transaction(STORE, mode);
      tx.onerror = () => rej(tx.error);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => res(req.result);
      req.onerror   = () => rej(req.error);
    }));
  }

  // ── Enqueue ───────────────────────────────────────────────
  async function enqueue(type, payload, unitId) {
    // Idempotency key — prevents duplicate queuing of same logical action
    const ikey = `${type}::${unitId}::${JSON.stringify(payload)}`;

    // Check for duplicate
    const existing = await list();
    if (existing.some(e => e.ikey === ikey)) {
      Trace.warn('queue:duplicate', { type, ikey });
      return null;
    }

    const item = { type, payload, unitId, ikey, queued_at: Date.now(), retries: 0,
                   priority: PRIORITY[type] ?? 99 };
    const id = await _tx('readwrite', s => s.add(item));
    item.id  = id;
    Trace.event('queue:enqueued', { type, unitId, id });
    await _syncStore();
    return id;
  }

  // ── List (sorted by priority then queued_at) ──────────────
  async function list() {
    const items = await _tx('readonly', s => s.getAll());
    return items.sort((a, b) => (a.priority - b.priority) || (a.queued_at - b.queued_at));
  }

  async function remove(id) {
    // Scrub sensitive payload fields before removing (belt-and-suspenders)
    try {
      const item = await _tx('readonly', s => s.get(id));
      if (item && item.payload && item.payload.password) {
        item.payload = { ...item.payload, password: '[cleared]' };
        await _tx('readwrite', s => s.put(item));
      }
    } catch {}
    await _tx('readwrite', s => s.delete(id));
    await _syncStore();
  }

  // ── Flush ─────────────────────────────────────────────────
  async function flush() {
    if (_flushing || _paused) return;
    if (!navigator.onLine || NetworkMonitor.quality === 'OFFLINE') return;

    _flushing = true;
    const items = await list();
    if (!items.length) { _flushing = false; return; }

    Trace.info('queue:flush:start', { count: items.length });
    for (const item of items) {
      try {
        await _execute(item);
        await remove(item.id);
        Trace.info('queue:flushed', { type: item.type, id: item.id });
      } catch (err) {
        item.retries++;
        const maxR = MAX_RETRIES[item.type] ?? 4;
        Trace.warn('queue:retry', { type: item.type, retries: item.retries, max: maxR, err: err.message });

        if (item.retries >= maxR) {
          await remove(item.id);
          Trace.error('queue:abandoned', { type: item.type, id: item.id, err: err.message });
          toast(`Action ${item.type} abandoned after ${maxR} retries`, 'error');
        } else {
          await _tx('readwrite', s => s.put(item));
        }
        // On network failure stop flushing immediately — don't waste attempts
        if (!navigator.onLine) break;
      }
    }
    _flushing = false;
    await _syncStore();
  }

  async function _execute(item) {
    const { type, payload } = item;
    switch (type) {
      case 'BIND':           return Installer.bind(payload.unit_id, payload.device_id, payload.gpio_pin, payload.node_id);
      case 'IDENTIFY':       return Installer.identify(payload.unit_id, payload.device_id, payload.duration_seconds);
      case 'TEST':           return Installer.test(payload.unit_id, payload.device_id);
      case 'COMPLETE':       return Installer.complete(payload.unit_id, payload.owner_email, payload.owner_name);
      case 'PROVISION_WIFI': return Installer.provisionWifi(payload.unit_id, payload.ssid, payload.password);
      default:               throw new Error(`Unknown action type: ${type}`);
    }
  }

  async function _syncStore() {
    try { Store.set('offlineQueue', await list()); } catch {}
  }

  // ── Pause / resume ────────────────────────────────────────
  function pause()  { _paused = true;  Trace.info('queue:paused', {}); }
  function resume() { _paused = false; Trace.info('queue:resumed', {}); flush(); }

  // ── Auto-flush triggers ───────────────────────────────────
  window.addEventListener('online', () => {
    Trace.info('queue:online', 'Auto-flush triggered');
    flush();
  });

  return { enqueue, list, remove, flush, pause, resume };
})();
