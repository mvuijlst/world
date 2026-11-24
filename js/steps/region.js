/*
 * Region and Close-up: closer maps (region.js), each agreeing with the one it is cut from. Region: part of
 * the World map, at a few hundred metres to a few km a pixel. Close-up: part of the Region, at tens of
 * metres a pixel. Each has its heights with finer detail, its own drainage, valleys, lakes, rivers (with
 * meanders and oxbow lakes on flat ground) and biomes from the same climate. Pick the place on the map it
 * is cut from; zoom and pan the closer map. The same step, twice (defineLevel).
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
      worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.region); } };
      worker.onerror = () => { worker = null; for (const p of pending.values()) p.reject(new Error('worker failed')); pending.clear(); };
    }
  } catch { worker = null; }
  const buildOff = (source, water, s) => {
    const inPage = () => new Promise((resolve) => setTimeout(() => resolve(R.build(source, water, s)), 30));
    if (!worker) return inPage();
    return new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, map: source, water, opts: s });
    }).catch(() => R.build(source, water, s));
  };
  const worldFrame = { north: 90, south: -90, west: -180, east: 180, dLat: 180, dLon: 360 };

  /*
   * A level of closer maps. cfg: key (the world's settings, and the step's id), parent(w, d) (a promise
   * of {ref: what the map depends on, source and water for region.js build, picker: {W, H, z, factor,
   * frame, wrap, rivers?}, centre: where to go by default, span: how far the parent reaches}).
   * Returns ready(w, d): a promise of {ref, key, region, settings, parent}, built once per parent and
   * window; and peek(): the last one built.
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
    const ready = (w, d) => cfg.parent(w, d).then((par) => {
      if (!par) return null;
      const s = settingsOf(w, par), key = JSON.stringify(s);
      if (cached && cached.ref === par.ref && cached.key === key) return cached;
      if (building && building.ref === par.ref && building.key === key) return building.promise;
      const me = { ref: par.ref, key };
      me.promise = buildOff(par.source, par.water, s).then((region) => {
        if (building === me) building = null;
        cached = { ref: par.ref, key, region, settings: s, parent: par };
        return cached;
      });
      building = me;
      return me.promise;
    });
    return { ready, peek: () => cached, settingsOf };
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
        source: { W: map.W, H: map.H, z: map.z, planet: map.planet, rivers: map.rivers ? { recv: map.rivers.recv, discharge: map.rivers.discharge } : null },
        picker: { W: map.W, H: map.H, z: map.z, factor: map.planet?.factor ?? 1, frame: worldFrame, wrap: true },
      };
    }),
  });
  const CLOSEUP = level({
    key: 'closeup', defSpan: 50, maxShare: 0.5, seedShift: 977,
    parent: (w, d) => REGION.ready(w, d).then((c) => {
      if (!c) return null;
      const r = c.region;
      return {
        ref: c, water: null, centre: riverCentre(r), span: r.frame.span,
        source: { W: r.W, H: r.H, z: r.z, frame: r.frame, water: r.water, lake: r.lake, recv: r.recv, flow: r.flow, planet: r.planet, rivers: r.rivers },
        picker: { W: r.W, H: r.H, z: r.z, factor: r.planet?.factor ?? 1, frame: r.frame, wrap: false, rivers: r.rivers, lake: r.lake },
      };
    }),
  });
  WS.regionReady = REGION.ready;
  WS.closeupReady = CLOSEUP.ready;

  function defineLevel(cfg) {
  const L = cfg.level;
  WS.defineStep({
    id: cfg.key, title: cfg.title, code: cfg.code, strip: cfg.strip, blurb: cfg.blurb, lede: cfg.lede,
    build(ctx) {
      const u = (ctx.ui[cfg.key] = ctx.ui[cfg.key] || { layer: 'relief', rivers: true, grid: true, zoom: 1, cx: 0.5, cy: 0.5 });
      const host = h('div', { class: 'scene-host' }), hint = h('div', { class: 'scene-status mono' });
      const bar = h('div', { class: 'map-bar' }), whereHost = h('div'), statsHost = h('div'), keyHost = h('div'), expHost = h('div');
      const ovHost = h('div', { class: 'scene-host' });
      const el = h('div', { class: 'stack-gap' },
        panel(cfg.title, { ticks: true, tag: cfg.tag, flush: true }, bar, host, h('div', { class: 'viz-caption' }, hint)),
        h('div', { class: 'grid two' },
          h('div', { class: 'stack-gap' }, panel('Where', { tag: cfg.pickerTag, flush: true }, ovHost, h('div', { style: { padding: '12px 14px' } }, whereHost)), statsHost),
          h('div', { class: 'stack-gap' }, keyHost, panel('Take it away', { tag: 'EXPORT' }, expHost))));
      const cv = h('canvas', { class: 'scene-canvas', tabindex: 0, role: 'img', 'aria-label': cfg.title });
      host.appendChild(cv);
      const ov = h('canvas', { class: 'scene-canvas', role: 'img', 'aria-label': `${cfg.pickerName}: click to place the ${cfg.noun}` });
      ovHost.appendChild(ov);
      const g = cv.getContext('2d'), og = ov.getContext('2d');
      let reg = null, regFor = null, off = null, busy = false, worldImg = null, worldFor = null, err = null;

      // ── building ──
      function ensure() {
        const w = ctx.world, d = ctx.d;
        if (!w.plates.features.some((f) => f.kind === 'crust')) { reg = null; return; }
        if (busy) return;
        busy = true; err = null;
        const t0 = performance.now();
        const slow = setTimeout(() => { hint.textContent = cfg.working; draw(); }, 60);
        L.ready(w, d).then((c) => {
          clearTimeout(slow); busy = false;
          if (!host.isConnected || !c) return;
          const again = c !== regFor;
          reg = c.region; regFor = c;
          if (again) { paint(); renderStats(); renderKey(); renderWhere(); paintWorld(); hint.textContent = `${reg.W} × ${reg.H} pixels, ${fmt.num(reg.frame.pxKm, 2)} km each · ${fmt.int(performance.now() - t0)} ms`; }
          draw(); drawWorld();
          if (again) WS.app.refresh();                         // (the checks can read the region now)
          // (the window may have moved while this was built: build again if so)
          if (JSON.stringify(L.settingsOf(ctx.world, c.parent)) !== c.key) ensure();
        }, (e) => { clearTimeout(slow); busy = false; err = e; hint.textContent = `Could not build the ${cfg.noun}: ${e.message}`; draw(); });
      }

      /* RGBA for every pixel: the layer's colour, lit from the north-west (with a little exaggeration). */
      function paint() {
        if (!reg) return;
        const { W, H, z, lake, biome } = reg, f = reg.planet?.factor ?? 1, px = new Uint8ClampedArray(W * H * 4);
        const m = reg.frame.pxKm * 1000, ve = clamp(1.2 + reg.frame.pxKm * 0.6, 1.5, 4);
        const L = [-0.55, 0.55, 0.63], flat = L[2];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const k = y * W + x, v = z[k];
          let c;
          if (v <= 0) c = ramp(SEA, -v);
          else if (lake[k]) c = lake[k] === 1 ? FRESH : SALT;
          else if (u.layer === 'biomes') c = biome[k] ? hex(B.BIOMES[biome[k] - 1][2]) : ICE;
          else c = biome[k] === B.BI.ice ? ICE : ramp(LAND, v * f);
          if (v > 0 && !lake[k]) {
            const e = Math.max(0, z[y * W + Math.min(W - 1, x + 1)]), wv = Math.max(0, z[y * W + Math.max(0, x - 1)]), n = Math.max(0, z[Math.max(0, y - 1) * W + x]), s = Math.max(0, z[Math.min(H - 1, y + 1) * W + x]);
            const gx = ((e - wv) / (2 * m)) * ve, gy = ((n - s) / (2 * m)) * ve, len = Math.hypot(gx, gy, 1);
            const lit = (-gx * L[0] + gy * -L[1] + L[2]) / len;
            const sh = clamp((0.3 + 0.95 * lit) / (0.3 + 0.95 * flat), 0.45, 1.3);
            c = [c[0] * sh, c[1] * sh, c[2] * sh];
          }
          const o = k * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
        }
        off = h('canvas'); off.width = W; off.height = H; off.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0);
      }

      // ── the closer map: zoom and pan ──
      const fit = () => {
        const w = host.clientWidth || 700, hh = Math.round(Math.min(w, Math.max(320, window.innerHeight * 0.78)));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.style.height = `${hh}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
        const ow = ovHost.clientWidth || 400, oh = Math.round(ow / 2);
        ov.style.height = `${oh}px`; ov.width = Math.round(ow * dpr); ov.height = Math.round(oh * dpr);
        draw(); drawWorld();
      };
      const ro = new ResizeObserver(fit);
      /* The view: the region's square, scaled to fit the canvas times the zoom, centred on (cx, cy) of it. */
      const view = () => {
        const side = Math.min(cv.width, cv.height) * u.zoom;
        return { side, x0: cv.width / 2 - u.cx * side, y0: cv.height / 2 - u.cy * side };
      };
      const clampView = () => {
        u.zoom = clamp(u.zoom, 1, 8);
        const v = view(), hx = cv.width / 2 / v.side, hy = cv.height / 2 / v.side;
        u.cx = hx >= 0.5 ? 0.5 : clamp(u.cx, hx, 1 - hx); u.cy = hy >= 0.5 ? 0.5 : clamp(u.cy, hy, 1 - hy);
      };
      function draw() {
        if (!cv.width) return;
        g.fillStyle = css('--bg'); g.fillRect(0, 0, cv.width, cv.height);
        if (!reg || !off) {
          g.fillStyle = css('--muted'); g.font = `${16 * (cv.width / Math.max(1, cv.clientWidth))}px ${css('--font-mono') || 'monospace'}`;
          g.fillText(err ? `Could not build the ${cfg.noun}.` : busy ? `Building the ${cfg.noun}…` : 'Make a world on the Plates step first.', 20, 40);
          return;
        }
        clampView();
        const v = view(), sc = v.side / reg.W;
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(off, v.x0, v.y0, v.side, v.side);
        const dpr = cv.width / Math.max(1, cv.clientWidth);
        if (u.rivers) drawRivers(g, (x, y) => [v.x0 + x * sc, v.y0 + y * sc], dpr * clamp(0.8 + 0.3 * Math.log2(Math.max(1, sc)), 0.8, 1.8), sc);
        if (u.grid) drawGrid(g, v, dpr);
        drawScale(g, v, dpr);
      }
      /*
       * Rivers as lines thin enough to read as rivers: a hairline for a brook, growing slowly with the
       * flow (a tenfold flow, about a quarter of a pixel more): a river of thousands of m³/s is drawn
       * about twice as wide as a brook, never more than 2 pixels (times the zoom's scale). Each river is one stroke, in runs of nearly even width, so joints show
       * no beads.
       */
      // (the drawn line, or the channel's true width, ≈ 2.7·√Q m, where that is wider: a big river seen
      // close up is a ribbon; sc is screen pixels a map pixel)
      const riverWidth = (q, scale, sc = 1) => Math.max(scale * R.riverWidth(q, reg.minFlow), (sc * 2.7 * Math.sqrt(Math.max(0, q))) / 1000 / reg.frame.pxKm);
      function drawRivers(gg, proj, scale, sc = 1) {
        gg.lineCap = 'round'; gg.lineJoin = 'round';
        // oxbow lakes first: the cut-off loops, as wide as the river that left them
        gg.strokeStyle = OXBOW;
        for (const ob of reg.oxbows || []) {
          gg.lineWidth = Math.max(scale * ob.w * 0.9, sc * ob.wTrue * 0.9);
          gg.beginPath();
          ob.pts.forEach((pt, i) => { const p = proj(pt[0], pt[1]); if (i) gg.lineTo(p[0], p[1]); else gg.moveTo(p[0], p[1]); });
          gg.stroke();
        }
        gg.strokeStyle = RIVER;
        const minQ = reg.minFlow * (sc < 0.6 ? 4 : sc < 1.2 ? 2 : 1);    // (fewer brooks when zoomed out)
        for (const rv of reg.rivers) {
          if (rv.q[rv.q.length - 1] < minQ) continue;
          let i = 0;
          while (i < rv.pts.length - 1 && rv.q[i] < minQ) i++;
          while (i < rv.pts.length - 1) {
            const w0 = riverWidth(rv.q[i], scale, sc);
            gg.lineWidth = w0; gg.beginPath();
            let p = proj(rv.pts[i][0], rv.pts[i][1]); gg.moveTo(p[0], p[1]);
            let j = i + 1;
            for (; j < rv.pts.length; j++) {
              p = proj(rv.pts[j][0], rv.pts[j][1]); gg.lineTo(p[0], p[1]);
              if (Math.abs(riverWidth(rv.q[j], scale, sc) - w0) > 0.15 * scale) break;
            }
            gg.stroke();
            i = j;
          }
        }
        // braided reaches over them: a bed of bare gravel, and the channels weaving across it
        for (const br of reg.braids || []) {
          gg.strokeStyle = GRAVEL;
          for (let k = 1; k < br.pts.length; k++) {
            const a = proj(br.pts[k - 1][0], br.pts[k - 1][1]), b = proj(br.pts[k][0], br.pts[k][1]);
            gg.lineWidth = Math.max(scale, sc * br.band[k]); gg.beginPath(); gg.moveTo(a[0], a[1]); gg.lineTo(b[0], b[1]); gg.stroke();
          }
          gg.strokeStyle = RIVER; gg.lineWidth = Math.max(0.5 * scale, sc * br.wStrand);
          for (const st of br.strands) { gg.beginPath(); st.forEach((pt, k) => { const p = proj(pt[0], pt[1]); if (k) gg.lineTo(p[0], p[1]); else gg.moveTo(p[0], p[1]); }); gg.stroke(); }
        }
      }
      /* Lines of latitude and longitude at a round step, labelled at the edges. */
      function drawGrid(gg, v, dpr) {
        const fr = reg.frame, degPx = v.side / fr.dLat, want = 140 * dpr / degPx;
        const step = [0.01, 0.02, 0.025, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30].find((s) => s >= want) || 30;
        gg.save();
        gg.strokeStyle = 'rgba(20, 20, 20, 0.28)'; gg.lineWidth = dpr; gg.fillStyle = 'rgba(20, 20, 20, 0.75)';
        gg.font = `${11 * dpr}px ${css('--font-mono') || 'monospace'}`;
        const lab = (t, x, y) => { gg.save(); gg.fillStyle = 'rgba(255,255,255,0.75)'; const w = gg.measureText(t).width; gg.fillRect(x - 2 * dpr, y - 11 * dpr, w + 4 * dpr, 14 * dpr); gg.restore(); gg.fillText(t, x, y); };
        const deg = (a, pos, neg) => `${fmt.num(Math.abs(a), step < 0.1 ? 2 : step < 1 ? (step < 0.25 ? 1 : 2) : 0)}°${a >= 0 ? pos : neg}`;
        for (let la = Math.ceil(fr.south / step) * step; la <= fr.north; la += step) {
          const y = v.y0 + ((fr.north - la) / fr.dLat) * v.side;
          if (y < 0 || y > cv.height) continue;
          gg.beginPath(); gg.moveTo(Math.max(0, v.x0), y); gg.lineTo(Math.min(cv.width, v.x0 + v.side), y); gg.stroke();
          lab(deg(la, 'N', 'S'), Math.max(0, v.x0) + 4 * dpr, y - 3 * dpr);
        }
        for (let lo = Math.ceil(fr.west / step) * step; lo <= fr.east; lo += step) {
          const x = v.x0 + ((lo - fr.west) / fr.dLon) * v.side;
          if (x < 0 || x > cv.width) continue;
          gg.beginPath(); gg.moveTo(x, Math.max(0, v.y0)); gg.lineTo(x, Math.min(cv.height, v.y0 + v.side)); gg.stroke();
          const l = ((lo + 540) % 360) - 180;
          lab(deg(l, 'E', 'W'), x + 4 * dpr, Math.min(cv.height, v.y0 + v.side) - 6 * dpr);
        }
        gg.restore();
      }
      function drawScale(gg, v, dpr) {
        const kmPx = reg.frame.span / v.side, want = kmPx * 160 * dpr;
        const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000].reduce((a, b) => (b <= want ? b : a), 1);
        const len = nice / kmPx, x = cv.width - len - 16 * dpr, y = 18 * dpr;
        gg.save();
        gg.fillStyle = 'rgba(255,255,255,0.8)'; gg.fillRect(x - 8 * dpr, y - 12 * dpr, len + 16 * dpr, 28 * dpr);
        gg.strokeStyle = '#222'; gg.lineWidth = 2 * dpr;
        gg.beginPath(); gg.moveTo(x, y + 6 * dpr); gg.lineTo(x, y + 10 * dpr); gg.lineTo(x + len, y + 10 * dpr); gg.lineTo(x + len, y + 6 * dpr); gg.stroke();
        gg.fillStyle = '#222'; gg.font = `${11 * dpr}px ${css('--font-mono') || 'monospace'}`; gg.textAlign = 'center';
        gg.fillText(`${fmt.int(nice)} km`, x + len / 2, y + 3 * dpr);
        gg.restore();
      }

      // pointer: drag to pan, wheel or buttons to zoom, hover to read a place
      const toRegion = (e) => {
        const r = cv.getBoundingClientRect(), dpr = cv.width / r.width, v = view();
        return [((e.clientX - r.left) * dpr - v.x0) / v.side * reg.W, ((e.clientY - r.top) * dpr - v.y0) / v.side * reg.H];
      };
      let drag = null;
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); drag = { x: e.clientX, y: e.clientY, cx: u.cx, cy: u.cy }; cv.style.cursor = 'grabbing'; });
      cv.addEventListener('pointermove', (e) => {
        if (drag) {
          const v = view(), dpr = cv.width / Math.max(1, cv.clientWidth);
          u.cx = drag.cx - ((e.clientX - drag.x) * dpr) / v.side; u.cy = drag.cy - ((e.clientY - drag.y) * dpr) / v.side;
          draw(); drawWorld();
          return;
        }
        if (!reg) return;
        const [x, y] = toRegion(e);
        if (x < 0 || y < 0 || x >= reg.W || y >= reg.H) return;
        const k = Math.floor(y) * reg.W + Math.floor(x), z = reg.z[k], [la, lo] = R.latLonOf(reg, x, y);
        const parts = [`${fmt.num(la, 2)}°, ${fmt.num(lo, 2)}°`];
        if (z <= 0) parts.push(`sea, ${fmt.int(-z)} m deep`);
        else {
          parts.push(`${fmt.int(z)} m`);
          parts.push(reg.lake[k] ? (reg.lake[k] === 1 ? 'fresh lake' : 'salt lake') : B.BIOMES[reg.biome[k] - 1]?.[1] || '');
          if (reg.flow[k] >= reg.minFlow) parts.push(`${fmt.int(reg.flow[k])} m³/s`);
          if (reg.cut[k] > 20) parts.push(`valley cut ${fmt.int(reg.cut[k])} m`);
        }
        hint.textContent = parts.join(' · ');
      });
      const end = () => { drag = null; cv.style.cursor = 'grab'; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      const zoomAt = (factor, px, py) => {
        const v = view(), ax = (px - v.x0) / v.side, ay = (py - v.y0) / v.side, z0 = u.zoom;
        u.zoom = clamp(u.zoom * factor, 1, 8);
        const s = u.zoom / z0;
        u.cx = ax - (ax - u.cx) / s; u.cy = ay - (ay - u.cy) / s;
        draw(); drawWorld(); renderBar();
      };
      cv.addEventListener('wheel', (e) => {
        e.preventDefault();
        const r = cv.getBoundingClientRect(), dpr = cv.width / r.width;
        zoomAt(Math.exp(-e.deltaY * 0.0015), (e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr);
      }, { passive: false });
      cv.style.touchAction = 'none'; cv.style.cursor = 'grab';

      // ── the map it is cut from, to pick the place ──
      // (its frame: degrees to the picker's pixels; the world map wraps round, a region does not)
      const pk = () => regFor && regFor.parent.picker;
      const toPick = (la, lo) => {
        const f = pk().frame; let d = lo - f.west;
        if (pk().wrap) d = ((d % 360) + 360) % 360;
        return [(d / f.dLon) * ov.width, ((f.north - la) / f.dLat) * ov.height];
      };
      function paintWorld() {
        const p = pk();
        if (!p || worldFor === p.z) return;
        const f = p.factor, px = new Uint8ClampedArray(p.W * p.H * 4);
        for (let k = 0; k < p.W * p.H; k++) {
          const v = p.z[k], col = v <= 0 ? ramp(SEA, -v) : p.lake && p.lake[k] ? FRESH : ramp(LAND, v * f);
          px[k * 4] = col[0]; px[k * 4 + 1] = col[1]; px[k * 4 + 2] = col[2]; px[k * 4 + 3] = 255;
        }
        worldImg = h('canvas'); worldImg.width = p.W; worldImg.height = p.H; worldImg.getContext('2d').putImageData(new ImageData(px, p.W, p.H), 0, 0);
        worldFor = p.z;
      }
      function drawWorld() {
        if (!ov.width) return;
        og.fillStyle = css('--bg'); og.fillRect(0, 0, ov.width, ov.height);
        if (!worldImg) return;
        og.imageSmoothingEnabled = true; og.drawImage(worldImg, 0, 0, ov.width, ov.height);
        const p = pk(), dpr = ov.width / Math.max(1, ov.clientWidth);
        // the parent's rivers, lightly (a close-up is placed on them)
        if (p.rivers) {
          og.strokeStyle = 'rgba(36, 92, 172, 0.8)'; og.lineWidth = dpr; og.lineJoin = 'round';
          const sx = ov.width / p.W, sy = ov.height / p.H;
          for (const rv of p.rivers) { og.beginPath(); rv.pts.forEach((q, i) => (i ? og.lineTo(q[0] * sx, q[1] * sy) : og.moveTo(q[0] * sx, q[1] * sy))); og.stroke(); }
        }
        if (!reg) return;
        const fr = reg.frame;
        const box = (w0, n0, w1, s1, colour, lw) => {
          og.strokeStyle = colour; og.lineWidth = lw * dpr;
          const [x0, y0] = toPick(n0, w0), wpx = ((w1 - w0) / p.frame.dLon) * ov.width, hpx = ((n0 - s1) / p.frame.dLat) * ov.height;
          for (const shift of p.wrap ? [-ov.width, 0, ov.width] : [0]) og.strokeRect(x0 + shift, y0, wpx, hpx);
        };
        box(fr.west, fr.north, fr.east, fr.south, 'rgba(0,0,0,0.65)', 3);
        box(fr.west, fr.north, fr.east, fr.south, '#ffb238', 1.5);
        // what the closer map shows now, when zoomed in
        if (u.zoom > 1.01) {
          const v = view(), a = R.latLonOf(reg, (-v.x0 / v.side) * reg.W, (-v.y0 / v.side) * reg.H), b = R.latLonOf(reg, ((cv.width - v.x0) / v.side) * reg.W, ((cv.height - v.y0) / v.side) * reg.H);
          let bw = b[1]; if (bw < a[1]) bw += 360;
          box(a[1], a[0], bw, b[0], '#ffffff', 1);
        }
      }
      ov.addEventListener('click', (e) => {
        const p = pk(); if (!p) return;
        const r = ov.getBoundingClientRect(), f = p.frame;
        const la = f.north - ((e.clientY - r.top) / r.height) * f.dLat, lo = ((((f.west + ((e.clientX - r.left) / r.width) * f.dLon) + 540) % 360) + 360) % 360 - 180;
        u.zoom = 1; u.cx = 0.5; u.cy = 0.5;
        ctx.mutate((w) => { w[cfg.key].lat = +la.toFixed(4); w[cfg.key].lon = +lo.toFixed(4); });
      });
      ov.style.cursor = 'crosshair';

      // ── panels ──
      function renderBar() {
        const layerTabs = tabs(LAYERS, u.layer, (v) => { u.layer = v; paint(); draw(); renderBar(); renderKey(); });
        const chk = (key, label, after) => { const b = h('input', { type: 'checkbox', checked: u[key] }); b.addEventListener('change', () => { u[key] = b.checked; (after || draw)(); }); return h('label', { class: 'check' }, b, label); };
        replace(bar, layerTabs, chk('rivers', 'Rivers'), chk('grid', 'Grid'),
          h('span', { class: 'btn-row', style: { marginLeft: 'auto' } },
            h('button', { class: 'btn small', type: 'button', 'aria-label': 'Zoom out', disabled: u.zoom <= 1, onclick: () => zoomAt(1 / 1.6, cv.width / 2, cv.height / 2) }, '−'),
            h('span', { class: 'mono muted', style: { minWidth: '3.5em', textAlign: 'center', alignSelf: 'center' } }, `×${fmt.num(u.zoom, 1)}`),
            h('button', { class: 'btn small', type: 'button', 'aria-label': 'Zoom in', disabled: u.zoom >= 8, onclick: () => zoomAt(1.6, cv.width / 2, cv.height / 2) }, '+')));
      }
      function renderWhere() {
        const w = ctx.world, ws = w[cfg.key], r0 = reg ? regFor.settings : { lat: 0, lon: 0 }, pSpan = regFor ? regFor.parent.span : Infinity;
        const s = { lat: ws.lat ?? r0.lat, lon: ws.lon ?? r0.lon, span: reg ? regFor.settings.span : ws.span, res: ws.res };
        const num = (key, label, min, max, value) => {
          const i = h('input', { class: 'txt num', type: 'number', min, max, step: cfg.step, value: +value.toFixed(4), 'aria-label': label });
          i.addEventListener('change', () => { const v = Number(i.value); if (!Number.isFinite(v)) return; u.zoom = 1; ctx.mutate((ww) => { ww[cfg.key].lat = key === 'lat' ? clamp(v, -85, 85) : s.lat; ww[cfg.key].lon = key === 'lon' ? ((((v + 180) % 360) + 360) % 360) - 180 : s.lon; }); });
          return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), i);
        };
        const sel = (path, label, items, value, tip) => {
          const el2 = h('select', { class: 'sel', 'aria-label': label }, items.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
          el2.addEventListener('change', () => { u.zoom = 1; ctx.set(path, Number(el2.value)); });
          return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, info(tip)), el2);
        };
        const cellKm = reg ? reg.stats.worldCellKm : null;
        const spans = cfg.spans.filter(([v]) => v <= pSpan * (cfg.key === 'closeup' ? 0.5 : 1) || v === cfg.spans[0][0]);
        replace(whereHost,
          h('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 10px' } }, cfg.pickText),
          h('div', { class: 'auto-grid' },
            num('lat', 'Centre latitude, °', -85, 85, s.lat), num('lon', 'Centre longitude, °', -180, 180, s.lon),
            sel(`${cfg.key}.span`, 'Across', spans, s.span, `How far the ${cfg.noun} reaches, east to west and north to south.${cellKm ? ` A cell of ${cfg.sourceName} is about ${cellKm < 1 ? `${fmt.int(cellKm * 1000)} m` : `${fmt.int(cellKm)} km`} across here; the ${cfg.noun} adds the detail below that.` : ''}`),
            sel(`${cfg.key}.res`, 'Detail', RES, s.res, `Pixels across the ${cfg.noun}. Finer takes longer: 2048 can take half a minute.`)),
          ws.lat != null ? h('div', { class: 'btn-row', style: { marginTop: '10px' } }, h('button', { class: 'btn small', type: 'button', onclick: () => { u.zoom = 1; ctx.mutate((ww) => { ww[cfg.key].lat = null; ww[cfg.key].lon = null; }); } }, cfg.backText)) : null);
      }
      function renderStats() {
        if (!reg) { replace(statsHost); return; }
        const s = reg.stats, k = (n) => fmt.int(n);
        const rows = [
          ['Across', `${k(reg.frame.span)} km`, `${s.pxKm < 1 ? `${k(s.pxKm * 1000)} m` : `${fmt.num(s.pxKm, 2)} km`} a pixel · ${cfg.sourceName}: ${s.worldCellKm < 1 ? `${k(s.worldCellKm * 1000)} m` : `${k(s.worldCellKm)} km`}`],
          ['Land', `${k(s.land * 100)} %`, `${k(s.landKm2)} km²`],
          ['Highest point', `${k(s.highest.m)} m`, `${fmt.num(s.highest.at[0], 2)}°, ${fmt.num(s.highest.at[1], 2)}°`],
          ['Rivers', `${k(s.rivers)}`, `${reg.oxbows && reg.oxbows.length ? `${k(reg.oxbows.length)} oxbow lakes · ` : ''}from ${fmt.num(reg.minFlow, reg.minFlow < 1 ? 1 : 0)} m³/s · ${reg.inflows.length ? `${k(reg.inflows.length)} enter from outside` : 'all rise here'}`],
          ['Largest river', s.biggest ? `${k(s.biggest.q)} m³/s` : '—', s.biggest ? `leaves at ${fmt.num(s.biggest.at[0], 2)}°, ${fmt.num(s.biggest.at[1], 2)}°` : `no river leaves the ${cfg.noun}`],
          ['Lakes', `${k(s.lakes)}`, `${k(s.saltLakes)} of them salt · ${k(s.lakeKm2)} km²`],
          ['Deepest valley', `${k(s.deepestCut)} m`, `cut by its river into ${cfg.sourceName}’s land`],
        ];
        replace(statsHost, h('div', { class: 'readouts' }, rows.map(([l, v, sub]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l), h('div', { class: 'val' }, v), h('div', { class: 'sub' }, sub)))));
      }
      function renderKey() {
        const sw = (c) => h('i', { style: { display: 'inline-block', width: '22px', height: '10px', background: `rgb(${c.map(Math.round).join(',')})`, verticalAlign: 'middle', marginRight: '6px' } });
        let items;
        if (u.layer === 'biomes' && reg) {
          const order = reg.stats.biomeShare.map((v, i) => [i, v]).filter(([, v]) => v > 0.001).sort((a, b) => b[1] - a[1]);
          items = order.map(([i, v]) => [hex(B.BIOMES[i][2]), `${B.BIOMES[i][1]} ${v < 0.01 ? '<1' : fmt.int(v * 100)} %`]);
        } else {
          const f = reg ? reg.planet?.factor ?? 1 : 1;
          items = [[SEA[6][1], 'deep sea'], [SEA[3][1], 'slope'], [SEA[0][1], 'shallows'], ...[0, 200, 500, 1000, 2000, 3500, 5000].map((m) => [ramp(LAND, m), `${fmt.int(m / f)} m`]), [ICE, 'ice']];
        }
        items.push([FRESH, 'fresh lake'], [SALT, 'salt lake']);
        if (reg && reg.oxbows && reg.oxbows.length) items.push([hex('#5892c4'), 'oxbow lake']);
        if (reg && reg.braids && reg.braids.length) items.push([[214, 204, 178], 'gravel bed (braided river)']);
        replace(keyHost, panel('Key', { tag: LAYERS.find((l) => l[0] === u.layer)[1].toUpperCase() }, h('div', { class: 'map-key mono', style: { marginLeft: 0 } }, items.map(([c, t]) => h('span', null, sw(c), t)),
          h('span', null, h('i', { style: { display: 'inline-block', width: '22px', height: '3px', background: RIVER, verticalAlign: 'middle', marginRight: '6px' } }), `river (from ${reg ? fmt.num(reg.minFlow, reg.minFlow < 1 ? 1 : 0) : 8} m³/s)`))));
      }
      const fileName = (what, ext) => `${(ctx.world.name || 'world').replace(/[^\w-]+/g, '_')}-${cfg.key}-${what}.${ext}`;
      const save = (blob, name) => { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
      function exportPng() {
        if (!off) return;
        const F = reg.W < 1500 ? 2 : 1, big = h('canvas'); big.width = reg.W * F; big.height = reg.H * F;
        const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false; bg.drawImage(off, 0, 0, big.width, big.height);
        if (u.rivers) drawRivers(bg, (x, y) => [x * F, y * F], F * 0.7, F);
        big.toBlob((b) => save(b, fileName(u.layer, 'png')));
      }
      async function exportHeight() {
        const lo = Math.floor(reg.stats.deepest.m), hi = Math.ceil(reg.stats.highest.m), span = Math.max(1, hi - lo), v = new Uint16Array(reg.z.length);
        for (let k = 0; k < v.length; k++) v[k] = Math.round(((reg.z[k] - lo) / span) * 65535);
        const blob = await WS.drawkit.png16(reg.W, reg.H, v);
        save(blob, fileName(`height_${lo}m_to_${hi}m_sea_${Math.round((-lo / span) * 65535)}`, 'png'));
        toast(`Heightmap: 0 = ${fmt.int(lo)} m, 65535 = ${fmt.int(hi)} m`);
      }
      function exportSvg() {
        const f2 = (x) => Math.round(x * 10) / 10, fr = reg.frame;
        const lines = reg.rivers.map((rv) => {
          const q = rv.q.reduce((a, b) => Math.max(a, b), 0);
          return `<polyline points="${rv.pts.map(([x, y]) => `${f2(x)},${f2(y)}`).join(' ')}" stroke-width="${f2(R.riverWidth(q, reg.minFlow))}" data-flow="${Math.round(q)}"/>`;
        });
        const bed = (reg.braids || []).map((br) => `<polyline points="${br.pts.map(([x, y]) => `${f2(x)},${f2(y)}`).join(' ')}" stroke-width="${f2(br.band.reduce((a, b) => Math.max(a, b), 0))}"/>`);
        const strands = (reg.braids || []).flatMap((br) => br.strands.map((st) => `<polyline points="${st.map(([x, y]) => `${f2(x)},${f2(y)}`).join(' ')}" stroke-width="${f2(br.wStrand)}"/>`));
        const ox = (reg.oxbows || []).map((ob) => `<polyline points="${ob.pts.map(([x, y]) => `${f2(x)},${f2(y)}`).join(' ')}" stroke-width="${f2(Math.max(ob.w, ob.wTrue))}"/>`);
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${reg.W} ${reg.H}" width="${reg.W}" height="${reg.H}">\n<!-- ${fmt.num(fr.north, 4)}N to ${fmt.num(fr.south, 4)}, ${fmt.num(fr.west, 4)} to ${fmt.num(fr.east, 4)} (degrees, equirectangular); ${fmt.num(fr.pxKm, 4)} km a pixel at the centre -->\n<g id="oxbows" fill="none" stroke="#5892c4" stroke-linecap="round" stroke-linejoin="round">\n${ox.join('\n')}\n</g>\n<g id="rivers" fill="none" stroke="#245cac" stroke-linecap="round" stroke-linejoin="round">\n${lines.join('\n')}\n</g>\n<g id="gravel-beds" fill="none" stroke="#d6ccb2" stroke-linecap="round" stroke-linejoin="round">\n${bed.join('\n')}\n</g>\n<g id="braids" fill="none" stroke="#245cac" stroke-linecap="round" stroke-linejoin="round">\n${strands.join('\n')}\n</g>\n</svg>\n`;
        save(new Blob([svg], { type: 'image/svg+xml' }), fileName('rivers', 'svg'));
      }
      function renderExport() {
        replace(expHost,
          h('p', { class: 'muted', style: { fontSize: '13px', marginBottom: '10px' } }, `At the ${cfg.noun}’s full detail, in the same frame, so they stack in an image editor.`),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn small primary', type: 'button', disabled: !reg, onclick: exportPng }, 'This map (PNG)'),
            h('button', { class: 'btn small', type: 'button', disabled: !reg, onclick: exportHeight }, 'Heightmap (16-bit PNG)'),
            h('button', { class: 'btn small', type: 'button', disabled: !reg, onclick: exportSvg }, 'Rivers (SVG)')));
      }

      return {
        el,
        update() {
          if (!ro._on) { ro.observe(host); ro.observe(ovHost); ro._on = true; }
          renderBar(); renderKey(); renderWhere(); renderExport();
          ensure();
          renderStats(); fit();
        },
        destroy() { ro.disconnect(); },
      };
    },
    checks(w) {
      if (!w.plates.features.some((f) => f.kind === 'crust')) return [{ level: 'info', text: 'No continents yet: make a world on the Plates step.' }];
      const c = L.peek();
      if (!c) return [{ level: 'info', text: `Open this step to build the ${cfg.noun}.` }];
      const s = c.region.stats, px = s.pxKm < 1 ? `${fmt.int(s.pxKm * 1000)} m` : `${fmt.num(s.pxKm, 2)} km`;
      return [{ level: 'ok', text: `${fmt.int(c.region.frame.span)} km across at ${px} a pixel: ${fmt.int(s.rivers)} rivers, ${fmt.int(s.lakes)} lakes${c.region.oxbows && c.region.oxbows.length ? `, ${fmt.int(c.region.oxbows.length)} oxbow lakes` : ''}.` }];
    },
  });
  }

  defineLevel({
    level: REGION, key: 'region', title: 'Region', code: '00_SURFACE/REGION', strip: 'A closer map', tag: 'CLOSER', noun: 'region',
    blurb: 'A closer map of one part of the world: valleys, lakes and every stream, agreeing with the world map.',
    lede: ['A closer look at one part of the world, some hundreds of km across: the world map’s land with the detail it is too coarse to hold, rivers down to brooks, lakes, valleys, meanders on the plains, and the biomes changing with height. Pick the place on the world map below; zoom and pan the map above. For closer still, the Close-up step.'],
    pickerTag: 'WORLD MAP', pickerName: 'World map', sourceName: 'the world map', step: 0.1,
    spans: [[200, '200 km'], [400, '400 km'], [800, '800 km'], [1600, '1 600 km'], [3200, '3 200 km']],
    pickText: 'Click the world map to centre the region there.', backText: 'Back to the largest river’s mouth',
    working: 'Working out the world map, its climate, then the region…',
  });
  defineLevel({
    level: CLOSEUP, key: 'closeup', title: 'Close-up', code: '00_SURFACE/CLOSE_UP', strip: 'Closer still', tag: 'CLOSEST', noun: 'close-up',
    blurb: 'Part of the Region, closer still: tens of metres a pixel, rivers wide as they are, meanders and oxbow lakes.',
    lede: ['Part of the Region, a few tens of km across at tens of metres a pixel, cut from it as the Region is cut from the world map, and agreeing with it: its land with finer detail still, every stream, and big rivers as wide as they really are, meandering over their floodplains and leaving oxbow lakes. Pick the place on the Region below.'],
    pickerTag: 'REGION', pickerName: 'Region', sourceName: 'the region', step: 0.01,
    spans: [[10, '10 km'], [25, '25 km'], [50, '50 km'], [100, '100 km'], [200, '200 km']],
    pickText: 'Click the region to centre the close-up there.', backText: 'Back to the region’s largest river',
    working: 'Working out the world map, the region, then the close-up…',
  });
})();
