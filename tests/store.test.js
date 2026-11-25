'use strict';
// Worlds live in IndexedDB, not in localStorage's ~5 MB: a big world still saves, worlds an
// older version left in localStorage move over, and a lost save is remembered as "stale" so
// the next page load can take the server's copy.
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../js/data.js');

/* localStorage with a quota (in characters), like a browser's. */
function fakeLocalStorage(quota = 50000) {
  const m = new Map();
  const size = () => [...m].reduce((s, [k, v]) => s + k.length + v.length, 0);
  const ls = {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { const old = m.get(k); m.set(k, String(v)); if (size() > quota) { if (old === undefined) m.delete(k); else m.set(k, old); throw new Error('QuotaExceededError'); } },
    removeItem: (k) => { m.delete(k); },
  };
  return new Proxy(ls, { ownKeys: () => [...m.keys()], getOwnPropertyDescriptor: (t, k) => (m.has(k) ? { enumerable: true, configurable: true, value: m.get(k) } : undefined) });
}

/* Just enough IndexedDB for js/store.js; `fail` makes every write abort. */
function fakeIndexedDB() {
  const data = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const idb = {
    fail: false,
    data,
    open() {
      const req = {};
      later(() => {
        const dbo = {
          objectStoreNames: { contains: () => true },
          createObjectStore() {},
          transaction() {
            const ops = [];
            const tx = {
              objectStore: () => ({
                put: (v, k) => ops.push(() => data.set(k, v)),
                delete: (k) => ops.push(() => data.delete(k)),
                openCursor() {
                  const cur = {};
                  const entries = [...data];
                  let i = 0;
                  const step = () => later(() => {
                    if (i < entries.length) { const [key, value] = entries[i++]; cur.result = { key, value, continue: step }; cur.onsuccess(); }
                    else { cur.result = null; cur.onsuccess(); tx.oncomplete && tx.oncomplete(); }
                  });
                  step();
                  return cur;
                },
              }),
              commit() {},
            };
            later(() => {
              if (!ops.length) return; // (a read: completes from its cursor)
              if (idb.fail) { tx.onabort && tx.onabort(); return; }
              ops.forEach((f) => f());
              tx.oncomplete && tx.oncomplete();
            });
            return tx;
          },
        };
        req.result = dbo;
        req.onsuccess();
      });
      return req;
    },
  };
  return idb;
}

/* A fresh page: load js/store.js anew against the given storage. */
async function page(ls, idb) {
  globalThis.localStorage = ls;
  if (idb) globalThis.indexedDB = idb; else delete globalThis.indexedDB;
  globalThis.WS = { data: D };
  delete require.cache[require.resolve('../js/store.js')];
  require('../js/store.js');
  const S = globalThis.WS.store;
  await S.ready();
  return S;
}
const settle = () => new Promise((r) => setTimeout(r, 5));
const bigWorld = (name, kb) => { const w = D.defaultWorld(name); w.notes = { padding: 'x'.repeat(kb * 1024) }; return w; };

test('a world bigger than localStorage still saves, and is there on the next page', async () => {
  const ls = fakeLocalStorage(50000), idb = fakeIndexedDB();
  const S = await page(ls, idb);
  assert.equal(S.backend, 'indexeddb');
  const w = bigWorld('Grak', 200);
  const seen = [];
  S.onStatus((x) => seen.push(x));
  assert.equal(S.save(w), true);
  await settle();
  assert.deepEqual(seen, [{ id: w.id, ok: true }]);
  const S2 = await page(ls, idb);
  assert.equal(S2.current().name, 'Grak');
  assert.equal(S2.load(w.id).notes.padding.length, 200 * 1024);
  assert.equal(S2.isStale(w.id), false);
});

test('worlds an older version kept in localStorage move to IndexedDB and free their space', async () => {
  const ls = fakeLocalStorage(50000), idb = fakeIndexedDB();
  const old = await page(ls, null); // the localStorage-only store
  const a = D.defaultWorld('Alpha'), b = D.defaultWorld('Beta');
  old.save(a); old.save(b);
  assert.ok(ls.getItem(`worldsmith.world.${a.id}`));
  const S = await page(ls, idb);
  assert.equal(ls.getItem(`worldsmith.world.${a.id}`), null);
  assert.equal(ls.getItem(`worldsmith.world.${b.id}`), null);
  assert.ok(idb.data.has(a.id) && idb.data.has(b.id));
  assert.deepEqual(S.index().map((x) => x.name).sort(), ['Alpha', 'Beta']);
  assert.equal(S.load(a.id).name, 'Alpha');
  S.remove(a.id);
  await settle();
  assert.equal(idb.data.has(a.id), false);
  assert.equal(S.load(a.id), null);
});

test('a lost save marks the world stale for the next page until sync has settled it', async () => {
  const ls = fakeLocalStorage(50000), idb = fakeIndexedDB();
  let S = await page(ls, idb);
  const w = D.defaultWorld('Grak');
  S.save(w); await settle();
  idb.fail = true;
  const seen = [];
  S.onStatus((x) => seen.push(x.ok));
  w.name = 'Grak, later'; S.save(w); await settle();
  assert.deepEqual(seen, [false]);
  assert.equal(S.load(w.id).name, 'Grak, later', 'this page still has the newest in memory');
  assert.equal(S.isStale(w.id), false, 'a failure in this page does not make its memory stale');
  // next page: the stored copy is the older one, and says so
  idb.fail = false;
  S = await page(ls, idb);
  assert.equal(S.load(w.id).name, 'Grak');
  assert.equal(S.isStale(w.id), true);
  S.save(S.load(w.id)); await settle(); // opening it saves it again: still stale
  S = await page(ls, idb);
  assert.equal(S.isStale(w.id), true);
  // sync takes the server's copy and settles it
  const server = D.defaultWorld('Grak, later'); server.id = w.id;
  S.save(server); S.settled(w.id); await settle();
  S = await page(ls, idb);
  assert.equal(S.isStale(w.id), false);
  assert.equal(S.load(w.id).name, 'Grak, later');
});

test('without IndexedDB worlds stay in localStorage, and a save that does not fit says so', async () => {
  const ls = fakeLocalStorage(50000);
  let S = await page(ls, null);
  assert.equal(S.backend, 'localstorage');
  const small = D.defaultWorld('Small');
  assert.equal(S.save(small), true);
  const big = bigWorld('Big', 100);
  assert.equal(S.save(big), false);
  S = await page(ls, null);
  assert.equal(S.isStale(big.id), true);
  assert.equal(S.load(small.id).name, 'Small');
});
