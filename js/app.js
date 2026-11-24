/*
 * Application shell: routing, the step framework, world management,
 * autosave and theme.
 */
(function (root) {
  'use strict';
  const WS = (root.WS = root.WS || {});
  const { h, panel, diagnostics, worst, icon, toast, replace } = WS.ui;

  // ── step registry ────────────────────────────────────────────────────
  WS.steps = [];
  // steps are numbered in the order they are defined; a code's leading number follows
  WS.defineStep = (def) => {
    const n = String(WS.steps.length).padStart(2, '0');
    def.num = n;
    if (def.code) def.code = def.code.replace(/^\d{2}_/, `${n}_`);
    WS.steps.push(def);
  };
  const stepById = (id) => WS.steps.find((x) => x.id === id);

  // ── state ────────────────────────────────────────────────────────────
  const app = {
    world: null, d: null, step: null, view: null, saveTimer: null,
  };

  function compute() { app.d = WS.calc.computeAll(app.world); }

  const ctx = {
    get world() { return app.world; },
    get d() { return app.d; },
    set(path, value, opts = {}) {
      WS.ui.set(app.world, path, value);
      afterChange(opts);
    },
    mutate(fn, opts = {}) { fn(app.world); afterChange(opts); },
    rerender() { renderStep(); },
    go(id) { location.hash = `#/${id}`; },
    ui: {}, // per-step ephemeral UI state (tabs, rotation…)
  };

  function afterChange(opts) {
    if (!opts.soft) compute();
    markDirty();
    if (opts.structural) { renderStep(); return; }
    if (!opts.soft) refresh();
    if (opts.rename) renderTopbarWorld();
  }

  function refresh() {
    if (app.view && app.view.update) { try { app.view.update(ctx); } catch (err) { console.error(err); } }
    if (app.diagEl) replace(app.diagEl, diagnostics(app.step.checks ? app.step.checks(app.world, app.d) : []));
    updateLamps();
  }

  // ── persistence ──────────────────────────────────────────────────────
  const saveEl = () => document.getElementById('save-state');
  function markDirty() {
    clearTimeout(app.saveTimer);
    app.saveTimer = setTimeout(saveNow, 600);
    showSaveState();
  }
  /* touch: this save holds an edit the server should get (false when merely opening a world). */
  function saveNow(touch = true) {
    clearTimeout(app.saveTimer);
    app.saveTimer = null;
    const ok = WS.store.save(app.world);
    if (touch) { WS.sync.touched(app.world.id); schedulePush(); }
    app.storageOk = ok;
    showSaveState();
  }
  window.addEventListener('beforeunload', () => { if (app.saveTimer) saveNow(); });

  function showSaveState() {
    const el = saveEl();
    if (!el) return;
    const s = WS.sync.state;
    let cls = 'saved', txt = 'SAVED LOCALLY';
    if (app.storageOk === false) { cls = 'dirty'; txt = 'STORAGE OFF'; }
    else if (app.saveTimer) { cls = 'dirty'; txt = 'UNSAVED'; }
    else if (s.user) {
      if (s.status === 'error') { cls = 'dirty'; txt = 'SYNC ERROR'; }
      else if (s.status === 'syncing' || app.pushTimer || app.pushing) { cls = 'dirty'; txt = 'SYNCING'; }
      else { cls = 'saved'; txt = 'SYNCED'; }
    }
    el.className = `save-state ${cls}`;
    el.textContent = txt;
    el.title = s.error || (s.user ? `Stored on the server as ${s.user}` : s.available ? 'Stored in this browser. Sign in under Worlds to sync.' : 'Stored in this browser only.');
  }

  // ── server sync ──────────────────────────────────────────────────────
  function schedulePush() {
    if (!WS.sync.state.user) return;
    clearTimeout(app.pushTimer);
    app.pushTimer = setTimeout(pushNow, 1200);
    showSaveState();
  }
  async function pushNow() {
    app.pushTimer = null;
    if (!WS.sync.state.user || app.pushing) return;
    app.pushing = true;
    showSaveState();
    try {
      const out = await WS.sync.push(app.world);
      if (out.world && out.world.id !== app.world.id) {
        // deleted elsewhere: our edits live on as a new world
        app.world = out.world;
        toast('This world was deleted on another device; your copy was kept as a new world.');
      } else if (out.world) {
        loadWorld(out.world, false);
        toast(`Changed on another device. Your version is saved as “${out.conflictCopy.name}”.`);
      }
      if (out.world) setTimeout(runSync, 0); // send the kept copy too
      WS.sync.setStatus('synced');
    } catch (err) {
      WS.sync.setStatus('error', err.message);
    } finally {
      app.pushing = false;
      showSaveState();
    }
  }

  let lastSync = 0;
  async function runSync() {
    if (!WS.sync.state.user) return;
    if (app.saveTimer) saveNow();
    lastSync = Date.now();
    const currentId = app.world.id;
    const pristine = WS.sync.isPristine(currentId);
    const { replaced, removed } = await WS.sync.syncAll();
    if (pristine && WS.store.index().length > 1) {
      // a fresh template on a new device: open the newest synced world instead
      WS.store.remove(currentId);
      const next = WS.store.load(WS.store.index()[0].id);
      if (next) { loadWorld(next, false); return; }
    }
    if (removed.includes(currentId)) {
      loadWorld(WS.store.current() || freshWorld(), false);
      toast('This world was deleted on another device.');
    } else if (replaced.includes(currentId)) {
      const w = WS.store.load(currentId);
      if (w) loadWorld(w, false);
    }
    showSaveState();
  }
  const resync = () => { if (document.visibilityState === 'visible' && Date.now() - lastSync > 30000) runSync(); };
  document.addEventListener('visibilitychange', resync);
  window.addEventListener('focus', resync);

  function freshWorld() {
    const w = WS.data.defaultWorld();
    WS.store.save(w);
    WS.sync.markPristine(w.id);
    return w;
  }

  function signInDialog() {
    const err = h('p', { class: 't-red', role: 'alert', style: { minHeight: '1.4em', fontSize: '14px' } });
    const user = h('input', { class: 'txt', name: 'username', autocomplete: 'username', required: true, 'aria-label': 'Username' });
    const pass = h('input', { class: 'txt', type: 'password', name: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'Password' });
    const dlg = h('dialog', { class: 'dialog', 'aria-labelledby': 'signin-title' });
    const form = h('form', { method: 'dialog', class: 'stack-gap' },
      h('header', { class: 'panel-head' }, h('span', { id: 'signin-title' }, 'Sign in to sync'), h('span', { class: 'tag' }, 'SERVER')),
      h('div', { class: 'panel-body stack-gap', style: { gap: '12px' } },
        h('p', { class: 'muted', style: { fontSize: '14px' } }, 'Your worlds are kept in this browser and copied to the server, so they follow you to other devices.'),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Username'), user),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Password'), pass),
        err,
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', type: 'submit' }, 'Sign in'),
          h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel'))));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = '';
      try {
        await WS.sync.signIn(user.value.trim(), pass.value);
        dlg.close();
        toast(`Signed in as ${WS.sync.state.user}`);
        await runSync();
      } catch (ex) { err.textContent = ex.message; }
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.appendChild(form);
    document.body.appendChild(dlg);
    dlg.showModal();
    user.focus();
  }

  function loadWorld(w, touch = false) {
    app.world = w;
    ctx.ui = {};
    compute();
    saveNow(touch);
    renderTopbarWorld();
    renderNav();
    renderStep();
  }

  // ── theme ────────────────────────────────────────────────────────────
  function applyTheme(t) {
    if (t === 'pulp') document.documentElement.setAttribute('data-theme', 'pulp');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('worldsmith.theme', t); } catch { /* ignore */ }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === 'pulp' ? '#efdfb8' : '#0b0806';
  }
  function currentTheme() { return document.documentElement.getAttribute('data-theme') === 'pulp' ? 'pulp' : 'crt'; }

  // ── top bar ──────────────────────────────────────────────────────────
  function brandMark() {
    return WS.ui.s('svg', { viewBox: '0 0 54 34', fill: 'none', 'aria-hidden': 'true' },
      WS.ui.s('path', { d: 'M2 31 L14 13 L20 21 L30 4 L40 19 L45 13 L52 31 Z', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round' }),
      WS.ui.s('path', { d: 'M8 31 L14 22 M24 31 L30 14 L36 31 M44 31 L45 24', stroke: 'currentColor', 'stroke-width': 1.2 }));
  }

  function renderTopbar() {
    const bar = document.getElementById('topbar');
    const menuBtn = h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Open navigation', onclick: () => toggleNav() }, icon('menu'));
    const themeBtn = h('button', {
      class: 'icon-btn theme-toggle', type: 'button', 'aria-label': 'Switch display theme',
      title: 'Switch between CRT phosphor and pulp-print display',
      onclick: () => { applyTheme(currentTheme() === 'crt' ? 'pulp' : 'crt'); renderStep(); },
    }, h('span', { class: 'lbl-crt' }, 'CRT'), h('span', { class: 'sep' }, '/'), h('span', { class: 'lbl-pulp' }, 'PULP'));
    replace(bar,
      menuBtn,
      h('a', { class: 'brand', href: '#/briefing', 'aria-label': 'WorldSmith home' }, brandMark(),
        h('span', { class: 'brand-name' }, 'WORLDSMITH', h('small', null, 'PLANETARY DESIGN CONSOLE'))),
      h('div', { class: 'spacer' }),
      h('div', { class: 'world-switch', id: 'world-switch' }),
      h('span', { class: 'save-state saved', id: 'save-state' }, 'SAVED LOCALLY'),
      worldsMenu(),
      themeBtn);
  }

  function renderTopbarWorld() {
    const host = document.getElementById('world-switch');
    if (!host) return;
    const input = h('input', { class: 'world-name', value: app.world.name, 'aria-label': 'World name', maxlength: 40 });
    input.addEventListener('input', () => { app.world.name = input.value || 'Untitled world'; markDirty(); });
    replace(host, h('span', { class: 'muted', style: { fontSize: '11px', letterSpacing: '.2em' } }, 'WORLD'), input);
  }

  function worldsMenu() {
    const pop = h('div', { class: 'menu-pop', role: 'menu' });
    const btn = h('button', { class: 'icon-btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: (e) => { e.stopPropagation(); open(!pop.classList.contains('open')); } }, icon('globe'), h('span', { class: 'worlds-label' }, 'Worlds'));
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', multiple: true, class: 'sr-only', id: 'import-file' });
    fileIn.addEventListener('change', async () => {
      const files = [...(fileIn.files || [])];
      if (!files.length) return;
      // several at once: each is saved (and synced); the last one opens
      const done = [], failed = [];
      for (const f of files) {
        try { const w = await WS.store.importJson(f); if (files.length > 1) { w.updated = new Date().toISOString(); WS.store.save(w); WS.sync.touched(w.id); } done.push(w); }
        catch (err) { failed.push(`${f.name}: ${err.message}`); }
      }
      if (done.length) loadWorld(done[done.length - 1], true);
      if (files.length > 1) runSync();
      toast(failed.length ? `Imported ${done.length}; failed: ${failed.join('; ')}` : done.length === 1 ? `Imported “${done[0].name}”` : `Imported ${done.length} worlds: ${done.map((w) => w.name).join(', ')}`);
      fileIn.value = '';
      open(false);
    });
    function open(on) {
      pop.classList.toggle('open', on);
      btn.setAttribute('aria-expanded', String(on));
      if (on) fill();
    }
    function fill() {
      const list = WS.store.index();
      const st = WS.sync.state;
      const account = !st.available ? null : st.user
        ? [h('div', { class: 'nav-title', style: { margin: '4px 10px 6px' } }, `SIGNED IN · ${st.user.toUpperCase()}`),
          h('button', { type: 'button', role: 'menuitem', onclick: () => { open(false); runSync().then(() => toast(WS.sync.state.status === 'error' ? `Sync failed: ${WS.sync.state.error}` : 'Synced with the server')); } }, icon('reset'), 'Sync now'),
          h('button', { type: 'button', role: 'menuitem', onclick: async () => { open(false); if (app.saveTimer) saveNow(); if (app.pushTimer) await pushNow(); await WS.sync.signOut(); showSaveState(); toast('Signed out. Your worlds stay in this browser.'); } }, icon('x'), 'Sign out'),
          h('hr')]
        : [h('button', { type: 'button', role: 'menuitem', onclick: () => { open(false); signInDialog(); } }, icon('link'), 'Sign in to sync'), h('hr')];
      replace(pop,
        account,
        h('div', { class: 'nav-title', style: { margin: '4px 10px 6px' } }, 'STORED WORLDS'),
        list.map((x) => h('button', {
          type: 'button', role: 'menuitem', class: ['world-item', x.id === app.world.id && 'current'],
          onclick: () => { if (x.id !== app.world.id) { if (app.saveTimer) saveNow(); const w = WS.store.load(x.id); if (w) loadWorld(w); } open(false); },
        }, h('span', null, x.name), h('small', null, new Date(x.updated).toLocaleDateString()))),
        h('hr'),
        h('button', { type: 'button', role: 'menuitem', onclick: () => { if (app.saveTimer) saveNow(); const w = WS.data.defaultWorld(`World ${list.length + 1}`); loadWorld(w, true); ctx.go('briefing'); open(false); toast('New world created from the Sol/Earth template'); } }, icon('plus'), 'New world'),
        h('button', { type: 'button', role: 'menuitem', onclick: () => { if (app.saveTimer) saveNow(); const w = WS.store.migrate(JSON.parse(JSON.stringify(app.world))); w.id = WS.data.newId('w'); w.name = `${app.world.name} (copy)`; loadWorld(w, true); open(false); toast('World duplicated'); } }, icon('copy'), 'Duplicate'),
        h('button', { type: 'button', role: 'menuitem', onclick: () => { WS.store.exportJson(app.world); open(false); } }, icon('download'), 'Export JSON'),
        h('label', { class: 'mi', role: 'menuitem', for: 'import-file', tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } }, icon('upload'), 'Import JSON'),
        fileIn,
        h('hr'),
        h('button', {
          type: 'button', role: 'menuitem', onclick: async () => {
            const synced = WS.sync.state.user;
            open(false);
            if (!await WS.ui.ask(`Delete “${app.world.name}”${synced ? ' from this browser and the server' : ' from this browser'}? This cannot be undone: export it first if you want a copy.`, { title: 'Delete this world', ok: 'Delete', danger: true })) return;
            const gone = app.world.id;
            WS.store.remove(gone);
            WS.sync.remove(gone);
            const next = WS.store.current() || freshWorld();
            loadWorld(next); open(false); toast('World deleted');
          },
        }, icon('x'), 'Delete this world'));
    }
    document.addEventListener('click', (e) => { if (!pop.contains(e.target) && e.target !== btn) open(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') open(false); });
    return h('div', { class: 'menu' }, btn, pop);
  }

  // ── sidebar ──────────────────────────────────────────────────────────
  function toggleNav(force) {
    const sb = document.getElementById('sidebar');
    const sc = document.getElementById('scrim');
    const on = force === undefined ? !sb.classList.contains('open') : force;
    sb.classList.toggle('open', on);
    sc.classList.toggle('show', on);
  }

  function renderNav() {
    const sb = document.getElementById('sidebar');
    replace(sb,
      h('div', { class: 'nav-title' }, 'BUILD SEQUENCE'),
      h('ol', { class: 'steps' }, WS.steps.map((st) => h('li', null,
        h('a', { class: 'step-link', href: `#/${st.id}`, id: `nav-${st.id}`, onclick: () => toggleNav(false) },
          h('span', { class: 'num' }, st.num), h('span', null, st.title), h('span', { class: 'lamp info', id: `lamp-${st.id}`, 'aria-hidden': 'true' }))))),
      h('div', { class: 'sidebar-foot' },
        h('div', { class: 'legend' },
          h('span', null, h('i', { class: 'lamp ok' }), 'Within Earth-like limits'),
          h('span', null, h('i', { class: 'lamp warn' }), 'Possible, but check'),
          h('span', null, h('i', { class: 'lamp fail' }), 'Breaks the method')),
        h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } }, 'Worlds are kept in this browser. Sign in under Worlds to sync them with the server; Export saves a file backup.')));
    updateLamps();
  }

  function updateLamps() {
    for (const st of WS.steps) {
      const el = document.getElementById(`lamp-${st.id}`);
      if (!el) continue;
      const list = st.checks ? st.checks(app.world, app.d) : [];
      const lvl = list.length ? worst(list) : 'info';
      el.className = `lamp ${lvl}`;
      el.title = { ok: 'All nominal', warn: 'Cautions', fail: 'Faults', info: '' }[lvl];
      const link = document.getElementById(`nav-${st.id}`);
      if (link) link.setAttribute('aria-current', app.step && app.step.id === st.id ? 'page' : 'false');
      const sbLamp = document.getElementById('stepbar-lamp');
      if (sbLamp && app.step && app.step.id === st.id) sbLamp.className = `lamp ${lvl}`;
    }
  }

  // ── step page ────────────────────────────────────────────────────────
  function lede(paras) {
    const el = h('div', { class: 'lede' }, paras.map((p) => h('p', null, p)));
    if (paras.length > 1) {
      const more = h('button', { type: 'button', class: 'lede-toggle', 'aria-expanded': 'false' }, 'More about this step');
      more.addEventListener('click', () => {
        const open = el.classList.toggle('open');
        more.setAttribute('aria-expanded', String(open));
        more.textContent = open ? 'Less' : 'More about this step';
      });
      el.appendChild(more);
    }
    return el;
  }

  /* Phones: a thumb-reach bar with previous / current (opens the sequence) / next. */
  function renderStepbar(step, prev, next) {
    const bar = document.getElementById('stepbar');
    if (!bar) return;
    const idx = WS.steps.indexOf(step);
    const lampEl = h('span', { class: 'lamp info', id: 'stepbar-lamp', 'aria-hidden': 'true' });
    replace(bar,
      prev ? h('a', { class: 'sb-btn', href: `#/${prev.id}`, 'aria-label': `Previous: ${prev.title}` }, icon('arrowL')) : h('span', { class: 'sb-btn', 'aria-hidden': 'true' }),
      h('button', { type: 'button', class: 'sb-mid', 'aria-label': 'Open the build sequence', onclick: () => toggleNav(true) },
        h('span', { class: 'sb-num' }, `${step.num}`, h('small', null, ` / ${String(WS.steps.length - 1).padStart(2, '0')}`)),
        h('span', { class: 'sb-title' }, step.title), lampEl),
      next ? h('a', { class: 'sb-btn primary', href: `#/${next.id}`, 'aria-label': `Next: ${next.title}` }, icon('arrowR')) : h('span', { class: 'sb-btn', 'aria-hidden': 'true' }));
    bar.style.setProperty('--progress', `${(idx / (WS.steps.length - 1)) * 100}%`);
  }

  function renderStep() {
    const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || 'briefing';
    // (steps that were merged into others: their old links still work)
    const step = stepById({ region: 'atlas', closeup: 'atlas' }[id] || id) || WS.steps[0];
    const changed = app.step !== step;
    app.step = step;
    const main = document.getElementById('stage');
    const scrollY = window.scrollY;
    if (app.view && app.view.destroy) app.view.destroy();
    try { app.view = step.build(ctx); }
    catch (err) {
      console.error(err);
      app.view = { el: panel('Fault', { tag: 'ERROR' }, h('p', null, `This step could not be drawn: ${err.message}`)), update() {} };
    }
    const idx = WS.steps.indexOf(step);
    const prev = WS.steps[idx - 1], next = WS.steps[idx + 1];
    app.diagEl = h('div');
    const notes = h('textarea', { class: 'notes', placeholder: `Field notes for ${step.title.toLowerCase()}: names, lore, decisions, open questions…`, 'aria-label': `${step.title} notes` });
    notes.value = (app.world.notes && app.world.notes[step.id]) || '';
    notes.addEventListener('input', () => { app.world.notes = app.world.notes || {}; app.world.notes[step.id] = notes.value; markDirty(); });

    replace(main,
      h('header', { class: 'step-head' },
        h('div', { class: 'param-strip' }, h('span', { class: 'k' }, 'Editing current parameter:'), h('span', { class: 'v' }, step.strip || step.title)),
        h('div', { class: 'step-title' }, h('h1', null, step.title), h('span', { class: 'code' }, step.code)),
        step.lede ? lede(step.lede) : null),
      app.view.el,
      step.checks || step.notes !== false ? h('div', { class: 'grid two-even', style: { marginTop: '16px' } },
        step.checks ? panel('Diagnostics', { tag: 'SELF-TEST' }, app.diagEl) : null,
        step.notes !== false ? panel('Field log', { tag: 'NOTES' }, notes) : null) : null,
      h('nav', { class: 'step-foot', 'aria-label': 'Step navigation' },
        prev ? h('a', { class: 'btn', href: `#/${prev.id}` }, icon('arrowL'), `${prev.num} ${prev.title}`) : h('span'),
        next ? h('a', { class: 'btn primary', href: `#/${next.id}` }, `${next.num} ${next.title}`, icon('arrowR')) : h('span')),
      h('p', { class: 'credit' }, 'Method after Artifexian · The WorldSmith 8.00'));
    renderStepbar(step, prev, next);
    refresh();
    document.title = `${step.title} · ${app.world.name} · WorldSmith`;
    if (changed) { window.scrollTo(0, 0); main.style.animation = 'none'; void main.offsetWidth; main.style.animation = ''; }
    else window.scrollTo(0, scrollY);
  }

  // ── boot ─────────────────────────────────────────────────────────────
  function boot() {
    let theme = 'crt';
    try { theme = localStorage.getItem('worldsmith.theme') || 'crt'; } catch { /* ignore */ }
    applyTheme(theme);
    renderTopbar();
    document.getElementById('scrim').addEventListener('click', () => toggleNav(false));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleNav(false); });
    window.addEventListener('hashchange', () => { renderStep(); updateLamps(); });
    WS.sync.onChange(showSaveState);
    loadWorld(WS.store.current() || freshWorld());
    WS.sync.init().then((st) => { showSaveState(); if (st.user) runSync(); });
  }

  WS.app = { ctx, boot, refresh, saveNow, runSync, get world() { return app.world; } };
  document.addEventListener('DOMContentLoaded', boot);
})(window);
