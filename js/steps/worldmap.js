/*
 * World map: the present-day surface built from the Plates step's history (Worldbuilder's Log
 * 20-26: plate boundaries, islands, continents and shelves, land and sea topography), scaled to the
 * planet (gravity, radius, ridge depth), on a map or a globe, with a brush to raise and lower it.
 */
(function () {
  'use strict';
  const { h, panel, fmt, replace, info, toast, tabs } = WS.ui;
  const S = WS.sphere, M = WS.worldmap;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // atlas colours: depth below sea level, height above it (heights stretched by the planet's relief)
  const SEA = [[0, [178, 226, 232]], [200, [140, 202, 222]], [1000, [98, 162, 206]], [3000, [60, 114, 172]], [5000, [36, 76, 132]], [7000, [22, 46, 92]], [11000, [10, 20, 50]]];
  const LAND = [[0, [92, 146, 86]], [200, [118, 166, 94]], [500, [168, 188, 118]], [1000, [204, 182, 122]], [2000, [172, 132, 92]], [3500, [138, 110, 96]], [5000, [214, 208, 202]], [8000, [255, 255, 255]]];
  const ramp = (stops, x) => {
    if (x <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (x - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * t); }
    return stops[stops.length - 1][1];
  };
  const BOUND = { 1: [230, 60, 60], 2: [255, 200, 60], 3: [220, 220, 220] };   // convergent, divergent, transform

  // the map of a world, kept while nothing it depends on changes
  let cached = null;
  const keyOf = (w, d) => JSON.stringify([w.plates, w.map.land ?? w.population.land, w.map.shelf, w.map.relief, w.map.res, d.planet.gravity, d.planet.radiusKm, w.tectonics.scaling, w.tectonics.ridgeDepth]);
  /* The map of a world (built if need be, synchronously): shared with the Climate step. */
  WS.currentMap = (w, d) => {
    if (!w.plates.features.some((f) => f.kind === 'crust')) return null;
    const key = keyOf(w, d);
    if (cached && cached.key === key && cached.strokes === w.map.strokes.length) return cached;
    const map = M.build(w.plates, { ...settingsOf(w, d), strokes: w.map.strokes });
    cached = { key, map, strokes: w.map.strokes.length };
    return cached;
  };
  const settingsOf = (w, d) => ({
    res: w.map.res || 720, land: (w.map.land ?? w.population.land) / 100, shelf: w.map.shelf, relief: w.map.relief, seed: w.plates.seed,
    gravity: d.planet.gravity, scaling: w.tectonics.scaling, radiusKm: d.planet.radiusKm, ridgeDepth: w.tectonics.ridgeDepth,
  });

  WS.defineStep({
    id: 'worldmap', title: 'World map', code: '00_SURFACE/WORLD_MAP', strip: 'Land & sea',
    blurb: 'The surface today: continents, shelves, mountains, islands and the deep sea, from the plates’ history.',
    lede: ['The surface of your world today, built from its plates’ history and scaled to its gravity and size. Turn the globe, raise and lower the land with the brush, and take the map away to draw on.'],
    build(ctx) {
      const u = (ctx.ui.map = ctx.ui.map || { view: 'map', shade: true, bounds: false, tool: 'look', radius: 150, strength: 600, lat: 20, lon: 0, zoom: 1 });
      const host = h('div', { class: 'scene-host' }), hint = h('div', { class: 'scene-status mono' });
      const viewTabs = h('div'), toolsHost = h('div'), setHost = h('div'), statsHost = h('div'), expHost = h('div'), keyHost = h('div');
      const el = h('div', { class: 'stack-gap' },
        panel('Map', { ticks: true, tag: 'PRESENT DAY', flush: true }, h('div', { class: 'map-bar' }, viewTabs, keyHost), host, h('div', { class: 'viz-caption' }, hint)),
        h('div', { class: 'grid two' },
          h('div', { class: 'stack-gap' }, panel('Draw', { tag: 'BRUSH' }, toolsHost), statsHost),
          h('div', { class: 'stack-gap' }, panel('Sea level & relief', { tag: 'SETTINGS' }, setHost), panel('Take it away', { tag: 'EXPORT' }, expHost))));
      const cv = h('canvas', { class: 'scene-canvas', tabindex: 0, role: 'img', 'aria-label': 'Map of the world today' });
      host.appendChild(cv);
      const g = cv.getContext('2d');
      let map = null, colours = null, img = null, building = false;

      // ── building and colouring ──
      function ensure() {
        const w = ctx.world, d = ctx.d;
        if (!w.plates.features.some((f) => f.kind === 'crust')) { map = null; return false; }
        const key = keyOf(w, d);
        if (cached && cached.key === key && cached.strokes === w.map.strokes.length) { map = cached.map; return true; }
        if (building) return false;
        building = true;
        hint.textContent = 'Building the map…';
        setTimeout(() => {
          const t0 = performance.now();
          map = M.build(w.plates, { ...settingsOf(w, d), strokes: w.map.strokes });
          cached = { key, map, strokes: w.map.strokes.length };
          building = false;
          colour();
          renderStats(); renderSet(); draw();
          hint.textContent = `${map.W} × ${map.H} cells · built in ${fmt.int(performance.now() - t0)} ms`;
          WS.app.refresh();                                   // the checks can read the map now
        }, 30);
        return false;
      }
      /* RGBA for every cell: the atlas colour, shaded by the slope (light from the north-west). */
      function colour() {
        if (!map) return;
        const { W, H, z, boundary } = map, f = map.planet.factor;
        colours = new Uint8ClampedArray(W * H * 4);
        const cellM = (2 * Math.PI * map.planet.radiusKm * 1000) / W;
        for (let j = 0; j < H; j++) {
          const cosl = Math.max(0.05, Math.cos((90 - ((j + 0.5) * 180) / H) * D2R));
          for (let i = 0; i < W; i++) {
            const k = j * W + i, v = z[k];
            let c = v > 0 ? ramp(LAND, v * f) : ramp(SEA, -v);
            if (u.shade) {
              const e = z[j * W + ((i + 1) % W)], wv = z[j * W + ((i + W - 1) % W)], n = z[Math.max(0, j - 1) * W + i], s = z[Math.min(H - 1, j + 1) * W + i];
              const ex = (Math.max(e, 0) - Math.max(wv, 0)) / (2 * cellM * cosl), ny = (Math.max(n, 0) - Math.max(s, 0)) / (2 * cellM);
              const shade = clamp(1 + 14 * f * (-ex * 0.7 + ny * 0.7), 0.55, 1.35);
              if (v > 0) c = c.map((x) => x * shade);
            }
            if (u.bounds && boundary[k]) c = BOUND[boundary[k]];
            const o = k * 4;
            colours[o] = c[0]; colours[o + 1] = c[1]; colours[o + 2] = c[2]; colours[o + 3] = 255;
          }
        }
        img = new ImageData(colours, W, H);
      }

      // ── drawing ──
      const fit = () => {
        const w = host.clientWidth || 700, hh = u.view === 'map' ? Math.round(w / 2) : Math.round(clamp(w * 0.8, 320, window.innerHeight * 0.75));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.style.height = `${hh}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
        draw();
      };
      const ro = new ResizeObserver(fit);
      const globeR = () => Math.min(cv.width, cv.height) * 0.46 * u.zoom;
      function draw() {
        if (!cv.width) return;
        g.fillStyle = css('--bg'); g.fillRect(0, 0, cv.width, cv.height);
        if (!map || !img) {
          g.fillStyle = css('--muted'); g.font = `${16 * (cv.width / cv.clientWidth)}px ${css('--font-mono') || 'monospace'}`;
          g.fillText(building ? 'Building the map…' : 'Make a world on the Plates step first.', 20, 40);
          return;
        }
        if (u.view === 'map') {
          const off = drawOff(); g.imageSmoothingEnabled = map.W < cv.width;
          g.drawImage(off, 0, 0, cv.width, cv.height);
        } else drawGlobe();
      }
      let offCanvas = null, offFor = null;
      function drawOff() {
        if (offFor !== img) { offCanvas = h('canvas'); offCanvas.width = map.W; offCanvas.height = map.H; offCanvas.getContext('2d').putImageData(img, 0, 0); offFor = img; }
        return offCanvas;
      }
      function drawGlobe() {
        const W = cv.width, H = cv.height, R = globeR(), cx = W / 2, cy = H / 2;
        const out = g.createImageData(W, H), d = out.data;
        const la0 = u.lat * D2R, lo0 = u.lon * D2R, sla = Math.sin(la0), cla = Math.cos(la0);
        const bg = css('--bg').match(/\w\w/g)?.map((x) => parseInt(x, 16)) || [10, 10, 10];
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const o = (y * W + x) * 4, px = (x - cx) / R, py = (cy - y) / R, r2 = px * px + py * py;
          if (r2 > 1) { d[o] = bg[0]; d[o + 1] = bg[1]; d[o + 2] = bg[2]; d[o + 3] = 255; continue; }
          const pz = Math.sqrt(1 - r2);
          const la = Math.asin(clamp(pz * sla + py * cla, -1, 1)), lo = lo0 + Math.atan2(px, pz * cla - py * sla);
          const j = clamp(Math.floor(((90 - la * R2D) / 180) * map.H), 0, map.H - 1);
          const i = ((Math.floor((((lo * R2D + 180) % 360 + 360) % 360) / 360 * map.W)) % map.W + map.W) % map.W;
          const k = (j * map.W + i) * 4, lit = 0.55 + 0.45 * pz;
          d[o] = colours[k] * lit; d[o + 1] = colours[k + 1] * lit; d[o + 2] = colours[k + 2] * lit; d[o + 3] = 255;
        }
        g.putImageData(out, 0, 0);
        g.strokeStyle = css('--line'); g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, R, 0, 2 * Math.PI); g.stroke();
      }

      // ── where the pointer is, and the brush ──
      function lookAt(e) {
        const r = cv.getBoundingClientRect(), dpr = cv.width / r.width, x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
        if (u.view === 'map') return [90 - (y / cv.height) * 180, (x / cv.width) * 360 - 180];
        const pr = S.orthographic(u.lat, u.lon, globeR(), cv.width / 2, cv.height / 2);
        return pr.invert(x, y);
      }
      function paint(at) {
        if (!map || !at) return;
        const s = { lat: +at[0].toFixed(3), lon: +at[1].toFixed(3), r: +((u.radius * 180) / (Math.PI * map.planet.radiusKm)).toFixed(3), dz: (u.tool === 'raise' ? 1 : -1) * u.strength };
        ctx.world.map.strokes.push(s);
        M.stamp(map.grid, [s.lat, s.lon], s.r, (k, dd) => { const t = clamp(1 - dd / s.r, 0, 1); map.z[k] += s.dz * t * t * (3 - 2 * t); });
        cached.strokes = ctx.world.map.strokes.length;
        colour(); offFor = null; draw();
      }
      let drag = null, lastPaint = null;
      cv.addEventListener('pointerdown', (e) => {
        cv.setPointerCapture(e.pointerId);
        drag = { x: e.clientX, y: e.clientY, lat: u.lat, lon: u.lon };
        if (u.tool !== 'look') { const at = lookAt(e); paint(at); lastPaint = at; }
      });
      cv.addEventListener('pointermove', (e) => {
        const at = lookAt(e);
        if (map && at) { const z = M.sample(map, at[0], at[1]); hint.textContent = `${fmt.num(at[0], 1)}°, ${fmt.num(at[1], 1)}° · ${z >= 0 ? `${fmt.int(z)} m above` : `${fmt.int(-z)} m below`} the sea`; }
        if (!drag) return;
        if (u.tool !== 'look') {
          if (at && (!lastPaint || S.distance(at, lastPaint) > ((u.radius * 180) / (Math.PI * ctx.d.planet.radiusKm)) / 3)) { paint(at); lastPaint = at; }
          return;
        }
        if (u.view === 'globe') {
          const k = (180 / Math.PI) / globeR() * (cv.width / cv.clientWidth);
          u.lon = ((drag.lon - (e.clientX - drag.x) * k / Math.max(0.2, Math.cos(u.lat * D2R))) + 540) % 360 - 180;
          u.lat = clamp(drag.lat + (e.clientY - drag.y) * k, -89, 89);
          draw();
        }
      });
      const end = () => {
        if (drag && u.tool !== 'look') { ctx.set('map.strokes', ctx.world.map.strokes); renderStats(); }
        drag = null; lastPaint = null;
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('wheel', (e) => { if (u.view !== 'globe') return; e.preventDefault(); u.zoom = clamp(u.zoom * Math.exp(-e.deltaY * 0.0012), 0.7, 6); draw(); }, { passive: false });
      cv.style.touchAction = 'none';

      // ── panels ──
      function renderView() {
        replace(viewTabs, tabs([['map', 'Map'], ['globe', 'Globe']], u.view, (v) => { u.view = v; renderView(); fit(); }),
          ...[['shade', 'Relief shading'], ['bounds', 'Plate boundaries']].map(([key, label]) => {
            const b = h('input', { type: 'checkbox', checked: u[key] });
            b.addEventListener('change', () => { u[key] = b.checked; colour(); offFor = null; draw(); renderKey(); });
            return h('label', { class: 'check' }, b, label);
          }));
      }
      function renderTools() {
        const btn = (tool, label) => h('button', { type: 'button', class: ['btn small tool-btn', u.tool === tool && 'active'], 'aria-pressed': String(u.tool === tool), onclick: () => { u.tool = tool; renderTools(); cv.style.cursor = tool === 'look' ? 'grab' : 'crosshair'; } }, label);
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
        const res = h('select', { class: 'sel', 'aria-label': 'Detail' }, [[360, 'Coarse · 360'], [720, 'Fine · 720'], [1440, 'Finest · 1440 (slow)']].map(([v, t]) => h('option', { value: v, selected: (w.map.res || 720) === v }, t)));
        res.addEventListener('change', () => ctx.set('map.res', Number(res.value)));
        replace(setHost,
          h('div', { class: 'auto-grid' },
            num('map.land', 'Land, % of surface', 1, 95, 0.5, 'How much of the surface stands above the sea. By default the Population step’s land share; the crust can only hold so much.', +(w.map.land ?? w.population.land).toFixed(1)),
            num('map.shelf', 'Shelf width ×', 0.2, 4, 0.1, 'Continental shelves: about 150 km wide on quiet coasts, 40 km where a plate subducts, on Earth.', w.map.shelf),
            num('map.relief', 'Relief ×', 0.2, 3, 0.1, 'Mountain heights on top of what gravity allows.', w.map.relief),
            h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Detail'), res)),
          h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            w.map.land != null ? h('button', { class: 'btn small', type: 'button', onclick: () => ctx.set('map.land', null) }, `Follow Population (${fmt.num(w.population.land, 1)} %)`) : null,
            auto ? h('button', { class: 'btn small', type: 'button', onclick: () => ctx.set('map.land', +auto.toFixed(1)) }, `Earth-like for this crust: ${fmt.num(auto, 1)} %`) : null),
          h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '8px' } },
            `Gravity ${fmt.num(ctx.d.planet.gravity, 2)} g: heights and widths ÷ ${fmt.num(ctx.d.planet.gravity ** w.tectonics.scaling, 2)} (g^${fmt.num(w.tectonics.scaling, 2)}, set on Tectonics), ridges at ${fmt.int(w.tectonics.ridgeDepth)} m.`));
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
            ['Plates', `${new Set(map.plate).size}`, 'with their boundaries']]
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
            h('button', { class: 'btn small primary', type: 'button', disabled: !map, onclick: exportColour }, 'Colour map (PNG)'),
            h('button', { class: 'btn small', type: 'button', disabled: !map, onclick: exportHeight }, 'Heightmap (16-bit PNG)')));
      }
      const fileName = (what) => `${(ctx.world.name || 'world').replace(/[^\w-]+/g, '_')}-${what}`;
      function save(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
      function exportColour() { const c = drawOff(); c.toBlob((b) => save(b, `${fileName('map')}.png`)); }
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
          renderView(); renderTools(); renderSet(); renderExport(); renderKey();
          if (ensure()) { if (!colours || offFor === null) colour(); renderStats(); fit(); } else { renderStats(); fit(); }
        },
        destroy() { ro.disconnect(); },
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
      const peak = 8850 / d.planet.gravity ** w.tectonics.scaling;
      if (map.highest.m > peak * 1.5) out.push({ level: 'warn', text: `The highest point, ${fmt.int(map.highest.m)} m, is well above what this gravity allows (about ${fmt.int(peak)} m).` });
      return out;
    },
  });

  /* A 16-bit greyscale PNG (deflated with the browser's CompressionStream). */
  async function png16(W, H, values) {
    const crcT = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
    const crc = (bytes) => { let c = 0xffffffff; for (const b of bytes) c = crcT[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const chunk = (type, data) => {
      const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
      dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(data, 8); dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
      return out;
    };
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
    dv.setUint32(0, W); dv.setUint32(4, H); ihdr[8] = 16; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    const raw = new Uint8Array(H * (1 + W * 2));
    for (let j = 0; j < H; j++) { const o = j * (1 + W * 2); raw[o] = 0; for (let i = 0; i < W; i++) { const v = values[j * W + i]; raw[o + 1 + i * 2] = v >> 8; raw[o + 2 + i * 2] = v & 255; } }
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
  }
})();
