/*
 * Rivers & biomes: where the rain goes (rivers, fresh and salt lakes, basins with no way to the
 * sea) and what grows (biomes), from the world map and its climate.
 */
(function () {
  'use strict';
  const { h, panel, fmt, replace, tabs } = WS.ui;
  const B = WS.biomes, S = WS.sphere;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
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
      const cv = h('canvas', { class: 'scene-canvas', role: 'img', 'aria-label': 'Rivers and biomes map' });
      host.appendChild(cv);
      const g = cv.getContext('2d');
      let bio = null, map = null, clim = null, img = null, off = null, busy = false;

      function ensure() {
        const w = ctx.world, d = ctx.d;
        if (!w.plates.features.some((f) => f.kind === 'crust')) { bio = null; return; }
        if (busy) return;
        const have = WS.currentBiomes(w, d, { peek: true });
        if (have) { if (bio !== have.bio || !off) { bio = have.bio; map = have.climRef.mapRef.map; clim = have.climRef.clim; paint(); renderStats(); renderKey(); hint.textContent = `${bio.W} × ${bio.H} cells · hover for a place`; } return; }
        busy = true; hint.textContent = 'Working out rivers and biomes…'; draw();
        setTimeout(() => {
          const t0 = performance.now(), c = WS.currentBiomes(w, d);
          bio = c.bio; map = c.climRef.mapRef.map; clim = c.climRef.clim; busy = false;
          paint(); renderStats(); renderKey(); draw();
          hint.textContent = `${bio.W} × ${bio.H} cells · ${fmt.int(performance.now() - t0)} ms`;
          WS.app.refresh();
        }, 30);
      }

      /* Colours for every cell, lightly shaded by the slope. */
      function paint() {
        if (!bio) return;
        const { W, H } = bio, z = map.z, px = new Uint8ClampedArray(W * H * 4), f = map.planet?.factor ?? 1;
        for (let k = 0; k < W * H; k++) {
          const i = k % W, j = (k - i) / W;
          let c;
          if (z[k] <= 0) c = clim && clim.ice[Math.min(clim.H - 1, Math.floor((j * clim.H) / H)) * clim.W + Math.floor((i * clim.W) / W)] ? ICE : z[k] > -200 ? SHELF : SEA;
          else if (bio.lake[k]) c = bio.lake[k] === 1 ? FRESH : SALT;
          else if (u.layer === 'biomes') c = hex(bio.biomes[bio.biome[k] - 1]?.[2] || '#888888');
          // (ice sheets shed no running water, but they are not dry land: shown as ice)
          else if (bio.biomes[bio.biome[k] - 1]?.[0] === 'ice') c = ICE;
          else { c = ramp(WATER, bio.runoff[k]); if (bio.inland[k]) c = [c[0] * 0.85 + 40, c[1] * 0.85 + 14, c[2] * 0.85]; }
          if (z[k] > 0 && !bio.lake[k]) {
            const e = z[j * W + ((i + 1) % W)] - z[j * W + ((i - 1 + W) % W)], n = z[Math.max(0, j - 1) * W + i] - z[Math.min(H - 1, j + 1) * W + i];
            const sh = clamp(1 + (0.0009 * f) * (-e * 0.7 + n * 0.7), 0.72, 1.22);
            c = c.map((x) => x * sh);
          }
          px.set([c[0], c[1], c[2], 255], k * 4);
        }
        img = new ImageData(px, W, H);
        off = h('canvas'); off.width = W; off.height = H; off.getContext('2d').putImageData(img, 0, 0);
      }

      // ── drawing: map or globe, rivers as lines on top ──
      const fit = () => {
        const w = host.clientWidth || 700, hh = u.view === 'map' ? Math.round(w / 2) : Math.round(clamp(w * 0.8, 320, window.innerHeight * 0.75));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.style.height = `${hh}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
        draw();
      };
      const ro = new ResizeObserver(fit);
      const R = () => Math.min(cv.width, cv.height) * 0.46;
      const pr = () => S.orthographic(u.lat, u.lon, R(), cv.width / 2, cv.height / 2);
      const toScreen = (la, lo) => (u.view === 'map' ? [((lo + 180) / 360) * cv.width, ((90 - la) / 180) * cv.height, true] : pr().project([la, lo]));
      const riverWidth = (q, scale) => scale * (0.5 + 0.75 * Math.log10(1 + q / bio.minFlow));
      function draw() {
        if (!cv.width) return;
        g.fillStyle = css('--bg'); g.fillRect(0, 0, cv.width, cv.height);
        if (!bio || !off) { g.fillStyle = css('--muted'); g.font = `${16 * (cv.width / cv.clientWidth)}px ${css('--font-mono') || 'monospace'}`; g.fillText(busy ? 'Working out rivers and biomes…' : 'Make a world on the Plates step first.', 20, 40); return; }
        if (u.view === 'map') { g.imageSmoothingEnabled = false; g.drawImage(off, 0, 0, cv.width, cv.height); }
        else {
          const W = cv.width, H = cv.height, r = R(), cx = W / 2, cy = H / 2, out = g.createImageData(W, H), d = out.data;
          const la0 = u.lat * D2R, lo0 = u.lon * D2R, sla = Math.sin(la0), cla = Math.cos(la0);
          for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
            const o = (y * W + x) * 4, px2 = (x - cx) / r, py = (cy - y) / r, r2 = px2 * px2 + py * py;
            if (r2 > 1) { d[o + 3] = 0; continue; }
            const pz = Math.sqrt(1 - r2), la = Math.asin(clamp(pz * sla + py * cla, -1, 1)), lo = lo0 + Math.atan2(px2, pz * cla - py * sla);
            const j = clamp(Math.floor(((90 - la * R2D) / 180) * bio.H), 0, bio.H - 1), i = ((Math.floor(((((lo * R2D + 180) % 360) + 360) % 360) / 360 * bio.W)) % bio.W + bio.W) % bio.W;
            const k = (j * bio.W + i) * 4, lit = 0.6 + 0.4 * pz;
            d[o] = img.data[k] * lit; d[o + 1] = img.data[k + 1] * lit; d[o + 2] = img.data[k + 2] * lit; d[o + 3] = 255;
          }
          g.putImageData(out, 0, 0);
          g.strokeStyle = css('--line'); g.lineWidth = 1.5; g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.stroke();
        }
        if (u.rivers) drawRivers(g, toScreen, (cv.width / Math.max(1, cv.clientWidth)) * (u.view === 'map' ? clamp(cv.clientWidth / 900, 0.7, 1.6) : 1));
      }
      function drawRivers(gg, proj, scale) {
        gg.strokeStyle = RIVER; gg.lineCap = 'round'; gg.lineJoin = 'round';
        for (const rv of bio.rivers) {
          let prev = null;
          for (let i = 0; i < rv.pts.length; i++) {
            const p = proj(rv.pts[i][0], rv.pts[i][1]);
            if (prev && p[2] && prev[2] && Math.abs(p[0] - prev[0]) < gg.canvas.width / 4) {
              gg.lineWidth = riverWidth(rv.q[i], scale);
              gg.beginPath(); gg.moveTo(prev[0], prev[1]); gg.lineTo(p[0], p[1]); gg.stroke();
            }
            prev = p;
          }
        }
      }

      // ── pointer: turn the globe, read a place ──
      let drag = null;
      const at = (e) => {
        const r = cv.getBoundingClientRect(), dpr = cv.width / r.width, x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
        return u.view === 'map' ? [90 - (y / cv.height) * 180, (x / cv.width) * 360 - 180] : pr().invert(x, y);
      };
      cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, lat: u.lat, lon: u.lon }; if (u.view === 'globe') cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', (e) => {
        const p = at(e);
        if (bio && p) {
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
        if (!drag || u.view !== 'globe') return;
        const kk = (180 / Math.PI) / R() * (cv.width / cv.clientWidth);
        u.lon = ((drag.lon - (e.clientX - drag.x) * kk / Math.max(0.2, Math.cos(u.lat * D2R))) + 540) % 360 - 180;
        u.lat = clamp(drag.lat + (e.clientY - drag.y) * kk, -89, 89);
        draw();
      });
      const end = () => { drag = null; };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
      cv.style.touchAction = 'none';

      // ── panels ──
      function renderBar() {
        const layerSel = h('select', { class: 'sel', 'aria-label': 'Layer', style: { width: 'auto' } }, LAYERS.map(([v, t]) => h('option', { value: v, selected: u.layer === v }, t)));
        layerSel.addEventListener('change', () => { u.layer = layerSel.value; paint(); draw(); renderKey(); });
        const rv = h('input', { type: 'checkbox', checked: u.rivers });
        rv.addEventListener('change', () => { u.rivers = rv.checked; draw(); });
        replace(bar, tabs([['map', 'Map'], ['globe', 'Globe']], u.view, (v) => { u.view = v; renderBar(); fit(); }), layerSel, h('label', { class: 'check' }, rv, 'Rivers'));
      }
      function renderKey() {
        const sw = (c) => h('i', { style: { display: 'inline-block', width: '22px', height: '10px', background: `rgb(${c.map(Math.round).join(',')})`, verticalAlign: 'middle', marginRight: '6px' } });
        let items = [];
        if (u.layer === 'biomes' && bio) {
          const order = bio.stats.biomeShare.map((v, i) => [i, v]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
          items = order.map(([i, v]) => [hex(bio.biomes[i][2]), `${bio.biomes[i][1]} ${fmt.int(v * 100) === '0' ? '<1' : fmt.int(v * 100)} %`]);
        } else items = WATER.map(([t, c]) => [c, `${t} mm/yr`]).concat([[[226, 190, 140], 'drains inland'], [ICE, 'ice sheet']]);
        items.push([FRESH, 'fresh lake'], [SALT, 'salt lake']);
        if (clim && clim.ice.some((v) => v)) items.push([ICE, 'sea ice (winter)']);
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
        if (!off) return;
        const F = 2, big = h('canvas'); big.width = bio.W * F; big.height = bio.H * F;
        const bg = big.getContext('2d'); bg.imageSmoothingEnabled = false; bg.drawImage(off, 0, 0, big.width, big.height);
        if (u.rivers) drawRivers(bg, (la, lo) => [((lo + 180) / 360) * big.width, ((90 - la) / 180) * big.height, true], F * 0.9);
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
          h('button', { class: 'btn small primary', type: 'button', onclick: exportPng }, 'This map (PNG)'),
          h('button', { class: 'btn small', type: 'button', onclick: exportSvg }, 'Rivers (SVG)')));
      }

      return {
        el,
        update() {
          if (!ro._on) { ro.observe(host); ro._on = true; }
          renderBar(); renderKey(); renderExport();
          ensure();
          renderStats(); fit();
        },
        destroy() { ro.disconnect(); },
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
