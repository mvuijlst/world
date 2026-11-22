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
  WS.defineStep = (def) => { WS.steps.push(def); };
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
    if (app.view && app.view.update) app.view.update(ctx);
    if (app.diagEl) replace(app.diagEl, diagnostics(app.step.checks ? app.step.checks(app.world, app.d) : []));
    updateLamps();
  }

  // ── persistence ──────────────────────────────────────────────────────
  const saveEl = () => document.getElementById('save-state');
  function markDirty() {
    const el = saveEl();
    if (el) { el.className = 'save-state dirty'; el.textContent = 'UNSAVED'; }
    clearTimeout(app.saveTimer);
    app.saveTimer = setTimeout(saveNow, 600);
  }
  function saveNow() {
    clearTimeout(app.saveTimer);
    app.saveTimer = null;
    const ok = WS.store.save(app.world);
    const el = saveEl();
    if (el) { el.className = `save-state ${ok ? 'saved' : 'dirty'}`; el.textContent = ok ? 'SAVED LOCALLY' : 'STORAGE OFF'; }
  }
  window.addEventListener('beforeunload', () => { if (app.saveTimer) saveNow(); });

  function loadWorld(w) {
    app.world = w;
    ctx.ui = {};
    compute();
    saveNow();
    renderTopbarWorld();
    renderNav();
    renderStep();
  }

  // ── theme ────────────────────────────────────────────────────────────
  function applyTheme(t) {
    if (t === 'pulp') document.documentElement.setAttribute('data-theme', 'pulp');
    else document.documentElement.removeAttribute('data-theme');
    try { localStorage.setItem('worldsmith.theme', t); } catch { /* ignore */ }
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
    const btn = h('button', { class: 'icon-btn', type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', onclick: (e) => { e.stopPropagation(); open(!pop.classList.contains('open')); } }, icon('globe'), h('span', null, 'Worlds'));
    const fileIn = h('input', { type: 'file', accept: '.json,application/json', class: 'sr-only', id: 'import-file' });
    fileIn.addEventListener('change', async () => {
      const f = fileIn.files && fileIn.files[0];
      if (!f) return;
      try { const w = await WS.store.importJson(f); loadWorld(w); toast(`Imported “${w.name}”`); }
      catch (err) { toast(`Import failed: ${err.message}`); }
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
      replace(pop,
        h('div', { class: 'nav-title', style: { margin: '4px 10px 6px' } }, 'STORED WORLDS'),
        list.map((x) => h('button', {
          type: 'button', role: 'menuitem', class: ['world-item', x.id === app.world.id && 'current'],
          onclick: () => { if (x.id !== app.world.id) { saveNow(); const w = WS.store.load(x.id); if (w) loadWorld(w); } open(false); },
        }, h('span', null, x.name), h('small', null, new Date(x.updated).toLocaleDateString()))),
        h('hr'),
        h('button', { type: 'button', role: 'menuitem', onclick: () => { saveNow(); const w = WS.data.defaultWorld(`World ${list.length + 1}`); loadWorld(w); ctx.go('briefing'); open(false); toast('New world created from the Sol/Earth template'); } }, icon('plus'), 'New world'),
        h('button', { type: 'button', role: 'menuitem', onclick: () => { saveNow(); const w = WS.store.migrate(JSON.parse(JSON.stringify(app.world))); w.id = WS.data.newId('w'); w.name = `${app.world.name} (copy)`; loadWorld(w); open(false); toast('World duplicated'); } }, icon('copy'), 'Duplicate'),
        h('button', { type: 'button', role: 'menuitem', onclick: () => { WS.store.exportJson(app.world); open(false); } }, icon('download'), 'Export JSON'),
        h('label', { class: 'mi', role: 'menuitem', for: 'import-file', tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } }, icon('upload'), 'Import JSON'),
        fileIn,
        h('hr'),
        h('button', {
          type: 'button', role: 'menuitem', onclick: () => {
            if (!confirm(`Delete “${app.world.name}” from this browser? This cannot be undone (export it first if you want a copy).`)) return;
            WS.store.remove(app.world.id);
            const next = WS.store.current() || WS.data.defaultWorld();
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
        h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } }, 'Everything is stored in this browser only. Use Worlds → Export to keep a backup.')));
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
    }
  }

  // ── step page ────────────────────────────────────────────────────────
  function renderStep() {
    const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1] || 'briefing';
    const step = stepById(id) || WS.steps[0];
    const changed = app.step !== step;
    app.step = step;
    const main = document.getElementById('stage');
    const scrollY = window.scrollY;
    if (app.view && app.view.destroy) app.view.destroy();
    app.view = step.build(ctx);
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
        step.lede ? h('div', { class: 'lede' }, step.lede.map((p) => h('p', null, p))) : null),
      app.view.el,
      step.checks || step.notes !== false ? h('div', { class: 'grid two-even', style: { marginTop: '16px' } },
        step.checks ? panel('Diagnostics', { tag: 'SELF-TEST' }, app.diagEl) : null,
        step.notes !== false ? panel('Field log', { tag: 'NOTES' }, notes) : null) : null,
      h('nav', { class: 'step-foot', 'aria-label': 'Step navigation' },
        prev ? h('a', { class: 'btn', href: `#/${prev.id}` }, icon('arrowL'), `${prev.num} ${prev.title}`) : h('span'),
        next ? h('a', { class: 'btn primary', href: `#/${next.id}` }, `${next.num} ${next.title}`, icon('arrowR')) : h('span')),
      h('p', { class: 'credit' }, 'Method after Artifexian · The WorldSmith 8.00'));
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
    window.addEventListener('hashchange', () => { renderStep(); updateLamps(); });
    const w = WS.store.current() || WS.data.defaultWorld();
    loadWorld(w);
  }

  WS.app = { ctx, boot, refresh, saveNow };
  document.addEventListener('DOMContentLoaded', boot);
})(window);
