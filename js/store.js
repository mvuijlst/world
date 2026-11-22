/*
 * World persistence. Everything stays in this browser (localStorage), with
 * JSON export/import for backups and moving between machines.
 */
(function (root) {
  'use strict';
  const WS = (root.WS = root.WS || {});
  const INDEX_KEY = 'worldsmith.index';
  const WORLD_KEY = (id) => `worldsmith.world.${id}`;
  const CURRENT_KEY = 'worldsmith.current';

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

  function index() {
    try { return JSON.parse(safeGet(INDEX_KEY)) || []; } catch { return []; }
  }
  function writeIndex(list) { safeSet(INDEX_KEY, JSON.stringify(list)); }

  function load(id) {
    try { const raw = safeGet(WORLD_KEY(id)); return raw ? migrate(JSON.parse(raw)) : null; } catch { return null; }
  }

  function save(w) {
    w.updated = new Date().toISOString();
    const ok = safeSet(WORLD_KEY(w.id), JSON.stringify(w));
    const list = index().filter((x) => x.id !== w.id);
    list.unshift({ id: w.id, name: w.name, updated: w.updated, star: w.star.name, planet: w.planet.name });
    writeIndex(list);
    safeSet(CURRENT_KEY, w.id);
    return ok;
  }

  function remove(id) {
    safeDel(WORLD_KEY(id));
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

  WS.store = { index, load, save, remove, current, migrate, exportJson, importJson };
})(typeof window !== 'undefined' ? window : globalThis);
