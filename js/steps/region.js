/*
 * Region and Close-up: closer maps (region.js), each agreeing with the one it is cut from. Region: part of
 * the World map, at a few hundred metres to a few km a pixel. Close-up: part of the Region, at tens of
 * metres a pixel. Each has its heights with finer detail, its own drainage, valleys, lakes, rivers (with
 * meanders and oxbow lakes on flat ground) and biomes from the same climate. Pick the place on the map it
 * is cut from. Both shown on one zoomable map, the Atlas, with the world map and previews around them.
 */
(function () {
  'use strict';
  const { h, panel, fmt, replace, info, toast, tabs } = WS.ui;
  const R = WS.region, B = WS.biomes;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
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
   * is always there; zoomed in past what it can show, it is drawn as a smooth preview (its heights,
   * bicubic, shaded) at once. Build detail builds the level the view calls for: a region (200-3,200 km,
   * from the world map) or, inside a built region and zoomed in, a close-up (10-200 km, from the
   * region), for what is on screen; the build is shown in place as it goes. Built detail stays where it
   * was built; around it, the preview.
   */
  const D2R = Math.PI / 180, wrapLon = (lo) => ((((lo + 180) % 360) + 360) % 360) - 180;
  const LEVELS = { region: { L: REGION, name: 'region', min: 200, max: 3200 }, closeup: { L: CLOSEUP, name: 'close-up', min: 10, max: 200 } };
  /* Whether [lat, lon] lies in a frame. */
  const inFrame = (fr, la, lo) => { let d = lo - fr.west; d = ((d % 360) + 360) % 360; return la <= fr.north && la >= fr.south && d <= fr.dLon; };

  WS.defineStep({
    id: 'atlas', title: 'Atlas', code: '00_SURFACE/ATLAS', strip: 'Zoom in: regions, close-ups',
    blurb: 'One map from the whole world down to metres: zoom in anywhere, and build the detail there when you want it.',
    lede: ['Zoom in anywhere on your world, from the globe down to a few metres a pixel. Past what the world map can show, you see it enlarged at once; Build detail adds what it is too coarse to hold, for what is on screen: a region (coasts by type, fjords, hills and valleys, rivers and lakes, biomes by height), and inside a built region, closer still, a close-up (every stream, meanders and oxbow lakes, braided reaches). The build is shown as it goes.'],
    build(ctx) {
      const u = (ctx.ui.atlas = ctx.ui.atlas || { layer: 'relief', rivers: true, grid: true, lat: null, lon: 0, kmPx: null });
      const host = h('div', { class: 'scene-host' }), hint = h('div', { class: 'scene-status mono' });
      const bar = h('div', { class: 'map-bar' }), statsHost = h('div'), keyHost = h('div'), expHost = h('div');
      const el = h('div', { class: 'stack-gap' },
        panel('Atlas', { ticks: true, tag: 'ZOOM', flush: true }, bar, host, h('div', { class: 'viz-caption' }, hint)),
        h('div', { class: 'grid two' }, h('div', { class: 'stack-gap' }, statsHost), h('div', { class: 'stack-gap' }, keyHost, panel('Take it away', { tag: 'EXPORT' }, expHost))));
      const cv = h('canvas', { class: 'scene-canvas', tabindex: 0, role: 'img', 'aria-label': 'Atlas: zoomable map of the world' });
      host.appendChild(cv);
      const g = cv.getContext('2d');
      const radius = () => ctx.d.planet.radiusKm || 6371, kmDeg = () => (Math.PI * radius()) / 180;

      // ── what there is to draw: the world map, the built region and close-up, previews, a build ──
      let world = null, worldImg = null, regSt = null, cuSt = null, err = null, progress = null, stageLayer = null;
      const imgs = new WeakMap();                                   // layer → its painted canvas (per colour layer)
      const regionLayer = () => (regSt && regSt.built ? regSt.built.region : null);
      const closeLayer = () => (cuSt && cuSt.built ? cuSt.built.region : null);
      /* The deepest built layer at [lat, lon]. */
      const layerAt = (la, lo) => { const c = closeLayer(), r = regionLayer(); return c && inFrame(c.frame, la, lo) ? c : r && inFrame(r.frame, la, lo) ? r : null; };

      function ensure() {
        const w = ctx.world, d = ctx.d;
        if (!w.plates.features.some((f) => f.kind === 'crust')) { world = null; draw(); return; }
        WS.mapReady(w, d).then((c) => {
          if (!c || !host.isConnected) return;
          if (!world || world.map !== c.map) {
            const m = c.map;
            world = { map: m, layer: { W: m.W, H: m.H, z: m.z, planet: m.planet, frame: { north: 90, south: -90, west: -180, dLon: 360, dLat: 180, pxKm: (2 * Math.PI * radius()) / m.W } } };
            worldImg = paint(world.layer);
            if (u.lat == null) initView();
            draw();
          }
          // what is built (nothing is built here: only looked up)
          return REGION.look(w, d).then((rs) => { regSt = rs; return CLOSEUP.look(w, d); }).then((cs) => {
            if (!host.isConnected) return;
            cuSt = cs;
            const b = (REGION.pending() || CLOSEUP.pending());
            if (b && !progress) follow(b);
            renderAll(); schedulePreview(); draw();
          });
        }).catch((e) => { err = e; hint.textContent = `Could not show the map: ${e.message}`; draw(); });
      }
      /* The first view: on what is built, or was last set, else the whole world. */
      function initView() {
        const r = REGION.peek(), wr = ctx.world.region;
        const W = cv.width || 1000;
        if (r) { u.lat = r.region.frame.lat; u.lon = r.region.frame.lon; u.kmPx = (r.region.frame.span * 1.1) / W; }
        else if (wr && wr.lat != null) { u.lat = wr.lat; u.lon = wr.lon; u.kmPx = ((wr.span || 800) * 1.4) / W; }
        else { u.lat = 0; u.lon = 0; u.kmPx = (360 * kmDeg()) / W; }
      }

      /* RGBA for every pixel of a layer: the colour layer, lit from the north-west. */
      function paint(layer) {
        const { W, H, z, lake, biome } = layer, f = layer.planet?.factor ?? 1, px = new Uint8ClampedArray(W * H * 4);
        const m = layer.frame.pxKm * 1000, ve = clamp(1.2 + layer.frame.pxKm * 0.6, 1.5, 4), Lx = -0.55, Ly = 0.55, Lz = 0.63;
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const k = y * W + x, v = z[k];
          let c;
          if (v <= 0) c = ramp(SEA, -v);
          else if (lake && lake[k]) c = lake[k] === 1 ? FRESH : SALT;
          else if (!biome) c = ramp(LAND, v * f);
          else if (u.layer === 'biomes') c = biome[k] ? hex(B.BIOMES[biome[k] - 1][2]) : ICE;
          else c = biome[k] === B.BI.ice ? ICE : ramp(LAND, v * f);
          if (v > 0 && !(lake && lake[k])) {
            const xe = x + 1 < W ? x + 1 : layer.wrap ? 0 : x, xw = x > 0 ? x - 1 : layer.wrap ? W - 1 : x;
            const e = Math.max(0, z[y * W + xe]), wv = Math.max(0, z[y * W + xw]), n = Math.max(0, z[Math.max(0, y - 1) * W + x]), s = Math.max(0, z[Math.min(H - 1, y + 1) * W + x]);
            const gx = ((e - wv) / (2 * m)) * ve, gy = ((n - s) / (2 * m)) * ve, len = Math.hypot(gx, gy, 1);
            const sh = clamp((0.3 + 0.95 * ((-gx * Lx - gy * Ly + Lz) / len)) / (0.3 + 0.95 * Lz), 0.45, 1.3);
            c = [c[0] * sh, c[1] * sh, c[2] * sh];
          }
          const o = k * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
        }
        const cvs = h('canvas'); cvs.width = W; cvs.height = H; cvs.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0);
        return cvs;
      }
      const imgOf = (layer) => { let e = imgs.get(layer); if (!e || e.mode !== u.layer) { e = { mode: u.layer, cvs: paint(layer) }; imgs.set(layer, e); } return e.cvs; };

      // ── the view: centre and km a (device) pixel; east-west scaled by the latitude once zoomed in ──
      function proj() {
        const W = cv.width, H = cv.height, kd = kmDeg(), span = Math.max(W, H) * u.kmPx;
        const c = 1 + (Math.max(0.1, Math.cos(u.lat * D2R)) - 1) * (1 - smooth((span - 3000) / 7000));
        const ppx = (kd * c) / u.kmPx, ppy = kd / u.kmPx;
        return {
          W, H, ppx, ppy, span,
          x: (lo) => { let d = lo - u.lon; d -= 360 * Math.round(d / 360); return W / 2 + d * ppx; },
          y: (la) => H / 2 - (la - u.lat) * ppy,
          ll: (x, y) => [u.lat - (y - H / 2) / ppy, wrapLon(u.lon + (x - W / 2) / ppx)],
        };
      }
      function clampView() {
        const W = Math.max(1, cv.width), kd = kmDeg();
        u.kmPx = clamp(u.kmPx, 0.004, (360 * kd) / W);
        const halfLat = (cv.height * u.kmPx) / kd / 2;
        u.lat = halfLat >= 90 ? 0 : clamp(u.lat, -90 + halfLat, 90 - halfLat);
        u.lon = wrapLon(u.lon);
      }
      /* Where a layer's frame lies on screen: its top-left and its size. */
      const placeOf = (P, fr) => ({ x: P.x(fr.west), y: P.y(fr.north), w: fr.dLon * P.ppx, h: fr.dLat * P.ppy });

      // ── previews: wherever the view is finer than the deepest layer under it, that layer enlarged ──
      let previews = [], pvTimer = null, pvKey = '';
      function schedulePreview() { clearTimeout(pvTimer); pvTimer = setTimeout(makePreviews, 120); }
      function makePreviews() {
        if (!world || !cv.width) return;
        const P = proj(), key = [u.lat, u.lon, u.kmPx, cv.width, cv.height, regionLayer() && regionLayer().frame.lat, closeLayer() && closeLayer().frame.lat].join('|');
        if (key === pvKey) return;
        pvKey = key; previews = [];
        const span = Math.min(P.span * 1.15, 0.45 * Math.PI * radius()), res = 640;
        const srcs = [[world.layer, world.map, null], [regionLayer(), regionLayer(), regionLayer() && regionLayer().frame], [closeLayer(), closeLayer(), closeLayer() && closeLayer().frame]];
        for (const [layer, src, clip] of srcs) {
          if (!layer || u.kmPx * 1.6 > layer.frame.pxKm) continue;        // (it shows well enough as it is)
          if (clip && !(inFrame(clip, u.lat, u.lon) || P.span < 4 * clip.span)) continue;
          const pv = R.preview(src.frame ? src : { W: src.W, H: src.H, z: src.z, planet: src.planet }, { lat: u.lat, lon: u.lon, span, res });
          previews.push({ layer: pv, over: layer, clip, cvs: paint(pv) });
        }
        draw();
      }

      // ── drawing ──
      const fit = () => {
        const w = host.clientWidth || 700, hh = Math.round(Math.min(w * 0.85, Math.max(360, window.innerHeight * 0.78)));
        const dpr = Math.min(2, window.devicePixelRatio || 1), oldW = cv.width;
        cv.style.height = `${hh}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
        if (u.kmPx && oldW) u.kmPx *= oldW / cv.width;
        if (world && u.lat == null) initView();
        draw(); schedulePreview();
      };
      const ro = new ResizeObserver(fit);
      function drawLayer(P, layer, cvs, clip) {
        const pl = placeOf(P, layer.frame);
        g.save();
        if (clip) { const c = placeOf(P, clip); g.beginPath(); g.rect(c.x, c.y, c.w, c.h); g.clip(); }
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        const shifts = layer.frame.dLon >= 359 ? [-360 * P.ppx, 0, 360 * P.ppx] : [0];
        for (const s of shifts) g.drawImage(cvs, pl.x + s, pl.y, pl.w, pl.h);
        g.restore();
      }
      function draw() {
        if (!cv.width) return;
        g.fillStyle = css('--bg'); g.fillRect(0, 0, cv.width, cv.height);
        const dpr = cv.width / Math.max(1, cv.clientWidth);
        if (!world) {
          g.fillStyle = css('--muted'); g.font = `${16 * dpr}px ${css('--font-mono') || 'monospace'}`;
          g.fillText(err ? 'Could not show the map.' : ctx.world.plates.features.some((f) => f.kind === 'crust') ? 'Working out the world map…' : 'Make a world on the Plates step first.', 20, 40);
          return;
        }
        clampView();
        const P = proj();
        // the world, then each built layer, each with its preview where the view is finer than it
        drawLayer(P, world.layer, worldImg);
        for (const pv of previews.filter((q) => q.over === world.layer)) drawLayer(P, pv.layer, pv.cvs);
        for (const lay of [regionLayer(), closeLayer()]) {
          if (!lay) continue;
          drawLayer(P, lay, imgOf(lay));
          for (const pv of previews.filter((q) => q.over === lay)) drawLayer(P, pv.layer, pv.cvs, lay.frame);
          if (u.rivers) { const pl = placeOf(P, lay.frame), sc = pl.w / lay.W; drawRivers(lay, (x, y) => [pl.x + x * sc, pl.y + y * sc], dpr * clamp(0.8 + 0.3 * Math.log2(Math.max(1, sc)), 0.8, 1.8), sc); }
        }
        if (stageLayer) drawLayer(P, stageLayer, stageLayer.cvs);
        // outlines: what is built, and what Build detail would build
        const box = (fr, colour, dash) => { const pl = placeOf(P, fr); g.save(); g.setLineDash(dash || []); g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 3 * dpr; g.strokeRect(pl.x, pl.y, pl.w, pl.h); g.strokeStyle = colour; g.lineWidth = 1.2 * dpr; g.strokeRect(pl.x, pl.y, pl.w, pl.h); g.restore(); };
        if (regionLayer()) box(regionLayer().frame, '#ffb238');
        if (closeLayer()) box(closeLayer().frame, '#ffe08a');
        const t = target();
        if (t.level && !progress) box(R.frame({ lat: t.lat, lon: t.lon, span: t.span, res: 64 }, radius()), 'rgba(255,255,255,0.9)', [6 * dpr, 5 * dpr]);
        if (u.grid) drawGrid(P, dpr);
        drawScale(P, dpr);
        if (progress) {
          const tx = `Building ${progress.what} · ${progress.label} (${progress.n}/${progress.of})`;
          g.save(); g.font = `${13 * dpr}px ${css('--font-mono') || 'monospace'}`;
          const tw = g.measureText(tx).width; g.fillStyle = 'rgba(0,0,0,0.65)'; g.fillRect(10 * dpr, 10 * dpr, tw + 16 * dpr, 24 * dpr);
          g.fillStyle = '#ffb238'; g.fillText(tx, 18 * dpr, 27 * dpr); g.restore();
        }
      }
      // (the drawn line, or the channel's true width where that is wider; sc: screen pixels a layer pixel)
      function drawRivers(lay, P2, scale, sc, gc = g) {
        const g = gc;                                   // (the map, or an export's canvas)
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
      function drawGrid(P, dpr) {
        const want = (140 * dpr) / P.ppy, step = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 45].find((s) => s >= want) || 45;
        const [n] = P.ll(0, 0), [sth] = P.ll(0, P.H), lonW = u.lon - P.W / 2 / P.ppx, lonE = u.lon + P.W / 2 / P.ppx;
        g.save(); g.strokeStyle = 'rgba(20, 20, 20, 0.28)'; g.lineWidth = dpr; g.fillStyle = 'rgba(20, 20, 20, 0.75)'; g.font = `${11 * dpr}px ${css('--font-mono') || 'monospace'}`;
        const lab = (t, x, y) => { g.save(); g.fillStyle = 'rgba(255,255,255,0.75)'; const w = g.measureText(t).width; g.fillRect(x - 2 * dpr, y - 11 * dpr, w + 4 * dpr, 14 * dpr); g.restore(); g.fillText(t, x, y); };
        const dig = step < 0.1 ? 2 : step < 1 ? (step < 0.25 ? 1 : 2) : 0, deg = (a, pos, neg) => `${fmt.num(Math.abs(a), dig)}°${a >= 0 ? pos : neg}`;
        for (let la = Math.ceil(Math.max(-90, sth) / step) * step; la <= Math.min(90, n); la += step) { const y = P.y(la); g.beginPath(); g.moveTo(0, y); g.lineTo(P.W, y); g.stroke(); lab(deg(la, 'N', 'S'), 4 * dpr, y - 3 * dpr); }
        for (let lo = Math.ceil(lonW / step) * step; lo <= lonE && (lo - lonW) / step < 400; lo += step) { const x = W2(P, lo); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, P.H); g.stroke(); lab(deg(wrapLon(lo), 'E', 'W'), x + 4 * dpr, P.H - 6 * dpr); }
        g.restore();
      }
      const W2 = (P, lo) => P.W / 2 + (lo - u.lon) * P.ppx;
      function drawScale(P, dpr) {
        const nice = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000].reduce((a, b) => (b <= u.kmPx * 160 * dpr ? b : a), 0.1);
        const len = nice / u.kmPx, x = P.W - len - 16 * dpr, y = 18 * dpr;
        g.save(); g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(x - 8 * dpr, y - 12 * dpr, len + 16 * dpr, 28 * dpr);
        g.strokeStyle = '#222'; g.lineWidth = 2 * dpr; g.beginPath(); g.moveTo(x, y + 6 * dpr); g.lineTo(x, y + 10 * dpr); g.lineTo(x + len, y + 10 * dpr); g.lineTo(x + len, y + 6 * dpr); g.stroke();
        g.fillStyle = '#222'; g.font = `${11 * dpr}px ${css('--font-mono') || 'monospace'}`; g.textAlign = 'center';
        g.fillText(nice < 1 ? `${fmt.int(nice * 1000)} m` : `${fmt.int(nice)} km`, x + len / 2, y + 3 * dpr); g.restore();
      }

      // ── what Build detail would build here ──
      function target() {
        if (!world || !cv.width) return { level: null };
        const span = Math.max(cv.width, cv.height) * u.kmPx, rl = regionLayer();
        if (span > LEVELS.region.max * 1.3) return { level: null, why: `Zoom in to build detail: a region is ${fmt.int(LEVELS.region.min)}–${fmt.int(LEVELS.region.max)} km across.` };
        const cuMax = rl ? Math.min(LEVELS.closeup.max, 0.5 * rl.frame.span) : 0;
        if (rl && inFrame(rl.frame, u.lat, u.lon) && span <= cuMax * 1.3) return { level: 'closeup', lat: u.lat, lon: u.lon, span: Math.round(clamp(span, LEVELS.closeup.min, cuMax)) };
        return { level: 'region', lat: u.lat, lon: u.lon, span: Math.round(clamp(span, LEVELS.region.min, LEVELS.region.max)) };
      }
      function startBuild() {
        const t = target();
        if (!t.level || progress) return;
        const lv = LEVELS[t.level];
        ctx.mutate((w) => { w[t.level].lat = +t.lat.toFixed(4); w[t.level].lon = +t.lon.toFixed(4); w[t.level].span = t.span; });
        const t0 = performance.now();
        progress = { what: lv.name, n: 0, of: 7, label: 'starting' };
        renderBar(); draw();
        lv.L.build(ctx.world, ctx.d, onProgressOf(lv)).then(() => {
          progress = null; stageLayer = null;
          hint.textContent = `Built the ${lv.name} in ${fmt.num((performance.now() - t0) / 1000, 1)} s.`;
          ensure(); WS.app.refresh();
        }, (e) => { progress = null; stageLayer = null; err = e; hint.textContent = `Could not build the ${lv.name}: ${e.message}`; renderBar(); draw(); });
      }
      /* Each stage of a build, as it comes: the heights so far, in place, and how far it has got. */
      const onProgressOf = (lv) => (p) => {
        if (!host.isConnected) return;
        progress = { what: lv.name, ...p };
        const b = lv.L.pending();
        if (p.z && b && b.settings) {
          const fr = R.frame(b.settings, radius());
          if (p.z.length === fr.W * fr.H) { stageLayer = { frame: fr, W: fr.W, H: fr.H, z: p.z, planet: b.planet }; stageLayer.cvs = paint(stageLayer); }
        }
        hint.textContent = `Building the ${lv.name}: ${p.label} (step ${p.n} of ${p.of})…`;
        renderBar(); draw();
      };
      /* A build already under way (when the step is opened again): follow it. */
      function follow(b) {
        const lv = REGION.pending() === b ? LEVELS.region : LEVELS.closeup, f = onProgressOf(lv);
        if (!b.listeners.includes(f)) b.listeners.push(f);
        progress = { what: lv.name, n: 0, of: 7, label: 'under way' };
        if (b.last) f(b.last);
        b.promise.then(() => { progress = null; stageLayer = null; ensure(); }, () => { progress = null; stageLayer = null; ensure(); });
      }

      // ── pointer: drag to pan, wheel to zoom, hover to read a place ──
      let drag = null;
      const devXY = (e) => { const r = cv.getBoundingClientRect(), dpr = cv.width / r.width; return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); drag = { xy: devXY(e), lat: u.lat, lon: u.lon }; cv.style.cursor = 'grabbing'; });
      cv.addEventListener('pointermove', (e) => {
        if (!world) return;
        const [x, y] = devXY(e), P = proj();
        if (drag) {
          u.lon = wrapLon(drag.lon - (x - drag.xy[0]) / P.ppx); u.lat = drag.lat + (y - drag.xy[1]) / P.ppy;
          draw(); schedulePreview(); return;
        }
        const [la, lo] = P.ll(x, y), lay = layerAt(la, lo), parts = [`${fmt.num(la, P.span < 300 ? 3 : 2)}°, ${fmt.num(lo, P.span < 300 ? 3 : 2)}°`];
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
        if (!progress) hint.textContent = parts.join(' · ');
      });
      const end = () => { if (drag) renderBar(); drag = null; cv.style.cursor = 'grab'; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      function zoomAt(factor, px, py) {
        const P = proj(), [la, lo] = P.ll(px, py);
        u.kmPx /= factor; clampView();
        const Q = proj();
        // (keep the point under the cursor where it was)
        u.lat += la - Q.ll(px, py)[0]; let d = lo - Q.ll(px, py)[1]; d -= 360 * Math.round(d / 360); u.lon = wrapLon(u.lon + d);
        draw(); schedulePreview(); renderBar();
      }
      cv.addEventListener('wheel', (e) => { e.preventDefault(); const [x, y] = devXY(e); zoomAt(Math.exp(-e.deltaY * 0.0015), x, y); }, { passive: false });
      cv.addEventListener('dblclick', (e) => { const [x, y] = devXY(e); zoomAt(2, x, y); });
      cv.style.touchAction = 'none'; cv.style.cursor = 'grab';
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
        const layerTabs = tabs(LAYERS, u.layer, (v) => { u.layer = v; draw(); renderBar(); renderKey(); });
        const chk = (key, label) => { const b = h('input', { type: 'checkbox', checked: u[key] }); b.addEventListener('change', () => { u[key] = b.checked; draw(); }); return h('label', { class: 'check' }, b, label); };
        const res = h('select', { class: 'sel', 'aria-label': 'Detail', style: { width: 'auto' } }, RES.map(([v, tx]) => h('option', { value: v, selected: (ctx.world.region.res || 1024) === v }, tx)));
        res.addEventListener('change', () => ctx.mutate((w) => { w.region.res = Number(res.value); w.closeup.res = Number(res.value); }));
        const goTo = (fr) => { u.lat = fr.lat; u.lon = fr.lon; u.kmPx = (fr.span * 1.1) / Math.max(1, Math.min(cv.width, cv.height)); draw(); schedulePreview(); renderBar(); };
        replace(bar, buildBtn, prog, layerTabs, chk('rivers', 'Rivers'), chk('grid', 'Grid'), res,
          h('span', { class: 'btn-row', style: { marginLeft: 'auto' } },
            regionLayer() ? h('button', { class: 'btn small', type: 'button', onclick: () => goTo(regionLayer().frame) }, 'Region') : null,
            closeLayer() ? h('button', { class: 'btn small', type: 'button', onclick: () => goTo(closeLayer().frame) }, 'Close-up') : null,
            h('button', { class: 'btn small', type: 'button', onclick: () => { u.kmPx = Infinity; clampView(); draw(); schedulePreview(); renderBar(); } }, 'World'),
            h('button', { class: 'btn small', type: 'button', 'aria-label': 'Zoom out', onclick: () => zoomAt(1 / 1.6, cv.width / 2, cv.height / 2) }, '−'),
            h('button', { class: 'btn small', type: 'button', 'aria-label': 'Zoom in', onclick: () => zoomAt(1.6, cv.width / 2, cv.height / 2) }, '+')));
      }
      /* The figures of the deepest built layer at the centre of the view (or of the region). */
      const focus = () => { if (!world) return null; const c = closeLayer(), r = regionLayer(); return c && inFrame(c.frame, u.lat, u.lon) ? c : r; };
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
        else { const f = world ? world.layer.planet?.factor ?? 1 : 1; items = [[SEA[6][1], 'deep sea'], [SEA[3][1], 'slope'], [SEA[0][1], 'shallows'], ...[0, 200, 500, 1000, 2000, 3500, 5000].map((m) => [ramp(LAND, m), `${fmt.int(m / f)} m`]), [ICE, 'ice']]; }
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
        const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false; bg.drawImage(imgOf(lay), 0, 0, big.width, big.height);
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
          renderAll(); ensure(); fit();
        },
        destroy() { ro.disconnect(); clearTimeout(pvTimer); },
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
