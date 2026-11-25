/*
 * Rivers & biomes: where the rain goes (rivers, fresh and salt lakes, basins with no way to the
 * sea) and what grows (biomes), from the world map and its climate.
 */
(function () {
  'use strict';
  const { h, panel, fmt, replace, tabs } = WS.ui;
  const B = WS.biomes;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const hex = (h2) => [1, 3, 5].map((i) => parseInt(h2.slice(i, i + 2), 16));
  const ramp = (stops, x) => { if (x <= stops[0][0]) return stops[0][1]; for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (x - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * t); } return stops[stops.length - 1][1]; };
  const SEA = [34, 66, 110], SHELF = [52, 92, 138], FRESH = [64, 124, 186], SALT = [176, 204, 204], ICE = [236, 242, 246], RIVER = 'rgb(36, 92, 172)';
  const WATER = [[0, [228, 210, 170]], [50, [214, 204, 156]], [200, [176, 196, 132]], [500, [120, 174, 108]], [1000, [70, 140, 96]], [2000, [34, 98, 78]]];
  const LAYERS = [['biomes', 'Biomes'], ['water', 'Water & basins']];

  // worked out once per climate (and planet), shared with the checks
  let cache = null;
  /* Rivers and biomes of a world (worked out if need be). With {peek: true}, only what is ready. */
  WS.currentBiomes = (w, d, opts = {}) => {
    const c = WS.currentClimate(w, d, { peek: opts.peek });
    if (!c) return null;
    const pl = B.planetOf(w, d);
    if (cache && cache.climRef === c && JSON.stringify(cache.pl) === JSON.stringify(pl)) return cache;
    if (opts.peek) return null;
    cache = { climRef: c, bio: B.build(c.mapRef.map, c.clim, pl), pl };
    return cache;
  };

  /* Everything for drawing, as one ZIP: works out the climate and the rivers first if need be. */
  WS.exportDrawingKit = async (ctx, button) => {
    const w = ctx.world, d = ctx.d;
    if (!w.plates.features.some((f) => f.kind === 'crust')) { WS.ui.toast('Make a world on the Plates step first.'); return; }
    const label = button ? button.textContent : '';
    if (button) { button.disabled = true; button.textContent = 'Working it out…'; }
    try {
      await WS.climateReady(w, d);                         // (the map and its climate off the page's thread)
      const c = WS.currentBiomes(w, d);
      const k = await WS.drawkit.kit(w, c.climRef.mapRef.map, c.climRef.clim, c.bio, { radiusKm: d.planet.radiusKm, gravity: d.planet.gravity, tilt: w.planet.tilt });
      const a = document.createElement('a'); a.href = URL.createObjectURL(k.blob); a.download = k.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      WS.ui.toast(`Drawing kit: ${k.files.length} files`);
    } finally { if (button) { button.disabled = false; button.textContent = label; } }
  };

  WS.defineStep({
    id: 'biomes', title: 'Rivers & biomes', code: '00_SURFACE/BIOMES', strip: 'Rivers, lakes, biomes',
    blurb: 'Rivers, lakes, inland basins and biomes, from the map and its climate.',
    lede: ['Where the rain goes and what grows there: rivers down to the sea, fresh lakes and salt lakes, basins with no way out, and the biomes of every coast and range.'],
    build(ctx) {
      const u = (ctx.ui.biomes = ctx.ui.biomes || { layer: 'biomes', view: 'map', rivers: true, lat: 20, lon: 0 });
      const host = h('div', { class: 'scene-host' }), hint = h('div', { class: 'scene-status mono' });
      const bar = h('div', { class: 'map-bar' }), keyHost = h('div'), statsHost = h('div'), expHost = h('div');
      const el = h('div', { class: 'stack-gap' },
        panel('Rivers & biomes', { ticks: true, tag: 'PRESENT DAY', flush: true }, bar, host, h('div', { class: 'viz-caption' }, hint)),
        h('div', { class: 'grid two' },
          h('div', { class: 'stack-gap' }, statsHost),
          h('div', { class: 'stack-gap' }, keyHost, panel('Take it away', { tag: 'EXPORT' }, expHost))));
      let bio = null, map = null, clim = null, img = null, busy = false;
      const proj = () => (u.view === 'globe' ? 'globe' : 'flat'), saved = u.cam && u.cam.projection === proj() ? u.cam : null;
      const view = WS.globe.create(host, { projection: proj(), lat: saved ? saved.lat : 20, lon: saved ? saved.lon : 0, alt: saved && !saved.auto ? saved.alt : null, radiusKm: ctx.d.planet.radiusKm, label: 'Rivers and biomes map', onView: (v) => { u.cam = v; }, onHover: (p) => hover(p) });

      function ensure() {
        const w = ctx.world, d = ctx.d;
        if (!w.plates.features.some((f) => f.kind === 'crust')) { bio = null; return; }
        if (busy) return;
        const have = WS.currentBiomes(w, d, { peek: true });
        if (have) { if (bio !== have.bio || !img) { bio = have.bio; map = have.climRef.mapRef.map; clim = have.climRef.clim; paint(); renderStats(); renderKey(); hint.textContent = `${bio.W} × ${bio.H} cells · hover for a place`; } return; }
        busy = true; hint.textContent = 'Working out the map, its climate, rivers and biomes…'; show();
        const t0 = performance.now();
        WS.climateReady(w, d).then(() => new Promise((r) => setTimeout(r, 0))).then(() => {
          busy = false;
          const c = host.isConnected && WS.currentBiomes(w, d);
          if (!c) return;
          bio = c.bio; map = c.climRef.mapRef.map; clim = c.climRef.clim;
          paint(); renderStats(); renderKey();
          hint.textContent = `${bio.W} × ${bio.H} cells · ${fmt.int(performance.now() - t0)} ms`;
          WS.app.refresh();
        }, (err) => { busy = false; hint.textContent = `Could not work it out: ${err.message}`; });
      }

      /* Colours for every cell (the viewer lights them by the slope). */
      function paint() {
        if (!bio) return;
        const { W, H } = bio, z = map.z, px = new Uint8ClampedArray(W * H * 4);
        for (let k = 0; k < W * H; k++) {
          let c;
          if (z[k] <= 0) c = bio.seaIce && bio.seaIce[k] ? ICE : z[k] > -200 ? SHELF : SEA;
          else if (bio.lake[k]) c = bio.lake[k] === 1 ? FRESH : SALT;
          else if (u.layer === 'biomes') c = hex(bio.biomes[bio.biome[k] - 1]?.[2] || '#888888');
          // (ice sheets shed no running water, but they are not dry land: shown as ice)
          else if (bio.biomes[bio.biome[k] - 1]?.[0] === 'ice') c = ICE;
          else { c = ramp(WATER, bio.runoff[k]); if (bio.inland[k]) c = [c[0] * 0.85 + 40, c[1] * 0.85 + 14, c[2] * 0.85]; }
          px.set([c[0], c[1], c[2], 255], k * 4);
        }
        img = new ImageData(px, W, H);
        show();
      }

      // ── the map viewer: the layer draped over the map's relief, rivers as lines on top ──
      const size = () => {
        const w = host.clientWidth || 700;
        host.style.height = `${u.view === 'map' ? Math.round(w / 2) : Math.round(clamp(w * 0.8, 320, window.innerHeight * 0.75))}px`;
      };
      const ro = new ResizeObserver(size);
      let shownMap = null;
      function show() {
        view.setRadius(ctx.d.planet.radiusKm);
        if (!bio || !img) { view.setHeight(null); view.setLayer(null); shownMap = null; view.setMessage(busy ? 'Working out rivers and biomes…' : ctx.world.plates.features.some((f) => f.kind === 'crust') ? '' : 'Make a world on the Plates step first.'); return; }
        view.setMessage('');
        if (shownMap !== map) { view.setHeight({ W: map.W, H: map.H, z: map.z, factor: map.planet?.factor ?? 1 }); shownMap = map; }
        view.setLayer({ W: img.width, H: img.height, data: img.data });
        view.setOverlay(u.rivers ? (g, v) => drawRivers(g, v.project, riverScale(v), v.w, v.h) : null);
      }
      /* Rivers a little wider as the view closes in. */
      const riverScale = (v) => clamp(0.9 * Math.pow(v.scale / 2.5, 0.35), 0.7, 3);
      const riverWidth = (q, scale) => scale * (0.5 + 0.75 * Math.log10(1 + q / bio.minFlow));
      /* Every river's segments gathered by width (a quarter pixel apart), one path a width, skipping what is out of sight. */
      function drawRivers(gg, proj, scale, W, H) {
        gg.strokeStyle = RIVER; gg.lineCap = 'round'; gg.lineJoin = 'round';
        const out = (p) => p[0] < -20 || p[1] < -20 || p[0] > W + 20 || p[1] > H + 20;
        const paths = new Map();
        for (const rv of bio.rivers) {
          let prev = null, w = -1, path = null;
          for (let i = 0; i < rv.pts.length; i++) {
            const p = proj(rv.pts[i][0], rv.pts[i][1]);
            const ok = prev && p[2] && prev[2] && Math.abs(p[0] - prev[0]) < W / 4 && !(out(p) && out(prev));
            if (ok) {
              const wi = Math.round(riverWidth(rv.q[i], scale) * 4) / 4;
              if (!path || wi !== w) { w = wi; path = paths.get(wi); if (!path) { path = new Path2D(); paths.set(wi, path); } path.moveTo(prev[0], prev[1]); }
              path.lineTo(p[0], p[1]);
            } else path = null;
            prev = p;
          }
        }
        for (const [wi, path] of [...paths].sort((x, y) => x[0] - y[0])) { gg.lineWidth = wi; gg.stroke(path); }
      }

      // ── reading a place ──
      function hover(p) {
        if (!bio || !p) return;
        const j = clamp(Math.floor(((90 - p[0]) / 180) * bio.H), 0, bio.H - 1), i = clamp(Math.floor(((p[1] + 180) / 360) * bio.W), 0, bio.W - 1), k = j * bio.W + i;
        const z = map.z[k], parts = [`${fmt.num(p[0], 1)}°, ${fmt.num(p[1], 1)}°`];
        if (z <= 0) parts.push('sea');
        else {
          parts.push(`${fmt.int(z)} m`);
          if (bio.lake[k]) parts.push(bio.lake[k] === 1 ? 'fresh lake' : 'salt lake');
          else parts.push(bio.biomes[bio.biome[k] - 1]?.[1] || '');
          if (bio.flow[k] >= 20) parts.push(`${fmt.int(bio.flow[k])} m³/s downstream`);
          if (bio.inland[k]) parts.push('drains inland');
        }
        hint.textContent = parts.join(' · ');
      }
      // ── panels ──
      function renderBar() {
        const layerSel = h('select', { class: 'sel', 'aria-label': 'Layer', style: { width: 'auto' } }, LAYERS.map(([v, t]) => h('option', { value: v, selected: u.layer === v }, t)));
        layerSel.addEventListener('change', () => { u.layer = layerSel.value; paint(); renderKey(); });
        const rv = h('input', { type: 'checkbox', checked: u.rivers });
        rv.addEventListener('change', () => { u.rivers = rv.checked; show(); });
        replace(bar, tabs([['map', 'Map'], ['globe', 'Globe']], u.view, (v) => { u.view = v; renderBar(); size(); view.setProjection(proj()); }), layerSel, h('label', { class: 'check' }, rv, 'Rivers'));
      }
      function renderKey() {
        const sw = (c) => h('i', { style: { display: 'inline-block', width: '22px', height: '10px', background: `rgb(${c.map(Math.round).join(',')})`, verticalAlign: 'middle', marginRight: '6px' } });
        let items = [];
        if (u.layer === 'biomes' && bio) {
          const order = bio.stats.biomeShare.map((v, i) => [i, v]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
          items = order.map(([i, v]) => [hex(bio.biomes[i][2]), `${bio.biomes[i][1]} ${fmt.int(v * 100) === '0' ? '<1' : fmt.int(v * 100)} %`]);
        } else items = WATER.map(([t, c]) => [c, `${t} mm/yr`]).concat([[[226, 190, 140], 'drains inland'], [ICE, 'ice sheet']]);
        items.push([FRESH, 'fresh lake'], [SALT, 'salt lake']);
        if (bio && bio.seaIce && bio.seaIce.some((v) => v)) items.push([ICE, 'sea ice (winter)']);
        replace(keyHost, panel('Key', { tag: LAYERS.find((l) => l[0] === u.layer)[1].toUpperCase() }, h('div', { class: 'map-key mono', style: { marginLeft: 0 } }, items.map(([c, t]) => h('span', null, sw(c), t)),
          h('span', null, h('i', { style: { display: 'inline-block', width: '22px', height: '3px', background: RIVER, verticalAlign: 'middle', marginRight: '6px' } }), `river (from ${fmt.int(bio ? bio.minFlow : 600)} m³/s)`))));
      }
      function renderStats() {
        if (!bio) { replace(statsHost); return; }
        const s = bio.stats, k = (n) => fmt.int(n);
        const rows = bio.liquid && s.endorheic !== null
          ? [['Longest river', `${k(s.longest.km)} km`, s.longest.at ? `mouth at ${fmt.num(s.longest.at[0], 0)}°, ${fmt.num(s.longest.at[1], 0)}°` : '—'],
            ['Largest river', s.biggest ? `${k(s.biggest.flow)} m³/s` : '—', 'at its mouth (the Amazon: about 200 000)'],
            ['Rivers to the sea', `${k(s.mouths)}`, `of ${k(bio.minFlow)} m³/s or more`],
            ['Lakes', `${k(s.lakes)}`, `${k(s.saltLakes)} of them salt · ${fmt.num(s.lakeShare * 100, 1)} % of the land`],
            ['Drains inland', `${k(s.endorheic * 100)} %`, 'of the land never reaches the sea'],
          ]
          : [['Rivers', 'none', bio.liquid ? 'too cold: the water is all ice' : 'water cannot stay liquid here']];
        const top = s.biomeShare.map((v, i) => [bio.biomes[i][1], v]).sort((a, b) => b[1] - a[1]).slice(0, 3);
        rows.push(...top.map(([n, v], i) => [i ? '' : 'Most land', `${k(v * 100)} %`, n]));
        replace(statsHost, h('div', { class: 'readouts' }, rows.map(([l, v, sub]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l), h('div', { class: 'val' }, v), h('div', { class: 'sub' }, sub)))));
      }
      const fileName = (what, ext) => `${(ctx.world.name || 'world').replace(/[^\w-]+/g, '_')}-${what}.${ext}`;
      const save = (blob, name) => { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove(); };
      function exportPng() {
        if (!img) return;
        const F = 2, big = view.renderEquirect(bio.W * F, bio.H * F), bg = big.getContext('2d');
        if (u.rivers) drawRivers(bg, (la, lo) => [((lo + 180) / 360) * big.width, ((90 - la) / 180) * big.height, true], F * 0.9, big.width, big.height);
        big.toBlob((b) => save(b, fileName(u.layer, 'png')));
      }
      function exportSvg() {
        if (!bio) return;
        const f = (x) => Math.round(x * 100) / 100;
        const lines = bio.rivers.map((rv) => {
          const q = rv.q.reduce((a, b) => Math.max(a, b), 0);
          return `<polyline points="${rv.pts.map(([la, lo]) => `${f(lo + 180)},${f(90 - la)}`).join(' ')}" stroke-width="${f(0.04 + 0.06 * Math.log10(1 + q / bio.minFlow))}" data-flow="${Math.round(q)}"/>`;
        });
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 180" width="3600" height="1800">\n<g fill="none" stroke="#245cac" stroke-linecap="round" stroke-linejoin="round">\n${lines.join('\n')}\n</g>\n</svg>\n`;
        save(new Blob([svg], { type: 'image/svg+xml' }), fileName('rivers', 'svg'));
      }
      function renderExport() {
        replace(expHost, h('div', { class: 'btn-row' },
          h('button', { class: 'btn small primary', type: 'button', onclick: (e) => WS.exportDrawingKit(ctx, e.currentTarget) }, 'Drawing kit (ZIP)'),
          h('button', { class: 'btn small', type: 'button', onclick: exportPng }, 'This map (PNG)'),
          h('button', { class: 'btn small', type: 'button', onclick: exportSvg }, 'Rivers (SVG)')));
      }

      return {
        el,
        update() {
          if (!ro._on) { ro.observe(host); ro._on = true; }
          renderBar(); renderKey(); renderExport();
          ensure();
          renderStats(); size(); show();
        },
        destroy() { ro.disconnect(); view.destroy(); },
      };
    },
    checks(w, d) {
      if (!w.plates.features.some((f) => f.kind === 'crust')) return [{ level: 'info', text: 'No continents yet: make a world on the Plates step.' }];
      const c = WS.currentBiomes(w, d, { peek: true });
      if (!c) return [{ level: 'info', text: 'Open this step to work out the rivers and biomes.' }];
      const b = c.bio, s = b.stats, out = [];
      if (!b.liquid) out.push({ level: 'warn', text: 'Water cannot stay liquid here (too thin an atmosphere, or too hot): no rivers or lakes.' });
      else if (s.endorheic === null) out.push({ level: 'info', text: 'Too cold for running water: no rivers, only ice.' });
      else {
        out.push({ level: 'ok', text: `${fmt.int(s.mouths)} rivers reach the sea; the longest runs ${fmt.int(s.longest.km)} km.` });
        if (s.endorheic > 0.35) out.push({ level: 'info', text: `${fmt.int(s.endorheic * 100)} % of the land drains into inland basins and salt lakes.` });
      }
      return out;
    },
  });
})();
