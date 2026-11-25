/*
 * Region and Close-up: closer maps (region.js), each agreeing with the one it is cut from. Region: part of
 * the World map, at a few hundred metres to a few km a pixel. Close-up: part of the Region, at tens of
 * metres a pixel. Each has its heights with finer detail, its own drainage, valleys, lakes, rivers (with
 * meanders and oxbow lakes on flat ground) and biomes from the same climate. Pick the place on the map it
 * is cut from. Both shown on one zoomable map, the Atlas (the map viewer, js/globe.js), over the world map.
 */
(function () {
  'use strict';
  const { h, panel, fmt, replace, info, toast, tabs } = WS.ui;
  const R = WS.region, B = WS.biomes;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = (h2) => [1, 3, 5].map((i) => parseInt(h2.slice(i, i + 2), 16));
  const ramp = (stops, x) => { if (x <= stops[0][0]) return stops[0][1]; for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (x - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * t); } return stops[stops.length - 1][1]; };
  // the World map's atlas colours (heights stretched by the planet's relief), and the biomes'
  const SEA = [[0, [178, 226, 232]], [50, [160, 214, 228]], [200, [140, 202, 222]], [1000, [98, 162, 206]], [3000, [60, 114, 172]], [5000, [36, 76, 132]], [7000, [22, 46, 92]], [11000, [10, 20, 50]]];
  const LAND = [[0, [92, 146, 86]], [200, [118, 166, 94]], [500, [168, 188, 118]], [1000, [204, 182, 122]], [2000, [172, 132, 92]], [3500, [138, 110, 96]], [5000, [214, 208, 202]], [8000, [255, 255, 255]]];
  const FRESH = [74, 134, 196], SALT = [186, 210, 208], ICE = [238, 243, 247], RIVER = 'rgb(36, 92, 172)';
  const RES = [[512, 'Quick · 512'], [1024, 'Fine · 1024'], [2048, 'Finest · 2048 (slow)']];
  const LAYERS = [['relief', 'Relief'], ['biomes', 'Biomes']];
  const OXBOW = 'rgb(88, 146, 196)', GRAVEL = 'rgb(214, 204, 178)';

  // ── building off the page's thread (one worker for both steps) ──
  let nextId = 1, worker = null;
  const pending = new Map();
  try {
    if (location.protocol !== 'file:' && typeof Worker !== 'undefined') {
      worker = new Worker('js/regionworker.js');
      worker.onmessage = (e) => {
        const p = pending.get(e.data.id);
        if (!p) return;
        if (e.data.progress) { if (p.onProgress) p.onProgress(e.data.progress); return; }
        pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.region);
      };
      worker.onerror = () => { worker = null; for (const p of pending.values()) p.reject(new Error('worker failed')); pending.clear(); };
    }
  } catch { worker = null; }
  /* Build off the page's thread, reporting each stage (onProgress({n, of, label, z})) as it is reached. */
  const buildOff = (source, water, s, onProgress) => {
    const inPage = () => new Promise((resolve) => setTimeout(() => resolve(R.build(source, water, { ...s, onStage: (n, of, label) => onProgress && onProgress({ n, of, label }) })), 30));
    if (!worker) return inPage();
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject, onProgress });
      worker.postMessage({ id, map: source, water, opts: s });
    }).catch(() => R.build(source, water, s));
  };
  const worldFrame = { north: 90, south: -90, west: -180, east: 180, dLat: 180, dLon: 360 };

  /*
   * A level of closer maps. cfg: key (the world's settings, and the step's id), parent(w, d, {build,
   * onProgress}) (a promise of {ref: what the map depends on, source and water for region.js build,
   * picker: {W, H, z, factor, frame, wrap, rivers?}, centre: where to go by default, span: how far the
   * parent reaches}, or {needs: 'region'} when what it is cut from is not built and build is not asked).
   * Nothing is built until asked:
   *   look(w, d): a promise of {par, s (the window), key, built (if built for this window), building (if
   *     under way)}, building nothing (but the world map, which the app builds anyway);
   *   build(w, d, onProgress): a promise of {ref, key, region, settings, parent}, built once per parent
   *     and window, reporting each stage ({n, of, label, z: the heights so far});
   *   peek(): the last one built.
   */
  function level(cfg) {
    let cached = null, building = null;
    const settingsOf = (w, par) => {
      const r = w[cfg.key] || {}, half = (km) => (km / 2) / ((Math.PI * 6371) / 180);
      let c = r.lat == null || r.lon == null ? par.centre : [r.lat, r.lon];
      const span = Math.min(r.span || cfg.defSpan, cfg.maxShare * par.span);
      // (a close-up stays inside the region it is cut from)
      if (!par.picker.wrap) {
        // (a region may straddle the date line: its longitudes run on past 180°)
        c = [c[0], par.picker.frame.lon + ((((c[1] - par.picker.frame.lon) % 360) + 540) % 360) - 180];
        const f = par.picker.frame, hLat = Math.min(f.dLat / 2, half(span) * 1.02), hLon = Math.min(f.dLon / 2, hLat / Math.max(0.1, Math.cos(c[0] * Math.PI / 180)));
        c = [clamp(c[0], f.south + hLat, f.north - hLat), clamp(c[1], f.west + hLon, f.east - hLon)];
      }
      return { lat: c[0], lon: c[1], span, res: r.res || 1024, seed: (w.plates.seed ?? 1) + cfg.seedShift, erosion: w.map.erosion ?? 1 };
    };
    const stateOf = (par) => {
      if (!par) return null;
      if (par.needs) return { needs: par.needs };
      const s = settingsOf(cfg.world, par), key = JSON.stringify(s);
      return {
        par, s, key,
        built: cached && cached.ref === par.ref && cached.key === key ? cached : null,
        building: building && building.ref === par.ref && building.key === key ? building : null,
      };
    };
    const look = (w, d) => { cfg.world = w; return cfg.parent(w, d, {}).then(stateOf); };
    const build = (w, d, onProgress) => {
      cfg.world = w;
      return cfg.parent(w, d, { build: true, onProgress }).then((par) => {
        const st = stateOf(par);
        if (!st || st.needs) return null;
        if (st.built) return st.built;
        if (st.building) { if (onProgress && !st.building.listeners.includes(onProgress)) st.building.listeners.push(onProgress); return st.building.promise; }
        const me = { ref: par.ref, key: st.key, listeners: onProgress ? [onProgress] : [], last: null, settings: st.s, planet: par.source.planet };
        me.promise = buildOff(par.source, par.water, st.s, (p) => { me.last = p; for (const f of me.listeners) f(p); }).then((region) => {
          if (building === me) building = null;
          cached = { ref: par.ref, key: st.key, region, settings: st.s, parent: par };
          return cached;
        }, (e) => { if (building === me) building = null; throw e; });
        building = me;
        return me.promise;
      });
    };
    return { look, build, ready: build, peek: () => cached, pending: () => building, settingsOf };
  }

  /* Where a region goes when none is set: the mouth of the largest river away from the poles, else the highest point. */
  function defaultCentre(map) {
    const W = map.W, ml = map.rivers && map.rivers.mouthList ? map.rivers.mouthList.filter((m) => m.from >= 0) : [];
    for (const m of ml) {
      const j = Math.floor(m.from / W), la = map.grid.lat[j], lo = -180 + ((m.from % W) + 0.5) * (360 / W);
      if (Math.abs(la) < 60) return [la, lo];
    }
    return map.highest.at;
  }
  /* Where a close-up goes when none is set: on the region's largest river, where it is flattest (its meanders). */
  function riverCentre(reg) {
    let best = null;
    const m = 0.15 * reg.W;
    for (const rv of reg.rivers) rv.pts.forEach((p, i) => {
      if (p[0] < m || p[1] < m || p[0] > reg.W - m || p[1] > reg.H - m) return;
      const score = rv.q[i];
      if (!best || score > best.score) best = { score, p };
    });
    return best ? R.latLonOf(reg, best.p[0], best.p[1]) : R.latLonOf(reg, reg.W / 2, reg.H / 2);
  }

  let waterMemo = null;
  const REGION = level({
    key: 'region', defSpan: 800, maxShare: 1, seedShift: 0,
    parent: (w, d) => WS.climateReady(w, d).then((c) => {
      if (!c) return null;
      // (the water budget on the world map's cells, worked out once per climate and planet)
      const pk = JSON.stringify(B.planetOf(w, d));
      if (!waterMemo || waterMemo.clim !== c.clim || waterMemo.pk !== pk) waterMemo = { clim: c.clim, pk, water: B.water(c.mapRef.map, c.clim, B.planetOf(w, d)) };
      const map = c.mapRef.map, water = waterMemo.water;
      const wt = { runoff: water.runoff, P: water.P, PET: water.PET, Tw: water.Tw, Tc: water.Tc, Ta: water.Ta, Pw: water.Pw, liquid: water.liquid, tBoil: water.tBoil };
      return {
        ref: `${c.mapRef.key}|${c.mapRef.strokes}`, water: wt, centre: defaultCentre(map), span: Math.PI * d.planet.radiusKm,
        source: { W: map.W, H: map.H, z: map.z, planet: map.planet, rivers: map.rivers ? { recv: map.rivers.recv, discharge: map.rivers.discharge } : null, glaciers: map.glaciers ? { ice: map.glaciers.ice } : null },
        picker: { W: map.W, H: map.H, z: map.z, factor: map.planet?.factor ?? 1, frame: worldFrame, wrap: true },
      };
    }),
  });
  const CLOSEUP = level({
    key: 'closeup', defSpan: 50, maxShare: 0.5, seedShift: 977,
    parent: (w, d, o = {}) => (o.build
      ? REGION.build(w, d, o.onProgress && ((p) => o.onProgress({ ...p, label: `The region first: ${p.label}`, region: true })))
      : REGION.look(w, d).then((st) => (st && !st.needs ? st.built || { needs: 'region' } : st))).then((c) => {
      if (!c || c.needs) return c;
      const r = c.region;
      return {
        ref: c, water: null, centre: riverCentre(r), span: r.frame.span,
        source: { W: r.W, H: r.H, z: r.z, frame: r.frame, water: r.water, lake: r.lake, recv: r.recv, flow: r.flow, planet: r.planet, rivers: r.rivers, ice: r.ice },
        picker: { W: r.W, H: r.H, z: r.z, factor: r.planet?.factor ?? 1, frame: r.frame, wrap: false, rivers: r.rivers, lake: r.lake },
      };
    }),
  });
  WS.regionReady = REGION.build;
  WS.closeupReady = CLOSEUP.build;

  /*
   * The Atlas: one map from the whole world down to metres, at several levels of detail. The world map
   * is always there, drawn by the map viewer smoothly between its cells however close the view, flat or
   * as a globe. Build detail builds the level the view calls for: a region (200-3,200 km,
   * from the world map) or, inside a built region and zoomed in, a close-up (10-200 km, from the
   * region), for what is on screen; the build is shown in place as it goes. Built detail stays where it
   * was built; around it, the world map.
   */
  const wrapLon = (lo) => ((((lo + 180) % 360) + 360) % 360) - 180;
  const LEVELS = { region: { L: REGION, name: 'region', min: 200, max: 3200 }, closeup: { L: CLOSEUP, name: 'close-up', min: 10, max: 200 } };
  /* Whether [lat, lon] lies in a frame. */
  const inFrame = (fr, la, lo) => { let d = lo - fr.west; d = ((d % 360) + 360) % 360; return la <= fr.north && la >= fr.south && d <= fr.dLon; };

  WS.defineStep({
    id: 'atlas', title: 'Atlas', code: '00_SURFACE/ATLAS', strip: 'Zoom in: regions, close-ups',
    blurb: 'One map from the whole world down to metres: zoom in anywhere, and build the detail there when you want it.',
    lede: ['Zoom in anywhere on your world, from the globe down to a few metres a pixel. Past what the world map can show, you see it enlarged at once; Build detail adds what it is too coarse to hold, for what is on screen: a region (coasts by type, fjords, hills and valleys, rivers and lakes, biomes by height), and inside a built region, closer still, a close-up (every stream, meanders and oxbow lakes, braided reaches). The build is shown as it goes.'],
    build(ctx) {
      const u = (ctx.ui.atlas = ctx.ui.atlas || { layer: 'relief', rivers: true, grid: true, view: 'map', cam: null });
      const host = h('div', { class: 'scene-host' }), hint = h('div', { class: 'scene-status mono' });
      const bar = h('div', { class: 'map-bar' }), statsHost = h('div'), keyHost = h('div'), expHost = h('div');
      const el = h('div', { class: 'stack-gap' },
        panel('Atlas', { ticks: true, tag: 'ZOOM', flush: true }, bar, host, h('div', { class: 'viz-caption' }, hint)),
        h('div', { class: 'grid two' }, h('div', { class: 'stack-gap' }, statsHost), h('div', { class: 'stack-gap' }, keyHost, panel('Take it away', { tag: 'EXPORT' }, expHost))));
      const radius = () => ctx.d.planet.radiusKm || 6371;
      const proj = () => (u.view === 'globe' ? 'globe' : 'flat');
      const saved = u.cam && u.cam.projection === proj() ? u.cam : null;
      let barSig = '', focusSig = '', placed = !!saved;
      const view = WS.globe.create(host, {
        projection: proj(), lat: saved ? saved.lat : 0, lon: saved ? saved.lon : 0, alt: saved && !saved.auto ? saved.alt : null,
        minAlt: 0.0004, radiusKm: radius(), label: 'Atlas: zoomable map of the world',
        onView: (v, moving) => {
          u.cam = v;
          if (moving) return;
          // (the bar and the figures follow the view once it comes to rest)
          const t = target(), sig = `${t.level}|${t.span}|${!!progress}`;
          if (sig !== barSig) { barSig = sig; renderBar(); }
          const f = focus(), fs = f ? `${f.frame.lat}|${f === closeLayer()}` : '';
          if (fs !== focusSig) { focusSig = fs; renderStats(); renderKey(); }
        },
        onHover: (p) => hover(p),
      });
      view.setStyle({ sea: SEA, land: LAND });

      // ── what there is to draw: the world map, the built region and close-up, a build under way ──
      let world = null, regSt = null, cuSt = null, err = null, progress = null, stageLayer = null;
      const colours = new WeakMap();                                // layer → its land colours (per colour layer)
      const regionLayer = () => (regSt && regSt.built ? regSt.built.region : null);
      const closeLayer = () => (cuSt && cuSt.built ? cuSt.built.region : null);
      /* The deepest built layer at [lat, lon]. */
      const layerAt = (la, lo) => { const c = closeLayer(), r = regionLayer(); return c && inFrame(c.frame, la, lo) ? c : r && inFrame(r.frame, la, lo) ? r : null; };

      function ensure() {
        const w = ctx.world, d = ctx.d;
        if (!w.plates.features.some((f) => f.kind === 'crust')) { world = null; show(); return; }
        if (!world) view.setMessage('Working out the world map…');
        WS.mapReady(w, d).then((c) => {
          if (!c || !host.isConnected) return;
          if (!world || world.map !== c.map) {
            const m = c.map;
            world = { map: m };
            view.setRadius(radius());
            view.setHeight({ W: m.W, H: m.H, z: m.z, factor: m.planet?.factor ?? 1 });
            if (!placed) { placed = true; initView(); }
          }
          // what is built (nothing is built here: only looked up)
          return REGION.look(w, d).then((rs) => { regSt = rs; return CLOSEUP.look(w, d); }).then((cs) => {
            if (!host.isConnected) return;
            cuSt = cs;
            const b = (REGION.pending() || CLOSEUP.pending());
            if (b && !progress) follow(b);
            show(); renderAll();
          });
        }).catch((e) => { err = e; hint.textContent = `Could not show the map: ${e.message}`; show(); });
      }
      /* The first view: on what is built, or was last set, else the whole world. */
      function initView() {
        const r = REGION.peek(), wr = ctx.world.region;
        if (r) view.setView({ lat: r.region.frame.lat, lon: r.region.frame.lon, spanKm: r.region.frame.span * 1.1 });
        else if (wr && wr.lat != null) view.setView({ lat: wr.lat, lon: wr.lon, spanKm: (wr.span || 800) * 1.4 });
      }
      /* The built layers and a build's heights so far, deepest last, to the viewer. */
      function show() {
        if (!world) { view.setMessage(err ? 'Could not show the map.' : ctx.world.plates.features.some((f) => f.kind === 'crust') ? 'Working out the world map…' : 'Make a world on the Plates step first.'); return; }
        view.setMessage('');
        const patch = (lay) => lay && { frame: lay.frame, W: lay.W, H: lay.H, z: lay.z, factor: lay.planet?.factor ?? 1, layer: landColours(lay) };
        view.setPatches([patch(regionLayer()), patch(closeLayer()), stageLayer && patch(stageLayer)]);
        view.setOverlay(overlay);
      }
      /* The colours a layer lays over the relief: lakes, ice, and the biomes when they are shown (alpha 0: the relief). */
      function landColours(layer) {
        const { W, H, z, lake, biome } = layer;
        if (!lake && !biome) return null;
        let e = colours.get(layer);
        if (e && e.mode === u.layer) return e.data;
        const px = new Uint8Array(W * H * 4);
        for (let k = 0; k < W * H; k++) {
          if (!(z[k] > 0)) continue;
          let c = null;
          if (lake && lake[k]) c = lake[k] === 1 ? FRESH : SALT;
          else if (biome && u.layer === 'biomes') c = biome[k] ? hex(B.BIOMES[biome[k] - 1][2]) : ICE;
          else if (biome && biome[k] === B.BI.ice) c = ICE;
          if (c) px.set([c[0], c[1], c[2], 255], k * 4);
        }
        e = { mode: u.layer, data: px }; colours.set(layer, e);
        return px;
      }
      /* A layer's map at full detail, lit like the viewer draws it (for the exports). */
      function imageOf(lay) {
        const ramps = { land: WS.globe.rampTable(LAND), sea: WS.globe.rampTable(SEA) };
        const px = WS.globe.colourImage({ W: lay.W, H: lay.H, z: lay.z, factor: lay.planet?.factor ?? 1, wrap: false, cellM: [lay.frame.pxKm * 1000, lay.frame.pxKm * 1000] }, { shade: true }, ramps, landColours(lay));
        const cvs = h('canvas'); cvs.width = lay.W; cvs.height = lay.H; cvs.getContext('2d').putImageData(new ImageData(px, lay.W, lay.H), 0, 0);
        return cvs;
      }
      const size = () => { const w = host.clientWidth || 700; host.style.height = `${Math.round(Math.min(w * 0.85, Math.max(360, window.innerHeight * 0.78)))}px`; };
      const ro = new ResizeObserver(size);

      // ── lines and labels over the map: rivers, what is built, what would be, a grid, a scale ──
      /* A line through [lat, lon] points, broken where it leaves the globe's face or wraps round the flat map. */
      function polyline(g, v, pts) {
        let prev = null;
        g.beginPath();
        for (const [la, lo] of pts) {
          const p = v.project(la, lo);
          if (p[2] && prev && prev[2] && Math.abs(p[0] - prev[0]) < v.w / 2) g.lineTo(p[0], p[1]); else if (p[2]) g.moveTo(p[0], p[1]);
          prev = p;
        }
        g.stroke();
      }
      const edges = (fr) => {
        const pts = [], n = 24, S = fr.north - fr.dLat;
        for (let i = 0; i <= n; i++) pts.push([fr.north, fr.west + (i / n) * fr.dLon]);
        for (let i = 1; i <= n; i++) pts.push([fr.north - (i / n) * fr.dLat, fr.west + fr.dLon]);
        for (let i = 1; i <= n; i++) pts.push([S, fr.west + fr.dLon - (i / n) * fr.dLon]);
        for (let i = 1; i <= n; i++) pts.push([fr.north - fr.dLat + (i / n) * fr.dLat, fr.west]);
        return pts;
      };
      function overlay(g, v) {
        // each built layer's rivers, at its own scale
        for (const lay of [regionLayer(), closeLayer()]) {
          if (!lay || !u.rivers || !v.project(lay.frame.lat, lay.frame.lon)[2]) continue;
          const fr = lay.frame, sc = (fr.dLat / lay.H) * v.scale;
          if (sc < 0.08) continue;                                         // (too small to tell apart)
          const P2 = (x, y) => v.project(fr.north - (y / lay.H) * fr.dLat, fr.west + (x / lay.W) * fr.dLon);
          drawRivers(lay, P2, clamp(0.8 + 0.3 * Math.log2(Math.max(1, sc)), 0.8, 1.8), sc, g);
        }
        // outlines: what is built, and what Build detail would build
        const box = (fr, colour, dash) => { g.save(); g.setLineDash(dash || []); g.lineJoin = 'round'; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3; polyline(g, v, edges(fr)); g.strokeStyle = colour; g.lineWidth = 1.2; polyline(g, v, edges(fr)); g.restore(); };
        if (regionLayer()) box(regionLayer().frame, '#ffb238');
        if (closeLayer()) box(closeLayer().frame, '#ffe08a');
        const t = target();
        if (t.level && !progress) box(R.frame({ lat: t.lat, lon: t.lon, span: t.span, res: 64 }, radius()), 'rgba(255,255,255,0.9)', [6, 5]);
        if (u.grid) drawGrid(g, v);
        drawScale(g, v);
        if (progress) {
          const tx = `Building ${progress.what} · ${progress.label} (${progress.n}/${progress.of})`;
          g.save(); g.font = `13px ${css('--font-mono') || 'monospace'}`;
          const tw = g.measureText(tx).width; g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(10, 10, tw + 16, 24);
          g.fillStyle = '#ffb238'; g.fillText(tx, 18, 27); g.restore();
        }
      }
      // (the drawn line, or the channel's true width where that is wider; sc: screen pixels a layer pixel)
      function drawRivers(lay, P2, scale, sc, g) {
        const rw = (q) => Math.max(scale * R.riverWidth(q, lay.minFlow), (sc * 2.7 * Math.sqrt(Math.max(0, q))) / 1000 / lay.frame.pxKm);
        g.lineCap = 'round'; g.lineJoin = 'round';
        g.strokeStyle = OXBOW;
        for (const ob of lay.oxbows || []) { g.lineWidth = Math.max(scale * ob.w * 0.9, sc * ob.wTrue * 0.9); g.beginPath(); ob.pts.forEach((pt, i) => { const p = P2(pt[0], pt[1]); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke(); }
        g.strokeStyle = RIVER;
        const minQ = lay.minFlow * (sc < 0.6 ? 4 : sc < 1.2 ? 2 : 1);
        for (const rv of lay.rivers) {
          if (rv.q[rv.q.length - 1] < minQ) continue;
          let i = 0;
          while (i < rv.pts.length - 1 && rv.q[i] < minQ) i++;
          while (i < rv.pts.length - 1) {
            const w0 = rw(rv.q[i]);
            g.lineWidth = w0; g.beginPath();
            let p = P2(rv.pts[i][0], rv.pts[i][1]); g.moveTo(p[0], p[1]);
            let j = i + 1;
            for (; j < rv.pts.length; j++) { p = P2(rv.pts[j][0], rv.pts[j][1]); g.lineTo(p[0], p[1]); if (Math.abs(rw(rv.q[j]) - w0) > 0.15 * scale) break; }
            g.stroke(); i = j;
          }
        }
        for (const br of lay.braids || []) {
          g.strokeStyle = GRAVEL;
          for (let k = 1; k < br.pts.length; k++) { const a = P2(br.pts[k - 1][0], br.pts[k - 1][1]), b = P2(br.pts[k][0], br.pts[k][1]); g.lineWidth = Math.max(scale, sc * br.band[k]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
          g.strokeStyle = RIVER; g.lineWidth = Math.max(0.5 * scale, sc * br.wStrand);
          for (const st of br.strands) { g.beginPath(); st.forEach((pt, k) => { const p = P2(pt[0], pt[1]); if (k) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.stroke(); }
        }
      }
      /* Parallels and meridians every so many degrees (about 140 px apart), labelled. */
      function drawGrid(g, v) {
        const want = 140 / v.scale, step = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 45].find((s) => s >= want) || 45;
        // what is in view: the places under a 9 x 9 lattice of the screen (everything, if any misses the planet)
        let la0 = 90, la1 = -90, d0 = 180, d1 = -180, all = false;
        for (let a = 0; a <= 8 && !all; a++) for (let b = 0; b <= 8; b++) {
          const p = v.pick((a / 8) * v.w, (b / 8) * v.h);
          if (!p) { all = true; break; }
          la0 = Math.min(la0, p[0]); la1 = Math.max(la1, p[0]); const dl = wrapLon(p[1] - v.lon); d0 = Math.min(d0, dl); d1 = Math.max(d1, dl);
        }
        const near = (lat) => v.pick(v.w / 2, v.h / 2) && Math.abs(lat) > 89.9;
        if (all || near(la0) || near(la1) || la1 > 89 || la0 < -89) { la0 = -90; la1 = 90; d0 = -180; d1 = 180; }
        const pad = step, lonA = v.lon + d0 - pad, lonB = v.lon + d1 + pad, latA = Math.max(-90, la0 - pad), latB = Math.min(90, la1 + pad);
        g.save(); g.strokeStyle = 'rgba(20, 20, 20, 0.28)'; g.lineWidth = 1; g.fillStyle = 'rgba(20, 20, 20, 0.75)'; g.font = `11px ${css('--font-mono') || 'monospace'}`;
        const lab = (t, x, y) => { g.save(); g.fillStyle = 'rgba(255,255,255,0.75)'; const w = g.measureText(t).width; g.fillRect(x - 2, y - 11, w + 4, 14); g.restore(); g.fillText(t, x, y); };
        const dig = step < 0.1 ? 2 : step < 1 ? (step < 0.25 ? 1 : 2) : 0, deg = (a, pos, neg) => `${fmt.num(Math.abs(a), dig)}°${a >= 0 ? pos : neg}`;
        const flat = v.projection === 'flat', N = 64;
        for (let la = Math.ceil(latA / step) * step, n = 0; la <= latB && n < 200; la += step, n++) {
          const pts = []; for (let i = 0; i <= N; i++) pts.push([la, lonA + ((lonB - lonA) * i) / N]);
          polyline(g, v, pts);
          const p = flat ? [4, v.project(la, v.lon)[1] - 3, true] : v.project(la, v.lon);
          if (p[2] && p[1] > 12 && p[1] < v.h - 4) lab(deg(la, 'N', 'S'), p[0] + (flat ? 0 : 4), p[1] - (flat ? 0 : 3));
        }
        for (let lo = Math.ceil(lonA / step) * step, n = 0; lo <= lonB && n < 400; lo += step, n++) {
          const pts = []; for (let i = 0; i <= N; i++) pts.push([latA + ((latB - latA) * i) / N, lo]);
          polyline(g, v, pts);
          const p = flat ? [v.project(0, lo)[0] + 4, v.h - 6, true] : v.project(v.lat, lo);
          if (p[2] && p[0] > 0 && p[0] < v.w - 30) lab(deg(wrapLon(lo), 'E', 'W'), p[0] + (flat ? 0 : 4), p[1] + (flat ? 0 : 14));
        }
        g.restore();
      }
      function drawScale(g, v) {
        const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].reduce((a, b) => (b <= v.kmPx * 160 ? b : a), 0.1);
        const len = nice / v.kmPx, x = v.w - len - 16, y = 18;
        g.save(); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x - 8, y - 12, len + 16, 28);
        g.strokeStyle = '#222'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, y + 6); g.lineTo(x, y + 10); g.lineTo(x + len, y + 10); g.lineTo(x + len, y + 6); g.stroke();
        g.fillStyle = '#222'; g.font = `11px ${css('--font-mono') || 'monospace'}`; g.textAlign = 'center';
        g.fillText(nice < 1 ? `${fmt.int(nice * 1000)} m` : `${fmt.int(nice)} km`, x + len / 2, y + 3); g.restore();
      }

      // ── what Build detail would build here ──
      function target() {
        if (!world) return { level: null };
        const v = view.view(), span = v.spanKm, rl = regionLayer();
        if (span > LEVELS.region.max * 1.3) return { level: null, why: `Zoom in to build detail: a region is ${fmt.int(LEVELS.region.min)}–${fmt.int(LEVELS.region.max)} km across.` };
        const cuMax = rl ? Math.min(LEVELS.closeup.max, 0.5 * rl.frame.span) : 0;
        if (rl && inFrame(rl.frame, v.lat, v.lon) && span <= cuMax * 1.3) return { level: 'closeup', lat: v.lat, lon: v.lon, span: Math.round(clamp(span, LEVELS.closeup.min, cuMax)) };
        return { level: 'region', lat: v.lat, lon: v.lon, span: Math.round(clamp(span, LEVELS.region.min, LEVELS.region.max)) };
      }
      function startBuild() {
        const t = target();
        if (!t.level || progress) return;
        const lv = LEVELS[t.level];
        ctx.mutate((w) => { w[t.level].lat = +t.lat.toFixed(4); w[t.level].lon = +t.lon.toFixed(4); w[t.level].span = t.span; });
        const t0 = performance.now();
        progress = { what: lv.name, n: 0, of: 7, label: 'starting' };
        renderBar(); view.redraw();
        lv.L.build(ctx.world, ctx.d, onProgressOf(lv)).then(() => {
          progress = null; stageLayer = null;
          hint.textContent = `Built the ${lv.name} in ${fmt.num((performance.now() - t0) / 1000, 1)} s.`;
          ensure(); WS.app.refresh();
        }, (e) => { progress = null; stageLayer = null; err = e; hint.textContent = `Could not build the ${lv.name}: ${e.message}`; renderBar(); show(); });
      }
      /* Each stage of a build, as it comes: the heights so far, in place, and how far it has got. */
      const onProgressOf = (lv) => (p) => {
        if (!host.isConnected) return;
        progress = { what: lv.name, ...p };
        const b = lv.L.pending();
        if (p.z && b && b.settings) {
          const fr = R.frame(b.settings, radius());
          if (p.z.length === fr.W * fr.H) stageLayer = { frame: fr, W: fr.W, H: fr.H, z: p.z, planet: b.planet };
        }
        hint.textContent = `Building the ${lv.name}: ${p.label} (step ${p.n} of ${p.of})…`;
        renderBar(); show();
      };
      /* A build already under way (when the step is opened again): follow it. */
      function follow(b) {
        const lv = REGION.pending() === b ? LEVELS.region : LEVELS.closeup, f = onProgressOf(lv);
        if (!b.listeners.includes(f)) b.listeners.push(f);
        progress = { what: lv.name, n: 0, of: 7, label: 'under way' };
        if (b.last) f(b.last);
        b.promise.then(() => { progress = null; stageLayer = null; ensure(); }, () => { progress = null; stageLayer = null; ensure(); });
      }

      // ── reading a place ──
      function hover(p) {
        if (!world || !p || progress) return;
        const [la, lo] = p, span = view.view().spanKm, lay = layerAt(la, lo), parts = [`${fmt.num(la, span < 300 ? 3 : 2)}°, ${fmt.num(lo, span < 300 ? 3 : 2)}°`];
        let z, k = -1;
        if (lay) { k = R.pixelOf(lay, la, lo); z = lay.z[k]; } else z = M.sample(world.map, la, lo);
        if (z <= 0) parts.push(`sea, ${fmt.int(-z)} m deep`);
        else {
          parts.push(`${fmt.int(z)} m`);
          if (lay && k >= 0) {
            parts.push(lay.lake[k] ? (lay.lake[k] === 1 ? 'fresh lake' : 'salt lake') : B.BIOMES[lay.biome[k] - 1]?.[1] || '');
            if (lay.flow[k] >= lay.minFlow) parts.push(`${fmt.int(lay.flow[k])} m³/s`);
          }
        }
        parts.push(lay ? (lay === closeLayer() ? 'close-up' : 'region') : 'world map');
        hint.textContent = parts.join(' · ');
      }
      const M = WS.worldmap;

      // ── panels ──
      function renderBar() {
        const t = target(), lv = t.level && LEVELS[t.level];
        const buildBtn = h('button', { class: 'btn small primary', type: 'button', disabled: !!progress || !lv, title: t.why || '', onclick: startBuild },
          progress ? 'Building…' : lv ? `Build detail: ${lv.name}, ${fmt.int(t.span)} km` : 'Zoom in to build detail');
        const prog = progress ? h('span', { class: 'mono', style: { display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '12px' } },
          h('span', { style: { display: 'inline-block', width: '140px', height: '8px', border: '1px solid var(--line)', position: 'relative' } },
            h('span', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: `${Math.round((100 * progress.n) / Math.max(1, progress.of))}%`, background: 'var(--amber)', transition: 'width 0.3s' } })),
          `${progress.n}/${progress.of}`) : null;
        const viewTabs = tabs([['map', 'Map'], ['globe', 'Globe']], u.view, (v) => { u.view = v; view.setProjection(proj()); renderBar(); });
        const layerTabs = tabs(LAYERS, u.layer, (v) => { u.layer = v; show(); renderBar(); renderKey(); });
        const chk = (key, label) => { const b = h('input', { type: 'checkbox', checked: u[key] }); b.addEventListener('change', () => { u[key] = b.checked; view.redraw(); }); return h('label', { class: 'check' }, b, label); };
        const res = h('select', { class: 'sel', 'aria-label': 'Detail', style: { width: 'auto' } }, RES.map(([v, tx]) => h('option', { value: v, selected: (ctx.world.region.res || 1024) === v }, tx)));
        res.addEventListener('change', () => ctx.mutate((w) => { w.region.res = Number(res.value); w.closeup.res = Number(res.value); }));
        const goTo = (fr) => view.flyTo(fr.lat, fr.lon, fr.span * 1.1);
        replace(bar, buildBtn, prog, viewTabs, layerTabs, chk('rivers', 'Rivers'), chk('grid', 'Grid'), res,
          h('span', { class: 'btn-row', style: { marginLeft: 'auto' } },
            regionLayer() ? h('button', { class: 'btn small', type: 'button', onclick: () => goTo(regionLayer().frame) }, 'Region') : null,
            closeLayer() ? h('button', { class: 'btn small', type: 'button', onclick: () => goTo(closeLayer().frame) }, 'Close-up') : null,
            h('button', { class: 'btn small', type: 'button', onclick: () => view.reset() }, 'World')));
      }
      /* The figures of the deepest built layer at the centre of the view (or of the region). */
      const focus = () => { if (!world) return null; const c = closeLayer(), r = regionLayer(), v = view.view(); return c && inFrame(c.frame, v.lat, v.lon) ? c : r; };
      function renderStats() {
        const lay = focus();
        if (!lay) { replace(statsHost, panel('Detail', { tag: 'NONE YET' }, h('p', { class: 'muted', style: { fontSize: '13px', margin: 0 } }, 'Zoom in on the map and press Build detail: first a region (200–3,200 km across), then, inside it and zoomed in further, a close-up (10–200 km). What is built stays; the dashed box shows what the button would build.'))); return; }
        const s = lay.stats, k = (n) => fmt.int(n), isCu = lay === closeLayer(), name = isCu ? 'close-up' : 'region', src = isCu ? 'the region' : 'the world map';
        const rows = [
          [isCu ? 'Close-up' : 'Region', `${k(lay.frame.span)} km`, `${s.pxKm < 1 ? `${k(s.pxKm * 1000)} m` : `${fmt.num(s.pxKm, 2)} km`} a pixel · ${src}: ${s.worldCellKm < 1 ? `${k(s.worldCellKm * 1000)} m` : `${k(s.worldCellKm)} km`}`],
          ['Land', `${k(s.land * 100)} %`, `${k(s.landKm2)} km²`],
          ['Highest point', `${k(s.highest.m)} m`, `${fmt.num(s.highest.at[0], 2)}°, ${fmt.num(s.highest.at[1], 2)}°`],
          ['Rivers', `${k(s.rivers)}`, `${lay.oxbows && lay.oxbows.length ? `${k(lay.oxbows.length)} oxbow lakes · ` : ''}from ${fmt.num(lay.minFlow, lay.minFlow < 1 ? 1 : 0)} m³/s · ${lay.inflows.length ? `${k(lay.inflows.length)} enter from outside` : 'all rise here'}`],
          ['Largest river', s.biggest ? `${k(s.biggest.q)} m³/s` : '—', s.biggest ? `leaves at ${fmt.num(s.biggest.at[0], 2)}°, ${fmt.num(s.biggest.at[1], 2)}°` : `no river leaves the ${name}`],
          ['Lakes', `${k(s.lakes)}`, `${k(s.saltLakes)} of them salt · ${k(s.lakeKm2)} km²`],
          ['Deepest valley', `${k(s.deepestCut)} m`, `cut by its river into ${src}’s land`],
        ];
        replace(statsHost, h('div', { class: 'readouts' }, rows.map(([l, v, sub]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l), h('div', { class: 'val' }, v), h('div', { class: 'sub' }, sub)))));
      }
      function renderKey() {
        const lay = focus(), sw = (c) => h('i', { style: { display: 'inline-block', width: '22px', height: '10px', background: `rgb(${c.map(Math.round).join(',')})`, verticalAlign: 'middle', marginRight: '6px' } });
        let items;
        if (u.layer === 'biomes' && lay) items = lay.stats.biomeShare.map((v, i) => [i, v]).filter(([, v]) => v > 0.001).sort((a, b) => b[1] - a[1]).map(([i, v]) => [hex(B.BIOMES[i][2]), `${B.BIOMES[i][1]} ${v < 0.01 ? '<1' : fmt.int(v * 100)} %`]);
        else { const f = world ? world.map.planet?.factor ?? 1 : 1; items = [[SEA[6][1], 'deep sea'], [SEA[3][1], 'slope'], [SEA[0][1], 'shallows'], ...[0, 200, 500, 1000, 2000, 3500, 5000].map((m) => [ramp(LAND, m), `${fmt.int(m / f)} m`]), [ICE, 'ice']]; }
        items.push([FRESH, 'fresh lake'], [SALT, 'salt lake']);
        if (lay && lay.oxbows && lay.oxbows.length) items.push([hex('#5892c4'), 'oxbow lake']);
        if (lay && lay.braids && lay.braids.length) items.push([[214, 204, 178], 'gravel bed (braided river)']);
        replace(keyHost, panel('Key', { tag: LAYERS.find((l) => l[0] === u.layer)[1].toUpperCase() }, h('div', { class: 'map-key mono', style: { marginLeft: 0 } }, items.map(([c, t]) => h('span', null, sw(c), t)),
          h('span', null, h('i', { style: { display: 'inline-block', width: '22px', height: '3px', background: RIVER, verticalAlign: 'middle', marginRight: '6px' } }), 'river'),
          h('span', null, h('i', { style: { display: 'inline-block', width: '22px', height: '10px', border: '1.5px solid #ffb238', verticalAlign: 'middle', marginRight: '6px' } }), 'built region'),
          h('span', null, h('i', { style: { display: 'inline-block', width: '22px', height: '10px', border: '1.5px dashed #fff', background: '#555', verticalAlign: 'middle', marginRight: '6px' } }), 'Build detail would build'))));
      }
      const fileName = (lay, what, ext) => `${(ctx.world.name || 'world').replace(/[^\w-]+/g, '_')}-${lay === closeLayer() ? 'closeup' : 'region'}-${what}.${ext}`;
      const save = (blob, name) => { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
      function exportPng(lay) {
        const F = lay.W < 1500 ? 2 : 1, big = h('canvas'); big.width = lay.W * F; big.height = lay.H * F;
        const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false; bg.drawImage(imageOf(lay), 0, 0, big.width, big.height);
        if (u.rivers) drawRivers(lay, (x, y) => [x * F, y * F], F * 0.7, F, bg);
        big.toBlob((b) => save(b, fileName(lay, u.layer, 'png')));
      }
      async function exportHeight(lay) {
        const lo = Math.floor(lay.stats.deepest.m), hi = Math.ceil(lay.stats.highest.m), span = Math.max(1, hi - lo), v = new Uint16Array(lay.z.length);
        for (let k = 0; k < v.length; k++) v[k] = Math.round(((lay.z[k] - lo) / span) * 65535);
        save(await WS.drawkit.png16(lay.W, lay.H, v), fileName(lay, `height_${lo}m_to_${hi}m_sea_${Math.round((-lo / span) * 65535)}`, 'png'));
        toast(`Heightmap: 0 = ${fmt.int(lo)} m, 65535 = ${fmt.int(hi)} m`);
      }
      function exportSvg(lay) {
        const f2 = (x) => Math.round(x * 10) / 10, fr = lay.frame, line = (pts, w, extra = '') => `<polyline points="${pts.map(([x, y]) => `${f2(x)},${f2(y)}`).join(' ')}" stroke-width="${f2(w)}"${extra}/>`;
        const lines = lay.rivers.map((rv) => { const q = rv.q.reduce((a, b) => Math.max(a, b), 0); return line(rv.pts, R.riverWidth(q, lay.minFlow), ` data-flow="${Math.round(q)}"`); });
        const bed = (lay.braids || []).map((br) => line(br.pts, br.band.reduce((a, b) => Math.max(a, b), 0)));
        const strands = (lay.braids || []).flatMap((br) => br.strands.map((st) => line(st, br.wStrand)));
        const ox = (lay.oxbows || []).map((ob) => line(ob.pts, Math.max(ob.w, ob.wTrue)));
        const grp = (id, col, xs) => `<g id="${id}" fill="none" stroke="${col}" stroke-linecap="round" stroke-linejoin="round">\n${xs.join('\n')}\n</g>`;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lay.W} ${lay.H}" width="${lay.W}" height="${lay.H}">\n<!-- ${fmt.num(fr.north, 4)}N to ${fmt.num(fr.south, 4)}, ${fmt.num(fr.west, 4)} to ${fmt.num(fr.east, 4)} (degrees, equirectangular); ${fmt.num(fr.pxKm, 4)} km a pixel at the centre -->\n${grp('oxbows', '#5892c4', ox)}\n${grp('rivers', '#245cac', lines)}\n${grp('gravel-beds', '#d6ccb2', bed)}\n${grp('braids', '#245cac', strands)}\n</svg>\n`;
        save(new Blob([svg], { type: 'image/svg+xml' }), fileName(lay, 'rivers', 'svg'));
      }
      function renderExport() {
        const rows = [[regionLayer(), 'Region'], [closeLayer(), 'Close-up']].filter(([l]) => l);
        if (!rows.length) { replace(expHost, h('p', { class: 'muted', style: { fontSize: '13px', margin: 0 } }, 'Build detail first: a region or a close-up can then be saved at its full detail.')); return; }
        replace(expHost, h('p', { class: 'muted', style: { fontSize: '13px', marginBottom: '10px' } }, 'At full detail, each in its own frame; a layer’s map, heightmap and rivers stack in an image editor.'),
          ...rows.map(([lay, name]) => h('div', { class: 'btn-row', style: { marginBottom: '8px' } }, h('span', { class: 'mono muted', style: { minWidth: '5.5em', alignSelf: 'center' } }, name),
            h('button', { class: 'btn small primary', type: 'button', onclick: () => exportPng(lay) }, 'Map (PNG)'),
            h('button', { class: 'btn small', type: 'button', onclick: () => exportHeight(lay) }, 'Heightmap (16-bit)'),
            h('button', { class: 'btn small', type: 'button', onclick: () => exportSvg(lay) }, 'Rivers (SVG)'))));
      }
      function renderAll() { renderBar(); renderStats(); renderKey(); renderExport(); }

      return {
        el,
        update() {
          if (!ro._on) { ro.observe(host); ro._on = true; }
          renderAll(); ensure(); size();
        },
        destroy() { ro.disconnect(); view.destroy(); },
      };
    },
    checks(w) {
      if (!w.plates.features.some((f) => f.kind === 'crust')) return [{ level: 'info', text: 'No continents yet: make a world on the Plates step.' }];
      const r = REGION.peek(), c = CLOSEUP.peek(), out = [];
      if (!r) return [{ level: 'info', text: 'Zoom in on the Atlas and press Build detail to build a region.' }];
      const line = (x, name) => { const s = x.region.stats, px = s.pxKm < 1 ? `${fmt.int(s.pxKm * 1000)} m` : `${fmt.num(s.pxKm, 2)} km`; return `${name}: ${fmt.int(x.region.frame.span)} km across at ${px} a pixel, ${fmt.int(s.rivers)} rivers, ${fmt.int(s.lakes)} lakes${x.region.oxbows && x.region.oxbows.length ? `, ${fmt.int(x.region.oxbows.length)} oxbow lakes` : ''}.`; };
      out.push({ level: 'ok', text: line(r, 'Region') });
      if (c && c.ref === r) out.push({ level: 'ok', text: line(c, 'Close-up') });
      return out;
    },
  });
})();
