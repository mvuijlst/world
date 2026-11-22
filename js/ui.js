/*
 * Small DOM toolkit: element builders, number formatting, and the
 * reusable console components (fields, readouts, panels, gauges…).
 */
(function (root) {
  'use strict';
  const WS = (root.WS = root.WS || {});

  // ── element builders ─────────────────────────────────────────────────
  function applyAttrs(el, attrs, isSvg) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'html') el.innerHTML = v;
      else if (!isSvg && (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled')) el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  function append(el, kids) {
    for (const c of kids.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return el;
  }
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    if (attrs) applyAttrs(el, attrs, false);
    return append(el, kids);
  }
  const SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(SVGNS, tag);
    if (attrs) applyAttrs(el, attrs, true);
    return append(el, kids);
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
  function replace(el, ...kids) { clear(el); return append(el, kids); }

  // ── formatting ───────────────────────────────────────────────────────
  // browser locale, so readouts use the same decimal mark as the number inputs
  const nf = (d) => new Intl.NumberFormat(undefined, { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const cache = {};
  function num(x, d = 2) {
    if (x === null || x === undefined || Number.isNaN(x)) return '—';
    if (!Number.isFinite(x)) return '∞';
    const a = Math.abs(x);
    if (a !== 0 && (a >= 1e12 || a < 10 ** -d)) return sci(x, 3);
    return (cache[d] = cache[d] || nf(d)).format(x);
  }
  function sci(x, d = 3) {
    if (!Number.isFinite(x)) return '—';
    const [m, e] = x.toExponential(d).split('e');
    const sup = e.replace('+', '').replace(/[-0-9]/g, (c) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)]);
    return `${num(Number(m), d)}×10${sup}`;
  }
  function int(x) { return num(Math.round(x), 0); }
  function big(x) { // people counts
    if (!Number.isFinite(x)) return '—';
    const a = Math.abs(x);
    if (a >= 1e9) return `${num(x / 1e9, 2)} bn`;
    if (a >= 1e6) return `${num(x / 1e6, 2)} M`;
    return int(x);
  }
  const fmt = { num, sci, int, big };

  // ── tooltip ──────────────────────────────────────────────────────────
  let tipEl = null, tipFor = null;
  function showTip(target) {
    if (!tipEl) { tipEl = h('div', { class: 'tooltip', role: 'tooltip', id: 'ws-tip' }); document.body.appendChild(tipEl); }
    tipEl.textContent = target.dataset.tip;
    tipFor = target;
    tipEl.classList.add('show');
    const r = target.getBoundingClientRect();
    const tw = tipEl.offsetWidth, th = tipEl.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(12, Math.min(window.innerWidth - tw - 12, x));
    let y = r.bottom + 8;
    if (y + th > window.innerHeight - 8) y = r.top - th - 8;
    tipEl.style.left = `${x}px`; tipEl.style.top = `${Math.max(8, y)}px`;
    target.setAttribute('aria-describedby', 'ws-tip');
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('show'); if (tipFor) tipFor.removeAttribute('aria-describedby'); tipFor = null; }
  // A tap fires pointerdown → (mouseover) → focus → click in quick succession; only the
  // click should decide, so hover is for mice and a tap toggles.
  let lastPointer = 'mouse';
  const tipTarget = (e) => e.target.closest && e.target.closest('[data-tip]');
  document.addEventListener('pointerdown', (e) => {
    lastPointer = e.pointerType || 'mouse';
    if (lastPointer !== 'mouse' && tipFor && !tipTarget(e)) hideTip(); // tap elsewhere closes
  }, true);
  document.addEventListener('mouseover', (e) => { const t = tipTarget(e); if (t && lastPointer === 'mouse') showTip(t); });
  document.addEventListener('mouseout', (e) => { const t = tipTarget(e); if (t && lastPointer === 'mouse') hideTip(); });
  document.addEventListener('focusin', (e) => { const t = tipTarget(e); if (t && lastPointer === 'mouse' && e.target.matches(':focus-visible')) showTip(t); });
  document.addEventListener('focusout', () => { if (lastPointer === 'mouse') hideTip(); });
  document.addEventListener('click', (e) => {
    const t = e.target.closest && e.target.closest('.info-btn[data-tip]');
    if (!t) return;
    e.preventDefault();
    if (lastPointer === 'mouse') { showTip(t); return; } // hover already handles mice
    if (tipFor === t) hideTip(); else showTip(t);
  });
  window.addEventListener('scroll', () => { if (lastPointer === 'mouse') hideTip(); }, { passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); });

  /*
   * On narrow screens `table.data.row-cards` lays each row out as a card; every cell shows its
   * column heading from data-label. Call after the table is built.
   */
  function cardify(table) {
    const heads = [...table.querySelectorAll('thead th')].map((th) => {
      const c = th.cloneNode(true);
      c.querySelectorAll('.info-btn').forEach((b) => b.remove());
      return c.textContent.trim();
    });
    table.classList.add('row-cards');
    table.querySelectorAll('tbody tr').forEach((tr) => {
      [...tr.children].forEach((td, i) => { if (!td.hasAttribute('data-label')) td.setAttribute('data-label', heads[i] || ''); });
    });
    return table;
  }

  /* A section that starts open on wide screens and folded on phones. */
  const wide = () => window.matchMedia('(min-width: 700px)').matches;
  function fold(summary, ...body) {
    return h('details', { class: 'fold', open: wide() }, h('summary', null, summary), body);
  }

  function info(text) {
    if (!text) return null;
    return h('button', { type: 'button', class: 'info-btn', 'data-tip': text, 'aria-label': 'More information' }, 'i');
  }

  // ── paths into the world object ──────────────────────────────────────
  function get(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
  function set(obj, path, value) {
    const keys = path.split('.');
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
    o[keys[keys.length - 1]] = value;
  }

  // ── components ───────────────────────────────────────────────────────
  function panel(title, opts = {}, ...body) {
    return h('section', { class: ['panel', opts.ticks && 'ticks', opts.class] },
      h('header', { class: 'panel-head' },
        h('span', null, title),
        opts.tag ? h('span', { class: 'tag' }, opts.tag) : h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))),
      h('div', { class: ['panel-body', opts.flush && 'flush'] }, body));
  }

  /*
   * Numeric input bound to a world path.
   * f = { path, label, unit, min, max, step, slider:[lo,hi], help, sub(ctx) }
   */
  function field(ctx, f) {
    const value = get(ctx.world, f.path);
    const input = h('input', {
      type: 'number', inputmode: 'decimal', value: value ?? '', step: f.step ?? 'any',
      min: f.min, max: f.max, id: `f-${f.path.replace(/\./g, '-')}`,
      'aria-label': f.label,
    });
    let slider = null;
    if (f.slider) {
      slider = h('input', {
        type: 'range', min: f.slider[0], max: f.slider[1], step: f.sliderStep ?? f.step ?? 'any',
        value: value ?? f.slider[0], 'aria-label': `${f.label} slider`, tabindex: -1,
      });
    }
    const sub = h('div', { class: 'field-sub' });
    const commit = (raw, from) => {
      if (raw === '' || raw === '-') { input.classList.add('bad'); return; }
      let v = Number(raw);
      if (!Number.isFinite(v)) { input.classList.add('bad'); return; }
      const out = (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max);
      input.classList.toggle('bad', out);
      if (out && f.hard) return;
      if (from === 'slider') input.value = v;
      if (slider && from !== 'slider') slider.value = v;
      ctx.set(f.path, v);
    };
    input.addEventListener('input', () => commit(input.value, 'input'));
    if (slider) slider.addEventListener('input', () => commit(slider.value, 'slider'));
    const el = h('div', { class: ['field', f.class] },
      h('label', { class: 'field-label', for: input.id }, f.label, info(f.help)),
      h('div', { class: 'field-row' }, input, f.unit ? h('span', { class: 'unit' }, f.unit) : null),
      slider, f.sub ? sub : null);
    el._update = (c) => {
      if (f.sub) sub.textContent = f.sub(c);
      if (document.activeElement !== input) {
        const v = get(c.world, f.path);
        if (Number(input.value) !== v) input.value = v;
        if (slider && Number(slider.value) !== v) slider.value = v;
      }
    };
    return el;
  }

  function textField(ctx, f) {
    const input = h('input', { type: 'text', value: get(ctx.world, f.path) ?? '', id: `f-${f.path.replace(/\./g, '-')}`, maxlength: 60 });
    input.addEventListener('input', () => ctx.set(f.path, input.value, { soft: true }));
    return h('div', { class: ['field', f.class] },
      h('label', { class: 'field-label', for: input.id }, f.label, info(f.help)), input);
  }

  function selectField(ctx, f) {
    const cur = get(ctx.world, f.path);
    const sel = h('select', { id: `f-${f.path.replace(/\./g, '-')}` },
      f.options.map((o) => {
        const [v, t] = Array.isArray(o) ? o : [o, o];
        return h('option', { value: v, selected: String(v) === String(cur) }, t);
      }));
    sel.addEventListener('change', () => ctx.set(f.path, f.numeric ? Number(sel.value) : sel.value, { structural: f.structural }));
    return h('div', { class: ['field', f.class] },
      h('label', { class: 'field-label', for: sel.id }, f.label, info(f.help)), sel);
  }

  /* A read-only echo of a value that lives on another step. */
  function linked(label, value, unit, stepId, help) {
    return h('div', { class: 'field locked' },
      h('label', { class: 'field-label' }, label, info(help),
        h('a', { class: 'link-chip', href: `#/${stepId}`, title: `Edit on the ${stepId} page` }, '↗ ' + stepId)),
      h('div', { class: 'field-row' }, h('input', { type: 'text', value, readonly: true, tabindex: -1, 'aria-label': label }),
        unit ? h('span', { class: 'unit' }, unit) : null));
  }

  /* Readouts: [{ label, value(c)->string, unit, sub(c), state(c)->'ok'|'warn'|'fail', help, wide }] */
  function readouts(defs) {
    const cells = defs.map((d) => {
      const val = h('div', { class: 'val' });
      const sub = h('div', { class: 'sub' });
      const cell = h('div', { class: ['readout', d.wide && 'wide'] },
        h('div', { class: 'lbl' }, d.label, info(d.help)), val, d.sub ? sub : null);
      cell._update = (c) => {
        const v = d.value(c);
        replace(val, v, d.unit ? h('small', null, typeof d.unit === 'function' ? d.unit(c) : d.unit) : null);
        if (d.sub) sub.textContent = d.sub(c);
        cell.classList.remove('ok', 'warn', 'fail');
        const st = d.state && d.state(c);
        if (st) cell.classList.add(st);
      };
      return cell;
    });
    const el = h('div', { class: 'readouts' }, cells);
    el._update = (c) => cells.forEach((x) => x._update(c));
    return el;
  }

  const FLAG = { ok: 'NOMINAL', warn: 'CAUTION', fail: 'FAULT', info: 'NOTE' };
  function diagnostics(list) {
    if (!list.length) return h('p', { class: 'muted' }, 'No diagnostics for this module.');
    return h('ul', { class: 'diag' }, list.map((d) => h('li', { class: d.level }, h('span', { class: 'flag' }, FLAG[d.level]), h('span', null, d.text))));
  }
  function worst(list) {
    const order = { fail: 3, warn: 2, ok: 1, info: 0 };
    let w = null;
    for (const d of list) if (!w || order[d.level] > order[w]) w = d.level;
    return w || 'info';
  }

  /* gauge(name, value, [lo, hi] safe band, [min, max] scale, display) */
  function gauge(name, value, band, scale, display) {
    const [mn, mx] = scale;
    const pos = (x) => `${Math.max(0, Math.min(100, ((x - mn) / (mx - mn)) * 100))}%`;
    const ok = value >= band[0] && value <= band[1];
    return h('div', { class: ['gauge', !ok && 'fail'] },
      h('div', { class: 'gauge-top' }, h('span', { class: 'name' }, name), h('span', { class: 'v' }, display ?? num(value, 3))),
      h('div', { class: 'gauge-track' },
        h('div', { class: 'gauge-band', style: { left: pos(band[0]), width: `calc(${pos(band[1])} - ${pos(band[0])})` } }),
        h('div', { class: 'gauge-mark', style: { left: pos(value) } })),
      h('div', { class: 'gauge-scale' }, h('span', null, num(mn, 2)), h('span', null, num(mx, 2))));
  }

  function leds(fraction, n = 20, tone = '') {
    const on = Math.round(Math.max(0, Math.min(1, fraction)) * n);
    return h('div', { class: ['leds', tone], role: 'meter', 'aria-valuenow': Math.round(fraction * 100), 'aria-valuemin': 0, 'aria-valuemax': 100 },
      Array.from({ length: n }, (_, i) => h('i', { class: i < on ? 'on' : '' })));
  }

  function tabs(items, current, onPick) {
    return h('div', { class: 'tabs', role: 'tablist' }, items.map(([k, label]) =>
      h('button', { type: 'button', class: 'tab', role: 'tab', 'aria-selected': String(k === current), onclick: () => onPick(k) }, label)));
  }

  let toastTimer = null;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) { t = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' }); document.body.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  /*
   * A question in the console's own dialog (never the browser's bare confirm): resolves true when
   * the action button is pressed, false on Cancel, Escape or a click outside.
   * opts: {title, ok (button text), danger (a destructive action), tag}
   */
  function ask(message, opts = {}) {
    return new Promise((resolve) => {
      let answer = false;
      const dlg = h('dialog', { class: 'dialog ask', 'aria-labelledby': 'ask-title', 'aria-describedby': 'ask-text' });
      const okBtn = h('button', { class: ['btn', opts.danger ? 'danger' : 'primary'], type: 'button', onclick: () => { answer = true; dlg.close(); } }, opts.ok || 'OK');
      const cancel = h('button', { class: 'btn', type: 'button', onclick: () => dlg.close() }, 'Cancel');
      dlg.appendChild(h('div', { class: 'stack-gap', style: { gap: 0 } },
        h('header', { class: 'panel-head' }, h('span', { id: 'ask-title' }, opts.title || 'Confirm'), h('span', { class: 'tag' }, opts.tag || (opts.danger ? 'CAUTION' : 'CONFIRM'))),
        h('div', { class: 'panel-body stack-gap', style: { gap: '14px' } },
          h('p', { id: 'ask-text', style: { fontSize: '15px' } }, message),
          h('div', { class: 'btn-row' }, okBtn, cancel))));
      dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });     // the backdrop
      dlg.addEventListener('close', () => { dlg.remove(); resolve(answer); });
      document.body.appendChild(dlg);
      dlg.showModal();
      (opts.danger ? cancel : okBtn).focus();
    });
  }

  /* Glyphs, drawn in the same thin-vector style as the console. */
  const ICONS = {
    menu: 'M3 6h18M3 12h18M3 18h18',
    globe: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18',
    save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7',
    upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
    download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
    plus: 'M12 5v14M5 12h14',
    x: 'M6 6l12 12M18 6L6 18',
    dice: 'M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01M12 12h.01',
    print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M6 14h12v7H6z',
    copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
    reset: 'M4 4v6h6M20 12a8 8 0 1 1-2.3-5.7L20 9',
    arrowL: 'M15 6l-6 6 6 6', arrowR: 'M9 6l6 6-6 6',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  };
  function icon(name) {
    return s('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' },
      s('path', { d: ICONS[name] || '' }));
  }

  WS.ui = {
    h, s, clear, replace, fmt, info, get, set, panel, field, textField, selectField, linked,
    readouts, diagnostics, worst, gauge, leds, tabs, toast, ask, icon, cardify, fold,
  };
})(typeof window !== 'undefined' ? window : globalThis);
