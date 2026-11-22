/*
 * Vector-display visualisations. Every diagram is plain SVG drawn with
 * CSS-classed strokes, so both themes recolour them for free.
 */
(function (root) {
  'use strict';
  const WS = (root.WS = root.WS || {});
  const { s, h, fmt } = WS.ui;
  const TAU = Math.PI * 2;

  const svgBox = (w, hgt, label, ...kids) =>
    s('svg', { class: 'viz', viewBox: `0 0 ${w} ${hgt}`, role: 'img', 'aria-label': label, preserveAspectRatio: 'xMidYMid meet' }, ...kids);
  const text = (x, y, str, cls = '', extra = {}) => s('text', { x, y, class: cls, ...extra }, str);
  const line = (x1, y1, x2, y2, cls = 'ln') => s('line', { x1, y1, x2, y2, class: cls });
  const circle = (cx, cy, r, cls = 'ln') => s('circle', { cx, cy, r, class: cls });
  const ring = (cx, cy, r1, r2, cls) => s('path', {
    class: cls, 'fill-rule': 'evenodd',
    d: `M${cx - r2},${cy}a${r2},${r2} 0 1,0 ${2 * r2},0a${r2},${r2} 0 1,0 ${-2 * r2},0Z M${cx - r1},${cy}a${r1},${r1} 0 1,0 ${2 * r1},0a${r1},${r1} 0 1,0 ${-2 * r1},0Z`,
  });
  const poly = (pts, cls = 'ln') => s('path', { class: cls, d: 'M' + pts.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join('L') });

  /* Blackbody colour for a temperature (Tanner Helland approximation). */
  function kelvinRGB(k) {
    const t = Math.max(1000, Math.min(40000, k)) / 100;
    let r, g, b;
    if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
    else { r = 329.7 * (t - 60) ** -0.1332; g = 288.12 * (t - 60) ** -0.0755; b = 255; }
    const c = (x) => Math.round(Math.max(0, Math.min(255, x)));
    return `rgb(${c(r)},${c(g)},${c(b)})`;
  }

  // ── GALAXY: top-down disc ────────────────────────────────────────────
  function galaxyMap(g, gd) {
    const W = 420, C = 210, R = 185;
    const k = R / g.radius;
    const kids = [];
    kids.push(circle(C, C, R, 'ln-faint dash'));
    // four logarithmic arms, drawn as dotted phosphor trails
    for (let arm = 0; arm < 4; arm++) {
      const pts = [];
      for (let t = 0; t < 3.6; t += 0.04) {
        const r = R * 0.08 * Math.exp(0.7 * t);
        if (r > R * 0.98) break;
        const a = t + (arm * TAU) / 4;
        pts.push([C + r * Math.cos(a), C + r * Math.sin(a)]);
      }
      kids.push(poly(pts, arm % 2 ? 'ln-soft dot' : 'ln-soft'));
    }
    kids.push(circle(C, C, 14, 'fill-amber'), circle(C, C, 6, 'solid-amber glow'));
    kids.push(ring(C, C, gd.ghzIn * k, gd.ghzOut * k, 'fill-teal'));
    kids.push(circle(C, C, gd.ghzIn * k, 'ln-teal dash'), circle(C, C, gd.ghzOut * k, 'ln-teal dash'));
    // you are here
    const ang = -Math.PI / 5;
    const lr = Math.min(g.location, g.radius * 1.05) * k;
    const x = C + lr * Math.cos(ang), y = C + lr * Math.sin(ang);
    const cls = gd.inGhz ? 'ln-amber' : 'ln-red';
    kids.push(line(C, C, x, y, 'ln-faint dash'));
    kids.push(circle(x, y, 9, cls), line(x - 15, y, x + 15, y, cls), line(x, y - 15, x, y + 15, cls), circle(x, y, 2.5, gd.inGhz ? 'solid-amber' : 'solid-red'));
    kids.push(text(Math.min(x + 14, W - 130), y - 14, 'YOU ARE HERE', 't-amber t-ui'));
    kids.push(text(Math.min(x + 14, W - 130), y + 22, `${fmt.int(g.location)} ly`, 't-amber'));
    // scale bar
    kids.push(line(C, W - 8, C + R, W - 8, 'ln-soft'), line(C, W - 12, C, W - 4, 'ln-soft'), line(C + R, W - 12, C + R, W - 4, 'ln-soft'));
    kids.push(text(C + R / 2 - 30, W - 14, `${fmt.int(g.radius)} ly`));
    return svgBox(W, W, 'Galaxy map with the habitable zone and your location', ...kids);
  }

  // ── GALAXY: stellar neighbourhood, rotatable wireframe sphere ─────────
  function neighbourhood(gd, radius, yaw, pitch, names) {
    const W = 420, C = 210, R = 170;
    const k = R / radius;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const proj = (x, y, z) => {
      const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
      const y2 = y1 * cp - z * sp, z2 = y1 * sp + z * cp;
      return [C + x1 * k, C - z2 * k, y2];
    };
    const kids = [];
    // sphere wireframe: latitude & longitude circles
    const curve = (fn, n = 48) => { const pts = []; for (let i = 0; i <= n; i++) pts.push(fn((i / n) * TAU)); return pts; };
    for (const lat of [-60, -30, 0, 30, 60]) {
      const r = radius * Math.cos((lat * Math.PI) / 180), z = radius * Math.sin((lat * Math.PI) / 180);
      kids.push(poly(curve((t) => proj(r * Math.cos(t), r * Math.sin(t), z)), lat === 0 ? 'ln-soft' : 'ln-faint'));
    }
    for (let m = 0; m < 6; m++) {
      const a = (m / 6) * Math.PI;
      kids.push(poly(curve((t) => proj(radius * Math.cos(t) * Math.cos(a), radius * Math.cos(t) * Math.sin(a), radius * Math.sin(t))), 'ln-faint'));
    }
    // axes
    for (const [ax, lbl] of [[[1, 0, 0], 'x'], [[0, 1, 0], 'y'], [[0, 0, 1], 'z']]) {
      const p = proj(ax[0] * radius * 1.1, ax[1] * radius * 1.1, ax[2] * radius * 1.1);
      kids.push(line(C, C, p[0], p[1], 'ln-faint dash'), text(p[0] + 3, p[1] - 3, lbl));
    }
    const pts = gd.systems.map((sys) => ({ sys, p: proj(sys.x, sys.y, sys.z) })).sort((a, b) => b.p[2] - a.p[2]);
    for (const { sys, p } of pts) {
      const isN = gd.nearest && sys.index === gd.nearest.index;
      const isF = gd.farthest && sys.index === gd.farthest.index;
      const depth = 0.55 + 0.45 * (1 - (p[2] / radius + 1) / 2);
      const base = proj(sys.x, sys.y, 0);
      kids.push(line(base[0], base[1], p[0], p[1], 'ln-faint'));
      kids.push(s('circle', { cx: p[0], cy: p[1], r: 3 + 2.5 * depth, class: isN ? 'solid-teal glow' : isF ? 'solid-red' : 'solid-line glow', opacity: depth.toFixed(2) }));
      kids.push(text(p[0] + 7, p[1] + 4, (names && names[sys.index]) || String(sys.index), isN ? 't-teal' : isF ? 't-line' : '', { opacity: depth.toFixed(2) }));
    }
    kids.push(circle(C, C, 7, 'ln-amber'), circle(C, C, 3, 'solid-amber glow'), text(C + 10, C - 8, 'HOME', 't-amber t-ui'));
    return svgBox(W, W, 'Rotatable map of nearby star systems', ...kids);
  }

  // ── STAR ──────────────────────────────────────────────────────────────
  function starDisc(st) {
    const W = 460, H = 250, cy = 105;
    const base = 46;
    const sizePx = (r) => (r <= 2.5 ? base * r : base * 2.5 * (1 + Math.log10(r / 2.5)));
    const rS = Math.max(2, sizePx(st.radius));
    const col = kelvinRGB(st.temperature);
    const id = `sg${Math.round(st.temperature)}`;
    const kids = [
      s('defs', null, s('radialGradient', { id },
        s('stop', { offset: '0%', 'stop-color': '#fff', 'stop-opacity': 1 }),
        s('stop', { offset: '45%', 'stop-color': col, 'stop-opacity': 1 }),
        s('stop', { offset: '100%', 'stop-color': col, 'stop-opacity': 0 }))),
    ];
    const sx = 150;
    kids.push(s('circle', { cx: sx, cy, r: rS * 1.6, fill: `url(#${id})`, opacity: 0.55 }));
    kids.push(s('circle', { cx: sx, cy, r: rS, fill: col, opacity: 0.92 }));
    kids.push(circle(sx, cy, base, 'ln-teal dash'));
    kids.push(text(sx - base, cy + base + 18, 'SOL = 1 R☉', 't-teal t-ui'));
    // readout callouts
    const rx = 300;
    kids.push(line(sx + Math.min(rS, 90), cy, rx - 8, cy, 'ln-faint dash'));
    kids.push(text(rx, cy - 30, st.spectral.code, 't-amber', { 'font-size': 38 }));
    kids.push(text(rx, cy, `${fmt.int(st.temperature)} K`, 't-text', { 'font-size': 22 }));
    kids.push(text(rx, cy + 24, `${fmt.num(st.radius, 3)} R☉`, '', { 'font-size': 18 }));
    // spectral strip, log temperature
    const y0 = 205, x0 = 20, x1 = W - 20;
    const lt = (T) => x0 + ((Math.log10(T) - Math.log10(2000)) / (Math.log10(50000) - Math.log10(2000))) * (x1 - x0);
    const bands = [['M', 2000, 3700], ['K', 3700, 5200], ['G', 5200, 6000], ['F', 6000, 7500], ['A', 7500, 10000], ['B', 10000, 33000], ['O', 33000, 50000]];
    for (const [c, lo, hi] of bands) {
      const a = lt(lo), b = lt(hi);
      kids.push(s('rect', { x: a, y: y0, width: b - a, height: 10, fill: kelvinRGB((lo + hi) / 2), opacity: 0.75 }));
      kids.push(line(a, y0 - 4, a, y0 + 14, 'ln-soft'));
      kids.push(text((a + b) / 2 - 4, y0 + 30, c, c === st.spectral.letter ? 't-amber' : ''));
    }
    const mx = Math.max(x0, Math.min(x1, lt(st.temperature)));
    kids.push(s('path', { d: `M${mx - 7},${y0 - 14}L${mx + 7},${y0 - 14}L${mx},${y0 - 3}Z`, class: 'solid-amber glow' }));
    return svgBox(W, H, `Star disc and spectral class ${st.spectral.code}`, ...kids);
  }

  // ── PLANETARY SYSTEM: top-down log-scaled orbits ──────────────────────
  const KIND_STYLE = {
    terrestrial: { r: 4.5, cls: 'solid-line glow' },
    gas: { r: 9, cls: 'solid-amber glow', ring: true },
    ice: { r: 7, cls: 'solid-teal glow' },
    dwarf: { r: 2.5, cls: 'solid-line' },
    belt: { r: 0, cls: '' },
  };
  function systemMap(sd, st, bodies, planet, planetName) {
    const W = 480, C = 240, R0 = 26, R1 = 222;
    const maxA = Math.max(sd.debrisOut * 1.15, ...bodies.map((b) => b.a * 1.1), planet.a * 1.3, st.frostLine * 1.3);
    const minA = Math.max(0.005, Math.min(sd.innerLimit, sd.orbits[0].a, st.hzIn, planet.a, ...bodies.map((b) => b.a)) * 0.6);
    const L0 = Math.log10(minA), L1 = Math.log10(maxA);
    const rp = (a) => R0 + ((Math.log10(Math.max(a, minA)) - L0) / (L1 - L0)) * (R1 - R0);
    const kids = [];
    kids.push(ring(C, C, rp(sd.debrisIn), rp(sd.debrisOut), 'fill-amber'));
    kids.push(ring(C, C, rp(st.hzIn), rp(st.hzOut), 'fill-teal'));
    kids.push(circle(C, C, rp(st.hzIn), 'ln-teal'), circle(C, C, rp(st.hzOut), 'ln-teal'));
    for (const o of sd.orbits) if (o.a <= maxA) kids.push(circle(C, C, rp(o.a), o.crowded || o.insideLimit ? 'ln-red dot' : 'ln-faint'));
    kids.push(circle(C, C, rp(st.frostLine), 'ln-amber dash'));
    if (sd.innerLimit > minA) kids.push(circle(C, C, rp(sd.innerLimit), 'ln-red'));
    // star
    kids.push(circle(C, C, 9, 'fill-amber'), s('circle', { cx: C, cy: C, r: 5, fill: kelvinRGB(st.temperature) }));
    // bodies on a golden-angle spiral so labels rarely collide
    const all = [...bodies.map((b) => ({ ...b, home: false })), { id: 'home', name: planetName, a: planet.a, kind: 'terrestrial', home: true }]
      .sort((a, b) => a.a - b.a);
    all.forEach((b, i) => {
      const a = b.home ? -Math.PI / 4 : -Math.PI / 4 + (i + 1) * 2.39996;
      const r = rp(b.a);
      if (b.kind === 'belt') { kids.push(circle(C, C, r, 'ln-mute dot')); kids.push(text(C + r * Math.cos(a) + 6, C + r * Math.sin(a), b.name, '')); return; }
      const x = C + r * Math.cos(a), y = C + r * Math.sin(a);
      const st2 = KIND_STYLE[b.kind] || KIND_STYLE.terrestrial;
      if (b.home) {
        kids.push(circle(x, y, 10, 'ln-amber'), line(x - 16, y, x + 16, y, 'ln-amber'), line(x, y - 16, x, y + 16, 'ln-amber'), circle(x, y, 4, 'solid-amber glow'));
        kids.push(text(x < W - 110 ? x + 12 : x - 12, y - 12, b.name.toUpperCase(), 't-amber t-ui', { 'text-anchor': x < W - 110 ? 'start' : 'end' }));
      } else {
        kids.push(circle(x, y, st2.r, st2.cls));
        if (st2.ring) kids.push(s('ellipse', { cx: x, cy: y, rx: st2.r * 1.9, ry: st2.r * 0.55, class: 'ln-amber', transform: `rotate(-20 ${x} ${y})` }));
        const right = x < W - 90;
        kids.push(text(right ? x + st2.r + 4 : x - st2.r - 4, y + 4, b.name, 't-text', { 'text-anchor': right ? 'start' : 'end' }));
      }
    });
    // log ruler
    const decades = [];
    for (let e = Math.ceil(L0); e <= Math.floor(L1); e++) decades.push(10 ** e);
    kids.push(line(C, C + 4, C + R1, C + 4, 'ln-faint'));
    for (const v of decades) { const r = rp(v); kids.push(line(C + r, C, C + r, C + 8, 'ln-soft')); kids.push(text(C + r - 8, C + 22, v >= 1 ? `${v}` : `${v}`, '', { 'font-size': 13 })); }
    kids.push(text(C + R1 - 20, C + 36, 'AU', 't-ui'));
    return svgBox(W, W, 'Top-down map of the planetary system on a logarithmic scale', ...kids);
  }

  // ── PLANET: tilted wireframe globe (animated spin) ────────────────────
  function globe(tilt, tropics, polar, cells) {
    const W = 360, C = 180, R = 118, E = (18 * Math.PI) / 180;
    const g = s('g', { transform: `rotate(${tilt} ${C} ${C})` });
    const latPath = (phi, front) => {
      const yc = C - R * Math.sin(phi) * Math.cos(E), rx = R * Math.cos(phi), ry = R * Math.cos(phi) * Math.sin(E);
      return front ? `M${C - rx},${yc}A${rx},${ry} 0 0,0 ${C + rx},${yc}` : `M${C - rx},${yc}A${rx},${ry} 0 0,1 ${C + rx},${yc}`;
    };
    const lat = (deg, cls, backCls) => {
      const phi = (deg * Math.PI) / 180;
      g.appendChild(s('path', { d: latPath(phi, false), class: backCls || 'ln-faint' }));
      g.appendChild(s('path', { d: latPath(phi, true), class: cls }));
    };
    g.appendChild(circle(C, C, R, 'ln glow'));
    for (const d of [-75, -60, -45, -30, -15, 15, 30, 45, 60, 75]) lat(d, 'ln-soft');
    // circulation cell boundaries
    if (cells && cells.bands) for (const [, hi] of cells.bands) if (hi < 90) { lat(hi, 'ln-mute dash'); lat(-hi, 'ln-mute dash'); }
    lat(0, 'ln-amber glow');
    if (tropics > 0) { lat(tropics, 'ln-teal glow'); lat(-tropics, 'ln-teal glow'); }
    if (polar < 90) { lat(polar, 'ln-amber dash'); lat(-polar, 'ln-amber dash'); }
    const merid = s('g');
    g.appendChild(merid);
    g.appendChild(line(C, C - R - 34, C, C + R + 34, 'ln-amber dash'));
    g.appendChild(text(C + 6, C - R - 22, 'N', 't-amber'));
    const svg = svgBox(W, W, `Globe with ${tilt}° axial tilt, tropics and polar circles`,
      line(8, C, 44, C, 'ln-amber'), s('path', { d: `M44,${C - 5}L54,${C}L44,${C + 5}Z`, class: 'solid-amber' }), text(6, C - 10, '★ STAR', 't-amber t-ui'),
      line(C, 6, C, W - 6, 'ln-faint dot'), g);
    // spin: redraw meridians with a longitude offset
    const drawMeridians = (off) => {
      while (merid.firstChild) merid.removeChild(merid.firstChild);
      for (let m = 0; m < 12; m++) {
        const lon = off + (m * Math.PI) / 6;
        const ptsF = [], ptsB = [];
        for (let i = 0; i <= 36; i++) {
          const phi = -Math.PI / 2 + (i / 36) * Math.PI;
          const x = R * Math.cos(phi) * Math.sin(lon);
          const zf = R * Math.cos(phi) * Math.cos(lon);
          const y = -R * Math.sin(phi) * Math.cos(E) + zf * Math.sin(E);
          (zf >= 0 ? ptsF : ptsB).push([C + x, C + y]);
        }
        if (ptsB.length > 1) merid.appendChild(poly(ptsB, 'ln-faint'));
        if (ptsF.length > 1) merid.appendChild(poly(ptsF, 'ln-soft'));
      }
    };
    drawMeridians(0);
    svg._spin = drawMeridians;
    return svg;
  }

  // ── PLANET: circulation cells cross-section ───────────────────────────
  function cellsSection(cells, tropics, polar) {
    const W = 360, H = 350, cx = 40, cy = 175, R = 110, R2 = 150;
    const kids = [];
    const pt = (r, latDeg) => [cx + r * Math.cos((latDeg * Math.PI) / 180), cy - r * Math.sin((latDeg * Math.PI) / 180)];
    const sector = (a, b, cls) => {
      const [x1, y1] = pt(R, a), [x2, y2] = pt(R, b), [x3, y3] = pt(R2, b), [x4, y4] = pt(R2, a);
      const large = Math.abs(b - a) > 180 ? 1 : 0;
      const sweep = b > a ? 0 : 1;
      return s('path', { class: cls, d: `M${x1},${y1}A${R},${R} 0 ${large},${sweep} ${x2},${y2}L${x3},${y3}A${R2},${R2} 0 ${large},${1 - sweep} ${x4},${y4}Z` });
    };
    const names3 = ['HADLEY', 'FERREL', 'POLAR'];
    if (cells.bands) {
      cells.bands.forEach(([lo, hi], i) => {
        for (const sign of [1, -1]) {
          kids.push(sector(sign * lo, sign * hi, i % 2 ? 'fill-amber' : 'fill-teal'));
          const mid = sign * (lo + hi) / 2;
          // loop arrow showing the overturning direction (alternates per cell)
          const rr = (R + R2) / 2;
          const span = Math.max(2, (hi - lo) * 0.32);
          const dir = (i % 2 ? -1 : 1) * sign;
          const [ax, ay] = pt(rr - 9, mid - dir * span), [bx, by] = pt(rr - 9, mid + dir * span);
          const [cx2, cy2] = pt(rr + 9, mid + dir * span), [dx, dy] = pt(rr + 9, mid - dir * span);
          if (hi - lo >= 6) kids.push(s('path', { class: 'ln-soft', d: `M${ax},${ay}L${bx},${by}L${cx2},${cy2}L${dx},${dy}` }));
        }
        const [tx, ty] = pt(R2 + 8, (lo + hi) / 2);
        if (hi - lo >= 5) kids.push(text(tx, ty + 4, cells.count === 3 ? names3[i] : `CELL ${i + 1}`, 't-text t-ui'));
      });
      for (const [, hi] of cells.bands) for (const sign of [1, -1]) {
        const [a, b] = pt(R, sign * hi), [c, d] = pt(R2 + 4, sign * hi);
        kids.push(line(a, b, c, d, 'ln-soft'));
      }
    }
    kids.push(s('path', { class: 'ln glow', d: `M${cx},${cy - R}A${R},${R} 0 0,1 ${cx},${cy + R}` }));
    kids.push(line(cx, cy - R - 20, cx, cy + R + 20, 'ln-faint dash'));
    // tropics & polar circles on the surface
    for (const [latv, cls] of [[tropics, 'solid-teal'], [-tropics, 'solid-teal'], [polar, 'solid-amber'], [-polar, 'solid-amber']]) {
      const [x, y] = pt(R, latv);
      kids.push(circle(x, y, 3.5, cls));
    }
    const [ex, ey] = pt(R, 0);
    kids.push(line(cx, cy, ex, ey, 'ln-amber dash'), text(ex - 70, ey - 6, 'EQUATOR', 't-amber t-ui'));
    kids.push(text(cx + 4, cy - R - 8, '90°N', ''), text(cx + 4, cy + R + 18, '90°S', ''));
    return svgBox(W, H, `Atmospheric circulation: ${cells.count} cells per hemisphere`, ...kids);
  }

  // ── PLANET: daylight heat-map (canvas) ────────────────────────────────
  function daylightCanvas(grid, rotation) {
    const cv = h('canvas', { class: 'heat', width: grid.days, height: grid.lats, role: 'img', 'aria-label': 'Daylight hours by latitude through the year' });
    const ctx = cv.getContext('2d');
    if (!ctx) return cv;
    const img = ctx.createImageData(grid.days, grid.lats);
    const css = getComputedStyle(document.documentElement);
    const parse = (v) => { const m = v.trim().match(/^#?([0-9a-f]{6})$/i); const n = m ? parseInt(m[1], 16) : 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
    const c0 = parse(css.getPropertyValue('--bg') || '#000000');
    const c1 = parse(css.getPropertyValue('--line') || '#ff5a36');
    const c2 = parse(css.getPropertyValue('--amber') || '#ffb238');
    const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
    for (let j = 0; j < grid.lats; j++) {
      const row = grid.lats - 1 - j; // north at top
      for (let i = 0; i < grid.days; i++) {
        const f = grid.hours[j][i] / rotation;
        const col = f < 0.5 ? lerp(c0, c1, f * 2) : lerp(c1, c2, (f - 0.5) * 2);
        const o = (row * grid.days + i) * 4;
        img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  // ── MOON: log ruler of the moon zone ──────────────────────────────────
  function moonRuler(m, md, planetRadiusKm) {
    const W = 520, H = 170, x0 = 30, x1 = W - 20, y = 86;
    const lo = Math.min(planetRadiusKm, md.zoneIn) * 0.8;
    const hi = Math.max(md.zoneOut, md.apoapsis) * 1.15;
    const X = (km) => x0 + ((Math.log10(km) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (x1 - x0);
    const kids = [];
    kids.push(s('rect', { x: X(md.zoneIn), y: y - 14, width: X(md.zoneOut / 2) - X(md.zoneIn), height: 28, class: 'fill-teal' }));
    kids.push(s('rect', { x: X(md.zoneOut / 2), y: y - 14, width: X(md.zoneOut) - X(md.zoneOut / 2), height: 28, class: 'fill-amber' }));
    kids.push(line(x0, y, x1, y, 'ln-soft'));
    for (let e = Math.ceil(Math.log10(lo)); e <= Math.floor(Math.log10(hi)); e++) {
      const xx = X(10 ** e);
      kids.push(line(xx, y + 16, xx, y + 24, 'ln-soft'), text(xx - 14, y + 40, `10${'⁰¹²³⁴⁵⁶⁷⁸⁹'[e] || e}`, '', { 'font-size': 14 }));
    }
    kids.push(text(x1 - 20, y + 58, 'km', 't-ui'));
    const mark = (km, label, cls, up = true) => {
      const xx = X(km);
      kids.push(line(xx, y - 22, xx, y + 22, cls));
      kids.push(text(Math.min(xx + 3, W - 120), up ? y - 28 : y + 58, label, cls.includes('amber') ? 't-amber' : cls.includes('teal') ? 't-teal' : cls.includes('red') ? 't-line' : ''));
    };
    // planet disc at the left
    kids.push(circle(X(planetRadiusKm), y, 10, 'ln glow'), text(X(planetRadiusKm) - 16, y - 18, 'PLANET', 't-ui'));
    mark(md.zoneIn, 'ROCHE', 'ln-red');
    mark(md.zoneOut / 2, '½ HILL', 'ln-teal', false);
    mark(md.zoneOut, 'HILL', 'ln-amber');
    // moon orbit: periapsis–apoapsis bar + moon
    kids.push(s('rect', { x: X(md.periapsis), y: y - 5, width: Math.max(2, X(md.apoapsis) - X(md.periapsis)), height: 10, class: 'solid-amber', opacity: 0.6 }));
    kids.push(circle(X(m.a), y, 6, 'solid-amber glow'));
    kids.push(text(Math.min(X(m.a) - 20, W - 130), y + 76, `${(m.name || 'MOON').toUpperCase()} ${fmt.int(m.a)} km`, 't-amber t-ui'));
    return svgBox(W, H, 'Moon orbit against the allowed moon zone (logarithmic)', ...kids);
  }

  // ── SKY: positions seen from above ────────────────────────────────────
  function skyPositions(sky, aHome, homeName, bodies) {
    const W = 440, C = 220, R = 200;
    const maxA = Math.max(aHome, ...bodies.map((b) => b.a)) * 1.02;
    const sc = (a) => (Math.sqrt(a / maxA)) * R; // sqrt keeps inner planets legible
    const kids = [];
    kids.push(circle(C, C, 6, 'solid-amber glow'), text(C + 8, C - 8, '★', 't-amber'));
    kids.push(circle(C, C, sc(aHome), 'ln-amber dash'));
    const hx = C + sc(aHome), hy = C;
    sky.bodies.forEach((b, i) => {
      const src = bodies[i];
      if (!src) return;
      kids.push(circle(C, C, sc(src.a), 'ln-faint'));
      const fh = b.fromHome;
      const len = Math.hypot(fh.x, fh.y) || 1;
      const px = C + (fh.x / len) * sc(src.a), py = C - (fh.y / len) * sc(src.a);
      const visible = fh.visibility.startsWith('Naked');
      kids.push(line(hx, hy, px, py, visible ? 'ln-teal dot' : 'ln-faint dot'));
      kids.push(circle(px, py, 4, visible ? 'solid-teal glow' : 'solid-line'));
      kids.push(text(px + 6, py - 6, b.name, visible ? 't-teal' : 't-text', { 'font-size': 14 }));
    });
    kids.push(circle(hx, hy, 8, 'ln-amber'), circle(hx, hy, 3, 'solid-amber'), text(hx + 10, hy + 16, (homeName || 'HOME').toUpperCase(), 't-amber t-ui'));
    return svgBox(W, W, 'Current positions of the planets relative to the home world', ...kids);
  }

  function starSizes(sky, homeName) {
    const rows = [{ name: homeName || 'Home', ...sky.home, home: true }, ...sky.bodies.map((b) => ({ name: b.name, ...b.fromBody }))];
    const cols = Math.min(rows.length, 5);
    const cw = 100, rh = 132, W = cols * cw, H = Math.ceil(rows.length / cols) * rh;
    const kids = [];
    rows.forEach((r, i) => {
      const cx = (i % cols) * cw + cw / 2, cy = Math.floor(i / cols) * rh + 46;
      const rad = Math.max(0.8, Math.min(40, 14 * r.size));
      kids.push(circle(cx, cy, 40, 'ln-faint'));
      kids.push(s('circle', { cx, cy, r: rad, class: r.home ? 'solid-amber glow' : 'solid-line glow', opacity: Math.max(0.25, Math.min(1, 0.35 + 0.25 * Math.log10(r.brightness * 10 + 1))).toFixed(2) }));
      kids.push(text(cx, cy + 60, r.name.length > 12 ? `${r.name.slice(0, 11)}…` : r.name, r.home ? 't-amber' : 't-text', { 'font-size': 14, 'text-anchor': 'middle' }));
      kids.push(text(cx, cy + 76, `${fmt.num(r.size, 2)}×`, '', { 'font-size': 13, 'text-anchor': 'middle' }));
    });
    return svgBox(W, H, 'Apparent size of the star from each body', ...kids);
  }

  // ── TECTONICS: mountain cross-section ─────────────────────────────────
  function crossSection(range, maxPeak) {
    const W = 640, H = 270, x0 = 40, x1 = W - 16, yBase = 210, yTop = 26;
    const f = range.features;
    const widths = f.map((x) => (x.infinite ? null : (x.width || 0)));
    const known = widths.filter((v) => v !== null).reduce((a, b) => a + b, 0);
    const infW = Math.max(60, known * 0.18);
    const ws = widths.map((v) => (v === null ? infW : v));
    const total = ws.reduce((a, b) => a + b, 0) || 1;
    const hs = f.map((x) => x.height);
    const eh = f.map((x) => x.erodedHeight);
    const maxH = Math.max(500, ...hs.filter((v) => v !== null), maxPeak * 0.4);
    const X = (km) => x0 + (km / total) * (x1 - x0);
    const Y = (m) => yBase - (Math.max(0, m) / maxH) * (yBase - yTop);
    const profile = (heights) => {
      const pts = [];
      let km = 0;
      f.forEach((feat, i) => {
        const a = km, b = km + ws[i];
        const prev = i > 0 ? heights[i - 1] : 0;
        const next = i < f.length - 1 ? heights[i + 1] : 0;
        const hv = heights[i];
        const rng = feat.heightRange;
        if (hv === null || hv === undefined) {
          // tapering: slide from neighbour to neighbour (skip over other tapers)
          const pv = findDefined(heights, i, -1) ?? 0, nv = findDefined(heights, i, 1) ?? 0;
          pts.push([a, pv], [b, nv]);
        } else if (rng.kind === 'taper' && /to peak/.test(rng.text)) {
          pts.push([a, prev ?? 0], [b, hv]);
        } else if (rng.kind === 'taper' && /from peak/.test(rng.text)) {
          pts.push([a, hv], [b, next ?? 0]);
        } else {
          const ease = Math.min(ws[i] * 0.12, 25);
          pts.push([a + ease, hv], [b - ease, hv]);
        }
        km = b;
      });
      return pts;
    };
    const kids = [];
    // grid & sea level
    for (let m = 0; m <= maxH; m += niceStep(maxH)) {
      kids.push(line(x0, Y(m), x1, Y(m), m === 0 ? 'ln-teal' : 'ln-faint'));
      kids.push(text(2, Y(m) + 4, m >= 1000 ? `${m / 1000}k` : `${m}`, '', { 'font-size': 13 }));
    }
    kids.push(text(x1 - 76, Y(0) + 16, 'SEA LEVEL', 't-teal t-ui'));
    if (maxPeak < maxH * 1.05) { kids.push(line(x0, Y(maxPeak), x1, Y(maxPeak), 'ln-red dash')); kids.push(text(x1 - 110, Y(maxPeak) - 5, 'MAX PEAK', 't-line t-ui')); }
    const act = profile(hs).map(([k, m]) => [X(k), Y(m)]);
    const ero = profile(eh).map(([k, m]) => [X(k), Y(m)]);
    const area = [[x0, Y(0)], ...act, [x1, Y(0)]];
    kids.push(poly(area, 'fill-amber'));
    kids.push(poly(act, 'ln-amber glow'));
    kids.push(poly(ero, 'ln-teal dash'));
    // feature dividers & labels
    let km = 0;
    f.forEach((feat, i) => {
      const a = X(km), b = X(km + ws[i]);
      kids.push(line(a, yBase + 4, a, yBase + 14, 'ln-soft'));
      const label = feat.name.toUpperCase();
      kids.push(text((a + b) / 2 - Math.min(label.length * 3.2, (b - a) / 2), yBase + 30 + (i % 2) * 14, label, feat.heightOk && feat.widthOk ? 't-text t-ui' : 't-line t-ui'));
      km += ws[i];
    });
    kids.push(line(x0, yBase + 9, x1, yBase + 9, 'ln-faint'));
    return svgBox(W, H, 'Mountain range cross-section, active and eroded', ...kids);
  }
  function findDefined(arr, i, dir) { for (let j = i + dir; j >= 0 && j < arr.length; j += dir) if (arr[j] !== null && arr[j] !== undefined) return arr[j]; return null; }
  function niceStep(max) { const raw = max / 5; const p = 10 ** Math.floor(Math.log10(raw)); const m = raw / p; return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p; }

  function oceanCurve(ocean) {
    const W = 520, H = 230, x0 = 46, x1 = W - 14, y0 = 18, y1 = H - 34;
    const maxAge = 300, maxD = 7000;
    const X = (age) => x0 + (Math.sqrt(age) / Math.sqrt(maxAge)) * (x1 - x0);
    const Y = (d) => y0 + (d / maxD) * (y1 - y0);
    const kids = [];
    for (let d = 0; d <= maxD; d += 1000) { kids.push(line(x0, Y(d), x1, Y(d), d === 0 ? 'ln-teal' : 'ln-faint')); kids.push(text(4, Y(d) + 4, `${d / 1000}k`, '', { 'font-size': 13 })); }
    for (const a of [0, 10, 20, 50, 100, 200, 300]) { kids.push(line(X(a), y1, X(a), y1 + 6, 'ln-soft')); kids.push(text(X(a) - 8, y1 + 22, String(a), '', { 'font-size': 13 })); }
    kids.push(text(x1 - 70, y1 - 8, 'AGE (Myr)', 't-ui'), text(x0 + 6, Y(0) + 14, 'SEA LEVEL', 't-teal t-ui'));
    const pts = [];
    for (let a = 0; a <= maxAge; a += 2) pts.push([X(a), Y(WS.calc.oceanDepth(ocean.ridge, a))]);
    kids.push(poly([[x0, Y(0)], ...pts, [x1, Y(0)]], 'fill-teal'));
    kids.push(poly(pts, 'ln-amber glow'));
    kids.push(line(X(20), y0, X(20), y1, 'ln-faint dash'), text(X(20) + 4, y0 + 12, '20 Myr', '', { 'font-size': 13 }));
    return svgBox(W, H, 'Ocean depth by crust age', ...kids);
  }

  // ── POPULATION: logistic growth curve ─────────────────────────────────
  function growthCurve(pd, years) {
    const W = 520, H = 230, x0 = 58, x1 = W - 14, y0 = 16, y1 = H - 32;
    const X = (t) => x0 + (t / pd.horizon) * (x1 - x0);
    const Y = (p) => y1 - (p / pd.capacity) * (y1 - y0);
    const kids = [];
    for (let i = 0; i <= 4; i++) {
      const p = (pd.capacity * i) / 4;
      kids.push(line(x0, Y(p), x1, Y(p), 'ln-faint'), text(2, Y(p) + 4, fmt.big(p), '', { 'font-size': 13 }));
    }
    kids.push(line(x0, Y(pd.capacity), x1, Y(pd.capacity), 'ln-red dash'), text(x1 - 120, Y(pd.capacity) + 14, 'CARRYING CAPACITY', 't-line t-ui'));
    for (let i = 0; i <= 4; i++) { const t = (pd.horizon * i) / 4; kids.push(text(X(t) - 10, y1 + 20, fmt.int(t), '', { 'font-size': 13 })); }
    kids.push(poly(pd.curve.map(([t, p]) => [X(t), Y(p)]), 'ln-amber glow'));
    kids.push(line(X(years), y0, X(years), y1, 'ln-teal dash'));
    kids.push(circle(X(years), Y(pd.world), 5, 'solid-teal glow'));
    kids.push(text(Math.min(X(years) + 8, W - 110), Y(pd.world) - 8, fmt.big(pd.world), 't-teal'));
    kids.push(text(x1 - 70, y1 - 6, 'YEARS', 't-ui'));
    return svgBox(W, H, 'World population over time (logistic growth)', ...kids);
  }

  // ── CLIMATE: latitude strip ───────────────────────────────────────────
  function latitudeStrip(cells, tropics, polar, zones) {
    const W = 520, H = 360, y0 = 16, y1 = H - 16, x0 = 60;
    const Y = (lat) => y0 + ((90 - lat) / 180) * (y1 - y0);
    const kids = [];
    if (cells.bands) cells.bands.forEach(([lo, hi], i) => {
      for (const sg of [1, -1]) {
        const a = Y(sg * hi), b = Y(sg * lo);
        kids.push(s('rect', { x: x0, y: Math.min(a, b), width: 90, height: Math.abs(b - a), class: i % 2 ? 'fill-amber' : 'fill-teal' }));
      }
      const names = ['HADLEY', 'FERREL', 'POLAR'];
      if (hi - lo >= 6) kids.push(text(x0 + 6, Y((lo + hi) / 2) + 4, cells.count === 3 ? names[i] : `CELL ${i + 1}`, 't-text t-ui'));
      if (hi < 90) { kids.push(line(x0, Y(hi), W - 10, Y(hi), 'ln-faint dash'), line(x0, Y(-hi), W - 10, Y(-hi), 'ln-faint dash')); }
    });
    for (const lat of [90, 60, 30, 0, -30, -60, -90]) kids.push(text(4, Y(lat) + 5, `${Math.abs(lat)}°${lat > 0 ? 'N' : lat < 0 ? 'S' : ''}`, '', { 'font-size': 14 }));
    kids.push(line(x0, Y(0), W - 10, Y(0), 'ln-amber'));
    for (const t of [tropics, -tropics]) kids.push(line(x0, Y(t), W - 10, Y(t), 'ln-teal'));
    for (const p of [polar, -polar]) kids.push(line(x0, Y(p), W - 10, Y(p), 'ln-amber dash'));
    kids.push(text(W - 92, Y(tropics) - 4, 'TROPIC', 't-teal t-ui'), text(W - 120, Y(polar) - 4, 'POLAR CIRCLE', 't-amber t-ui'));
    // typical climate group bands
    if (zones) zones.forEach((z, i) => {
      const x = x0 + 110 + i * 62;
      for (const sg of [1, -1]) {
        const a = Y(sg * z.hi), b = Y(sg * z.lo);
        kids.push(s('rect', { x, y: Math.min(a, b), width: 44, height: Math.max(1, Math.abs(b - a)), fill: z.color, opacity: 0.55 }));
      }
      kids.push(text(x + 16, y0 - 2 + 12, z.group, 't-text', { 'font-size': 16 }));
    });
    return svgBox(W, H, 'Circulation cells and typical climate belts by latitude', ...kids);
  }

  WS.viz = {
    kelvinRGB, galaxyMap, neighbourhood, starDisc, systemMap, globe, cellsSection, daylightCanvas,
    moonRuler, skyPositions, starSizes, crossSection, oceanCurve, growthCurve, latitudeStrip,
  };
})(typeof window !== 'undefined' ? window : globalThis);
