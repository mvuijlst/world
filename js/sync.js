/*
 * Server sync. The browser's copy (js/store.js) stays the working copy, so the app works offline, from file://
 * and without an account. When the page is served by the WorldSmith server and you are
 * signed in, every saved world is also sent to /api/worlds, and worlds saved on other
 * devices are fetched.
 *
 * Per world we remember the server revision our copy is based on and whether it has edits
 * the server hasn't seen. A save based on an old revision is refused by the server (409);
 * then our version is kept as a separate "(conflict)" copy and the server's is taken.
 */
(function (root) {
  'use strict';
  const WS = (root.WS = root.WS || {});
  const META = (id) => `worldsmith.sync.${id}`;
  const listeners = new Set();

  const state = { available: false, user: null, status: 'local', busy: 0, error: null };

  function meta(id) { try { return JSON.parse(localStorage.getItem(META(id))) || { rev: null, dirty: true }; } catch { return { rev: null, dirty: true }; } }
  function setMeta(id, m) { try { localStorage.setItem(META(id), JSON.stringify(m)); } catch { /* storage off */ } }
  function dropMeta(id) { try { localStorage.removeItem(META(id)); } catch { /* storage off */ } }

  function emit() { listeners.forEach((fn) => { try { fn(state); } catch { /* listener error */ } }); }
  function setStatus(s, err) { state.status = s; state.error = err || null; emit(); }

  function csrf() {
    const m = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : '';
  }

  async function api(method, path, data) {
    const res = await fetch(`api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(data !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { 'X-CSRFToken': csrf() } : {}) },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    return { status: res.status, ok: res.ok, json };
  }

  /* Is there a WorldSmith server behind this page, and who is signed in? */
  async function init() {
    if (location.protocol === 'file:') return state;
    try {
      const r = await api('GET', 'session');
      if (r.ok && r.json && 'user' in r.json) {
        state.available = true;
        state.user = r.json.user;
      }
    } catch { /* static hosting: no server */ }
    setStatus(state.available ? (state.user ? 'synced' : 'signed-out') : 'local');
    return state;
  }

  async function signIn(username, password) {
    await api('GET', 'session'); // make sure the CSRF cookie is set
    const r = await api('POST', 'login', { username, password });
    if (!r.ok) throw new Error((r.json && r.json.error) || `Sign-in failed (${r.status})`);
    state.user = r.json.user;
    setStatus('synced');
    return state.user;
  }

  async function signOut() {
    await api('POST', 'logout');
    state.user = null;
    setStatus('signed-out');
  }

  /* Mark a locally saved world as changed; it is pushed on the next flush. */
  function touched(id) { const m = meta(id); m.dirty = true; delete m.pristine; setMeta(id, m); }

  /* A blank template world opened on a new device: not worth sending until it is edited. */
  function markPristine(id) { setMeta(id, { rev: null, dirty: false, pristine: true }); }
  function isPristine(id) { return !!meta(id).pristine; }

  /*
   * Push one world. Returns { world } when the server's version replaced ours, so the caller
   * can show it, or {} when ours is now stored.
   */
  async function push(w) {
    if (!state.user) return {};
    const m = meta(w.id);
    if (m.pristine || (!m.dirty && m.rev !== null)) return {};
    const r = await api('PUT', `worlds/${encodeURIComponent(w.id)}`, { rev: m.rev, data: w });
    if (r.ok) { setMeta(w.id, { rev: r.json.rev, dirty: false }); return {}; }
    if (r.status === 401) { state.user = null; setStatus('signed-out'); return {}; }
    if (r.status === 409 && r.json && r.json.world) {
      // keep our edits as a copy, take the server's version under the original id
      const copy = WS.store.migrate(JSON.parse(JSON.stringify(w)));
      copy.id = WS.data.newId('w');
      copy.name = `${w.name} (conflict ${new Date().toLocaleString()})`;
      WS.store.save(copy, { keepCurrent: true });
      setMeta(copy.id, { rev: null, dirty: true });
      const server = WS.store.migrate(r.json.world.data);
      WS.store.save(server, { keepCurrent: true });
      setMeta(server.id, { rev: r.json.world.rev, dirty: false });
      return { world: server, conflictCopy: copy };
    }
    if (r.status === 410) {
      // deleted on another device but edited here: keep it, as a new world
      const revived = JSON.parse(JSON.stringify(w));
      dropMeta(w.id);
      WS.store.remove(w.id);
      revived.id = WS.data.newId('w');
      WS.store.save(revived, { keepCurrent: true });
      setMeta(revived.id, { rev: null, dirty: true });
      return { world: revived };
    }
    throw new Error((r.json && r.json.error) || `Save failed (${r.status})`);
  }

  async function remove(id) {
    dropMeta(id);
    if (!state.user) return;
    try { await api('DELETE', `worlds/${encodeURIComponent(id)}`); } catch { /* offline: it stays on the server */ }
  }

  /*
   * Bring local and server into line: fetch what is newer on the server, drop what was
   * deleted there, push what only we have. Returns the ids whose local copy was replaced.
   */
  async function syncAll() {
    if (!state.user) return { replaced: [], removed: [] };
    state.busy++; setStatus('syncing');
    const replaced = [], removed = [], recovered = [];
    try {
      const r = await api('GET', 'worlds');
      if (r.status === 401) { state.user = null; setStatus('signed-out'); return { replaced, removed }; }
      if (!r.ok) throw new Error(`Could not list worlds (${r.status})`);
      const local = new Map(WS.store.index().map((x) => [x.id, x]));
      for (const s of r.json.worlds) {
        const m = local.has(s.id) ? meta(s.id) : { rev: null, dirty: false };
        if (s.deleted) {
          if (local.has(s.id) && !m.dirty) { WS.store.remove(s.id); dropMeta(s.id); removed.push(s.id); }
          continue;
        }
        // (stale: this browser lost the last save of it, so the server's copy is the newer one)
        const stale = local.has(s.id) && WS.store.isStale(s.id);
        if (!local.has(s.id) || (s.rev !== m.rev && !m.dirty) || stale) {
          const g = await api('GET', `worlds/${encodeURIComponent(s.id)}`);
          if (g.ok) {
            WS.store.save(WS.store.migrate(g.json.data), { keepCurrent: true, keepStamp: true });
            setMeta(s.id, { rev: g.json.rev, dirty: false });
            replaced.push(s.id);
            if (stale) { WS.store.settled(s.id); recovered.push(s.id); }
          }
        }
        local.delete(s.id);
      }
      // the rest exists only here, or has local edits: push
      const ids = new Set([...local.keys(), ...WS.store.index().map((x) => x.id).filter((id) => meta(id).dirty)]);
      for (const id of ids) {
        const w = WS.store.load(id);
        if (!w) continue;
        if (meta(id).pristine || (!local.has(id) && !meta(id).dirty)) continue;
        const out = await push(w);
        if (out.world) replaced.push(out.world.id);
      }
      setStatus('synced');
    } catch (err) {
      setStatus('error', err.message);
    } finally {
      state.busy--;
    }
    return { replaced, removed, recovered };
  }

  WS.sync = {
    state, init, signIn, signOut, touched, markPristine, isPristine, push, remove, syncAll,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setStatus,
  };
})(typeof window !== 'undefined' ? window : globalThis);
