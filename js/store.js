/*
 * World persistence. Everything stays in this browser, with JSON export/import for backups
 * and moving between machines.
 *
 * The worlds themselves live in IndexedDB, which has room for hundreds of MB; localStorage
 * (about 5 MB for the whole site) keeps only the small things: the list of worlds, which one
 * is open, and the sync notes. ready() reads every world into memory once, so load() and
 * save() stay synchronous; save() updates memory at once and writes to IndexedDB behind it.
 * Worlds an older version kept in localStorage are moved over on the first ready().
 *
 * A write that fails is reported to onStatus listeners and the world is noted as "stale"
 * (localStorage), so the next page load knows its stored copy is older than what was last
 * shown and sync can take the server's copy instead of trusting it.
 */
(function (root) {
  'use strict';
  const WS = (root.WS = root.WS || {});
  const INDEX_KEY = 'worldsmith.index';
  const WORLD_KEY = (id) => `worldsmith.world.${id}`;
  const WORLD_PREFIX = 'worldsmith.world.';
  const CURRENT_KEY = 'worldsmith.current';
  const STALE_KEY = 'worldsmith.stale';
  const DB_NAME = 'worldsmith', DB_STORE = 'worlds';

  function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch { return false; } }
  function safeDel(k) { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } }

  /* Fill any fields a stored world is missing (older saves, hand-edited JSON). */
  function migrate(w) {
    const base = WS.data.defaultWorld(w && w.name);
    const merge = (dst, src) => {
      for (const k in src) {
        if (Array.isArray(src[k])) { if (!Array.isArray(dst[k])) dst[k] = src[k]; }
        else if (src[k] && typeof src[k] === 'object') { if (!dst[k] || typeof dst[k] !== 'object') dst[k] = {}; merge(dst[k], src[k]); }
        else if (dst[k] === undefined) dst[k] = src[k];
      }
      return dst;
    };
    const out = merge(JSON.parse(JSON.stringify(w || {})), base);
    if (!out.id) out.id = base.id;
    out.system.bodies = out.system.bodies.filter((b) => !b.home);
    return out;
  }

  // ── IndexedDB ─────────────────────────────────────────────────────────
  let db = null;                 // the open database, or null: then worlds go to localStorage as before
  const mem = new Map();         // id → the world as JSON text, as last saved in this page
  const listeners = new Set();

  function openDb() {
    return new Promise((resolve) => {
      let req;
      try { req = root.indexedDB && root.indexedDB.open(DB_NAME, 1); } catch { req = null; }
      if (!req) { resolve(null); return; }
      req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(DB_STORE)) req.result.createObjectStore(DB_STORE); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  function readAll() {
    return new Promise((resolve, reject) => {
      const out = new Map();
      const tx = db.transaction(DB_STORE, 'readonly');
      const cur = tx.objectStore(DB_STORE).openCursor();
      cur.onsuccess = () => { const c = cur.result; if (c) { out.set(String(c.key), c.value); c.continue(); } };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    });
  }
  /* Write (text) or delete (null) one world; resolves true once it is on disk. */
  function write(id, text) {
    return new Promise((resolve) => {
      let tx;
      try {
        tx = db.transaction(DB_STORE, 'readwrite');
        const st = tx.objectStore(DB_STORE);
        if (text == null) st.delete(id); else st.put(text, id);
        if (tx.commit) tx.commit();
      } catch { resolve(false); return; }
      tx.oncomplete = () => resolve(true);
      tx.onerror = tx.onabort = () => resolve(false);
    });
  }

  function staleIds() { try { return new Set(JSON.parse(safeGet(STALE_KEY)) || []); } catch { return new Set(); } }
  function markStale(id, on) {
    const s = staleIds();
    if (on === s.has(id)) return;
    if (on) s.add(id); else s.delete(id);
    if (s.size) safeSet(STALE_KEY, JSON.stringify([...s])); else safeDel(STALE_KEY);
  }
  /*
   * Was the last save of this world lost before this page opened, so the copy it read is
   * behind what was last shown? (A failure in this page doesn't count: memory has the newest.)
   */
  let staleAtOpen = new Set();
  function isStale(id) { return staleAtOpen.has(id); }
  function settled(id) { staleAtOpen.delete(id); }

  function report(id, ok) {
    markStale(id, !ok || staleAtOpen.has(id)); // (stays marked until sync has taken the server's copy)
    listeners.forEach((fn) => { try { fn({ id, ok }); } catch { /* listener error */ } });
  }

  let readyP = null;
  /* Open the database, read every world into memory, and move worlds out of localStorage. */
  function ready() {
    if (readyP) return readyP;
    readyP = (async () => {
      staleAtOpen = staleIds();
      db = await openDb();
      if (!db) return;
      try {
        for (const [id, text] of await readAll()) mem.set(id, text);
      } catch { db = null; return; }
      // worlds an older version kept in localStorage: copy each over, then free its space
      let keys = [];
      try { keys = Object.keys(localStorage).filter((k) => k.startsWith(WORLD_PREFIX)); } catch { /* no localStorage */ }
      for (const k of keys) {
        const id = k.slice(WORLD_PREFIX.length), text = safeGet(k);
        if (text == null) continue;
        if (!mem.has(id) && !await write(id, text)) continue; // keep it where it is
        if (!mem.has(id)) mem.set(id, text);
        safeDel(k);
      }
    })();
    return readyP;
  }

  // ── the store ─────────────────────────────────────────────────────────
  function index() {
    try { return JSON.parse(safeGet(INDEX_KEY)) || []; } catch { return []; }
  }
  function writeIndex(list) { safeSet(INDEX_KEY, JSON.stringify(list)); }

  // (a world that could not be moved over is still read from localStorage)
  function raw(id) { return mem.has(id) ? mem.get(id) : safeGet(WORLD_KEY(id)); }

  function load(id) {
    try { const text = raw(id); return text ? migrate(JSON.parse(text)) : null; } catch { return null; }
  }

  /*
   * opts.keepCurrent: don't make this the world opened next time (used for synced copies).
   * opts.keepStamp:   keep w.updated as it is (a copy fetched from the server).
   * Returns false when the world could not be stored at all; a later IndexedDB failure is
   * reported through onStatus.
   */
  function save(w, opts = {}) {
    if (!opts.keepStamp || !w.updated) w.updated = new Date().toISOString();
    const text = JSON.stringify(w);
    let ok = true;
    if (db) {
      mem.set(w.id, text);
      write(w.id, text).then((done) => { if (done) safeDel(WORLD_KEY(w.id)); report(w.id, done); });
    } else {
      ok = safeSet(WORLD_KEY(w.id), text);
      markStale(w.id, !ok);
    }
    const list = index().filter((x) => x.id !== w.id);
    list.push({ id: w.id, name: w.name, updated: w.updated, star: w.star.name, planet: w.planet.name });
    list.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    writeIndex(list);
    if (!opts.keepCurrent) safeSet(CURRENT_KEY, w.id);
    return ok;
  }

  function remove(id) {
    if (db) { mem.delete(id); write(id, null); }
    safeDel(WORLD_KEY(id));
    markStale(id, false);
    writeIndex(index().filter((x) => x.id !== id));
  }

  function current() {
    const id = safeGet(CURRENT_KEY);
    const w = id && load(id);
    if (w) return w;
    const first = index()[0];
    return (first && load(first.id)) || null;
  }

  function exportJson(w) {
    const blob = new Blob([JSON.stringify(w, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(w.name || 'world').replace(/[^\w-]+/g, '_')}.worldsmith.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function importJson(file) {
    const text = await file.text();
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !parsed.star || !parsed.planet) throw new Error('Not a WorldSmith world file');
    const w = migrate(parsed);
    w.id = WS.data.newId('w'); // never overwrite an existing world on import
    return w;
  }

  WS.store = {
    ready, index, load, save, remove, current, migrate, exportJson, importJson, isStale, settled,
    /* fn({ id, ok }) after each IndexedDB write */
    onStatus(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get backend() { return db ? 'indexeddb' : 'localstorage'; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
