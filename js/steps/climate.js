/*
 * Climate: winds and pressure, ocean currents, upwelling and reefs, temperature, precipitation and
 * the climate zones of the world map (Worldbuilder's Log 28-34), for whatever planet this is.
 */
(function () {
  'use strict';
  const { h, panel, fmt, replace, info, tabs } = WS.ui;
  const K = WS.climate, S = WS.sphere, D = WS.data;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = (h2) => [1, 3, 5].map((i) => parseInt(h2.slice(i, i + 2), 16));
  const ramp = (stops, x) => { if (x <= stops[0][0]) return stops[0][1]; for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (x - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * t); } return stops[stops.length - 1][1]; };
  const TEMP = [[-40, [60, 40, 120]], [-20, [70, 90, 190]], [-5, [120, 170, 230]], [5, [180, 225, 220]], [15, [170, 210, 120]], [25, [240, 200, 80]], [35, [225, 110, 50]], [50, [150, 30, 40]]];
  const RAIN = [[0, [210, 180, 130]], [150, [225, 210, 150]], [400, [180, 210, 140]], [800, [90, 170, 120]], [1500, [40, 130, 160]], [3000, [30, 70, 160]], [6000, [40, 30, 120]]];
  const SEA = [34, 66, 110], SEAICE = [226, 236, 242];
  const NAME = {};
  for (const z of D.CLIMATE_ZONES || []) for (const c of String(z.code).split(/\s*\/\s*/)) if (!NAME[c]) NAME[c] = z.name;

  const LAYERS = [['zones', 'Climate zones'], ['temp', 'Temperature'], ['rain', 'Precipitation'], ['wind', 'Pressure & winds'], ['currents', 'Ocean currents'], ['life', 'Upwelling & reefs']];
  let cache = null;
  /* The climate of a world, kept while its map and planet stay the same: shared with Rivers & biomes.
     With {peek: true}, only what is already worked out (or null). */
  WS.currentClimate = (w, d, opts = {}) => {
    if (!w.plates.features.some((f) => f.kind === 'crust')) return null;
    const pl = K.planetOf(w, d), m = WS.currentMap(w, d);
    // (the World map's brush changes the map in place: its stroke count says when)
    if (cache && cache.mapRef === m && cache.strokes === m.strokes && JSON.stringify(cache.pl) === JSON.stringify(pl)) return cache;
    if (opts.peek) return null;
    cache = { mapRef: m, strokes: m.strokes, clim: K.build(m.map, pl), pl };
    return cache;
  };

  WS.defineStep({
    id: 'climate-map', title: 'Climate', code: '00_SURFACE/CLIMATE', strip: 'Winds, rain, zones',
    blurb: 'Winds, currents, temperature, rain and the climate zones of the world map.',
    lede: ['The climate of your world from its map, its star and its spin: winds and pressure, ocean currents, upwelling and reefs, temperature, precipitation, and the climate zones that follow. Any planet will do; some will be nothing like Earth.'],
    build(ctx) {
      const u = (ctx.ui.climate = ctx.ui.climate || { layer: 'zones', season: 'jul', view: 'map', lat: 20, lon: 0 });
      const host = h('div', { class: 'scene-host' }), hint = h('div', { class: 'scene-status mono' });
      const bar = h('div', { class: 'map-bar' }), keyHost = h('div'), statsHost = h('div'), inHost = h('div'), expHost = h('div');
      const el = h('div', { class: 'stack-gap' },
        panel('Climate', { ticks: true, tag: 'PRESENT DAY', flush: true }, bar, host, h('div', { class: 'viz-caption' }, hint)),
        h('div', { class: 'grid two' },
          h('div', { class: 'stack-gap' }, statsHost, keyHost),
          h('div', { class: 'stack-gap' }, panel('What drives it', { tag: 'PLANET' }, inHost), panel('Take it away', { tag: 'EXPORT' }, expHost))));
      const cv = h('canvas', { class: 'scene-canvas', role: 'img', 'aria-label': 'Climate map' });
      host.appendChild(cv);
      const g = cv.getContext('2d');
      let clim = null, fmap = null, img = null, off = null, busy = false;

      function ensure() {
        const w = ctx.world, d = ctx.d;
        if (!w.plates.features.some((f) => f.kind === 'crust')) { clim = null; return; }
        if (busy) return;
        const pl = K.planetOf(w, d), have = WS.currentClimate(w, d, { peek: true });
        if (have) { if (clim !== have.clim || !off) { clim = have.clim; fmap = have.mapRef.map; paint(); renderStats(); renderKey(); hint.textContent = `${clim.W} × ${clim.H} cells · hover for a place${pl.locked ? ' · tidally locked' : ''}`; } return; }   // nothing changed
        busy = true; hint.textContent = 'Working out the climate…';
        setTimeout(() => {
          const t0 = performance.now();
          const c = WS.currentClimate(w, d); clim = c.clim; fmap = c.mapRef.map; busy = false;
          paint(); renderStats(); renderIn(); renderKey(); draw();
          hint.textContent = `${clim.W} × ${clim.H} cells · ${fmt.int(performance.now() - t0)} ms${pl.locked ? ' · tidally locked' : ''}`;
          WS.app.refresh();
        }, 30);
      }
      const season = () => clim.seasons[u.season];
      /* The climate cell for a cell of the map, of the same kind (land or sea) where there is one near. */
      function cellFor(kk, isLand) {
        const MW = fmap.W, MH = fmap.H, ii = kk % MW, jj = (kk - ii) / MW, { W, H, land } = clim;
        const i = Math.floor((ii * W) / MW), j = Math.min(H - 1, Math.floor((jj * H) / MH)), k = j * W + i;
        if (!!land[k] === isLand) return k;
        for (let r = 1; r <= 2; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const q2 = j + dj; if (q2 < 0 || q2 >= H) continue; const q = q2 * W + ((i + di + W) % W); if (!!land[q] === isLand) return q; }
        return k;
      }
      const fineAt = (la, lo) => clamp(Math.floor(((90 - la) / 180) * fmap.H), 0, fmap.H - 1) * fmap.W + ((Math.floor(((lo + 180) / 360) * fmap.W) % fmap.W) + fmap.W) % fmap.W;
      /* Colours for every cell of the map (its coast and sea ice), from the climate's coarser cells. */
      function paint() {
        if (!clim || !fmap) return;
        const MW = fmap.W, MH = fmap.H, fz = fmap.z, iceF = clim.iceMap, px = new Uint8ClampedArray(MW * MH * 4), s = season(), year = u.season === 'year';
        const J = clim.seasons.jan, L = clim.seasons.jul, E = clim.seasons.equ;
        for (let kk = 0; kk < MW * MH; kk++) {
          const isLand = fz[kk] > 0, k = cellFor(kk, isLand), iced = !isLand && iceF && iceF[kk];
          let c;
          if (u.layer === 'zones') c = isLand ? hex(clim.zones[clim.zone[k] - 1]?.[1] || '#888888') : iced ? SEAICE : SEA;
          else if (u.layer === 'temp') c = ramp(TEMP, year ? (J.T[k] + L.T[k] + 2 * E.T[k]) / 4 : s.T[k]);
          else if (u.layer === 'rain') c = isLand ? ramp(RAIN, year ? clim.rainYear[k] : 2 * s.Pr[k]) : SEA.map((x) => x + 30);
          else if (u.layer === 'wind') { const p = (year ? (J.P[k] + L.P[k] + 2 * E.P[k]) / 4 : s.P[k]) - 1013; c = p > 0 ? [200 + Math.min(55, p * 4), 150 - Math.min(80, p * 5), 120] : [120 + p * 3, 150 + p * 2, 210]; if (isLand) c = c.map((x) => x * 0.8 + 30); }
          // (under the ice the sea is at freezing: no warm or cold currents there, only drift)
          else if (u.layer === 'currents') c = isLand ? [150, 145, 130] : iced ? SEAICE : clim.sst[k] > 0.3 ? [40 + Math.min(180, clim.sst[k] * 45), 60, 110] : clim.sst[k] < -0.3 ? [30, 70 + Math.min(150, -clim.sst[k] * 35), 140 + Math.min(100, -clim.sst[k] * 25)] : SEA;
          else c = isLand ? [150, 145, 130] : iced ? SEAICE : clim.reef[k] ? [255, 110, 150] : [30, 60 + Math.min(150, clim.fish[k] * 80), 100 + Math.min(80, clim.fish[k] * 40)];
          // the coast, on every layer but the zones (which show it anyway)
          if (u.layer !== 'zones') { const ii = kk % MW, jj = (kk - ii) / MW; if (isLand !== fz[jj * MW + ((ii + 1) % MW)] > 0 || (jj + 1 < MH && isLand !== fz[kk + MW] > 0)) c = [25, 25, 30]; }
          px.set([c[0], c[1], c[2], 255], kk * 4);
        }
        img = new ImageData(px, MW, MH);
        off = h('canvas'); off.width = MW; off.height = MH; off.getContext('2d').putImageData(img, 0, 0);
      }

      // ── drawing: map or globe, with arrows for winds and currents ──
      const fit = () => {
        const w = host.clientWidth || 700, hh = u.view === 'map' ? Math.round(w / 2) : Math.round(clamp(w * 0.8, 320, window.innerHeight * 0.75));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.style.height = `${hh}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
        draw();
      };
      const ro = new ResizeObserver(fit);
      const R = () => Math.min(cv.width, cv.height) * 0.46;
      const pr = () => S.orthographic(u.lat, u.lon, R(), cv.width / 2, cv.height / 2);
      function toScreen(la, lo) {
        if (u.view === 'map') return [((lo + 180) / 360) * cv.width, ((90 - la) / 180) * cv.height, true];
        return pr().project([la, lo]);
      }
      function draw() {
        if (!cv.width) return;
        g.fillStyle = css('--bg'); g.fillRect(0, 0, cv.width, cv.height);
        if (!clim || !off) { g.fillStyle = css('--muted'); g.font = `${16 * (cv.width / cv.clientWidth)}px ${css('--font-mono') || 'monospace'}`; g.fillText(busy ? 'Working out the climate…' : 'Make a world on the Plates step first.', 20, 40); return; }
        if (u.view === 'map') { g.imageSmoothingEnabled = true; g.drawImage(off, 0, 0, cv.width, cv.height); }
        else {
          const W = cv.width, H = cv.height, r = R(), cx = W / 2, cy = H / 2, out = g.createImageData(W, H), d = out.data;
          const la0 = u.lat * D2R, lo0 = u.lon * D2R, sla = Math.sin(la0), cla = Math.cos(la0);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const o = (y * W + x) * 4, px2 = (x - cx) / r, py = (cy - y) / r, r2 = px2 * px2 + py * py;
            if (r2 > 1) { d[o + 3] = 0; continue; }
            const pz = Math.sqrt(1 - r2), la = Math.asin(clamp(pz * sla + py * cla, -1, 1)), lo = lo0 + Math.atan2(px2, pz * cla - py * sla);
            const IW = img.width, IH = img.height, j = clamp(Math.floor(((90 - la * R2D) / 180) * IH), 0, IH - 1), i = ((Math.floor(((((lo * R2D + 180) % 360) + 360) % 360) / 360 * IW)) % IW + IW) % IW;
            const k = (j * IW + i) * 4, lit = 0.6 + 0.4 * pz;
            d[o] = img.data[k] * lit; d[o + 1] = img.data[k + 1] * lit; d[o + 2] = img.data[k + 2] * lit; d[o + 3] = 255;
          }
          g.putImageData(out, 0, 0);
          g.strokeStyle = css('--line'); g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.stroke();
        }
        if (u.layer === 'wind' || u.layer === 'currents') arrows();
      }
      function arrows() {
        const s = u.layer === 'wind' ? (u.season === 'year' ? clim.seasons.jul : season()) : null, dpr = cv.width / cv.clientWidth;
        const step = Math.max(4, Math.round(clim.W / 36));
        g.lineWidth = 1.2 * dpr;
        for (let j = step / 2; j < clim.H; j += step) for (let i = step / 2; i < clim.W; i += step) {
          const k = Math.floor(j) * clim.W + Math.floor(i), la = clim.lat[Math.floor(j)], lo = -180 + ((i + 0.5) * 360) / clim.W;
          let ux, vy, col;
          if (s) { ux = s.u[k]; vy = s.v[k]; col = 'rgba(255,255,255,0.85)'; }
          let drift = false;
          if (!s) {
            if (clim.land[k]) continue;
            ux = clim.current.u[k]; vy = clim.current.v[k];
            // under sea ice the currents still run and carry the ice with them, slowed (the ice shields
            // the water from the wind), and the water is at freezing: neither warm nor cold
            drift = !!(clim.iceMap && clim.iceMap[fineAt(la, lo)]);
            col = drift ? 'rgba(40,60,90,0.85)' : clim.sst[k] > 0.3 ? 'rgba(255,140,110,0.95)' : clim.sst[k] < -0.3 ? 'rgba(150,210,255,0.95)' : 'rgba(255,255,255,0.6)';
          }
          const l = Math.hypot(ux, vy); if (l < 1e-6) continue;
          const len = (2.4 * Math.min(1, l * (s ? 6 : 1.4)) + 0.6) * (drift ? 0.6 : 1);   // degrees
          const a = toScreen(la, lo), b = toScreen(clamp(la + (vy / l) * len, -89, 89), lo + ((ux / l) * len) / Math.max(0.2, Math.cos(la * D2R)));
          if (!a[2] || !b[2] || Math.abs(b[0] - a[0]) > cv.width / 4) continue;
          g.strokeStyle = col; g.fillStyle = col;
          g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
          const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hd = 4 * dpr;
          g.beginPath(); g.moveTo(b[0], b[1]); g.lineTo(b[0] - hd * Math.cos(ang - 0.5), b[1] - hd * Math.sin(ang - 0.5)); g.lineTo(b[0] - hd * Math.cos(ang + 0.5), b[1] - hd * Math.sin(ang + 0.5)); g.closePath(); g.fill();
        }
      }

      // ── pointer: turn the globe, read a place ──
      let drag = null;
      const at = (e) => {
        const r = cv.getBoundingClientRect(), dpr = cv.width / r.width, x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
        return u.view === 'map' ? [90 - (y / cv.height) * 180, (x / cv.width) * 360 - 180] : pr().invert(x, y);
      };
      cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, lat: u.lat, lon: u.lon }; cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', (e) => {
        const p = at(e);
        if (clim && p) {
          const j = clamp(Math.floor(((90 - p[0]) / 180) * clim.H), 0, clim.H - 1), i = clamp(Math.floor(((p[1] + 180) / 360) * clim.W), 0, clim.W - 1), k = j * clim.W + i;
          const fk = fineAt(p[0], p[1]), z = fmap.z[fk], isLand = z > 0, k2 = cellFor(fk, isLand), iced = !isLand && clim.iceMap && clim.iceMap[fk];
          const J = clim.seasons.jan, L = clim.seasons.jul, E = clim.seasons.equ;
          const code = isLand ? clim.zones[clim.zone[k2] - 1]?.[0] : null;
          hint.textContent = `${fmt.num(p[0], 1)}°, ${fmt.num(p[1], 1)}° · ${isLand ? `${fmt.int(z)} m` : 'sea'} · ${fmt.num(J.T[k2], 0)} / ${fmt.num(E.T[k2], 0)} / ${fmt.num(L.T[k2], 0)} °C · ${fmt.int(clim.rainYear[k2])} mm a year${code ? ` · ${code} ${NAME[code] || ''}` : iced ? ' · sea ice (winter)' : clim.reef[k2] ? ' · coral reefs' : ''}`;
        }
        if (!drag || u.view !== 'globe') return;
        const k = (180 / Math.PI) / R() * (cv.width / cv.clientWidth);
        u.lon = ((drag.lon - (e.clientX - drag.x) * k / Math.max(0.2, Math.cos(u.lat * D2R))) + 540) % 360 - 180;
        u.lat = clamp(drag.lat + (e.clientY - drag.y) * k, -89, 89);
        draw();
      });
      const end = () => { drag = null; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      cv.style.touchAction = 'none';

      // ── panels ──
      function renderBar() {
        const layerSel = h('select', { class: 'sel', 'aria-label': 'Layer', style: { width: 'auto' } }, LAYERS.map(([v, t]) => h('option', { value: v, selected: u.layer === v }, t)));
        layerSel.addEventListener('change', () => { u.layer = layerSel.value; paint(); draw(); renderKey(); renderBar(); });
        const seasonal = u.layer === 'temp' || u.layer === 'rain' || u.layer === 'wind';
        replace(bar, tabs([['map', 'Map'], ['globe', 'Globe']], u.view, (v) => { u.view = v; renderBar(); fit(); }), layerSel,
          seasonal ? tabs([['jan', 'Northern winter'], ['equ', 'Equinoxes'], ['jul', 'Northern summer'], ['year', 'Year']].filter(([v]) => u.layer !== 'wind' || v !== 'year'), u.season === 'year' && u.layer === 'wind' ? 'jul' : u.season, (v) => { u.season = v; paint(); draw(); renderBar(); renderKey(); }) : null);
      }
      function renderKey() {
        const sw = (c) => h('i', { style: { display: 'inline-block', width: '22px', height: '10px', background: `rgb(${c.map(Math.round).join(',')})`, verticalAlign: 'middle', marginRight: '6px' } });
        let items = [];
        if (u.layer === 'zones' && clim) {
          const seen = new Map();
          for (let k = 0; k < clim.zone.length; k++) if (clim.zone[k]) { const [code, colr] = clim.zones[clim.zone[k] - 1]; seen.set(code, colr); }
          items = [...seen].sort((a, b) => a[0].localeCompare(b[0])).map(([code, colr]) => [hex(colr), `${code} ${NAME[code] || ''}`]);
        } else if (u.layer === 'temp') items = TEMP.map(([t, c]) => [c, `${t} °C`]);
        else if (u.layer === 'rain') items = RAIN.map(([t, c]) => [c, `${t} mm/yr`]);
        else if (u.layer === 'wind') items = [[[240, 110, 120], 'high pressure'], [[100, 130, 210], 'low pressure'], [[255, 255, 255], 'surface wind']];
        else if (u.layer === 'currents') items = [[[220, 60, 110], 'warm current'], [[30, 200, 240], 'cold current'], [SEAICE, 'sea ice (dark arrows: its drift)']];
        else items = [[[30, 210, 180], 'rich fishing (upwelling, shelves)'], [[255, 110, 150], 'coral reefs'], [SEAICE, 'sea ice']];
        replace(keyHost, panel('Key', { tag: LAYERS.find((l) => l[0] === u.layer)[1].toUpperCase() }, h('div', { class: 'map-key mono', style: { marginLeft: 0 } }, items.map(([c, t]) => h('span', null, sw(c), t)))));
      }
      function renderStats() {
        if (!clim) { replace(statsHost); return; }
        const { W, H, lat, land } = clim, grp = {}, J = clim.seasons.jan, L = clim.seasons.jul, E = clim.seasons.equ;
        let la = 0, sea = 0, ice = 0, reefs = 0, hot = -1e9, cold = 1e9, wet = 0, dry = 1e9;
        for (let k = 0; k < W * H; k++) {
          const a = Math.cos(lat[Math.floor(k / W)] * D2R);
          if (land[k]) {
            la += a; const gname = clim.zones[clim.zone[k] - 1]?.[0]?.[0]; grp[gname] = (grp[gname] || 0) + a;
            hot = Math.max(hot, J.T[k], L.T[k], E.T[k]); cold = Math.min(cold, J.T[k], L.T[k], E.T[k]); const p = clim.rainYear[k]; wet = Math.max(wet, p); dry = Math.min(dry, p);
          } else { sea += a; if (clim.reef[k]) reefs++; }
        }
        // sea ice on the map's own cells
        if (fmap && clim.iceMap) { let s2 = 0, i2 = 0; for (let kk = 0; kk < fmap.W * fmap.H; kk++) if (!(fmap.z[kk] > 0)) { const a = fmap.grid.cosl[Math.floor(kk / fmap.W)]; s2 += a; if (clim.iceMap[kk]) i2 += a; } sea = s2; ice = i2; }
        const pc = (gname) => `${fmt.int((100 * (grp[gname] || 0)) / Math.max(1e-9, la))} %`;
        replace(statsHost, h('div', { class: 'readouts' },
          [['Tropical (A)', pc('A'), 'of the land'], ['Dry (B)', pc('B'), 'deserts & steppes'], ['Temperate (C)', pc('C'), ''], ['Continental (D)', pc('D'), ''], ['Polar (E)', pc('E'), 'tundra & ice'],
            ['Land temperatures', `${fmt.int(cold)} to ${fmt.int(hot)} °C`, 'coldest season to hottest'], ['Rain on land', `${fmt.int(dry)} to ${fmt.int(wet)} mm`, 'a year, driest to wettest'],
            ['Sea ice', `${fmt.int((100 * ice) / Math.max(1e-9, sea))} %`, 'of the sea, at its winter'], ['Coral reefs', `${fmt.int(reefs)}`, 'cells of warm shallows']]
            .map(([l, v, sub]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l), h('div', { class: 'val' }, v), h('div', { class: 'sub' }, sub)))));
      }
      function renderIn() {
        const pl = cache ? cache.pl : K.planetOf(ctx.world, ctx.d);
        const rows = [
          ['Axial tilt', `${fmt.num(ctx.world.planet.tilt, 1)}°`, 'how far the sun swings north and south: the seasons'],
          ['Day', `${fmt.num(ctx.world.planet.rotation, 1)} h`, `${(pl.cells || []).length || '—'} circulation cells a hemisphere${pl.locked ? ' · tidally locked: one face to the star' : ''}`],
          ['Spin', pl.retrograde ? 'retrograde' : 'prograde', 'which way the winds and currents turn'],
          ['Mean temperature', `${fmt.int(pl.meanC)} °C`, `starlight ${fmt.num(pl.flux, 2)} × Earth’s`],
          ['Atmosphere', `${fmt.num(pl.pressure, 2)} atm`, 'thicker air evens out the temperatures'],
          ['Gravity', `${fmt.num(pl.gravity, 2)} g`, `cooling ${fmt.num(6.5 * pl.gravity, 1)} °C per km up`],
        ];
        replace(inHost, h('div', { class: 'readouts' }, rows.map(([l, v, sub]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l), h('div', { class: 'val' }, v), h('div', { class: 'sub' }, sub)))),
          h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '8px' } }, 'Set on the Star and Planet steps; the map comes from Plates and World map.'));
      }
      function renderExport() {
        replace(expHost, h('div', { class: 'btn-row' },
          h('button', { class: 'btn small primary', type: 'button', onclick: () => { if (!off) return; const big = h('canvas'); big.width = clim.W * 4; big.height = clim.H * 4; const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false; bg.drawImage(off, 0, 0, big.width, big.height); big.toBlob((b) => { const a = h('a', { href: URL.createObjectURL(b), download: `${(ctx.world.name || 'world').replace(/[^\w-]+/g, '_')}-${u.layer}${u.layer === 'temp' || u.layer === 'rain' ? '-' + u.season : ''}.png` }); document.body.appendChild(a); a.click(); a.remove(); }); } }, 'This layer (PNG)')));
      }

      return {
        el,
        update() {
          if (!ro._on) { ro.observe(host); ro._on = true; }
          renderBar(); renderKey(); renderIn(); renderExport();
          ensure();                                            // reuses what it can: the map and the climate are cached
          renderStats(); fit();
        },
        destroy() { ro.disconnect(); },
      };
    },
    checks(w, d) {
      if (!w.plates.features.some((f) => f.kind === 'crust')) return [{ level: 'info', text: 'No continents yet: make a world on the Plates step.' }];
      if (!cache) return [{ level: 'info', text: 'Open the climate to work it out.' }];
      const c = cache.clim, out = [];
      let land = 0, lush = 0, ice = 0;
      for (let k = 0; k < c.W * c.H; k++) if (c.land[k]) { const a = Math.cos(c.lat[Math.floor(k / c.W)] * D2R), code = c.zones[c.zone[k] - 1]?.[0] || ''; land += a; if (/^(A|C|D[fw][ab])/.test(code)) lush += a; if (code === 'EF') ice += a; }
      const share = lush / Math.max(1e-9, land);
      out.push({ level: share > 0.3 ? 'ok' : share > 0.08 ? 'info' : 'warn', text: `${fmt.int(share * 100)} % of the land is warm and wet enough for forests and farming (tropical, temperate or the milder continental climates).` });
      if (ice / Math.max(1e-9, land) > 0.4) out.push({ level: 'info', text: `${fmt.int((100 * ice) / land)} % of the land lies under ice.` });
      if (cache.pl.locked) out.push({ level: 'info', text: 'A tidally locked world: one face always day, the other always night.' });
      return out;
    },
  });
})();
