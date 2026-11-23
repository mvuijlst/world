/*
 * Region: a closer map of part of the World map, at a few hundred metres to a few km a pixel, that
 * agrees with it (region.js): its heights with finer detail, its own drainage, valleys, lakes, rivers
 * and biomes from the same climate. Pick the place on the world map; zoom and pan the closer map.
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
  const SPANS = [[200, '200 km'], [400, '400 km'], [800, '800 km'], [1600, '1 600 km'], [3200, '3 200 km']];
  const RES = [[512, 'Quick · 512'], [1024, 'Fine · 1024'], [2048, 'Finest · 2048 (slow)']];
  const LAYERS = [['relief', 'Relief'], ['biomes', 'Biomes']];

  // ── the region of a world, kept while its map, climate and window stay the same ──
  let cached = null, building = null, nextId = 1, worker = null;
  const pending = new Map();
  try {
    if (location.protocol !== 'file:' && typeof Worker !== 'undefined') {
      worker = new Worker('js/regionworker.js');
      worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.region); } };
      worker.onerror = () => { worker = null; for (const p of pending.values()) p.reject(new Error('worker failed')); pending.clear(); };
    }
  } catch { worker = null; }

  /* Where the window goes when none is set: the mouth of the largest river away from the poles, else the highest point. */
  function defaultCentre(map) {
    const W = map.W, ml = map.rivers && map.rivers.mouthList ? map.rivers.mouthList.filter((m) => m.from >= 0) : [];
    for (const m of ml) {
      const j = Math.floor(m.from / W), la = map.grid.lat[j], lo = -180 + ((m.from % W) + 0.5) * (360 / W);
      if (Math.abs(la) < 60) return [la, lo];
    }
    return map.highest.at;
  }
  const settingsOf = (w, map) => {
    const r = w.region || {}, c = r.lat == null || r.lon == null ? defaultCentre(map) : [r.lat, r.lon];
    return { lat: c[0], lon: c[1], span: r.span || 800, res: r.res || 1024, seed: w.plates.seed ?? 1, erosion: w.map.erosion ?? 1 };
  };

  /* The region (a promise): the world map and its climate first, then the window, in a worker. */
  WS.regionReady = (w, d) => WS.climateReady(w, d).then((c) => {
    if (!c) return null;
    const map = c.mapRef.map, s = settingsOf(w, map), key = JSON.stringify(s);
    if (cached && cached.mapRef === c.mapRef && cached.strokes === c.mapRef.strokes && cached.key === key) return cached;
    if (building && building.mapRef === c.mapRef && building.strokes === c.mapRef.strokes && building.key === key) return building.promise;
    const water = B.water(map, c.clim, B.planetOf(w, d));
    const lean = { W: map.W, H: map.H, z: map.z, planet: map.planet, rivers: map.rivers ? { recv: map.rivers.recv, discharge: map.rivers.discharge } : null };
    const inPage = () => new Promise((resolve) => setTimeout(() => resolve(R.build(lean, water, s)), 30));
    const viaWorker = () => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      const wt = { runoff: water.runoff, P: water.P, PET: water.PET, Tw: water.Tw, Tc: water.Tc, Ta: water.Ta, Pw: water.Pw, liquid: water.liquid, tBoil: water.tBoil };
      worker.postMessage({ id, map: lean, water: wt, opts: s });
    }).catch(() => R.build(lean, water, s));
    const me = { mapRef: c.mapRef, strokes: c.mapRef.strokes, key };
    me.promise = (worker ? viaWorker() : inPage()).then((region) => {
      if (building === me) building = null;
      const out = { mapRef: me.mapRef, strokes: me.strokes, key, region, settings: s };
      cached = out;
      return out;
    });
    building = me;
    return me.promise;
  });

  WS.defineStep({
    id: 'region', title: 'Region', code: '00_SURFACE/REGION', strip: 'A closer map',
    blurb: 'A closer map of one part of the world: valleys, lakes and every stream, agreeing with the world map.',
    lede: ['A closer look at one part of the world, some hundreds of km across: the world map’s land with the detail it is too coarse to hold, rivers down to brooks, lakes, valleys, and the biomes changing with height. Pick the place on the world map below; zoom and pan the map above.'],
    build(ctx) {
      const u = (ctx.ui.region = ctx.ui.region || { layer: 'relief', rivers: true, grid: true, zoom: 1, cx: 0.5, cy: 0.5 });
      const host = h('div', { class: 'scene-host' }), hint = h('div', { class: 'scene-status mono' });
      const bar = h('div', { class: 'map-bar' }), whereHost = h('div'), statsHost = h('div'), keyHost = h('div'), expHost = h('div');
      const ovHost = h('div', { class: 'scene-host' });
      const el = h('div', { class: 'stack-gap' },
        panel('Region', { ticks: true, tag: 'CLOSER', flush: true }, bar, host, h('div', { class: 'viz-caption' }, hint)),
        h('div', { class: 'grid two' },
          h('div', { class: 'stack-gap' }, panel('Where', { tag: 'WORLD MAP', flush: true }, ovHost, h('div', { style: { padding: '12px 14px' } }, whereHost)), statsHost),
          h('div', { class: 'stack-gap' }, keyHost, panel('Take it away', { tag: 'EXPORT' }, expHost))));
      const cv = h('canvas', { class: 'scene-canvas', tabindex: 0, role: 'img', 'aria-label': 'Closer map of a region' });
      host.appendChild(cv);
      const ov = h('canvas', { class: 'scene-canvas', role: 'img', 'aria-label': 'World map: click to place the region' });
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
        const slow = setTimeout(() => { hint.textContent = 'Working out the world map, its climate, then the region…'; draw(); }, 60);
        WS.regionReady(w, d).then((c) => {
          clearTimeout(slow); busy = false;
          if (!host.isConnected || !c) return;
          const again = c !== regFor;
          reg = c.region; regFor = c;
          if (again) { paint(); renderStats(); renderKey(); renderWhere(); paintWorld(); hint.textContent = `${reg.W} × ${reg.H} pixels, ${fmt.num(reg.frame.pxKm, 2)} km each · ${fmt.int(performance.now() - t0)} ms`; }
          draw(); drawWorld();
          if (again) WS.app.refresh();                         // (the checks can read the region now)
          // (the window may have moved while this was built: build again if so)
          if (JSON.stringify(settingsOf(ctx.world, c.mapRef.map)) !== c.key) ensure();
        }, (e) => { clearTimeout(slow); busy = false; err = e; hint.textContent = `Could not build the region: ${e.message}`; draw(); });
      }

      /* RGBA for every pixel: the layer's colour, lit from the north-west (with a little exaggeration). */
      function paint() {
        if (!reg) return;
        const { W, H, z, lake, biome } = reg, f = regFor.mapRef.map.planet?.factor ?? 1, px = new Uint8ClampedArray(W * H * 4);
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
          g.fillText(err ? 'Could not build the region.' : busy ? 'Building the region…' : 'Make a world on the Plates step first.', 20, 40);
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
      const riverWidth = (q, scale) => scale * R.riverWidth(q, reg.minFlow);
      function drawRivers(gg, proj, scale, sc = 1) {
        gg.strokeStyle = RIVER; gg.lineCap = 'round'; gg.lineJoin = 'round';
        const minQ = reg.minFlow * (sc < 0.6 ? 4 : sc < 1.2 ? 2 : 1);    // (fewer brooks when zoomed out)
        for (const rv of reg.rivers) {
          if (rv.q[rv.q.length - 1] < minQ) continue;
          let i = 0;
          while (i < rv.pts.length - 1 && rv.q[i] < minQ) i++;
          while (i < rv.pts.length - 1) {
            const w0 = riverWidth(rv.q[i], scale);
            gg.lineWidth = w0; gg.beginPath();
            let p = proj(rv.pts[i][0], rv.pts[i][1]); gg.moveTo(p[0], p[1]);
            let j = i + 1;
            for (; j < rv.pts.length; j++) {
              p = proj(rv.pts[j][0], rv.pts[j][1]); gg.lineTo(p[0], p[1]);
              if (Math.abs(riverWidth(rv.q[j], scale) - w0) > 0.15 * scale) break;
            }
            gg.stroke();
            i = j;
          }
        }
      }
      /* Lines of latitude and longitude at a round step, labelled at the edges. */
      function drawGrid(gg, v, dpr) {
        const fr = reg.frame, degPx = v.side / fr.dLat, want = 140 * dpr / degPx;
        const step = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30].find((s) => s >= want) || 30;
        gg.save();
        gg.strokeStyle = 'rgba(20, 20, 20, 0.28)'; gg.lineWidth = dpr; gg.fillStyle = 'rgba(20, 20, 20, 0.75)';
        gg.font = `${11 * dpr}px ${css('--font-mono') || 'monospace'}`;
        const lab = (t, x, y) => { gg.save(); gg.fillStyle = 'rgba(255,255,255,0.75)'; const w = gg.measureText(t).width; gg.fillRect(x - 2 * dpr, y - 11 * dpr, w + 4 * dpr, 14 * dpr); gg.restore(); gg.fillText(t, x, y); };
        const deg = (a, pos, neg) => `${fmt.num(Math.abs(a), step < 1 ? (step < 0.25 ? 1 : 2) : 0)}°${a >= 0 ? pos : neg}`;
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

      // ── the world map, to pick the place ──
      function paintWorld() {
        const c = regFor && regFor.mapRef;
        if (!c || worldFor === c.map) return;
        const map = c.map, f = map.planet?.factor ?? 1, px = new Uint8ClampedArray(map.W * map.H * 4);
        for (let k = 0; k < map.W * map.H; k++) { const v = map.z[k], col = v > 0 ? ramp(LAND, v * f) : ramp(SEA, -v); px[k * 4] = col[0]; px[k * 4 + 1] = col[1]; px[k * 4 + 2] = col[2]; px[k * 4 + 3] = 255; }
        worldImg = h('canvas'); worldImg.width = map.W; worldImg.height = map.H; worldImg.getContext('2d').putImageData(new ImageData(px, map.W, map.H), 0, 0);
        worldFor = map;
      }
      function drawWorld() {
        if (!ov.width) return;
        og.fillStyle = css('--bg'); og.fillRect(0, 0, ov.width, ov.height);
        if (!worldImg) return;
        og.imageSmoothingEnabled = true; og.drawImage(worldImg, 0, 0, ov.width, ov.height);
        if (!reg) return;
        const fr = reg.frame, X = (lo) => ((lo + 180) / 360) * ov.width, Y = (la) => ((90 - la) / 180) * ov.height, dpr = ov.width / Math.max(1, ov.clientWidth);
        const box = (w0, n0, w1, s1, colour, lw) => {
          og.strokeStyle = colour; og.lineWidth = lw * dpr;
          for (const shift of [-360, 0, 360]) og.strokeRect(X(w0 + shift), Y(n0), X(w1 + shift) - X(w0 + shift), Y(s1) - Y(n0));
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
        const r = ov.getBoundingClientRect(), la = 90 - ((e.clientY - r.top) / r.height) * 180, lo = ((e.clientX - r.left) / r.width) * 360 - 180;
        u.zoom = 1; u.cx = 0.5; u.cy = 0.5;
        ctx.mutate((w) => { w.region.lat = +la.toFixed(2); w.region.lon = +lo.toFixed(2); });
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
        const w = ctx.world, r0 = reg ? regFor.settings : { lat: 0, lon: 0 };
        const s = { lat: w.region.lat ?? r0.lat, lon: w.region.lon ?? r0.lon, span: w.region.span, res: w.region.res };
        const num = (key, label, min, max, value) => {
          const i = h('input', { class: 'txt num', type: 'number', min, max, step: 0.1, value: +value.toFixed(2), 'aria-label': label });
          i.addEventListener('change', () => { const v = Number(i.value); if (!Number.isFinite(v)) return; u.zoom = 1; ctx.mutate((ww) => { ww.region.lat = key === 'lat' ? clamp(v, -85, 85) : s.lat; ww.region.lon = key === 'lon' ? ((((v + 180) % 360) + 360) % 360) - 180 : s.lon; }); });
          return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label), i);
        };
        const sel = (path, label, items, value, tip) => {
          const el2 = h('select', { class: 'sel', 'aria-label': label }, items.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
          el2.addEventListener('change', () => { u.zoom = 1; ctx.set(path, Number(el2.value)); });
          return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, info(tip)), el2);
        };
        const cellKm = reg ? reg.stats.worldCellKm : (2 * Math.PI * ctx.d.planet.radiusKm) / (w.map.res || 720);
        replace(whereHost,
          h('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 10px' } }, 'Click the world map to centre the region there.'),
          h('div', { class: 'auto-grid' },
            num('lat', 'Centre latitude, °', -85, 85, s.lat), num('lon', 'Centre longitude, °', -180, 180, s.lon),
            sel('region.span', 'Across', SPANS, s.span, `How far the region reaches, east to west and north to south. A world map cell here is about ${fmt.int(cellKm)} km across; the region adds the detail below that.`),
            sel('region.res', 'Detail', RES, s.res, 'Pixels across the region. Finer takes longer: 2048 can take half a minute.')),
          w.region.lat != null ? h('div', { class: 'btn-row', style: { marginTop: '10px' } }, h('button', { class: 'btn small', type: 'button', onclick: () => { u.zoom = 1; ctx.mutate((ww) => { ww.region.lat = null; ww.region.lon = null; }); } }, 'Back to the largest river’s mouth')) : null);
      }
      function renderStats() {
        if (!reg) { replace(statsHost); return; }
        const s = reg.stats, k = (n) => fmt.int(n);
        const rows = [
          ['Across', `${k(reg.frame.span)} km`, `${fmt.num(s.pxKm, 2)} km a pixel · the world map’s cells ${k(s.worldCellKm)} km`],
          ['Land', `${k(s.land * 100)} %`, `${k(s.landKm2)} km²`],
          ['Highest point', `${k(s.highest.m)} m`, `${fmt.num(s.highest.at[0], 2)}°, ${fmt.num(s.highest.at[1], 2)}°`],
          ['Rivers', `${k(s.rivers)}`, `from ${k(reg.minFlow)} m³/s · ${reg.inflows.length ? `${k(reg.inflows.length)} enter from outside` : 'all rise here'}`],
          ['Largest river', s.biggest ? `${k(s.biggest.q)} m³/s` : '—', s.biggest ? `leaves at ${fmt.num(s.biggest.at[0], 2)}°, ${fmt.num(s.biggest.at[1], 2)}°` : 'no river leaves the region'],
          ['Lakes', `${k(s.lakes)}`, `${k(s.saltLakes)} of them salt · ${k(s.lakeKm2)} km²`],
          ['Deepest valley', `${k(s.deepestCut)} m`, 'cut by its river into the world map’s land'],
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
          const f = regFor ? regFor.mapRef.map.planet?.factor ?? 1 : 1;
          items = [[SEA[6][1], 'deep sea'], [SEA[3][1], 'slope'], [SEA[0][1], 'shallows'], ...[0, 200, 500, 1000, 2000, 3500, 5000].map((m) => [ramp(LAND, m), `${fmt.int(m / f)} m`]), [ICE, 'ice']];
        }
        items.push([FRESH, 'fresh lake'], [SALT, 'salt lake']);
        replace(keyHost, panel('Key', { tag: LAYERS.find((l) => l[0] === u.layer)[1].toUpperCase() }, h('div', { class: 'map-key mono', style: { marginLeft: 0 } }, items.map(([c, t]) => h('span', null, sw(c), t)),
          h('span', null, h('i', { style: { display: 'inline-block', width: '22px', height: '3px', background: RIVER, verticalAlign: 'middle', marginRight: '6px' } }), `river (from ${fmt.int(reg ? reg.minFlow : 8)} m³/s)`))));
      }
      const fileName = (what, ext) => `${(ctx.world.name || 'world').replace(/[^\w-]+/g, '_')}-region-${what}.${ext}`;
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
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${reg.W} ${reg.H}" width="${reg.W}" height="${reg.H}">\n<!-- ${fmt.num(fr.north, 3)}N to ${fmt.num(fr.south, 3)}, ${fmt.num(fr.west, 3)} to ${fmt.num(fr.east, 3)} (degrees, equirectangular); ${fmt.num(fr.pxKm, 3)} km a pixel at the centre -->\n<g fill="none" stroke="#245cac" stroke-linecap="round" stroke-linejoin="round">\n${lines.join('\n')}\n</g>\n</svg>\n`;
        save(new Blob([svg], { type: 'image/svg+xml' }), fileName('rivers', 'svg'));
      }
      function renderExport() {
        replace(expHost,
          h('p', { class: 'muted', style: { fontSize: '13px', marginBottom: '10px' } }, 'At the region’s full detail, in the same frame, so they stack in an image editor.'),
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
      if (!cached) return [{ level: 'info', text: 'Open this step to build a closer map.' }];
      const s = cached.region.stats;
      return [{ level: 'ok', text: `${fmt.int(cached.region.frame.span)} km across at ${fmt.num(s.pxKm, 2)} km a pixel: ${fmt.int(s.rivers)} rivers, ${fmt.int(s.lakes)} lakes.` }];
    },
  });
})();
