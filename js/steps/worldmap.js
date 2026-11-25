/*
 * World map: the present-day surface built from the Plates step's history (Worldbuilder's Log
 * 20-26: plate boundaries, islands, continents and shelves, land and sea topography), scaled to the
 * planet (gravity, radius, ridge depth), on a map or a globe, with a brush to raise and lower it.
 */
(function () {
  'use strict';
  const { h, panel, fmt, replace, info, toast, tabs } = WS.ui;
  const S = WS.sphere, M = WS.worldmap;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  // the atlas colours, drawn by the map viewer (js/globe.js): depth below sea level, height above it
  const { SEA, LAND } = WS.globe;
  const BOUND = { 1: [230, 60, 60], 2: [255, 200, 60], 3: [220, 220, 220] };   // convergent, divergent, transform

  // the map of a world, kept while nothing it depends on changes
  let cached = null, rules = null;
  const keyOf = (w, d) => JSON.stringify([w.plates, w.map.land ?? w.population.land, w.map.shelf, w.map.relief, w.map.res, w.map.erosion, w.map.carve, w.planet.pressure >= WET, d.planet.gravity, d.planet.radiusKm, d.planet.cells.count, w.tectonics.scaling, w.tectonics.ridgeDepth,
    // (the rivers carve with the climate's water: what the climate depends on)
    w.map.carve !== false ? [WS.climate.planetOf(w, d), WS.biomes.planetOf(w, d), +tidesOf(w, d).toFixed(3), w.map.iceAge ?? 6] : null]);
  /*
   * The map of a world, shared with the Climate and Rivers steps. With {peek: true}, only one already
   * built (or null): what the lamps and checks use, so that they never start a build. Without, it is
   * built here and now if need be, on the page's thread (a fallback: the steps wait for mapReady).
   */
  WS.currentMap = (w, d, opts = {}) => {
    if (!w.plates.features.some((f) => f.kind === 'crust')) return null;
    const key = keyOf(w, d);
    if (cached && cached.key === key && cached.strokes === w.map.strokes.length) return cached;
    if (opts.peek) return null;
    const map = buildMap(w, d);
    cached = { key, map, strokes: w.map.strokes.length };
    return cached;
  };
  /*
   * The map of a world when it is ready (a promise of what currentMap gives): built in a worker, so the
   * page stays responsive meanwhile, or (where workers cannot run) in the page after a moment. A build
   * already under way for the same world and settings is shared; a newer one replaces it.
   */
  let worker = null, building = null, nextId = 1;
  const pending = new Map();
  try {
    if (location.protocol !== 'file:' && typeof Worker !== 'undefined') {
      worker = new Worker('js/mapworker.js');
      worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.map); } };
      worker.onerror = () => { worker = null; for (const p of pending.values()) p.reject(new Error('worker failed')); pending.clear(); };
    }
  } catch { worker = null; }
  WS.mapReady = (w, d) => {
    if (!w.plates.features.some((f) => f.kind === 'crust')) return Promise.resolve(null);
    const key = keyOf(w, d), strokes = w.map.strokes.length;
    if (cached && cached.key === key && cached.strokes === strokes) return Promise.resolve(cached);
    if (building && building.key === key && building.strokes === strokes) return building.promise;
    const inPage = () => new Promise((resolve) => setTimeout(() => resolve(buildMap(w, d)), 30));
    const viaWorker = () => new Promise((resolve, reject) => {
      const id = nextId++, s = settingsOf(w, d);
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, plates: w.plates, settings: s, strokes: w.map.strokes, carve: s.carve, iceAge: w.map.iceAge ?? 6, climPlanet: WS.climate.planetOf(w, d), bioPlanet: WS.biomes.planetOf(w, d) });
    }).catch(() => buildMap(w, d));                                // (a worker that fails: build in the page)
    const me = { key, strokes };
    me.promise = (worker ? viaWorker() : inPage()).then((map) => {
      if (building === me) building = null;
      // a newer build may have finished first: keep whichever matches the world as it is now
      if (!(cached && cached.key === key && cached.strokes === strokes)) cached = { key, map, strokes };
      return cached.key === key ? cached : { key, map, strokes };
    });
    building = me;
    return me.promise;
  };
  /*
   * Build the map: the land from the plates' history, then (unless switched off) its climate, and the
   * rivers carve it with the water that climate gives; the brush strokes go on last. The climate is
   * kept with the map for the Climate step (the carving barely changes it: it works on smoothed heights).
   */
  function buildMap(w, d) {
    const s = settingsOf(w, d);
    if (!s.carve) {
      const plain = M.build(w.plates, { ...s, carve: false, strokes: w.map.strokes }), pl = WS.climate.planetOf(w, d);
      plain.climate = { clim: WS.climate.build(plain, pl), pl, strokes: w.map.strokes.length };
      return plain;
    }
    const map = M.build(w.plates, { ...s, carve: false, strokes: [] });
    const pl = WS.climate.planetOf(w, d), clim = WS.climate.build(map, pl);
    M.carveMap(map, { water: WS.biomes.water(map, clim, WS.biomes.planetOf(w, d)), strokes: w.map.strokes, iceAge: w.map.iceAge ?? 6 });
    map.climate = { clim, pl, strokes: w.map.strokes.length };
    return map;
  }
  /* The planet's tides against Earth's, from its moon, star, size and gravity (worldmap.js planetTides). */
  const tidesOf = (w, d) => M.planetTides({
    moonMass: w.moon.enabled ? w.moon.mass : 0, moonKm: w.moon.a, starMass: w.star.mass, au: w.planet.a,
    locked: w.planet.rotation >= 0.95 * d.planet.yearEarthDays * 24, radiusKm: d.planet.radiusKm, gravity: d.planet.gravity,
  });
  WS.tidesOf = tidesOf;
  const settingsOf = (w, d) => ({
    res: w.map.res || 720, land: (w.map.land ?? w.population.land) / 100, shelf: w.map.shelf, relief: w.map.relief, seed: w.plates.seed,
    gravity: d.planet.gravity, scaling: w.tectonics.scaling, radiusKm: d.planet.radiusKm, ridgeDepth: w.tectonics.ridgeDepth,
    erosion: w.map.erosion ?? 1, cells: d.planet.cells.count, tides: tidesOf(w, d),
    carve: w.map.carve !== false && w.planet.pressure >= WET,          // rivers need liquid water
  });
  const WET = 0.0061;                                                     // atm: below it water cannot be liquid

  // ── mountain range profiles: the workbook's TECTONICS sheet, kept as a reference ──
  function suggested(type, gravity, scaling) {
    const r = WS.calc.mountainRange({ type, heights: [], widths: [], erosion: 0, age: 0 }, gravity, scaling);
    const mid = (x) => (x.min !== undefined ? Math.round((x.min + x.max) / 2 / 10) * 10 : null);
    return { heights: r.features.map((f) => mid(f.heightRange)), widths: r.features.map((f) => mid(f.widthRange)) };
  }
  /* Profile a mountain range by hand: its type, features within the suggested sizes, erosion. */
  function rangeProfiles(ctx) {
    const { icon, textField, cardify } = WS.ui, C = WS.calc, V = WS.viz;
    const root = h('div');
    let sig = null, cur = null;
    const structure = (w) => `${Math.min(w.tectonics.active || 0, w.tectonics.ranges.length - 1)}|${w.tectonics.ranges.map((r) => `${r.id}:${r.type}`).join(',')}`;
    const change = (fn) => { sig = null; ctx.mutate(fn); };          // rebuilds this block on the next update
    function build() {
      const k = WS.kit(ctx), T = ctx.world.tectonics;
      const idx = Math.min(T.active || 0, T.ranges.length - 1), r = T.ranges[idx], base = `tectonics.ranges.${idx}`;
      const rangeTabs = h('div', { class: 'btn-row', style: { marginBottom: '12px' } },
        T.ranges.map((rg, i) => h('button', { class: ['btn small', i === idx && 'primary'], type: 'button', onclick: () => change((w) => { w.tectonics.active = i; }) }, rg.name || `Range ${i + 1}`)),
        h('button', { class: 'btn small', type: 'button', onclick: () => change((w) => {
          const s = suggested('Andean', ctx.d.planet.gravity, w.tectonics.scaling);
          w.tectonics.ranges.push({ id: WS.data.newId('r'), name: `Range ${w.tectonics.ranges.length + 1}`, type: 'Andean', heights: s.heights, widths: s.widths, erosion: 5, age: 50 });
          w.tectonics.active = w.tectonics.ranges.length - 1;
        }) }, icon('plus'), 'Add range'));
      const typeSel = h('select', { class: 'sel', id: 'range-type' }, Object.keys(C.RANGE_TYPES).map((t) => h('option', { value: t, selected: t === r.type }, t)));
      typeSel.addEventListener('change', () => change((w) => {
        const rr = w.tectonics.ranges[idx], s = suggested(typeSel.value, ctx.d.planet.gravity, w.tectonics.scaling);
        rr.type = typeSel.value; rr.heights = s.heights; rr.widths = s.widths;
      }));
      const inputs = h('div', null, rangeTabs,
        h('div', { class: 'fields' },
          textField(ctx, { path: `${base}.name`, label: 'Range name' }),
          h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'range-type' }, 'Type', info('Andean: thin orogeny at a subduction margin (southern Andes).\nLaramide: thick orogeny at a subduction margin (Rockies).\nUral: thin orogeny at a continent–continent collision (Urals, Alps, Caucasus).\nHimalayan: thick orogeny at a continent–continent collision (Himalayas).\n\nChanging the type refills the table with mid-range suggestions.')), typeSel),
          k.f({ path: `${base}.erosion`, label: 'Erosion rate', unit: 'm/Myr', min: 0, slider: [0, 20], step: 0.5, help: 'Global average ≈ 4–5 m/Myr. Regionally: arid 3, cold 7, polar 1, temperate 16, tropical 5.' }),
          k.f({ path: `${base}.age`, label: 'Inactive for', unit: 'Myr', min: 0, slider: [0, 500], step: 1, help: 'How long the range has been tectonically inactive. 0 = still active.' })),
        h('div', { class: 'btn-row', style: { marginTop: '12px' } },
          h('button', { class: 'btn small', type: 'button', onclick: () => change((w) => Object.assign(w.tectonics.ranges[idx], suggested(r.type, ctx.d.planet.gravity, w.tectonics.scaling))) }, icon('reset'), 'Fill suggested midpoints'),
          T.ranges.length > 1 ? h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await WS.ui.ask(`Remove ${r.name} and everything set for it?`, { title: 'Remove range', ok: 'Remove', danger: true })) change((w) => { w.tectonics.ranges.splice(idx, 1); w.tectonics.active = 0; }); } }, icon('x'), 'Remove range') : null));
      const ro = k.ro([
        { label: 'Max peak height', value: (c) => fmt.int(c.d.tectonics.maxPeak), unit: 'm', help: 'The absolute highest a single peak can stand under this gravity (rock strength), well above what ranges reach.' },
        { label: 'Gravity', value: (c) => fmt.num(c.d.planet.gravity, 3), unit: 'g', sub: () => 'linked from Planet' },
      ]);
      const xsHost = h('div', { class: 'viz-frame' }), featTable = h('div', { class: 'table-wrap' });
      const oceanHost = h('div', { class: 'viz-frame' }), oceanTable = h('div', { class: 'table-wrap' });
      replace(root,
        h('p', { class: 'muted', style: { fontSize: '13px', marginBottom: '12px' } }, 'The workbook’s Tectonics sheet: size a range by hand from its type and this gravity, and see it worn down. The map makes its own belts from the plates’ collisions and trenches; this does not change them.'),
        h('div', { class: 'grid two' },
          h('div', { class: 'stack-gap' }, inputs, ro),
          h('div', { class: 'stack-gap' },
            h('div', null, xsHost, h('div', { class: 'viz-caption' }, h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--amber)' } }), 'active profile'), h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--teal)' } }), 'after erosion'), h('span', null, 'vertical exaggeration varies'))),
            featTable)),
        h('h4', { class: 'field-label', style: { margin: '18px 0 8px' } }, 'Ocean depth by crust age (from the ridge depth above)'),
        h('div', { class: 'grid two' }, oceanTable, oceanHost));
      let featSig = '';
      const renderFeatures = (c) => {
        const rr = c.d.tectonics.ranges[idx], cr = c.world.tectonics.ranges[idx];
        const rows = rr.features.map((f, i) => {
          const mk = (arr, key, disabled, ok) => {
            if (disabled) return h('span', { class: 'muted' }, '—');
            const inp = h('input', { class: ['txt num', !ok && 'bad'], type: 'number', step: 10, value: cr[arr][i] ?? '', 'aria-label': `${f.name} ${key}` });
            inp.addEventListener('input', () => ctx.set(`${base}.${arr}.${i}`, inp.value === '' ? null : Number(inp.value)));
            return inp;
          };
          return h('tr', null, h('td', { class: 'txtcell' }, h('b', null, f.name)),
            h('td', null, mk('heights', 'height (m)', f.tapering, f.heightOk)), h('td', { class: 'txtcell muted' }, f.heightRange.text),
            h('td', null, mk('widths', 'width (km)', f.infinite, f.widthOk)), h('td', { class: 'txtcell muted' }, f.widthRange.text),
            h('td', { class: 'num' }, f.erodedHeight === null ? 'Tapering' : fmt.int(f.erodedHeight)));
        });
        replace(featTable, cardify(h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'Feature'), h('th', null, 'Height m'), h('th', null, ['Suggested ', info('Average heights. Individual peaks may exceed them. 0 means at or below sea level. “Tapering” slopes between its neighbours — leave it blank.')]), h('th', null, 'Width km'), h('th', null, ['Suggested ', info('Average widths. 0 means the feature may be absent. ∞ tapers off until it meets another feature (mountain, coast, rift…) — leave it blank.')]), h('th', null, 'Eroded m'))),
          h('tbody', null, rows))));
      };
      return {
        update(c) {
          k.update(c);
          const rr = c.d.tectonics.ranges[idx];
          replace(xsHost, V.crossSection(rr, c.d.tectonics.maxPeak));
          const fs = `${c.world.tectonics.scaling}|${c.d.planet.gravity.toFixed(4)}|${rr.features.map((f) => `${f.heightOk}${f.widthOk}${f.erodedHeight}`).join(',')}`;
          if (fs !== featSig) {
            const active = document.activeElement, pos = active && featTable.contains(active) ? active.getAttribute('aria-label') : null;
            featSig = fs; renderFeatures(c);
            if (pos) { const again = featTable.querySelector(`[aria-label="${pos}"]`); if (again) { again.focus(); const v = again.value; again.value = ''; again.value = v; } }
          }
          replace(oceanHost, V.oceanCurve({ ridge: c.world.tectonics.ridgeDepth }));
          const oc = c.d.tectonics.ocean.filter((o) => [0, 10, 20, 50, 100, 200, 500, 1000].includes(o.age));
          replace(oceanTable, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Crust age (Myr)'), h('th', null, 'Depth (m)'))),
            h('tbody', null, oc.map((o) => h('tr', null, h('td', null, String(o.age)), h('td', { class: 'num' }, fmt.int(o.depth)))))));
        },
      };
    }
    return {
      el: root,
      update(c) {
        const s = structure(c.world);
        if (s !== sig) { sig = s; cur = build(); }
        cur.update(c);
      },
    };
  }

  WS.defineStep({
    id: 'worldmap', title: 'World map', code: '00_SURFACE/WORLD_MAP', strip: 'Land & sea',
    blurb: 'The surface today: continents, shelves, mountains, islands and the deep sea, from the plates’ history.',
    lede: ['The surface of your world today, built from its plates’ history and scaled to its gravity and size. Turn the globe, raise and lower the land with the brush, and take the map away to draw on.'],
    build(ctx) {
      const u = (ctx.ui.map = ctx.ui.map || { view: 'map', shade: true, bounds: false, tool: 'look', radius: 150, strength: 600, lat: 20, lon: 0, zoom: 1 });
      const host = h('div', { class: 'scene-host' }), hint = h('div', { class: 'scene-status mono' });
      const viewTabs = h('div'), toolsHost = h('div'), setHost = h('div'), statsHost = h('div'), expHost = h('div'), keyHost = h('div');
      const profiles = rangeProfiles(ctx);
      const el = h('div', { class: 'stack-gap' },
        panel('Map', { ticks: true, tag: 'PRESENT DAY', flush: true }, h('div', { class: 'map-bar' }, viewTabs, keyHost), host, h('div', { class: 'viz-caption' }, hint)),
        h('div', { class: 'grid two' },
          h('div', { class: 'stack-gap' }, panel('Draw', { tag: 'BRUSH' }, toolsHost), statsHost),
          h('div', { class: 'stack-gap' }, panel('Sea level & relief', { tag: 'SETTINGS' }, setHost), panel('Take it away', { tag: 'EXPORT' }, expHost))),
        panel('Range profiles', { tag: 'REFERENCE' },
          h('details', { class: 'fold' }, h('summary', null, 'Mountain range cross-sections, erosion and ocean depth'), h('div', { style: { marginTop: '12px' } }, profiles.el))));
      let map = null, shown = null, building = false, drawn = '';
      const projOf = () => (u.view === 'globe' ? 'globe' : 'flat');
      const saved = u.cam && u.cam.projection === projOf() ? u.cam : null;
      const view = WS.globe.create(host, {
        projection: projOf(), lat: saved ? saved.lat : 20, lon: saved ? saved.lon : 0, alt: saved && !saved.auto ? saved.alt : null,
        radiusKm: ctx.d.planet.radiusKm, label: 'Map of the world today',
        onView: (v) => { u.cam = v; },
        onHover: (at) => { if (map && at) { const z = M.sample(map, at[0], at[1]); hint.textContent = `${fmt.num(at[0], 1)}°, ${fmt.num(at[1], 1)}° · ${z >= 0 ? `${fmt.int(z)} m above` : `${fmt.int(-z)} m below`} the sea`; } },
        onStroke: (phase, at) => {
          if (phase === 'start') { lastPaint = null; stroking = true; }
          if (phase !== 'end') {
            if (at && (!lastPaint || S.distance(at, lastPaint) > ((u.radius * 180) / (Math.PI * ctx.d.planet.radiusKm)) / 3)) { paint(at); lastPaint = at; }
            return;
          }
          if (stroking) { ctx.set('map.strokes', ctx.world.map.strokes); renderStats(); }
          stroking = false; lastPaint = null;
        },
      });
      let lastPaint = null, stroking = false;

      // ── building, and handing it to the viewer ──
      function ensure() {
        const w = ctx.world, d = ctx.d;
        if (!w.plates.features.some((f) => f.kind === 'crust')) { map = null; show(); return false; }
        const key = keyOf(w, d);
        if (cached && cached.key === key && cached.strokes === w.map.strokes.length) { map = cached.map; show(); return true; }
        if (building) return false;
        building = true; show();
        hint.textContent = settingsOf(w, d).carve ? 'Building the map, its climate and its rivers…' : 'Building the map…';
        const t0 = performance.now();
        // (in a worker: the page stays responsive meanwhile)
        WS.mapReady(w, d).then((c) => {
          building = false;
          if (!host.isConnected || !c) return;
          map = c.map;
          show(); renderStats(); renderSet(); renderExport();
          hint.textContent = `${map.W} × ${map.H} cells · built in ${fmt.int(performance.now() - t0)} ms`;
          WS.app.refresh();                                   // (the checks can read the map now, and a newer world is built)
        }, (err) => { building = false; hint.textContent = `Could not build the map: ${err.message}`; });
        return false;
      }
      /* The map's heights to the viewer (once per map), the plate boundaries as a mask over them. */
      function show() {
        view.setRadius(ctx.d.planet.radiusKm);
        if (!map) { view.setHeight(null); view.setMessage(building ? 'Building the map…' : 'Make a world on the Plates step first.'); shown = null; return; }
        view.setMessage('');
        if (shown !== map) { view.setHeight({ W: map.W, H: map.H, z: map.z, factor: map.planet.factor }); shown = map; drawn = ''; }
        const sig = `${u.shade}|${u.bounds}`;
        if (sig === drawn) return;
        drawn = sig;
        view.setStyle({ shade: u.shade });
        if (!u.bounds) { view.setMask(null); return; }
        const m = new Uint8Array(map.W * map.H * 4);
        map.boundary.forEach((b, k) => { if (b) m.set([...BOUND[b], 255], k * 4); });
        view.setMask({ W: map.W, H: map.H, data: m });
      }
      /* The map's height on the page: 2:1 flat, taller as a globe. */
      const size = () => {
        const w = host.clientWidth || 700;
        host.style.height = `${u.view === 'map' ? Math.round(w / 2) : Math.round(clamp(w * 0.8, 320, window.innerHeight * 0.75))}px`;
      };
      const ro = new ResizeObserver(size);

      // ── the brush ──
      function paint(at) {
        if (!map || !at) return;
        const s = { lat: +at[0].toFixed(3), lon: +at[1].toFixed(3), r: +((u.radius * 180) / (Math.PI * map.planet.radiusKm)).toFixed(3), dz: (u.tool === 'raise' ? 1 : -1) * u.strength };
        ctx.world.map.strokes.push(s);
        let j0 = map.H, j1 = -1;
        M.stamp(map.grid, [s.lat, s.lon], s.r, (k, dd) => { const t = clamp(1 - dd / s.r, 0, 1), j = Math.floor(k / map.W); map.z[k] += s.dz * t * t * (3 - 2 * t); if (j < j0) j0 = j; if (j > j1) j1 = j; });
        cached.strokes = ctx.world.map.strokes.length;
        if (j1 >= 0) view.updateHeight({ j0, j1 });
      }
      // ── panels ──
      function renderView() {
        replace(viewTabs, tabs([['map', 'Map'], ['globe', 'Globe']], u.view, (v) => { u.view = v; renderView(); renderTools(); size(); view.setProjection(projOf()); }),
          ...[['shade', 'Relief shading'], ['bounds', 'Plate boundaries']].map(([key, label]) => {
            const b = h('input', { type: 'checkbox', checked: u[key] });
            b.addEventListener('change', () => { u[key] = b.checked; show(); renderKey(); });
            return h('label', { class: 'check' }, b, label);
          }));
      }
      function renderTools() {
        const btn = (tool, label) => h('button', { type: 'button', class: ['btn small tool-btn', u.tool === tool && 'active'], 'aria-pressed': String(u.tool === tool), onclick: () => { u.tool = tool; view.setMode(tool === 'look' ? 'grab' : 'stroke'); renderTools(); } }, label);
        const num = (key, label, min, max, step, unit) => {
          const i = h('input', { class: 'txt num', type: 'number', min, max, step, value: u[key], 'aria-label': label });
          i.addEventListener('change', () => { u[key] = clamp(Number(i.value) || u[key], min, max); i.value = u[key]; });
          return h('label', { class: 'field' }, h('span', { class: 'field-label' }, `${label}, ${unit}`), i);
        };
        const n = ctx.world.map.strokes.length;
        replace(toolsHost,
          h('div', { class: 'btn-row' }, btn('look', u.view === 'globe' ? 'Look / turn' : 'Look'), btn('raise', 'Raise'), btn('lower', 'Lower')),
          h('div', { class: 'auto-grid', style: { marginTop: '10px' } }, num('radius', 'Brush radius', 20, 2000, 10, 'km'), num('strength', 'Strength', 50, 5000, 50, 'm')),
          h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            h('button', { class: 'btn small', type: 'button', disabled: !n, onclick: async () => {
              if (!await WS.ui.ask(`Undo all ${n} brush strokes?`, { title: 'Clear the drawing', ok: 'Clear', danger: true })) return;
              ctx.set('map.strokes', []); cached = null; ensure(); renderTools();
            } }, `Clear the drawing${n ? ` (${n})` : ''}`)));
      }
      function renderSet() {
        const w = ctx.world, auto = map ? map.crust * (29 / 41) * 100 : null;
        const num = (path, label, min, max, step, tip, value) => {
          const i = h('input', { class: 'txt num', type: 'number', min, max, step, value, 'aria-label': label });
          i.addEventListener('change', () => { const v = Number(i.value); if (!Number.isFinite(v)) return; ctx.set(path, clamp(v, min, max)); });
          return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, info(tip)), i);
        };
        const fg = ctx.d.planet.gravity ** w.tectonics.scaling;
        const carveBox = h('input', { type: 'checkbox', checked: w.map.carve !== false, disabled: w.planet.pressure < WET });
        carveBox.addEventListener('change', () => ctx.set('map.carve', carveBox.checked));
        const res = h('select', { class: 'sel', 'aria-label': 'Detail' }, [[360, 'Coarse · 360'], [720, 'Fine · 720'], [1440, 'Finest · 1440 (slow)']].map(([v, t]) => h('option', { value: v, selected: (w.map.res || 720) === v }, t)));
        res.addEventListener('change', () => ctx.set('map.res', Number(res.value)));
        replace(setHost,
          h('div', { class: 'auto-grid' },
            num('map.land', 'Land, % of surface', 1, 95, 0.5, 'How much of the surface stands above the sea. By default the Population step’s land share; the crust can only hold so much.', +(w.map.land ?? w.population.land).toFixed(1)),
            num('map.shelf', 'Shelf width ×', 0.2, 4, 0.1, 'Continental shelves: about 150 km wide on quiet coasts, 40 km where a plate subducts, on Earth.', w.map.shelf),
            num('map.relief', 'Relief ×', 0.2, 3, 0.1, 'Mountain heights on top of what gravity allows.', w.map.relief),
            num('map.iceAge', 'Ice ages, °C', 0, 15, 0.5, 'How much colder the ice ages were than today (Earth’s last: about 6 °C, more towards the poles). Glaciers then covered more ground and carved it: troughs, lake basins, fjords. 0: only where there is ice today.', w.map.iceAge ?? 6),
            num('map.erosion', 'Erosion ×', 0.2, 4, 0.1, `How fast the land wears down once it stops rising, × Earth’s: mountain belts and the raised ground beneath them, flood basalts, volcanoes. Faster where it rains (the equator, the fronts between this planet’s ${ctx.d.planet.cells.count} circulation cells), slower in the dry belts and near the poles; how deep the rivers cut follows it too. Earth = 1.`, w.map.erosion ?? 1),
            num('tectonics.scaling', 'Gravity scaling', 1, 2, 0.05, 'How strongly heights and widths shrink as gravity grows: they are divided by g^scaling (Artifexian: 1–2). At 1 g it makes no difference.', w.tectonics.scaling),
            num('tectonics.ridgeDepth', 'Ridge depth, m', 0, 6000, 50, 'Depth of the mid-ocean ridge crests below sea level; the ocean floor deepens from there as it ages and cools. On Earth about 2,600 m; stay within about ±500 m of that.', w.tectonics.ridgeDepth),
            h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Detail'), res)),
          h('label', { class: 'check', style: { marginTop: '10px' } }, carveBox, 'Rivers and glaciers carve the land', info(w.planet.pressure < WET ? 'This planet’s air is too thin for liquid water: no rivers.' : 'Rivers cut down into the land, deepest where the most water gathers: the rain the Climate step gives this map, less what evaporates (big rivers through wet uplands and mountains, little in deserts). They carry the rock off: it partly fills basins and builds deltas at the mouths of the largest rivers. A basin spills over its rim only if more water flows in than its lake could evaporate; otherwise it stays closed. How deep they cut follows Erosion ×. (Working out the climate first makes the map slower to build.)')),
          h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            w.map.land != null ? h('button', { class: 'btn small', type: 'button', onclick: () => ctx.set('map.land', null) }, `Follow Population (${fmt.num(w.population.land, 1)} %)`) : null,
            auto ? h('button', { class: 'btn small', type: 'button', onclick: () => ctx.set('map.land', +auto.toFixed(1)) }, `Earth-like for this crust: ${fmt.num(auto, 1)} %`) : null),
          h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '8px' } },
            `Gravity ${fmt.num(ctx.d.planet.gravity, 2)} g: heights and widths ÷ ${fmt.num(fg, 2)} (g^${fmt.num(w.tectonics.scaling, 2)}), so the highest ranges reach about ${fmt.int(8850 / fg)} m; ridges at ${fmt.int(w.tectonics.ridgeDepth)} m.`));
      }
      function renderStats() {
        if (!map) { replace(statsHost); return; }
        let land = 0, sum = 0, deep = 0;
        for (const v of map.z) { if (v > 0) { land++; sum += v; } else if (v < -200) deep++; }
        replace(statsHost, h('div', { class: 'readouts' },
          [['Land', `${fmt.num(map.land * 100, 1)} %`, `of the surface · crust ${fmt.num(map.crust * 100, 1)} %`],
            ['Highest point', `${fmt.int(map.highest.m)} m`, `${fmt.num(map.highest.at[0], 1)}°, ${fmt.num(map.highest.at[1], 1)}°`],
            ['Deepest point', `${fmt.int(-map.deepest.m)} m`, `${fmt.num(map.deepest.at[0], 1)}°, ${fmt.num(map.deepest.at[1], 1)}°`],
            ['Mean land height', `${fmt.int(land ? sum / land : 0)} m`, 'Earth ≈ 840 m'],
            ['Plates', `${new Set(map.plate).size}`, 'with their boundaries'],
            ...(map.rivers ? [['Carved by rivers', `${fmt.num(map.rivers.eroded / 1e6, 2)} M km³`, `deepest valley ${fmt.int(map.rivers.deepest)} m · ${map.rivers.rain === 'climate' ? 'with the climate’s rain' : 'rain by latitude'}`],
              ...(map.glaciers && map.glaciers.area ? [['Glaciers', `${fmt.num(map.glaciers.area / 1e6, 2)} M km²`, `glaciated now or in the ice ages · troughs to ${fmt.int(map.glaciers.deepest)} m · fjords ${fmt.int(map.glaciers.fjords)} km²`]] : []),
              ['River mouths', `${map.rivers.mouthList.filter((x) => /delta/.test(x.kind)).length} deltas · ${map.rivers.mouthList.filter((x) => x.kind === 'estuary').length} estuaries`, `${fmt.int(map.rivers.deltaArea)} km² of delta land · tides ${fmt.num(map.tideX, 2)} × Earth’s (Moon, star, gravity)`]] : [])]
            .map(([l, v, sub]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l), h('div', { class: 'val' }, v), h('div', { class: 'sub' }, sub)))),
          h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            h('button', { class: 'btn small', type: 'button', onclick: () => { ctx.mutate((w) => { w.population.land = +(map.land * 100).toFixed(1); if (w.map.land != null) w.map.land = +(map.land * 100).toFixed(1); }); toast(`Population land set to ${fmt.num(map.land * 100, 1)} %`); } }, `Use ${fmt.num(map.land * 100, 1)} % as land on Population`)));
      }
      function renderKey() {
        const sw = (c) => h('i', { style: { display: 'inline-block', width: '22px', height: '10px', background: `rgb(${c.join(',')})`, verticalAlign: 'middle', marginRight: '6px' } });
        replace(keyHost, h('div', { class: 'map-key mono' },
          ...[[SEA[5][1], 'deep sea'], [SEA[2][1], 'slope'], [SEA[0][1], 'shelf'], [LAND[0][1], 'lowland'], [LAND[3][1], 'upland'], [LAND[5][1], 'mountains'], [LAND[6][1], 'peaks']].map(([c, t]) => h('span', null, sw(c), t)),
          u.bounds ? [[BOUND[1], 'convergent'], [BOUND[2], 'divergent'], [BOUND[3], 'transform']].map(([c, t]) => h('span', null, sw(c), t)) : null));
      }
      function renderExport() {
        replace(expHost,
          h('p', { class: 'muted', style: { fontSize: '13px', marginBottom: '10px' } }, 'Equirectangular, ready for an image editor, Wilbur or Blender (as Artifexian maps onto a sphere).'),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn small primary', type: 'button', disabled: !map, onclick: (e) => WS.exportDrawingKit(ctx, e.currentTarget) }, 'Drawing kit (ZIP)'),
            h('button', { class: 'btn small', type: 'button', disabled: !map, onclick: exportColour }, 'Colour map (PNG)'),
            h('button', { class: 'btn small', type: 'button', disabled: !map, onclick: exportHeight }, 'Heightmap (16-bit PNG)')));
      }
      const fileName = (what) => `${(ctx.world.name || 'world').replace(/[^\w-]+/g, '_')}-${what}`;
      function save(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
      function exportColour() { view.renderEquirect(map.W, map.H).toBlob((b) => save(b, `${fileName('map')}.png`)); }
      async function exportHeight() {
        const lo = Math.floor(map.deepest.m), hi = Math.ceil(map.highest.m), span = Math.max(1, hi - lo);
        const v = new Uint16Array(map.z.length);
        for (let k = 0; k < v.length; k++) v[k] = Math.round(((map.z[k] - lo) / span) * 65535);
        const blob = await png16(map.W, map.H, v);
        save(blob, `${fileName('height')}_${lo}m_to_${hi}m_sea_${Math.round((-lo / span) * 65535)}.png`);
        toast(`Heightmap: 0 = ${fmt.int(lo)} m, 65535 = ${fmt.int(hi)} m; sea level is grey ${Math.round((-lo / span) * 65535)}`);
      }

      return {
        el,
        update() {
          if (!ro._on) { ro.observe(host); ro._on = true; }
          renderView(); renderTools(); renderSet(); renderKey(); profiles.update(ctx);
          view.setMode(u.tool === 'look' ? 'grab' : 'stroke');
          ensure(); renderStats(); size();
          renderExport();                                      // (after the map is built: its buttons need it)
        },
        destroy() { ro.disconnect(); view.destroy(); },
      };
    },
    checks(w, d) {
      const out = [];
      if (!w.plates.features.some((f) => f.kind === 'crust')) return [{ level: 'info', text: 'No continents yet: make a world on the Plates step.' }];
      const map = cached && cached.key === keyOf(w, d) ? cached.map : null;
      if (!map) return [{ level: 'info', text: 'Open the map to build it.' }];
      if (map.land < map.target - 0.03) out.push({ level: 'warn', text: `Only ${fmt.num(map.land * 100, 1)} % is land: the continental crust can’t hold the ${fmt.num(map.target * 100, 1)} % asked for.` });
      else out.push({ level: 'ok', text: `${fmt.num(map.land * 100, 1)} % of the surface is land.` });
      if (map.land > map.crust * 0.85) out.push({ level: 'info', text: `Land is ${fmt.int((map.land / map.crust) * 100)} % of the continental crust, so there is little flooded shelf (Earth: about 71 %). A lower land share, or more crust on Plates, gives wider shelves.` });
      if (Math.abs(w.tectonics.ridgeDepth - 2600) > 500) out.push({ level: 'warn', text: `Mid-ocean ridges at ${fmt.int(w.tectonics.ridgeDepth)} m are more than 500 m from Earth’s ~2,600 m.` });
      const peak = 8850 / d.planet.gravity ** w.tectonics.scaling;
      if (map.highest.m > peak * 1.5) out.push({ level: 'warn', text: `The highest point, ${fmt.int(map.highest.m)} m, is well above what this gravity allows (about ${fmt.int(peak)} m).` });
      // the hard rules of a caused map (js/fidelity.js), once per map and rivers; the rivers only if
      // already worked out (a check never starts a build)
      const c = WS.currentBiomes(w, d, { peek: true }), bio = c && c.climRef.mapRef.map === map ? c.bio : null;
      if (!rules || rules.map !== map || rules.bio !== bio || rules.strokes !== cached.strokes) rules = { map, bio, strokes: cached.strokes, list: WS.fidelity.rules(map, bio) };
      for (const r of rules.list) out.push({ level: r.ok ? 'ok' : 'info', text: r.text });
      if (!bio) out.push({ level: 'info', text: 'R1–R3 · Open Rivers & biomes to check the rivers.' });
      return out;
    },
  });

  /* A 16-bit greyscale PNG (in the drawing kit's module). */
  const png16 = (W, H, values) => WS.drawkit.png16(W, H, values);
})();
