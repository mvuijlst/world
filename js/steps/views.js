/*
 * Orrery (a navigable model of the system) and Vista (the sky and the land from any place on
 * any world, with its plants).
 */
(function () {
  'use strict';
  const { h, panel, fmt, replace, icon, info, tabs, toast } = WS.ui;
  const OR = WS.orbits, SP = WS.spectra, C = WS.calc;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* A canvas that follows its box's size at the device's pixel ratio. */
  function hiDpiCanvas(host, aspect, onResize) {
    const cv = h('canvas', { class: 'scene-canvas' });
    host.appendChild(cv);
    const fit = () => {
      const w = host.clientWidth || 600;
      const hgt = Math.round(clamp(w * aspect, 320, Math.max(360, window.innerHeight * 0.72)));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.style.height = `${hgt}px`;
      cv.width = Math.round(w * dpr); cv.height = Math.round(hgt * dpr);
      onResize && onResize();
    };
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    fit();
    return { cv, ro };
  }

  const rgbStr = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const bytesOf = (lin) => SP.toBytes(lin);

  // ════════════════════════════════════════════════════════════════════
  // ORRERY
  // ════════════════════════════════════════════════════════════════════
  const SPEEDS = [['1', '1 day / s'], ['10', '10 days / s'], ['60', '2 months / s'], ['365', '1 year / s'], ['3650', '10 years / s']];

  WS.defineStep({
    id: 'orrery', title: 'Orrery', code: '00_ORBITAL/ORRERY', strip: 'Navigable system',
    blurb: 'Fly round the system you built and watch it turn; step onto any world.',
    lede: [
      'Every body you placed, on its Kepler orbit, with the habitable zone, the frost line and the debris disk. Drag to turn the view, scroll or pinch to zoom, tap a world to select it, double-tap to follow it.',
      'Time runs from your home world’s vernal equinox. Pick a world and stand on it to see its sky on the Vista step.',
    ],
    notes: false,
    build(ctx) {
      const u = (ctx.ui.orr = ctx.ui.orr || { t: 0, playing: !reduced(), speed: '10', yaw: -0.9, pitch: 0.55, dist: 2.4, compressed: true, big: true, labels: true, focus: null, selected: 'home' });
      const host = h('div', { class: 'scene-host' });
      const status = h('div', { class: 'scene-status mono' });
      const infoHost = h('div');
      const playBtn = h('button', { class: 'btn small primary', type: 'button', onclick: () => { u.playing = !u.playing; syncButtons(); kick(); } });
      const speedSel = h('select', { class: 'sel', 'aria-label': 'Speed' }, SPEEDS.map(([v, t]) => h('option', { value: v, selected: v === u.speed }, t)));
      speedSel.addEventListener('change', () => { u.speed = speedSel.value; });
      const toggle = (key, label) => {
        const box = h('input', { type: 'checkbox', checked: u[key] });
        box.addEventListener('change', () => { u[key] = box.checked; draw(); });
        return h('label', { class: 'check' }, box, label);
      };
      const syncButtons = () => { replace(playBtn, u.playing ? '❚❚ Pause' : '▶ Play'); };
      syncButtons();
      const tools = h('div', { class: 'scene-tools' },
        playBtn, speedSel,
        h('button', { class: 'btn small', type: 'button', onclick: () => { u.t = 0; draw(); } }, icon('reset'), 'Equinox'),
        h('button', { class: 'btn small', type: 'button', onclick: () => { u.focus = null; u.yaw = -0.9; u.pitch = 0.55; u.dist = 2.4; draw(); } }, 'Reset view'),
        toggle('compressed', 'Compressed distances'), toggle('big', 'Enlarged bodies'), toggle('labels', 'Labels'));
      const el = h('div', { class: 'stack-gap' },
        panel('System', { tag: 'DRAG · ZOOM · TAP', flush: true }, host, h('div', { class: 'viz-caption' }, status)),
        h('div', { class: 'grid two-even' }, panel('Controls', { tag: 'TIME & VIEW' }, tools), panel('Selected', { tag: 'BODY' }, infoHost)));

      let els = [], scale = null, bgStars = null, particles = null, sig = '';
      const { cv, ro } = hiDpiCanvas(host, 0.62, () => draw());
      const g = cv.getContext('2d');

      function prepare(c) {
        els = OR.elements(c.world, c.d);
        const maxR = Math.max(c.d.system.debrisOut * 1.08, ...els.map((b) => b.a * (1 + b.e) * 1.08), c.d.star.frostLine * 1.2);
        scale = { maxR };
        // fixed random stars on the sky sphere
        let seed = 12345; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        bgStars = Array.from({ length: 360 }, () => { const z = 2 * r() - 1, a = 2 * Math.PI * r(), q = Math.sqrt(1 - z * z); return [q * Math.cos(a), q * Math.sin(a), z, r()]; });
        const ring = (lo, hi, n, zSpread) => Array.from({ length: n }, () => { const rr = lo + (hi - lo) * r(), a = 2 * Math.PI * r(); return [rr * Math.cos(a), rr * Math.sin(a), (r() - 0.5) * zSpread * rr]; });
        particles = { debris: ring(c.d.system.debrisIn, c.d.system.debrisOut, 520, 0.08), belts: els.filter((b) => b.kind === 'belt').map((b) => ring(b.a * 0.9, b.a * 1.1, 260, 0.04)) };
      }
      const S = (r) => (u.compressed ? Math.sqrt(r / scale.maxR) : r / scale.maxR);
      const toScene = (p) => { const r = Math.hypot(p[0], p[1], p[2]); if (r < 1e-12) return [0, 0, 0]; const k = S(r) / r; return [p[0] * k, p[1] * k, p[2] * k]; };

      function camera() {
        let target = [0, 0, 0];
        if (u.focus) { const b = els.find((x) => x.id === u.focus); if (b) target = toScene(OR.position(b, u.t)); }
        const cp = Math.cos(u.pitch), eye = [target[0] + u.dist * cp * Math.cos(u.yaw), target[1] + u.dist * cp * Math.sin(u.yaw), target[2] + u.dist * Math.sin(u.pitch)];
        const f = norm(sub(target, eye)), right = norm(cross(f, [0, 0, 1])), up = cross(right, f);
        const W = cv.width, H = cv.height, focal = (H / 2) / Math.tan(25 * D2R);
        const proj = (p) => { const v = sub(p, eye), z = dot(v, f); if (z <= 0.02) return null; return [W / 2 + focal * dot(v, right) / z, H / 2 - focal * dot(v, up) / z, z]; };
        const dir = (d) => { const z = dot(d, f); if (z <= 0) return null; return [W / 2 + focal * dot(d, right) / z, H / 2 - focal * dot(d, up) / z]; };
        return { proj, dir, focal, eye };
      }

      const pickable = [];
      function draw() {
        if (!scale) return;
        const W = cv.width, H = cv.height, dpr = W / cv.clientWidth;
        const col = { bg: css('--bg'), line: css('--line'), soft: css('--line-soft'), faint: css('--line-faint'), amber: css('--amber'), teal: css('--teal'), text: css('--text'), muted: css('--muted'), red: css('--red') };
        const cam = camera();
        g.fillStyle = col.bg; g.fillRect(0, 0, W, H);
        // background stars
        for (const s of bgStars) { const p = cam.dir(s); if (!p) continue; g.globalAlpha = 0.25 + 0.6 * s[3]; g.fillStyle = col.text; g.fillRect(p[0], p[1], dpr * (s[3] > 0.92 ? 1.6 : 1), dpr * (s[3] > 0.92 ? 1.6 : 1)); }
        g.globalAlpha = 1;
        const c = ctx.d;
        const circle = (r, n = 128) => Array.from({ length: n + 1 }, (_, i) => { const a = (i / n) * 2 * Math.PI; return cam.proj(toScene([r * Math.cos(a), r * Math.sin(a), 0])); });
        const path = (pts) => { g.beginPath(); let pen = false; for (const p of pts) { if (!p) { pen = false; continue; } if (pen) g.lineTo(p[0], p[1]); else { g.moveTo(p[0], p[1]); pen = true; } } };
        // distance rings
        g.lineWidth = dpr; g.font = `${12 * dpr}px ${css('--font-mono') || 'monospace'}`;
        for (const r of [0.1, 0.3, 1, 3, 10, 30, 100, 300]) if (r < scale.maxR) {
          path(circle(r)); g.strokeStyle = col.faint; g.setLineDash([2 * dpr, 6 * dpr]); g.stroke(); g.setLineDash([]);
          const p = cam.proj(toScene([r, 0, 0])); if (p && u.labels) { g.fillStyle = col.muted; g.fillText(`${r} AU`, p[0] + 3 * dpr, p[1] - 3 * dpr); }
        }
        // habitable zone, frost line
        const hzO = circle(c.star.hzOut), hzI = circle(c.star.hzIn);
        if (hzO.every(Boolean) && hzI.every(Boolean)) {
          g.beginPath(); hzO.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); hzI.slice().reverse().forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1])));
          g.fillStyle = css('--teal-soft'); g.fill('evenodd');
        }
        path(circle(c.star.frostLine)); g.strokeStyle = col.amber; g.globalAlpha = 0.6; g.setLineDash([5 * dpr, 5 * dpr]); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
        // debris disk and belts
        const dots = (list, colour, alpha) => { g.fillStyle = colour; g.globalAlpha = alpha; for (const q of list) { const p = cam.proj(toScene(q)); if (p) g.fillRect(p[0], p[1], dpr, dpr); } g.globalAlpha = 1; };
        dots(particles.debris, col.amber, 0.55);
        particles.belts.forEach((b) => dots(b, col.muted, 0.7));
        // orbits
        for (const b of els) {
          if (b.kind === 'belt') continue;
          path(OR.orbitPath(b, 128).map((q) => cam.proj(toScene(q))));
          g.strokeStyle = b.id === u.selected ? col.teal : b.home ? col.amber : col.soft; g.lineWidth = (b.home || b.id === u.selected ? 1.6 : 1) * dpr; g.stroke();
        }
        // the star
        const sp = cam.proj([0, 0, 0]);
        const starRGB = SP.starColour(c.star.temperature);
        if (sp) {
          const rr = (u.big ? 10 * Math.pow(c.star.radius, 0.35) : Math.max(2, cam.focal * (c.star.radiusKm / OR.AU_KM / scale.maxR) / sp[2])) * dpr;
          const glow = g.createRadialGradient(sp[0], sp[1], 0, sp[0], sp[1], rr * 4);
          glow.addColorStop(0, rgbStr(starRGB, 0.9)); glow.addColorStop(0.25, rgbStr(starRGB, 0.35)); glow.addColorStop(1, rgbStr(starRGB, 0));
          g.fillStyle = glow; g.beginPath(); g.arc(sp[0], sp[1], rr * 4, 0, 2 * Math.PI); g.fill();
          g.fillStyle = rgbStr(starRGB); g.beginPath(); g.arc(sp[0], sp[1], rr, 0, 2 * Math.PI); g.fill();
        }
        // bodies, far to near
        pickable.length = 0;
        const drawn = els.filter((b) => b.kind !== 'belt').map((b) => { const pos = OR.position(b, u.t); return { b, pos, p: cam.proj(toScene(pos)) }; }).filter((x) => x.p).sort((a, b2) => b2.p[2] - a.p[2]);
        const KIND = { terrestrial: col.line, gas: col.amber, ice: col.teal, dwarf: col.muted };
        for (const { b, pos, p } of drawn) {
          const rPx = (u.big ? clamp(3 + 3.2 * Math.log2(1 + b.radius * 2), 2.5, 16) : Math.max(1.2, cam.focal * (b.radius * 6371 / OR.AU_KM / scale.maxR) / p[2])) * dpr;
          // lit from the star: a crescent-shaded disc
          const toStar = sp ? Math.atan2(sp[1] - p[1], sp[0] - p[0]) : 0;
          const base = b.home ? col.amber : KIND[b.kind] || col.line;
          g.fillStyle = base; g.beginPath(); g.arc(p[0], p[1], rPx, 0, 2 * Math.PI); g.fill();
          const sh = g.createLinearGradient(p[0] + Math.cos(toStar) * rPx, p[1] + Math.sin(toStar) * rPx, p[0] - Math.cos(toStar) * rPx, p[1] - Math.sin(toStar) * rPx);
          sh.addColorStop(0, 'rgba(0,0,0,0)'); sh.addColorStop(0.55, 'rgba(0,0,0,0.15)'); sh.addColorStop(1, 'rgba(0,0,0,0.75)');
          g.fillStyle = sh; g.beginPath(); g.arc(p[0], p[1], rPx, 0, 2 * Math.PI); g.fill();
          if (b.kind === 'gas') { g.strokeStyle = col.amber; g.lineWidth = dpr; g.beginPath(); g.ellipse(p[0], p[1], rPx * 1.9, rPx * 0.5, -0.35, 0, 2 * Math.PI); g.stroke(); }
          if (b.id === u.selected) { g.strokeStyle = col.teal; g.lineWidth = 1.4 * dpr; g.beginPath(); g.arc(p[0], p[1], rPx + 5 * dpr, 0, 2 * Math.PI); g.stroke(); }
          if (u.labels) { g.fillStyle = b.home ? col.amber : col.text; g.fillText(b.name, p[0] + rPx + 4 * dpr, p[1] - rPx - 2 * dpr); }
          pickable.push({ id: b.id, x: p[0], y: p[1], r: rPx });
          // the moon of home
          if (b.home && ctx.world.moon.enabled) {
            const off = OR.moonOffset(ctx.world, c, u.t);
            if (off) {
              const k = Math.hypot(...off), sceneOff = u.big || u.compressed ? off.map((v) => (v / k) * 0.03) : off.map((v) => v / scale.maxR);
              const ps = toScene(pos), mp = cam.proj([ps[0] + sceneOff[0], ps[1] + sceneOff[1], ps[2] + sceneOff[2]]);
              if (mp) { g.fillStyle = col.text; g.beginPath(); g.arc(mp[0], mp[1], Math.max(1.5 * dpr, rPx * 0.35), 0, 2 * Math.PI); g.fill(); }
            }
          }
        }
        const home = els.find((b) => b.home);
        const year = Math.floor(u.t / home.period), day = u.t - year * home.period;
        status.textContent = `Year ${year + 1}, day ${fmt.num(day, 1)} of ${fmt.num(home.period, 1)} (Earth days) · ${u.compressed ? 'distances √-compressed' : 'true distances'} · ${u.big ? 'bodies enlarged' : 'bodies to scale'}`;
      }

      function showInfo(c) {
        const b = els.find((x) => x.id === u.selected) || els.find((x) => x.home);
        if (!b) return;
        const pos = OR.position(b, u.t), r = Math.hypot(...pos);
        const year = b.period / 365.256;
        replace(infoHost,
          h('h3', { class: 't-amber', style: { letterSpacing: '.12em', textTransform: 'uppercase', fontSize: '15px', marginBottom: '8px' } }, b.name, b.home ? ' · home' : ''),
          h('div', { class: 'readouts' },
            [['Orbit', `${fmt.num(b.a, 3)} AU`], ['Year', year > 2 ? `${fmt.num(year, 2)} Earth yr` : `${fmt.num(b.period, 1)} days`], ['From the star now', `${fmt.num(r, 3)} AU`], ['Eccentricity', fmt.num(b.e, 3)], ['Inclination', `${fmt.num(b.i, 1)}°`], ['Radius', `${fmt.num(b.radius, 3)} R⊕`]]
              .map(([l, v]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l), h('div', { class: 'val', style: { fontSize: '22px' } }, v)))),
          h('div', { class: 'btn-row', style: { marginTop: '12px' } },
            b.kind !== 'belt' ? h('button', { class: 'btn primary', type: 'button', onclick: () => {
              const home = els.find((x) => x.home);
              ctx.mutate((w) => { w.vista.body = b.home ? 'home' : b.id; w.vista.day = ((u.t % home.period) + home.period) % home.period / home.period; });
              ctx.go('vista');
            } }, `Stand on ${b.name}`, icon('arrowR')) : null,
            h('button', { class: 'btn', type: 'button', onclick: () => { u.focus = u.focus === b.id ? null : b.id; u.dist = u.focus ? 0.6 : 2.4; draw(); } }, u.focus === b.id ? 'Stop following' : 'Follow')));
      }

      // ── interaction: drag, wheel, pinch, tap, double-tap ──
      const pts = new Map(); let dragged = false, lastTap = 0, pinch0 = null;
      cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]); dragged = false; if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), dist: u.dist }; } });
      cv.addEventListener('pointermove', (e) => {
        if (!pts.has(e.pointerId)) return;
        const prev = pts.get(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
        if (pts.size === 2 && pinch0) { const [a, b] = [...pts.values()]; u.dist = clamp(pinch0.dist * pinch0.d / Math.max(10, Math.hypot(a[0] - b[0], a[1] - b[1])), 0.05, 6); dragged = true; draw(); return; }
        const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
        if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true;
        u.yaw -= dx * 0.008; u.pitch = clamp(u.pitch + dy * 0.008, -1.5, 1.5); draw();
      });
      const up = (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.delete(e.pointerId); if (pts.size < 2) pinch0 = null;
        if (dragged) return;
        const r = cv.getBoundingClientRect(), dpr = cv.width / r.width, x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
        let best = null;
        for (const p of pickable) { const dd = Math.hypot(p.x - x, p.y - y); if (dd < p.r + 16 * dpr && (!best || dd < best.d)) best = { ...p, d: dd }; }
        const now = Date.now();
        if (best) { u.selected = best.id; if (now - lastTap < 350) { u.focus = best.id; u.dist = 0.6; } showInfo(ctx); draw(); }
        lastTap = now;
      };
      cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch0 = null; });
      cv.addEventListener('wheel', (e) => { e.preventDefault(); u.dist = clamp(u.dist * Math.exp(e.deltaY * 0.0012), 0.05, 6); draw(); }, { passive: false });
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'Interactive 3D model of the planetary system');
      cv.style.touchAction = 'none'; cv.style.cursor = 'grab';

      // ── time ──
      let raf = null, last = 0, infoTick = 0;
      const loop = (ts) => {
        raf = null;
        if (!host.isConnected) return;
        if (u.playing) {
          const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0;
          u.t += dt * Number(u.speed);
          draw();
          if (ts - infoTick > 500) { showInfo(ctx); infoTick = ts; }
        }
        last = ts;
        if (u.playing) raf = requestAnimationFrame(loop);
      };
      const kick = () => { last = 0; if (!raf && u.playing) raf = requestAnimationFrame(loop); };

      return {
        el,
        update(c) {
          const s2 = JSON.stringify([c.world.system, c.world.planet.a, c.world.planet.e, c.world.star.mass, c.world.moon.enabled]);
          if (s2 !== sig) { sig = s2; prepare(c); }
          draw(); showInfo(c); kick();
        },
        destroy() { if (raf) cancelAnimationFrame(raf); raf = null; ro.disconnect(); },
      };
    },
  });

  // ════════════════════════════════════════════════════════════════════
  // VISTA
  // ════════════════════════════════════════════════════════════════════
  const HABITATS = [['auto', 'From the latitude'], ['jungle', 'Jungle'], ['rainforest', 'Cool rain forest'], ['forest', 'Forest'], ['scrub', 'Dry scrub & steppe'], ['desert', 'Desert'], ['mountain', 'High mountains'], ['tundra', 'Tundra']];

  /* The sky's physical setting for a body. */
  function airFor(world, d, body) {
    if (body.home) return { pressure: world.planet.pressure, gravity: d.planet.gravity, gas: 'air', methane: 0, surface: 'land' };
    if (body.kind === 'gas' || body.kind === 'ice') return { pressure: 1, gravity: Math.max(0.4, body.gravity), gas: 'h2', methane: body.kind === 'ice' ? 0.02 : 0.003, surface: 'clouds' };
    if (!body.atmosphere) return { pressure: 0, gravity: body.gravity, gas: 'air', methane: 0, surface: 'rock' };
    return { pressure: body.pressure || 1, gravity: body.gravity, gas: 'air', methane: 0, surface: 'land' };
  }

  /* Habitat kind for the plants page from latitude and the planet's circulation (or the user's choice). */
  function habitatFor(world, d, lat) {
    if (world.vista.habitat !== 'auto') return world.vista.habitat;
    const a = Math.abs(lat), cells = d.planet.cells;
    if (cells.count !== 3) return a < 25 ? 'jungle' : a < 60 ? 'forest' : 'tundra';
    const Hd = cells.bands[0][1], F = cells.bands[1][1];
    if (a < Hd * 0.45) return 'jungle';
    if (a < Hd * 0.65) return 'scrub';
    if (a < Hd * 1.1) return 'desert';
    if (a < F * 0.85) return 'forest';
    if (a < F + (90 - F) * 0.2) return 'rainforest';
    return 'tundra';
  }
  const starLetter = (T) => (T >= 6000 ? 'F' : T >= 5200 ? 'G' : T >= 3700 ? 'K' : 'M');
  const gravityClass = (gv) => (gv < 0.7 ? 'light' : gv > 1.1 ? 'heavy' : 'earth');

  /* Apparent magnitude of a body seen from somewhere (the Sky step's formulas). */
  function magnitude(b, L) {
    if (b.kind === 'belt') return 99;
    const H = 5 * Math.log10(1329 / L / ((b.radius * 12742) * Math.sqrt(Math.max(0.01, b.albedo || 0.3))));
    const type = C.bodyType(b.radius, b.atmosphere);
    return H + 5 * Math.log10(b.helio * b.dist) + C.phaseTerm(type, Math.min(b.phase, 170));
  }

  const MOON_PHASES = ['New', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full', 'Waning gibbous', 'Last quarter', 'Waning crescent'];

  WS.defineStep({
    id: 'vista', title: 'Vista', code: '00_SURFACE/VISTA', strip: 'Sky & land from the ground',
    blurb: 'Stand anywhere on any world: its sky by day and night, its star, moon and planets, its plants.',
    lede: [
      'The sky’s colour comes from the star’s light scattered by the air: a physical model anchored to the renders of Panoptes V’s “Colors of Alien Worlds”, so a G star gives an Earth-blue sky, an M dwarf a pale, sallow one, an A star a deep blue, and thick or low-gravity air a whiter sky. Colours are shown as an eye used to Earth’s daylight would see them, unless you choose to adapt.',
      'The fields take Panoptes’ plant colours for photosynthesis tuned to your star. Choose a place and a time, drag the view, and grow some plants for it.',
    ],
    build(ctx) {
      const k = WS.kit(ctx);
      const v = () => ctx.world.vista;
      const host = h('div', { class: 'scene-host' });
      const status = h('div', { class: 'scene-status mono' });
      const readHost = h('div');
      const plantHost = h('div');
      const bodySel = h('select', { id: 'vista-body', class: 'sel' });
      bodySel.addEventListener('change', () => ctx.set('vista.body', bodySel.value));
      const modeTabs = h('div');
      const eyeSel = h('select', { id: 'vista-eye' }, [['earth', 'Used to Earth’s daylight (Panoptes)'], ['local', 'Adapted to this star']].map(([val, t]) => h('option', { value: val }, t)));
      eyeSel.addEventListener('change', () => ctx.set('vista.eye', eyeSel.value));
      let playing = false, raf = null;
      const playBtn = h('button', { class: 'btn small primary', type: 'button', onclick: () => { playing = !playing; playBtn.textContent = playing ? '❚❚ Stop time' : '▶ Run the day'; if (playing) tick(); } }, '▶ Run the day');
      const labelsBox = h('input', { type: 'checkbox' });
      labelsBox.addEventListener('change', () => ctx.set('vista.labels', labelsBox.checked));

      const controls = panel('Where & when', { ticks: true, tag: 'INPUT' },
        h('div', { class: 'fields' },
          h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'vista-body' }, 'Standing on', info('Any world of the system. Airless worlds have a black sky; on a giant you float at the cloud tops (hydrogen air, a trace of methane).')), bodySel),
          k.f({ path: 'vista.lat', label: 'Latitude', unit: '°', min: -90, max: 90, slider: [-90, 90], step: 0.5 }),
          k.f({ path: 'vista.day', label: 'Time of year', min: 0, max: 1, slider: [0, 1], step: 0.002, help: 'Fraction of the local year from the vernal equinox (0). For the home world ¼ is the northern summer solstice.', sub: () => yearText() }),
          k.f({ path: 'vista.hour', label: 'Time of day', min: 0, max: 1, slider: [0, 1], step: 0.002, help: 'Local solar time as a fraction of the day: 0.5 is noon.', sub: () => clockText() }),
          k.f({ path: 'vista.az', label: 'Looking toward', unit: '°', min: 0, max: 360, slider: [0, 360], step: 1, help: 'Azimuth of the centre of the view: 0 north, 90 east, 180 south, 270 west. You can also drag the picture.' }),
          k.f({ path: 'vista.exposure', label: 'Exposure', unit: 'EV', min: -6, max: 8, slider: [-4, 8], step: 0.1, help: '0 is the Panoptes exposure (a grey card facing the noon star is full white). Raise it to see twilight and night as a dark-adapted eye would.' }),
          k.f({ path: 'vista.haze', label: 'Haze', min: 0, max: 2, slider: [0, 1], step: 0.01, help: 'Aerosol optical depth at 550 nm. 0 is the clear air Panoptes assumes; 0.1-0.3 is an ordinary hazy day.' }),
          h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'vista-eye' }, 'Eyes', info('Panoptes shows alien light as an eye used to Earth’s daylight sees it: an M dwarf’s noon is amber. “Adapted” white-balances to the local daylight, as the people living there would see it.')), eyeSel)),
        h('div', { class: 'btn-row', style: { marginTop: '12px' } }, playBtn, h('label', { class: 'check' }, labelsBox, 'Labels'),
          h('button', { class: 'btn small', type: 'button', onclick: () => { ctx.mutate((w) => { w.vista.hour = 0.5; w.vista.az = w.vista.lat >= 0 ? 180 : 0; }); } }, 'Noon'),
          h('button', { class: 'btn small', type: 'button', onclick: () => ctx.mutate((w) => { w.vista.hour = 0.0; w.vista.exposure = Math.max(w.vista.exposure, 4); }) }, 'Midnight')));

      const el = h('div', { class: 'stack-gap' },
        panel('View', { tag: 'DRAG TO LOOK AROUND', flush: true }, h('div', { style: { padding: '8px 12px 0' } }, modeTabs), host, h('div', { class: 'viz-caption' }, status)),
        h('div', { class: 'grid two' }, controls, h('div', { class: 'stack-gap' }, panel('Sky now', { tag: 'EPHEMERIS' }, readHost), panel('Plant life', { tag: 'PANOPTES · NODARIUM' }, plantHost))));

      let els = [], self = null, now = null, skyModel = null, sigModel = '', starfield = null, terrain = null, air = null, g = null;
      const { cv, ro } = hiDpiCanvas(host, 0.5, () => render());
      g = cv.getContext('2d');
      const small = document.createElement('canvas'), sg = small.getContext('2d');
      const tDays = () => v().day * (self ? self.period : 365.25);
      function yearText() { if (!self) return ''; return `day ${fmt.num(v().day * self.period, 1)} of ${fmt.num(self.period, 1)} (Earth days)`; }
      function clockText() {
        if (!self) return '';
        const dayH = OR.solarDay(self) * 24, hrs = v().hour * dayH;
        return `${String(Math.floor(hrs)).padStart(2, '0')}:${String(Math.floor((hrs % 1) * 60)).padStart(2, '0')} of a ${fmt.num(dayH, 1)} h day`;
      }

      function prepare(c) {
        els = OR.elements(c.world, c.d);
        const id = v().body;
        self = els.find((b) => (id === 'home' ? b.home : b.id === id)) || els.find((b) => b.home);
        const air = airFor(c.world, c.d, self);
        const insolation = c.d.star.luminosity / (self.a ** 2);
        const key = JSON.stringify([c.d.star.temperature, air, v().haze, insolation.toFixed(3)]);
        if (key !== sigModel) { sigModel = key; skyModel = air.pressure > 0 ? SP.sky({ T: c.d.star.temperature, ...air, haze: v().haze, insolation }) : null; }
        replace(bodySel, els.filter((b) => b.kind !== 'belt').map((b) => h('option', { value: b.home ? 'home' : b.id, selected: b === self }, `${b.name}${b.home ? ' (home)' : ''} · ${b.kind}`)));
        // stars fixed on the celestial sphere of this world
        let seed = 977; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        starfield = Array.from({ length: 900 }, () => { const z = 2 * r() - 1, a = 2 * Math.PI * r(); return { ra: a, dec: Math.asin(z), mag: 6.5 * Math.pow(r(), 0.45) - 1, tint: r() }; });
        // a horizon of hills, from the latitude
        let s2 = Math.round((v().lat + 91) * 1000) + 7; const r2 = () => ((s2 = (s2 * 48271) % 2147483647) / 2147483647);
        const waves = Array.from({ length: 6 }, (_, i) => ({ f: (i + 1) * (1 + r2()), p: r2() * 6.28, a: (2.6 / (i + 1)) * (0.5 + r2()) }));
        terrain = (az) => -1.2 + waves.reduce((s, w) => s + w.a * Math.sin(w.f * az * D2R * 2 + w.p), 0) * 0.55;
        air.letter = starLetter(c.d.star.temperature);
        return air;
      }

      // ── drawing ─────────────────────────────────────────────────────
      function project(W, H) {
        const vv = v();
        if (vv.mode === 'dome') {
          const R = Math.min(W, H) * 0.47, cx = W / 2, cy = H / 2;
          return {
            dome: true, R, cx, cy,
            // equidistant fisheye looking up: zenith in the centre, north at the top, east to the left
            toScreen: (alt, az) => { const rr = (90 - alt) / 90 * R, a = az * D2R; return [cx - rr * Math.sin(a), cy - rr * Math.cos(a)]; },
            toSky: (x, y) => { const dx = x - cx, dy = y - cy, rr = Math.hypot(dx, dy) / R; if (rr > 1.02) return null; return { alt: 90 - rr * 90, az: (Math.atan2(-dx, -dy) * R2D + 360) % 360 }; },
            pxPerDeg: R / 90,
          };
        }
        const fovH = clamp((W / H) * 62, 90, 200), pxPerDeg = W / fovH, altLow = -16, altTop = altLow + H / pxPerDeg;
        return {
          dome: false, pxPerDeg, altLow, altTop,
          toScreen: (alt, az) => { let da = ((az - vv.az + 540) % 360) - 180; return [W / 2 + da * pxPerDeg, H - (alt - altLow) * pxPerDeg]; },
          toSky: (x, y) => ({ alt: altLow + (H - y) / pxPerDeg, az: ((vv.az + (x - W / 2) / pxPerDeg) % 360 + 360) % 360 }),
        };
      }

      function adaptFn() {
        if (v().eye !== 'local' || !skyModel || !now || now.star.alt < 0) return (lin) => lin;
        const white = skyModel.light(Math.max(5, now.star.alt)).linear;
        const m = Math.max(...white);
        return (lin) => lin.map((x, i) => x * m / Math.max(1e-6, white[i]));
      }

      function render() {
        const c = ctx;
        if (!self || !g || !cv.width) return;
        const W = cv.width, H = cv.height, dpr = W / cv.clientWidth;
        now = OR.skyFrom(c.world, c.d, els, self.id, tDays(), v().lat, v().hour);
        const P = project(W, H);
        const ev = Math.pow(2, v().exposure);
        const adapt = adaptFn();
        const sun = now.star;
        // ── the sky, on a coarse grid, then smoothed up ──
        const cell = Math.max(4, Math.round(6 * dpr));
        const gw = Math.ceil(W / cell), gh = Math.ceil(H / cell);
        small.width = gw; small.height = gh;
        const img = sg.createImageData(gw, gh);
        const anc = skyModel ? skyModel.anchor(sun.alt) : null;
        const sa = sun.alt * D2R, saz = sun.az * D2R;
        const groundLin = groundColour(c);
        for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
          const q = P.toSky((i + 0.5) * cell, (j + 0.5) * cell);
          const o = (j * gw + i) * 4;
          if (!q) { img.data[o + 3] = 0; continue; }
          let lin;
          if (q.alt < 0 && P.dome) { lin = [0, 0, 0]; }
          else if (!skyModel) lin = [0, 0, 0];
          else {
            const alt = Math.max(0, q.alt) * D2R, az = q.az * D2R;
            const cg = Math.sin(alt) * Math.sin(sa) + Math.cos(alt) * Math.cos(sa) * Math.cos(az - saz);
            lin = skyModel.radiance(Math.max(0, q.alt), sun.alt, Math.acos(clamp(cg, -1, 1)) * R2D, anc);
            if (q.alt < 0) { const t = clamp(-q.alt / 6, 0, 1); lin = lin.map((x, k2) => x * (1 - t) + groundLin[k2] * t); }
          }
          const b = SP.toBytes(adapt(lin).map((x) => x * ev));
          img.data[o] = b[0]; img.data[o + 1] = b[1]; img.data[o + 2] = b[2]; img.data[o + 3] = 255;
        }
        sg.putImageData(img, 0, 0);
        g.clearRect(0, 0, W, H);
        g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
        g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
        g.drawImage(small, 0, 0, gw * cell, gh * cell);
        // ── night: stars, planets ──
        const skyLum = skyModel ? (() => { const z = skyModel.radiance(60, sun.alt, 60, anc).map((x) => x * ev); return 0.2126 * z[0] + 0.7152 * z[1] + 0.0722 * z[2]; })() : 0;
        const limit = 6.5 - 2.5 * Math.log10(1 + skyLum * 2000);          // faintest magnitude visible
        const tilt = (self.tilt || 0) * D2R, phi = v().lat * D2R;
        for (const s of starfield) {
          if (s.mag > limit) continue;
          const Hh = now.theta - s.ra;
          const alt = Math.asin(Math.sin(phi) * Math.sin(s.dec) + Math.cos(phi) * Math.cos(s.dec) * Math.cos(Hh)) * R2D;
          if (alt < 0) continue;
          const az = (Math.atan2(-Math.cos(s.dec) * Math.sin(Hh), Math.sin(s.dec) * Math.cos(phi) - Math.cos(s.dec) * Math.cos(Hh) * Math.sin(phi)) * R2D + 360) % 360;
          if (!P.dome && terrainAlt(az) > alt) continue;
          const p = P.toScreen(alt, az); if (p[0] < 0 || p[0] > W) continue;
          const bright = clamp((limit - s.mag) / 4, 0.15, 1);
          g.fillStyle = s.tint > 0.85 ? `rgba(255,210,170,${bright})` : s.tint < 0.15 ? `rgba(190,210,255,${bright})` : `rgba(255,255,255,${bright})`;
          const sz = (s.mag < 1.5 ? 2.2 : s.mag < 3 ? 1.6 : 1.1) * dpr; g.fillRect(p[0] - sz / 2, p[1] - sz / 2, sz, sz);
        }
        void tilt;
        const labels = v().labels;
        g.font = `${12 * dpr}px ${css('--font-mono') || 'monospace'}`;
        const visibleBodies = [];
        for (const b of now.bodies) {
          if (b.kind === 'belt' || b.alt < -1) continue;
          const mag = magnitude(b, c.d.star.luminosity);
          if (!Number.isFinite(mag) || mag > limit + 0.5 || angSep(b, sun) < 3) continue;
          if (!P.dome && terrainAlt(b.az) > b.alt) continue;
          const p = P.toScreen(b.alt, b.az); if (p[0] < -20 || p[0] > W + 20) continue;
          const sizePx = Math.max(1.4 * dpr, clamp(3.4 - mag * 0.5, 1.2, 5) * dpr, b.size * P.pxPerDeg);
          g.fillStyle = b.home ? 'rgba(160,210,255,0.95)' : 'rgba(255,244,220,0.95)';
          g.beginPath(); g.arc(p[0], p[1], sizePx, 0, 2 * Math.PI); g.fill();
          visibleBodies.push({ ...b, mag });
          if (labels) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillText(`${b.name} ${fmt.num(mag, 1)}`, p[0] + 6 * dpr, p[1] - 6 * dpr); }
        }
        // ── the moon ──
        const m = now.moon;
        if (m && m.alt > -2 && (P.dome || terrainAlt(m.az) < m.alt + m.size)) drawMoon(m, P, sun, dpr, skyLum, ev, adapt);
        // ── the star ──
        if (sun.alt > -2) drawStar(sun, P, dpr, ev, adapt, c);
        // ── the ground ──
        if (!P.dome) drawGround(P, W, H, dpr, c, ev, adapt);
        else drawDomeFrame(P, dpr);
        // compass
        g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = `${13 * dpr}px ${css('--font-mono') || 'monospace'}`;
        for (const [lab, az] of [['N', 0], ['NE', 45], ['E', 90], ['SE', 135], ['S', 180], ['SW', 225], ['W', 270], ['NW', 315]]) {
          if (P.dome) { const p = P.toScreen(-3, az); g.fillText(lab, p[0] - 5 * dpr, p[1] + 4 * dpr); continue; }
          const p = P.toScreen(0, az); if (p[0] < 10 || p[0] > W - 20) continue;
          g.fillText(lab, p[0] - 5 * dpr, H - 8 * dpr);
        }
        status.textContent = `${self.name} · ${fmt.num(Math.abs(v().lat), 1)}°${v().lat >= 0 ? 'N' : 'S'} · ${clockText()} · star ${fmt.num(sun.alt, 1)}° high, azimuth ${fmt.num(sun.az, 0)}°`;
        showReadouts(c, visibleBodies);
      }
      const angSep = (a, b) => Math.acos(clamp(Math.sin(a.alt * D2R) * Math.sin(b.alt * D2R) + Math.cos(a.alt * D2R) * Math.cos(b.alt * D2R) * Math.cos((a.az - b.az) * D2R), -1, 1)) * R2D;
      const terrainAlt = (az) => (air && air.surface === 'clouds' ? -3 : terrain(az));

      function groundColour(c) {
        // the land under the local light, linear (for the horizon blend of the sky grid)
        if (!skyModel || !air) return [0.02, 0.02, 0.02];
        const leaf = SP.leafColours(c.d.star.temperature, air.pressure)[2];
        const base = air.surface === 'land' && self.home ? SP.fromHex(leaf).map((x) => SP.decode(x / 255)) : [0.18, 0.17, 0.16];
        const k2 = lightRatio(now ? now.star.alt : 30);
        return base.map((x, i) => x * k2[i]);
      }
      /* Light on the ground now, relative to the light under a star 55° high (where the leaf colours hold). */
      function lightRatio(alt) {
        if (!skyModel) return alt > 0 ? [1, 1, 1].map(() => Math.sin(alt * D2R) / Math.sin(55 * D2R)) : [0, 0, 0];
        const a = skyModel.light(alt).linear, b = skyModel.light(55).linear;
        return a.map((x, i) => clamp(x / Math.max(1e-6, b[i]), 0, 3));
      }

      function drawStar(sun, P, dpr, ev, adapt, c) {
        const p = P.toScreen(sun.alt, sun.az);
        if (p[0] < -200 || p[0] > cv.width + 200) return;
        let lin;
        if (skyModel) { const d2 = SP.directBeam(skyModel.atm, skyModel.star, sun.alt); lin = skyModel.linear(d2); }
        else lin = skyModelLess(c);
        const mx = Math.max(...lin, 1e-6);
        const colr = SP.toBytes(adapt(lin.map((x) => x / mx)));
        const rr = Math.max(2.5 * dpr, (sun.size / 2) * P.pxPerDeg);
        // the glow round the star is light scattered by the air: none without air
        const haloR = skyModel ? rr * 10 + 40 * dpr : rr * 2.5;
        const halo = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], haloR);
        const bright = clamp(mx * ev * 0.6, 0.15, 1);
        halo.addColorStop(0, rgbStr(colr, 0.85 * bright)); halo.addColorStop(0.12, rgbStr(colr, 0.35 * bright)); halo.addColorStop(1, rgbStr(colr, 0));
        g.fillStyle = halo; g.beginPath(); g.arc(p[0], p[1], haloR, 0, 2 * Math.PI); g.fill();
        g.fillStyle = rgbStr(SP.toBytes(adapt(lin.map((x) => (x / mx) * 1.2)))); g.beginPath(); g.arc(p[0], p[1], rr, 0, 2 * Math.PI); g.fill();
        if (v().labels) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillText(ctx.world.star.name, p[0] + rr + 8 * dpr, p[1] + 4 * dpr); }
      }
      function skyModelLess(c) { const sc = SP.scene({ T: c.d.star.temperature, pressure: 0 }); return sc.linear(sc.star.map((x) => x / Math.PI)); }

      function drawMoon(mo, P, sun, dpr, skyLum, ev, adapt) {
        const p = P.toScreen(mo.alt, mo.az);
        if (p[0] < -50 || p[0] > cv.width + 50) return;
        const r = Math.max(3 * dpr, (mo.size / 2) * P.pxPerDeg);
        const s = P.toScreen(mo.toStar.alt, mo.toStar.az);
        let ang = Math.atan2(s[1] - p[1], s[0] - p[0]);
        if (P.dome) ang = Math.atan2(s[1] - p[1], s[0] - p[0]);
        const k2 = Math.cos(mo.phase * D2R);                                    // 1 full, -1 new
        const lit = skyModel ? lightRatio(55).map(() => 1) : [1, 1, 1];
        const moonLin = adapt([0.12, 0.12, 0.12].map((x, i) => x * lit[i] * ev * 6));
        const col = SP.toBytes(moonLin);
        const alpha = clamp(1 - skyLum * ev * 2.2, 0.35, 1);
        g.save(); g.translate(p[0], p[1]); g.rotate(ang);
        g.globalAlpha = alpha;
        g.fillStyle = 'rgba(20,22,26,0.35)'; g.beginPath(); g.arc(0, 0, r, 0, 2 * Math.PI); g.fill();
        g.fillStyle = rgbStr(col);
        g.beginPath(); g.arc(0, 0, r, -Math.PI / 2, Math.PI / 2, false);                 // lit half toward the star
        g.ellipse(0, 0, Math.abs(k2) * r, r, 0, Math.PI / 2, -Math.PI / 2, k2 < 0);
        g.fill();
        g.restore(); g.globalAlpha = 1;
        if (v().labels) { g.fillStyle = 'rgba(255,255,255,0.75)'; g.fillText(mo.name || 'Moon', p[0] + r + 6 * dpr, p[1] - r); }
      }

      function drawGround(P, W, H, dpr, c, ev, adapt) {
        const leaves = self.home && air && air.surface === 'land' ? SP.leafColours(c.d.star.temperature, air.pressure, { twilight: false }) : null;
        const light = lightRatio(now.star.alt);
        const horizonSky = skyModel ? skyModel.radiance(1, now.star.alt, 90) : [0, 0, 0];
        const toLin = (hexs) => SP.fromHex(hexs).map((x) => SP.decode(x / 255));
        const ink = (lin) => rgbStr(SP.toBytes(adapt(lin.map((x) => x * ev))));
        // far hills: aerial perspective towards the horizon sky
        g.beginPath(); g.moveTo(0, H);
        for (let x = 0; x <= W; x += 4 * dpr) { const q = P.toSky(x, 0); const p = P.toScreen(terrainAlt(q.az), q.az); g.lineTo(x, p[1]); }
        g.lineTo(W, H); g.closePath();
        const yTop = P.toScreen(2, 0)[1], yBottom = H;
        const grad = g.createLinearGradient(0, yTop, 0, yBottom);
        const base = air && air.surface === 'clouds' ? [0.55, 0.5, 0.42] : leaves ? toLin(leaves[2]) : air && air.surface === 'rock' ? [0.16, 0.15, 0.14] : [0.2, 0.18, 0.15];
        const lit = base.map((x, i) => x * light[i]);
        const far = lit.map((x, i) => x * 0.45 + horizonSky[i] * 0.55);
        grad.addColorStop(0, ink(far)); grad.addColorStop(0.35, ink(lit.map((x, i) => x * 0.8 + horizonSky[i] * 0.2))); grad.addColorStop(1, ink(lit.map((x) => x * 0.7)));
        g.fillStyle = grad; g.fill();
        if (!leaves) return;
        // nearer fields: bands of the six concentrations, and tufts of plants in the foreground
        let s = Math.round(v().lat * 100) + 31; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
        const yH = P.toScreen(0, 0)[1];
        for (let band = 0; band < 7; band++) {
          const y0 = yH + (H - yH) * (0.08 + band * 0.13), hh = (H - yH) * 0.13;
          const colLin = toLin(leaves[(band * 2 + 1) % 6]).map((x, i) => x * light[i]);
          const mix = clamp(1 - band / 6, 0, 1) * 0.4;
          g.fillStyle = ink(colLin.map((x, i) => x * (1 - mix) + horizonSky[i] * mix));
          g.beginPath(); g.moveTo(0, y0 + hh * 0.3);
          for (let x = 0; x <= W; x += 30 * dpr) g.lineTo(x, y0 + hh * (0.3 + 0.25 * Math.sin(x / (90 * dpr) + band * 1.7)));
          g.lineTo(W, y0 + hh); g.lineTo(0, y0 + hh); g.closePath(); g.globalAlpha = 0.55; g.fill(); g.globalAlpha = 1;
        }
        for (let n = 0; n < 70; n++) {
          const x = r() * W, depth = Math.pow(r(), 0.6), y = yH + (H - yH) * (0.25 + 0.75 * depth), size = (6 + 28 * depth) * dpr;
          const colLin = toLin(leaves[Math.floor(r() * 6)]).map((xx, i) => xx * light[i] * (0.8 + 0.4 * r()));
          g.strokeStyle = ink(colLin); g.fillStyle = g.strokeStyle; g.lineWidth = Math.max(1, size / 14);
          const blades = 3 + Math.floor(r() * 5);
          for (let bl = 0; bl < blades; bl++) {
            const a = -Math.PI / 2 + (r() - 0.5) * 1.6, len = size * (0.6 + 0.6 * r());
            const tx = x + Math.cos(a) * len, ty = y + Math.sin(a) * len;
            g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (r() - 0.5) * size * 0.4, y + Math.sin(a) * len * 0.6, tx, ty); g.stroke();
            if (r() > 0.5) { g.beginPath(); g.ellipse(tx, ty, size * 0.12, size * 0.28, a + Math.PI / 2, 0, 2 * Math.PI); g.fill(); }
          }
        }
      }
      function drawDomeFrame(P, dpr) {
        g.strokeStyle = css('--line'); g.lineWidth = 1.2 * dpr; g.beginPath(); g.arc(P.cx, P.cy, P.R, 0, 2 * Math.PI); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.12)';
        for (const alt of [30, 60]) { g.beginPath(); g.arc(P.cx, P.cy, P.R * (90 - alt) / 90, 0, 2 * Math.PI); g.stroke(); }
      }

      function showReadouts(c, visible) {
        const sun = now.star, mo = now.moon;
        // day length today at this latitude, from the star's declination
        const dec = sun.dec, phi = v().lat * D2R;
        const cosH = (-Math.sin(0.83 * D2R) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec) || 1e-9);
        const dayH = OR.solarDay(self) * 24;
        const daylight = cosH <= -1 ? dayH : cosH >= 1 ? 0 : (Math.acos(cosH) / Math.PI) * dayH;
        const phaseIdx = mo ? Math.round(((now.moon && moonAge()) || 0) * 8) % 8 : null;
        const rows = [
          ['Star', `${fmt.num(sun.alt, 1)}° · az ${fmt.num(sun.az, 0)}°`, `${fmt.num(sun.size, 3)}° wide`],
          ['Daylight today', `${fmt.num(daylight, 1)} h`, `of a ${fmt.num(dayH, 1)} h day`],
          mo ? ['Moon', mo.alt > 0 ? `${fmt.num(mo.alt, 1)}° · az ${fmt.num(mo.az, 0)}°` : 'below the horizon', `${MOON_PHASES[phaseIdx]} · ${fmt.num((1 + Math.cos(mo.phase * D2R)) * 50, 0)}% lit`] : null,
          ['Air', air.pressure > 0 ? `${fmt.num(air.pressure, 2)} atm · ${fmt.num(air.gravity, 2)} g` : 'none', air.surface === 'clouds' ? 'cloud tops of a giant' : air.gas === 'air' ? `like ${fmt.num(skyModel ? skyModel.peff : 0, 2)} Earth air columns` : ''],
        ].filter(Boolean);
        replace(readHost,
          h('div', { class: 'readouts' }, rows.map(([l, val, sub]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l), h('div', { class: 'val', style: { fontSize: '22px' } }, val), h('div', { class: 'sub' }, sub)))),
          h('div', { class: 'panel-sub', style: { marginTop: '12px' } }, 'Planets in view'),
          visible.length ? h('ul', { class: 'diag' }, visible.sort((a, b) => a.mag - b.mag).map((b) => h('li', { class: b.mag < 0 ? 'ok' : 'info' }, h('span', { class: 'flag' }, fmt.num(b.mag, 1)), h('span', null, `${b.name} · ${fmt.num(b.alt, 0)}° high, az ${fmt.num(b.az, 0)}°`))))
            : h('p', { class: 'muted' }, sun.alt > -6 ? 'None bright enough against this sky.' : 'None above the horizon now.'));
      }
      function moonAge() {
        // 0 new → 0.5 full → 1, from the elongation (the star and moon's separation) and whether it waxes
        const mo = now.moon, sun = now.star;
        const sep = angSep(mo, sun) / 180;
        const ahead = Math.sin((mo.toStar.az - mo.az) * D2R) < 0;
        return ahead ? sep / 2 : 1 - sep / 2;
      }

      // ── plants ──
      let plantFrame = null;
      function showPlants(c) {
        const T = c.d.star.temperature, pres = self.home ? c.world.planet.pressure : 1;
        const locked = c.d.moon && c.d.moon.planetLockedToStar;
        const day = SP.leafColours(T, pres), dusk = T < 5300 ? SP.leafColours(T, pres, { twilight: true }) : null;
        const hab = habitatFor(c.world, c.d, v().lat);
        const letter = starLetter(T), gcls = gravityClass(c.d.planet.gravity);
        const seed = Math.abs(Math.round(OR.unit(c.world.id + hab + Math.round(v().lat)) * 999983));
        const url = `https://cloud.yusupov.cloud/plants/?star=${letter}&gravity=${gcls}&habitat=${hab}&seed=${seed}`;
        const swatches = (list) => h('div', { class: 'swatches' }, list.map((hx) => h('span', { class: 'swatch', style: { background: hx }, title: hx })));
        const habSel = h('select', { id: 'vista-hab' }, HABITATS.map(([val, t]) => h('option', { value: val, selected: val === c.world.vista.habitat }, t)));
        habSel.addEventListener('change', () => ctx.set('vista.habitat', habSel.value));
        const frameHost = h('div', { class: 'plant-frame' });
        const grow = () => {
          plantFrame = h('iframe', { src: url, title: `Plants of ${c.world.planet.name}`, loading: 'lazy', allow: 'fullscreen', referrerpolicy: 'no-referrer' });
          replace(frameHost, plantFrame);
        };
        replace(plantHost,
          !self.home ? h('p', { class: 'muted', style: { marginBottom: '10px' } }, `Plant life is shown for ${c.world.planet.name}, the home world.`) : null,
          h('div', { class: 'panel-sub' }, `Under a ${C.spectralClass(T).code} star, ${fmt.num(pres, 2)} atm`),
          swatches(day),
          h('p', { class: 'muted', style: { fontSize: '13px', margin: '6px 0 10px' } }, 'Leaf colours from light to dense pigment, for photosynthesis adapted to a star high in the sky (Panoptes: pigments absorb where the starlight is strong and changes fastest).'),
          dusk ? [h('div', { class: 'panel-sub' }, locked ? 'Adapted to perpetual twilight (tidally locked)' : 'If adapted to twilight (as on a locked world)'), swatches(dusk)] : null,
          h('div', { class: 'fields', style: { marginTop: '12px' } }, h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'vista-hab' }, 'Habitat', info(`For the plant grower: ${hab} here. “From the latitude” follows the circulation cells: jungle near the equator, deserts where the Hadley cells sink, forests in the Ferrel cells, tundra beyond.`)), habSel)),
          h('div', { class: 'btn-row', style: { marginTop: '12px' } },
            h('button', { class: 'btn primary', type: 'button', onclick: grow }, '✿ Grow plants here'),
            h('a', { class: 'btn', href: url, target: '_blank', rel: 'noopener' }, icon('link'), 'Open full screen')),
          frameHost,
          h('p', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } },
            'Colours: ', h('a', { href: 'https://panoptesv.com/SciFi/ColorsOfAlienWorlds/AlienFields.php', target: '_blank', rel: 'noopener' }, 'Panoptes V, Colors of Alien Plants'), ' and ',
            h('a', { href: 'https://panoptesv.com/SciFi/ColorsOfAlienWorlds/AlienSkies.php', target: '_blank', rel: 'noopener' }, 'Alien Skies'), '. Plants grown by the nodarium engine at cloud.yusupov.cloud/plants for a ', `${letter}-star, ${gcls}-gravity ${hab}.`));
      }

      // ── interaction: drag to look around ──
      let drag = null;
      cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, az: v().az, touch: e.pointerType !== 'mouse' }; if (!drag.touch) cv.setPointerCapture(e.pointerId); });
      cv.addEventListener('pointermove', (e) => {
        if (!drag || v().mode === 'dome') return;
        const P = project(cv.width, cv.height), dpr = cv.width / cv.clientWidth;
        const az = ((drag.az - (e.clientX - drag.x) * dpr / P.pxPerDeg) % 360 + 360) % 360;
        ctx.set('vista.az', Math.round(az * 10) / 10, { soft: true });
        k.update(ctx); render();
      });
      const end = () => { if (drag) { drag = null; ctx.set('vista.az', v().az); } };
      cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', () => { drag = null; });
      cv.classList.add('drag-x');
      cv.setAttribute('role', 'img');

      // ── time running ──
      let lastTs = 0;
      const tick = (ts) => {
        raf = null;
        if (!playing || !host.isConnected) return;
        const dt = lastTs && ts ? Math.min(0.1, (ts - lastTs) / 1000) : 0; lastTs = ts || 0;
        const hr = (v().hour + dt / 40) % 1;                                // a day in 40 s
        ctx.world.vista.hour = hr; if (hr < v().hour) ctx.world.vista.day = (v().day + OR.solarDay(self) / self.period) % 1;
        k.update(ctx); render();
        raf = requestAnimationFrame(tick);
      };

      let sigPlants = '';
      return {
        el,
        update(c) {
          air = prepare(c);
          k.update(c);
          replace(modeTabs, tabs([['panorama', 'Panorama'], ['dome', 'All-sky dome']], v().mode, (m) => ctx.set('vista.mode', m)));
          eyeSel.value = v().eye; labelsBox.checked = !!v().labels;
          cv.setAttribute('aria-label', `The sky from ${self.name}`);
          render();
          const sp = JSON.stringify([c.d.star.temperature, c.world.planet.pressure, self.id, v().habitat, v().lat > 0 ? Math.round(v().lat / 5) : Math.round(v().lat / 5), c.d.planet.gravity.toFixed(2)]);
          if (sp !== sigPlants) { sigPlants = sp; showPlants(c); }
        },
        destroy() { playing = false; if (raf) cancelAnimationFrame(raf); ro.disconnect(); },
      };
    },
  });

  // geometry helpers
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
})();
