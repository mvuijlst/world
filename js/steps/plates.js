/*
 * Plates: the supercontinent and its first breakup, as Artifexian builds them in GPlates.
 *   Worldbuilder's Log 10 (the Supercontinent): cratons, the continental crust round them, rifts,
 *     failed rifts.
 *   Worldbuilder's Log 11 (the First 100 Million Years): split the supercontinent along its rifts,
 *     give each plate rotation poles through time, move the continents at believable speeds, and
 *     watch new ocean crust form between them, with flowlines.
 * Drawn on a globe here; the rotations follow GPlates' model exactly (js/rotation.js, tested against
 * pyGPlates); the server writes and reads GPlates files with pyGPlates.
 */
(function () {
  'use strict';
  const { h, panel, fmt, replace, icon, info, toast } = WS.ui;
  const S = WS.sphere, Q = WS.rotation;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const KINDS = {
    craton: { label: 'Craton', closed: true, gplates: 'Craton', help: 'An old, stable core of continental crust (a shield). Draw several: each becomes the heart of a plate.' },
    crust: { label: 'Continental crust', closed: true, gplates: 'ContinentalCrust', help: 'Younger continental crust welded round the cratons. Together it makes the supercontinent.' },
    rift: { label: 'Rift', closed: false, gplates: 'ContinentalRift', help: 'A line along which the supercontinent will split. Rifts tend to run between cratons, not through them.' },
    failed: { label: 'Failed rift', closed: false, gplates: 'ContinentalRift', help: 'A rift arm that stops opening (an aulacogen), usually the third arm at a triple junction on a rift.' },
  };
  const PALETTE = ['#d9822b', '#2a9d8f', '#c0392b', '#7d5ba6', '#6a994e', '#3a86c8', '#b5838d', '#c9a227', '#4f7c7a', '#9c6644'];
  const colourOf = (plates, id) => { const i = plates.findIndex((p) => p.id === id); return i < 0 ? '#888888' : plates[i].colour || PALETTE[i % PALETTE.length]; };
  const hexA = (hx, a) => { const n = parseInt(hx.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  // ocean floor by age: young and hot (red) to old and cold (deep blue)
  const AGE_RAMP = [[0, [214, 60, 40]], [0.25, [235, 160, 60]], [0.5, [220, 210, 110]], [0.75, [70, 160, 160]], [1, [40, 70, 150]]];
  const ageColour = (f, a = 0.85) => {
    const t = clamp(f, 0, 1);
    for (let i = 1; i < AGE_RAMP.length; i++) if (t <= AGE_RAMP[i][0]) {
      const [t0, c0] = AGE_RAMP[i - 1], [t1, c1] = AGE_RAMP[i], k = (t - t0) / (t1 - t0);
      return `rgba(${c0.map((v, j) => Math.round(v + (c1[j] - v) * k)).join(',')},${a})`;
    }
    return `rgba(40,70,150,${a})`;
  };
  // speeds: Earth's plates move 1-10 cm/yr, the fastest about 15-20
  const SPEED_OK = 10, SPEED_MAX = 20;
  let fid = 0;
  const newId = () => `f${Date.now().toString(36)}${(fid++).toString(36)}`;

  const modelOf = (P) => Q.model(P.plates, P.start);
  const plateCentroid = (P, id) => {
    const fs = P.features.filter((f) => f.plateId === id && KINDS[f.kind].closed && f.coords.length >= 3);
    return fs.length ? S.latLon(S.centroid(fs.flatMap((f) => f.coords))) : null;
  };
  /* Speeds of a plate over each interval between its samples: [{from, to, cm}] (oldest first). */
  function plateSpeeds(P, id, radiusKm) {
    const p = P.plates.find((x) => x.id === id), c = plateCentroid(P, id);
    if (!p || !c) return [];
    const ages = [P.start, ...(p.rotations || []).map((r) => r.age).filter((a) => a < P.start)].sort((a, b) => b - a);
    const m = modelOf(P), out = [];
    for (let i = 1; i < ages.length; i++) out.push({ from: ages[i - 1], to: ages[i], cm: Q.speed(m, id, c, ages[i - 1], ages[i], radiusKm) });
    return out;
  }

  function stats(P, radiusKm) {
    const of = (k) => P.features.filter((f) => f.kind === k);
    const crust = S.coverage([...of('crust'), ...of('craton')].map((f) => f.coords));
    const cratons = S.coverage(of('craton').map((f) => f.coords));
    const length = (k) => of(k).reduce((s, f) => s + f.coords.slice(1).reduce((t, p, i) => t + S.distance(f.coords[i], p), 0), 0) * Math.PI / 180 * radiusKm;
    return { crust, cratons, land: crust * (29 / 41), rift: length('rift'), failed: length('failed'), counts: { craton: of('craton').length, crust: of('crust').length, rift: of('rift').length, failed: of('failed').length } };
  }

  /* The plates on either side of a rift, from the cratons and crust just beside its middle. */
  function sidesOf(P, rift) {
    const c = rift.coords, i = Math.max(0, Math.floor((c.length - 1) / 2));
    const a = S.vec(c[i]), b = S.vec(c[Math.min(c.length - 1, i + 1)]);
    const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const nl = Math.hypot(...n) || 1;
    const side = (sgn) => {
      for (const d of [0.02, 0.05, 0.1]) {
        const p = S.latLon(mid.map((v, k) => v + sgn * d * n[k] / nl));
        const hit = P.features.find((f) => f.kind === 'craton' && S.contains(f.coords, p)) || P.features.find((f) => f.kind === 'crust' && S.contains(f.coords, p));
        if (hit) return hit.plateId;
      }
      return null;
    };
    return { left: side(1), right: side(-1) };
  }

  WS.defineStep({
    id: 'plates', title: 'Plates', code: '00_LITHOSPHERE/PLATES', strip: 'Supercontinent & drift',
    blurb: 'Draw the supercontinent, split it along its rifts, and set the plates drifting.',
    lede: [
      'Following Artifexian’s Worldbuilder’s Log 10 and 11 (GPlates: the Supercontinent, the First 100 Million Years). Begin with one supercontinent: its cratons, the ancient stable cores, and the younger continental crust that welds them together (Earth’s covers about 40 % of the planet). Draw the rifts where it will tear apart, and a few failed rifts branching off them.',
      'Then split the crust along the rifts, so each side rides its own plate, and move the plates through time: at an age, drag a plate to where it should be, and the console writes the rotation pole GPlates would. Keep them to believable speeds (most plates 1–10 cm a year). New ocean floor opens behind them, coloured by age, with the mid-ocean ridge and flowlines. Everything goes to and from GPlates desktop.',
    ],
    build(ctx) {
      const P = () => ctx.world.plates;
      const u = (ctx.ui.plates = ctx.ui.plates || { lat: 20, lon: 10, zoom: 1, tool: 'look', draft: [], selected: null, plate: null, age: null, playing: false, spread: true, flow: false });
      if (u.age === null || u.age > P().start) u.age = P().start;
      const host = h('div', { class: 'scene-host globe-host' });
      const hint = h('div', { class: 'scene-status mono' });
      const timeHost = h('div', { class: 'time-bar' });
      const toolsHost = h('div'), listHost = h('div'), statsHost = h('div'), gplatesHost = h('div'), motionHost = h('div');
      let server = null;

      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' },
          panel('Draw & move', { ticks: true, tag: 'TOOLS' }, toolsHost),
          panel('Plate motion', { tag: 'ROTATION POLES' }, motionHost),
          panel('Plates & features', { tag: 'INVENTORY' }, listHost),
          panel('GPlates', { tag: 'IMPORT · EXPORT' }, gplatesHost)),
        h('div', { class: 'stack-gap' },
          panel('Globe', { tag: 'DRAG TO TURN · WHEEL TO ZOOM', flush: true }, timeHost, host, h('div', { class: 'viz-caption' }, hint)),
          statsHost));

      const cv = h('canvas', { class: 'scene-canvas', tabindex: 0, role: 'application', 'aria-label': 'Globe editor: draw cratons, crust and rifts, and move plates through time' });
      host.appendChild(cv);
      const g = cv.getContext('2d');
      const fit = () => {
        const w = host.clientWidth || 600, hh = Math.round(clamp(w * 0.82, 320, Math.max(360, window.innerHeight * 0.75)));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.style.height = `${hh}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
        draw();
      };
      const ro = new ResizeObserver(fit);
      const proj = () => S.orthographic(u.lat, u.lon, Math.min(cv.width, cv.height) * 0.44 * u.zoom, cv.width / 2, cv.height / 2);
      const atStart = () => u.age >= P().start;

      /* Where a feature is at the age on view. */
      function placed(m, f) { return atStart() ? f.coords : m.reconstruct(f.plateId, f.coords, u.age); }

      function pathOf(pr, coords, closed) {
        const pts = S.densify(coords, closed, 2).map((p) => pr.project(p));
        g.beginPath();
        pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
        if (closed) g.closePath();
        return pts;
      }

      let cursor = null;
      function draw() {
        if (!cv.width) return;
        const W = cv.width, H = cv.height, dpr = W / (cv.clientWidth || W);
        const pr = proj(), R = Math.min(W, H) * 0.44 * u.zoom;
        const col = { bg: css('--bg'), line: css('--line'), faint: css('--line-faint'), soft: css('--line-soft'), teal: css('--teal'), amber: css('--amber'), red: css('--red'), text: css('--text') };
        const Pw = P(), m = modelOf(Pw);
        g.fillStyle = col.bg; g.fillRect(0, 0, W, H);
        g.save();
        g.beginPath(); g.arc(W / 2, H / 2, R, 0, 2 * Math.PI);
        g.fillStyle = document.documentElement.dataset.theme === 'pulp' ? '#cfdcd6' : '#0b1d24'; g.fill();
        g.clip();
        g.lineWidth = dpr;
        for (let lat = -60; lat <= 60; lat += 30) { pathOf(pr, Array.from({ length: 73 }, (_, i) => [lat, -180 + i * 5]), false); g.strokeStyle = lat === 0 ? col.soft : col.faint; g.stroke(); }
        for (let lon = -180; lon < 180; lon += 30) { pathOf(pr, Array.from({ length: 37 }, (_, i) => [-90 + i * 5, lon]), false); g.strokeStyle = col.faint; g.stroke(); }

        // new ocean floor between plates that have parted, by age; ridges; flowlines
        const spreadRifts = new Set();
        if (!atStart() && u.spread) {
          for (const f of Pw.features.filter((x) => x.kind === 'rift' && x.left && x.right && x.left !== x.right && x.coords.length >= 2)) {
            const sp = Q.spreading(m, f.coords, f.left, f.right, Pw.start, u.age, Pw.step || 10);
            if (!sp.isochrons.length) continue;
            spreadRifts.add(f.id);
            const span = Pw.start - u.age;
            for (const [edge, flank] of [[sp.edgeL, 'left'], [sp.edgeR, 'right']]) {
              let prev = edge, prevAge = Pw.start;
              for (const iso of sp.isochrons) {
                const line = iso[flank];
                pathOf(pr, [...prev, ...line.slice().reverse()], true);
                g.fillStyle = ageColour((prevAge - u.age) / Math.max(1, span), 0.8); g.fill();
                prev = line; prevAge = iso.age;
              }
            }
            pathOf(pr, sp.ridge, false); g.strokeStyle = col.red; g.lineWidth = 2.4 * dpr; g.setLineDash([10 * dpr, 4 * dpr, 2 * dpr, 4 * dpr]); g.stroke(); g.setLineDash([]);
            if (u.flow) for (const fl of sp.flowlines) for (const arm of [fl.left, fl.right]) { pathOf(pr, arm, false); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = dpr; g.stroke(); }
          }
        }
        const plates = Pw.plates;
        const order = { crust: 0, craton: 1, rift: 2, failed: 3 };
        for (const f of Pw.features.slice().sort((a, b) => order[a.kind] - order[b.kind])) {
          const c = colourOf(plates, f.plateId), kind = KINDS[f.kind], at = placed(m, f);
          if (kind.closed && at.length >= 3) {
            pathOf(pr, at, true);
            g.fillStyle = hexA(c, f.kind === 'craton' ? 0.8 : 0.5); g.fill();
            g.strokeStyle = c; g.lineWidth = (f.kind === 'craton' ? 1.6 : 1.2) * dpr; g.stroke();
            if (f.kind === 'craton') {
              g.save(); pathOf(pr, at, true); g.clip();
              g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = dpr;
              for (let x = -H; x < W; x += 9 * dpr) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); }
              g.restore();
            }
          } else if (!kind.closed && at.length >= 2 && !spreadRifts.has(f.id)) {
            pathOf(pr, at, false);
            g.strokeStyle = col.red; g.lineWidth = (f.kind === 'rift' ? 3 : 2) * dpr;
            g.setLineDash(f.kind === 'failed' ? [7 * dpr, 5 * dpr] : []); g.stroke(); g.setLineDash([]);
          }
          if (u.selected === f.id) {
            if (at.length >= 2) { pathOf(pr, at, kind.closed); g.strokeStyle = col.teal; g.lineWidth = 2.4 * dpr; g.stroke(); }
            if (u.tool === 'look') for (const p of at) { const q = pr.project(p); if (!q[2]) continue; g.fillStyle = col.bg; g.strokeStyle = col.teal; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(q[0], q[1], 5 * dpr, 0, 2 * Math.PI); g.fill(); g.stroke(); }
          }
        }
        if (u.draft.length) {
          const pts = cursor ? [...u.draft, cursor] : u.draft;
          pathOf(pr, pts, false);
          g.strokeStyle = col.amber; g.lineWidth = 2 * dpr; g.setLineDash([5 * dpr, 4 * dpr]); g.stroke(); g.setLineDash([]);
          u.draft.forEach((p, i) => { const q = pr.project(p); g.fillStyle = i === 0 ? col.amber : col.bg; g.strokeStyle = col.amber; g.beginPath(); g.arc(q[0], q[1], (i === 0 ? 6 : 4) * dpr, 0, 2 * Math.PI); g.fill(); g.stroke(); });
        }
        g.restore();
        g.strokeStyle = col.line; g.lineWidth = 1.5 * dpr; g.beginPath(); g.arc(W / 2, H / 2, R, 0, 2 * Math.PI); g.stroke();
        g.font = `${12 * dpr}px ${css('--font-mono') || 'monospace'}`;
        for (const f of Pw.features) {
          if (!f.name || f.coords.length < 2) continue;
          const at = placed(m, f);
          const pos = KINDS[f.kind].closed ? S.latLon(S.centroid(at)) : at[Math.floor(at.length / 2)];
          const q = pr.project(pos); if (!q[2]) continue;
          g.fillStyle = col.text; g.fillText(f.name, q[0] + 4 * dpr, q[1]);
        }
        // the age on view, in the corner
        g.font = `${18 * dpr}px ${css('--font-mono') || 'monospace'}`; g.fillStyle = col.amber;
        g.fillText(`${fmt.int(u.age)} Ma`, 12 * dpr, 24 * dpr);
        hint.textContent = hintText();
      }
      function hintText() {
        if (u.tool === 'move') return atStart() ? 'Move: first choose a younger age with the time slider: at the start age the plates sit as drawn' : (u.selected ? 'Drag on the globe to move the selected feature’s plate to where it is at this age' : 'Tap a plate to choose it, then drag to move it');
        if (u.tool === 'look') return u.selected ? 'Drag a handle to move a point · Delete removes the shape · drag elsewhere to turn the globe' : 'Tap a shape to select it · drag to turn the globe · choose a tool to draw';
        const k = KINDS[u.tool];
        if (!u.draft.length) return `${k.label}: tap the globe to place the first point`;
        return k.closed ? `${u.draft.length} points · tap the first point or press Enter to close · Backspace undoes · Esc cancels` : `${u.draft.length} points · double-tap or press Enter to finish · Backspace undoes · Esc cancels`;
      }

      // ── editing ──
      function commitDraft() {
        const tool = u.tool, k = KINDS[tool];
        if (!k) return;
        const pts = u.draft.slice();
        u.draft = []; cursor = null;
        if ((k.closed && pts.length < 3) || (!k.closed && pts.length < 2)) { draw(); return; }
        ctx.mutate((w) => {
          const Pw = w.plates, m = modelOf(Pw);
          const where = (f) => (atStart() ? f.coords : m.reconstruct(f.plateId, f.coords, u.age));
          let plateId = null;
          if (tool === 'craton') {
            plateId = Pw.nextPlate++;
            Pw.plates.push({ id: plateId, name: `Plate ${plateId}`, colour: PALETTE[Pw.plates.length % PALETTE.length], fixed: 0, rotations: [] });
            const mid = S.latLon(S.centroid(pts));
            for (const f of Pw.features) if (f.kind === 'crust' && !Pw.plates.some((q) => q.id === f.plateId) && S.contains(where(f), mid)) f.plateId = plateId;
          } else {
            const host2 = Pw.features.find((f) => f.kind === 'craton' && S.contains(where(f), pts[0])) || Pw.features.find((f) => f.kind === 'crust' && S.contains(where(f), pts[0]));
            plateId = host2 ? host2.plateId : (u.plate ?? (Pw.plates[0] ? Pw.plates[0].id : 0));
          }
          // drawn at another age: store where it was at the start (its plate's rotation undone)
          const ref = atStart() ? pts : modelOf(Pw).unreconstruct(plateId, pts, u.age);
          const n = Pw.features.filter((f) => f.kind === tool).length + 1;
          const f = { id: newId(), kind: tool, plateId, name: `${k.label} ${n}`, coords: ref.map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]) };
          if (tool === 'rift') Object.assign(f, sidesOf(Pw, f));
          Pw.features.push(f);
          u.selected = f.id;
        });
        renderSide(); draw();
      }
      function removeSelected() {
        if (!u.selected) return;
        ctx.mutate((w) => {
          const f = w.plates.features.find((x) => x.id === u.selected);
          w.plates.features = w.plates.features.filter((x) => x.id !== u.selected);
          if (f && f.kind === 'craton' && !w.plates.features.some((x) => x.plateId === f.plateId)) w.plates.plates = w.plates.plates.filter((p) => p.id !== f.plateId);
        });
        u.selected = null; renderSide(); draw();
      }
      function pick(x, y) {
        const pr = proj(), at = pr.invert(x, y);
        if (!at) return null;
        const m = modelOf(P()), dpr = cv.width / cv.clientWidth, R = Math.min(cv.width, cv.height) * 0.44 * u.zoom;
        const tol = (10 * dpr / R) * 180 / Math.PI;
        const lines = P().features.filter((f) => !KINDS[f.kind].closed && f.coords.length >= 2).map((f) => [S.distanceToLine(at, placed(m, f)), f]).filter(([d]) => d < tol).sort((a, b) => a[0] - b[0]);
        if (lines.length && u.tool !== 'move') return lines[0][1];
        const polys = P().features.filter((f) => KINDS[f.kind].closed && S.contains(placed(m, f), at)).sort((a, b) => S.areaFraction(a.coords) - S.areaFraction(b.coords));
        return polys[0] || null;
      }
      /* Split every crust polygon a rift crosses into two, each on the plate of the craton it holds. */
      function splitAlong(rift) {
        let cuts = 0;
        ctx.mutate((w) => {
          const Pw = w.plates, out = [];
          for (const f of Pw.features) {
            if (f.kind !== 'crust') { out.push(f); continue; }
            const parts = S.splitPolygon(f.coords, rift.coords);
            if (!parts) { out.push(f); continue; }
            cuts++;
            parts.forEach((ring, i) => {
              const craton = Pw.features.find((c) => c.kind === 'craton' && S.contains(ring, S.latLon(S.centroid(c.coords))));
              out.push({ id: newId(), kind: 'crust', plateId: craton ? craton.plateId : f.plateId, name: `${f.name} ${i ? 'B' : 'A'}`, coords: ring.map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]) });
            });
          }
          Pw.features = out;
          const r = Pw.features.find((x) => x.id === rift.id);
          if (r) Object.assign(r, sidesOf(Pw, r));
        });
        toast(cuts ? `Split ${cuts} crust shape${cuts > 1 ? 's' : ''} along ${rift.name}` : `${rift.name} doesn’t cross any crust from edge to edge`);
        renderSide(); draw();
      }

      // pointer: drag turns the globe, moves a handle, or (move tool) moves a plate; a tap adds a point or selects
      const pts = new Map(); let gesture = null, lastTap = 0, lastXY = [0, 0];
      const local = (e) => { const r = cv.getBoundingClientRect(), dpr = cv.width / r.width; return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
      cv.addEventListener('pointerdown', (e) => {
        cv.focus({ preventScroll: true });
        cv.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, local(e));
        if (pts.size === 2) { const [a, b] = [...pts.values()]; gesture = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: u.zoom }; return; }
        const [x, y] = local(e);
        gesture = { x, y, lat: u.lat, lon: u.lon, moved: false, handle: null, plate: null };
        const sel = P().features.find((q) => q.id === u.selected);
        if (u.tool === 'look' && sel) {
          const m = modelOf(P()), pr = proj(), dpr = cv.width / cv.clientWidth;
          placed(m, sel).forEach((p, i) => { const q = pr.project(p); if (q[2] && Math.hypot(q[0] - x, q[1] - y) < 12 * dpr) gesture.handle = i; });
        }
        if (u.tool === 'move' && !atStart()) {
          const hit = pick(x, y) || sel;
          const start = proj().invert(x, y);
          if (hit && start) {
            u.selected = hit.id;
            const pl = P().plates.find((p) => p.id === hit.plateId);
            if (pl) gesture.plate = { id: pl.id, from: start, base: modelOf(P()).absolute(pl.id, u.age), fixedAbs: modelOf(P()).absolute(pl.fixed || 0, u.age), original: JSON.parse(JSON.stringify(pl.rotations || [])) };
          }
        }
      });
      cv.addEventListener('pointermove', (e) => {
        const [x, y] = local(e);
        if (u.draft.length && !pts.size) { cursor = proj().invert(x, y); draw(); }
        if (!pts.has(e.pointerId) || !gesture) return;
        pts.set(e.pointerId, [x, y]);
        if (gesture.pinch !== undefined && pts.size === 2) { const [a, b] = [...pts.values()]; u.zoom = clamp(gesture.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / gesture.pinch, 0.6, 8); draw(); return; }
        const dpr = cv.width / cv.clientWidth;
        if (Math.hypot(x - gesture.x, y - gesture.y) > 4 * dpr) gesture.moved = true;
        if (!gesture.moved) return;
        if (gesture.plate) {
          const to = proj().invert(x, y);
          if (!to) return;
          const a = S.vec(gesture.plate.from), b = S.vec(to);
          const axis = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
          const ang = Math.atan2(Math.hypot(...axis), a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
          const drag = ang > 1e-9 ? Q.fromAxisAngle(axis, ang) : Q.IDENTITY;
          const rel = Q.toPole(Q.mul(Q.inverse(gesture.plate.fixedAbs), Q.mul(drag, gesture.plate.base)));
          const pl = P().plates.find((p) => p.id === gesture.plate.id);
          pl.rotations = gesture.plate.original.filter((r) => r.age !== u.age).concat([{ age: u.age, lat: +rel.lat.toFixed(4), lon: +rel.lon.toFixed(4), angle: +rel.angle.toFixed(4) }]);
          draw();
          return;
        }
        if (gesture.handle !== null) {
          const at = proj().invert(x, y);
          const f = P().features.find((q) => q.id === u.selected);
          if (at && f) { const [ref] = atStart() ? [at] : modelOf(P()).unreconstruct(f.plateId, [at], u.age); f.coords[gesture.handle] = [+ref[0].toFixed(4), +ref[1].toFixed(4)]; draw(); }
          return;
        }
        const R = Math.min(cv.width, cv.height) * 0.44 * u.zoom, k = (180 / Math.PI) / R;
        u.lon = ((gesture.lon - (x - gesture.x) * k / Math.max(0.2, Math.cos(u.lat * Math.PI / 180))) + 540) % 360 - 180;
        u.lat = clamp(gesture.lat + (y - gesture.y) * k, -89, 89);
        draw();
      });
      const release = (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.delete(e.pointerId);
        const gst = gesture;
        if (pts.size) return;
        gesture = null;
        if (!gst || gst.pinch !== undefined) return;
        if (gst.plate && gst.moved) { ctx.set('plates.plates', P().plates); renderSide(); return; }
        if (gst.handle !== null && gst.moved) { ctx.set('plates.features', P().features); renderSide(); return; }
        if (gst.moved) return;
        const [x, y] = local(e), now = Date.now();
        if (u.tool === 'look' || u.tool === 'move') { const f = pick(x, y); u.selected = f ? f.id : null; renderSide(); draw(); return; }
        const at = proj().invert(x, y);
        if (!at) return;
        const k = KINDS[u.tool], pr = proj(), dpr = cv.width / cv.clientWidth;
        if (k.closed && u.draft.length >= 3) { const q = pr.project(u.draft[0]); if (Math.hypot(q[0] - x, q[1] - y) < 12 * dpr) { commitDraft(); return; } }
        if (!k.closed && u.draft.length >= 2 && now - lastTap < 400 && Math.hypot(x - lastXY[0], y - lastXY[1]) < 10 * dpr) { commitDraft(); lastTap = 0; return; }
        u.draft.push(at); lastTap = now; lastXY = [x, y]; draw();
      };
      cv.addEventListener('pointerup', release);
      cv.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); gesture = null; });
      cv.addEventListener('wheel', (e) => { e.preventDefault(); u.zoom = clamp(u.zoom * Math.exp(-e.deltaY * 0.0012), 0.6, 8); draw(); }, { passive: false });
      cv.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && u.draft.length) { e.preventDefault(); commitDraft(); }
        else if (e.key === 'Escape') { u.draft = []; cursor = null; draw(); }
        else if (e.key === 'Backspace' && u.draft.length) { e.preventDefault(); u.draft.pop(); draw(); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && u.selected && u.tool === 'look') { e.preventDefault(); removeSelected(); }
      });
      cv.style.touchAction = 'none'; cv.style.cursor = 'crosshair';

      // ── time ──
      let raf = null, lastT = 0;
      const setAge = (a) => { u.age = clamp(Math.round(a), 0, P().start); renderTime(); renderMotion(); draw(); };
      const play = (ts) => {
        raf = null;
        if (!u.playing || !host.isConnected) return;
        if (!lastT) lastT = ts;
        if (ts - lastT > 280) { lastT = ts; if (u.age <= 0) { u.playing = false; renderTime(); return; } setAge(u.age - (P().step || 10)); }
        raf = requestAnimationFrame(play);
      };
      function renderTime() {
        const Pw = P();
        const slider = h('input', { type: 'range', min: 0, max: Pw.start, step: 1, value: Pw.start - u.age, 'aria-label': 'Age on view (drag right to go forward in time)' });
        slider.addEventListener('input', () => setAge(Pw.start - Number(slider.value)));
        const startIn = h('input', { class: 'txt num', type: 'number', min: 10, max: 4500, step: 10, value: Pw.start, 'aria-label': 'Start age of the supercontinent (Ma)', style: { width: '90px' } });
        startIn.addEventListener('change', () => {
          const v = clamp(Math.round(Number(startIn.value) || Pw.start), 10, 4500);
          ctx.mutate((w) => { const d = v - w.plates.start; w.plates.start = v; for (const p of w.plates.plates) for (const r of p.rotations || []) r.age += d; });
          u.age = v; renderSide(); renderTime(); draw();
        });
        replace(timeHost,
          h('button', { class: 'btn small primary', type: 'button', onclick: () => { u.playing = !u.playing; if (u.playing) { if (u.age <= 0) u.age = Pw.start; lastT = 0; raf = requestAnimationFrame(play); } renderTime(); } }, u.playing ? '❚❚' : '▶'),
          h('button', { class: 'btn small', type: 'button', 'aria-label': 'Back one step', onclick: () => setAge(u.age + (Pw.step || 10)) }, '−'),
          h('div', { class: 'time-slider' }, slider, h('div', { class: 'time-scale mono' }, h('span', null, `${fmt.int(Pw.start)} Ma`), h('span', { class: 't-amber' }, `${fmt.int(u.age)} Ma · ${fmt.int(Pw.start - u.age)} Myr after the start`), h('span', null, '0 Ma'))),
          h('button', { class: 'btn small', type: 'button', 'aria-label': 'Forward one step', onclick: () => setAge(u.age - (Pw.step || 10)) }, '+'),
          h('label', { class: 'time-start' }, h('span', { class: 'field-label' }, 'Start', info('The age of the supercontinent as drawn, in millions of years ago (Artifexian starts at 1000 Ma). Changing it shifts every rotation with it.')), startIn));
      }

      // ── side panels ──
      function renderTools() {
        const btn = (tool, label, swatch) => h('button', {
          type: 'button', class: ['btn small tool-btn', u.tool === tool && 'active'], 'aria-pressed': String(u.tool === tool),
          onclick: () => { u.tool = tool; u.draft = []; cursor = null; renderTools(); draw(); cv.focus({ preventScroll: true }); },
        }, swatch, label);
        const sw = (style) => h('i', { class: 'tool-swatch', style });
        const plates = P().plates;
        const sel = P().features.find((f) => f.id === u.selected);
        const plateSel = h('select', { class: 'sel', id: 'plate-for-new', 'aria-label': 'Plate for new crust and rifts' },
          h('option', { value: '' }, 'automatic (the craton underneath)'),
          plates.map((p) => h('option', { value: p.id, selected: u.plate === p.id }, `${p.id} · ${p.name}`)));
        plateSel.addEventListener('change', () => { u.plate = plateSel.value === '' ? null : Number(plateSel.value); });
        const toggle = (key, label) => { const b = h('input', { type: 'checkbox', checked: u[key] }); b.addEventListener('change', () => { u[key] = b.checked; draw(); }); return h('label', { class: 'check' }, b, label); };
        replace(toolsHost,
          h('div', { class: 'btn-row' },
            btn('look', 'Select / turn', null),
            btn('craton', 'Craton', sw({ background: PALETTE[0] })),
            btn('crust', 'Crust', sw({ background: hexA(PALETTE[0], 0.4), border: `1px solid ${PALETTE[0]}` })),
            btn('rift', 'Rift', sw({ background: 'var(--red)', height: '3px' })),
            btn('failed', 'Failed rift', sw({ background: 'repeating-linear-gradient(90deg, var(--red) 0 5px, transparent 5px 8px)', height: '3px' })),
            btn('move', 'Move plate', sw({ background: 'var(--teal)', borderRadius: '50%', width: '10px' }))),
          h('p', { class: 'muted', style: { fontSize: '13.5px', margin: '10px 0' } },
            u.tool === 'look' ? 'Choose a tool, then tap points on the globe. Each craton starts a plate of its own; crust and rifts join the plate of the craton they start on.'
              : u.tool === 'move' ? 'Pick an age with the time slider, then drag a plate to where it should be then. Each drag writes a rotation pole for that age; between ages the plate glides as in GPlates.'
                : KINDS[u.tool].help),
          KINDS[u.tool] ? h('div', { class: 'btn-row' },
            h('button', { class: 'btn small primary', type: 'button', onclick: commitDraft }, 'Finish shape'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { u.draft.pop(); draw(); } }, 'Undo point'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { u.draft = []; cursor = null; draw(); } }, 'Cancel')) : null,
          sel && sel.kind === 'rift' ? h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            h('button', { class: 'btn small primary', type: 'button', onclick: () => splitAlong(sel) }, `Split the crust along ${sel.name}`)) : null,
          plates.length ? h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', { class: 'field-label', for: 'plate-for-new' }, 'Plate for new crust & rifts'), plateSel) : null,
          h('div', { class: 'btn-row', style: { marginTop: '12px' } }, toggle('spread', 'New ocean floor & ridges'), toggle('flow', 'Flowlines')));
      }

      function renderMotion() {
        const Pw = P();
        const sel = Pw.features.find((f) => f.id === u.selected);
        const pl = sel && Pw.plates.find((p) => p.id === sel.plateId);
        if (!pl) { replace(motionHost, h('p', { class: 'muted' }, Pw.plates.length ? 'Select a shape to see and edit the motion of its plate.' : 'Draw cratons first: each one starts a plate.')); return; }
        const speeds = plateSpeeds(Pw, pl.id, ctx.d.planet.radiusKm);
        const fixedSel = h('select', { class: 'sel', 'aria-label': `Plate ${pl.id} moves relative to` },
          h('option', { value: 0, selected: !pl.fixed }, '0 · the reference frame'),
          Pw.plates.filter((p) => p.id !== pl.id).map((p) => h('option', { value: p.id, selected: pl.fixed === p.id }, `${p.id} · ${p.name}`)));
        fixedSel.addEventListener('change', () => {
          // keep the plate where it is: re-express each sample relative to the new fixed plate
          const m = modelOf(Pw), nf = Number(fixedSel.value);
          if (nf && Q.model(Pw.plates.map((p) => (p.id === pl.id ? { ...p, fixed: nf } : p)), Pw.start).absolute(nf, Pw.start) && wouldLoop(Pw, pl.id, nf)) { toast('That would make the plates move relative to each other in a loop'); fixedSel.value = pl.fixed || 0; return; }
          const rots = (pl.rotations || []).map((r) => { const abs = m.absolute(pl.id, r.age); const rel = Q.toPole(Q.mul(Q.inverse(m.absolute(nf, r.age)), abs)); return { age: r.age, lat: +rel.lat.toFixed(4), lon: +rel.lon.toFixed(4), angle: +rel.angle.toFixed(4) }; });
          ctx.mutate(() => { pl.fixed = nf; pl.rotations = rots; });
          renderMotion(); draw();
        });
        const rows = (pl.rotations || []).slice().sort((a, b) => b.age - a.age).map((r) => {
          const num = (key, step, label) => { const i = h('input', { class: 'txt num', type: 'number', step, value: r[key], 'aria-label': `${label} at ${r.age} Ma` }); i.addEventListener('change', () => { const v = Number(i.value); if (!Number.isFinite(v)) return; r[key] = key === 'age' ? clamp(Math.round(v), 0, Pw.start - 1) : v; ctx.set('plates.plates', Pw.plates); renderMotion(); draw(); }); return i; };
          const sp = speeds.find((s) => s.to === r.age);
          return h('tr', null, h('td', null, num('age', 1, 'Age')), h('td', null, num('lat', 0.1, 'Pole latitude')), h('td', null, num('lon', 0.1, 'Pole longitude')), h('td', null, num('angle', 0.1, 'Angle')),
            h('td', { class: ['num', sp && (sp.cm > SPEED_MAX ? 't-red' : sp.cm > SPEED_OK ? 't-amber' : 't-teal')] }, sp ? fmt.num(sp.cm, 1) : '—'),
            h('td', null, h('button', { type: 'button', class: 'btn small danger', 'aria-label': `Delete the pole at ${r.age} Ma`, onclick: () => { pl.rotations = pl.rotations.filter((x) => x !== r); ctx.set('plates.plates', Pw.plates); renderMotion(); draw(); } }, icon('x'))));
        });
        replace(motionHost,
          h('div', { class: 'plate-head', style: { marginBottom: '8px' } }, h('i', { class: 'plate-chip', style: { background: colourOf(Pw.plates, pl.id) } }), h('b', null, `${pl.id} · ${pl.name}`)),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Moves relative to', info('Plate 0 is the fixed reference frame. Choose another plate to move this one along with it (as GPlates’ fixed plate).')), fixedSel),
          h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, h('table', { class: 'data poles' },
            h('thead', null, h('tr', null, h('th', null, 'Age Ma'), h('th', null, 'Pole lat'), h('th', null, 'Pole lon'), h('th', null, 'Angle °'), h('th', null, ['cm/yr ', info(`Speed of the plate’s centre since the previous pole. Earth’s plates move 1–${SPEED_OK} cm a year; above ${SPEED_MAX} is implausibly fast.`)]), h('th'))),
            h('tbody', null, h('tr', { class: 'hz' }, h('td', { class: 'num' }, fmt.int(Pw.start)), h('td', { class: 'txtcell', colspan: 3 }, 'as drawn (no rotation)'), h('td'), h('td')), rows))),
          h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            h('button', { class: 'btn small', type: 'button', disabled: atStart(), onclick: () => {
              const rel = Q.toPole(modelOf(Pw).relative(pl.id, u.age));
              pl.rotations = (pl.rotations || []).filter((r) => r.age !== u.age).concat([{ age: u.age, lat: +rel.lat.toFixed(4), lon: +rel.lon.toFixed(4), angle: +rel.angle.toFixed(4) }]);
              ctx.set('plates.plates', Pw.plates); renderMotion();
            } }, icon('plus'), `Pole at ${fmt.int(u.age)} Ma`)));
      }
      function wouldLoop(Pw, id, fixed) { let f = fixed, n = 0; while (f && n++ < 60) { if (f === id) return true; const p = Pw.plates.find((x) => x.id === f); f = p ? p.fixed : 0; } return false; }

      function renderList() {
        const Pw = P();
        if (!Pw.features.length) { replace(listHost, h('p', { class: 'muted' }, 'Nothing drawn yet. Start with a craton.')); return; }
        const plateOpts = (sel) => Pw.plates.map((p) => h('option', { value: p.id, selected: p.id === sel }, `${p.id}`));
        const rows = Pw.plates.map((pl) => {
          const name = h('input', { class: 'txt', value: pl.name, 'aria-label': `Name of plate ${pl.id}` });
          name.addEventListener('change', () => { pl.name = name.value || `Plate ${pl.id}`; ctx.set('plates.plates', Pw.plates); renderTools(); renderMotion(); });
          return h('div', { class: 'plate-block' },
            h('div', { class: 'plate-head' }, h('i', { class: 'plate-chip', style: { background: colourOf(Pw.plates, pl.id) } }), h('span', { class: 'mono' }, String(pl.id)), name),
            Pw.features.filter((f) => f.plateId === pl.id).map((f) => featureRow(f, plateOpts)));
        });
        const loose = Pw.features.filter((f) => !Pw.plates.some((p) => p.id === f.plateId));
        replace(listHost, rows, loose.length ? h('div', { class: 'plate-block' }, h('div', { class: 'plate-head' }, h('span', { class: 'muted' }, 'Not on a plate')), loose.map((f) => featureRow(f, plateOpts))) : null);
      }
      function featureRow(f, plateOpts) {
        const Pw = P();
        const name = h('input', { class: 'txt', value: f.name, 'aria-label': `${KINDS[f.kind].label} name` });
        name.addEventListener('change', () => { f.name = name.value; ctx.set('plates.features', Pw.features); draw(); });
        const sel = h('select', { class: 'sel', 'aria-label': `Plate of ${f.name}` }, plateOpts(f.plateId));
        sel.addEventListener('change', () => { f.plateId = Number(sel.value); ctx.set('plates.features', Pw.features); renderList(); draw(); });
        const area = KINDS[f.kind].closed ? `${fmt.num(S.areaFraction(f.coords) * 100, 1)} %` : `${fmt.int(f.coords.slice(1).reduce((t, p, i) => t + S.distance(f.coords[i], p), 0) * Math.PI / 180 * ctx.d.planet.radiusKm)} km`;
        const row = h('div', { class: ['feature-row', u.selected === f.id && 'selected'] },
          h('button', { type: 'button', class: 'btn small', title: 'Show on the globe', 'aria-label': `Select ${f.name}`, onclick: () => { u.selected = f.id; if (u.tool !== 'move') u.tool = 'look'; const c = S.latLon(S.centroid(placed(modelOf(Pw), f))); u.lat = clamp(c[0], -89, 89); u.lon = c[1]; renderSide(); draw(); } }, KINDS[f.kind].label),
          name, f.kind === 'craton' ? h('span', { class: 'muted mono' }, String(f.plateId)) : sel, h('span', { class: 'mono t-amber' }, area),
          h('button', { type: 'button', class: 'btn small danger', 'aria-label': `Delete ${f.name}`, onclick: () => { u.selected = f.id; removeSelected(); } }, icon('x')));
        if (f.kind !== 'rift') return row;
        // a rift opens between two plates
        const side = (key, label) => {
          const s = h('select', { class: 'sel', 'aria-label': `${label} plate of ${f.name}` }, h('option', { value: '' }, '—'), Pw.plates.map((p) => h('option', { value: p.id, selected: p.id === f[key] }, `${p.id}`)));
          s.addEventListener('change', () => { f[key] = s.value === '' ? null : Number(s.value); ctx.set('plates.features', Pw.features); draw(); });
          return h('label', { class: 'rift-side' }, h('span', { class: 'field-label' }, label), s);
        };
        return h('div', null, row, h('div', { class: 'rift-sides' }, side('left', 'Opens between'), side('right', 'and'),
          h('button', { type: 'button', class: 'btn small', onclick: () => { Object.assign(f, sidesOf(Pw, f)); ctx.set('plates.features', Pw.features); renderList(); draw(); } }, 'Detect')));
      }

      function renderStats() {
        const Pw = P(), st = stats(Pw, ctx.d.planet.radiusKm);
        const fastest = Pw.plates.map((p) => ({ p, s: plateSpeeds(Pw, p.id, ctx.d.planet.radiusKm) })).flatMap(({ p, s }) => s.map((x) => ({ ...x, p }))).sort((a, b) => b.cm - a.cm)[0];
        replace(statsHost, h('div', { class: 'readouts' },
          [['Continental crust', `${fmt.num(st.crust * 100, 1)} %`, 'of the surface · Earth ≈ 40 %', 'Union of all crust and cratons, measured on the sphere.'],
            ['Cratons', `${fmt.num(st.cratons * 100, 1)} %`, `${st.counts.craton} drawn`, null],
            ['Land, estimated', `${fmt.num(st.land * 100, 1)} %`, 'crust × 29/41, Earth’s share above the sea', 'On Earth about 29 % of the surface is land on about 41 % continental crust: the rest is flooded shelf.'],
            ['Rifts', `${fmt.int(st.rift)} km`, `${st.counts.rift} rifts · ${st.counts.failed} failed (${fmt.int(st.failed)} km)`, null],
            ['Fastest plate', fastest ? `${fmt.num(fastest.cm, 1)} cm/yr` : '—', fastest ? `${fastest.p.name}, ${fmt.int(fastest.from)}–${fmt.int(fastest.to)} Ma` : 'no poles yet', `Earth’s plates: 1–${SPEED_OK} cm/yr; the fastest about 15–${SPEED_MAX}.`]]
            .map(([l, v, sub, tip]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l, info(tip)), h('div', { class: 'val' }, v), h('div', { class: 'sub' }, sub)))),
          st.crust > 0 ? h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            h('button', { class: 'btn small', type: 'button', onclick: () => { ctx.mutate((w) => { w.population.land = +(st.land * 100).toFixed(1); }); toast(`Population land set to ${fmt.num(st.land * 100, 1)} %`); } }, `Use ${fmt.num(st.land * 100, 1)} % as land on Population`),
            h('span', { class: 'muted', style: { fontSize: '13px', alignSelf: 'center' } }, `now ${fmt.num(ctx.world.population.land, 1)} %`)) : null,
          !atStart() && u.spread ? h('div', { class: 'age-key' }, h('span', { class: 'mono' }, 'ocean floor age'), h('i', { style: { background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => ageColour(t, 1)).join(',')})` } }), h('span', { class: 'mono' }, `0 → ${fmt.int(P().start - u.age)} Myr`)) : null);
      }

      // ── GPlates ──
      async function checkServer() {
        if (location.protocol === 'file:') { server = false; return; }
        try { const r = await fetch('api/plates/status'); const j = await r.json(); server = j && j.available ? j : false; } catch { server = false; }
      }
      function download(blob, name) { const a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
      const safeName = () => (ctx.world.name || 'world').replace(/[^\w-]+/g, '_');
      function geojson() {
        const Pw = P();
        return {
          type: 'FeatureCollection',
          features: Pw.features.filter((f) => f.coords.length >= (KINDS[f.kind].closed ? 3 : 2)).map((f) => ({
            type: 'Feature',
            properties: { name: f.name, kind: f.kind, PLATEID1: f.plateId, plate: (Pw.plates.find((p) => p.id === f.plateId) || {}).name || '', gplates: KINDS[f.kind].gplates, left: f.left ?? null, right: f.right ?? null },
            geometry: KINDS[f.kind].closed ? { type: 'Polygon', coordinates: [[...f.coords, f.coords[0]].map(([la, lo]) => [lo, la])] } : { type: 'LineString', coordinates: f.coords.map(([la, lo]) => [lo, la]) },
          })),
        };
      }
      /* A GPlates rotation file (PLATES4): "plate age lat lon angle fixed !comment" per line. */
      function parseRot(text) {
        const seqs = new Map();
        for (const line of text.split(/\r?\n/)) {
          const m = line.trim().match(/^(\d+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(\d+)\s*(?:!(.*))?$/);
          if (!m) continue;
          const [, id, age, lat, lon, ang, fixed, note] = m;
          if (+id === 999) continue;                                             // GPlates' comment plate
          const s = seqs.get(+id) || { id: +id, fixed: +fixed, name: (note || '').trim(), rotations: [] };
          s.rotations.push({ age: +age, lat: +lat, lon: +lon, angle: +ang });
          seqs.set(+id, s);
        }
        return [...seqs.values()];
      }
      function takeIn(features, plates, how) {
        if (!features.length) { toast(`${how}: no cratons, crust or rifts found`); return; }
        if (P().features.length && !confirm(`Add ${features.length} shapes from ${how} to the ones already drawn?`)) return;
        ctx.mutate((w) => {
          const Pw = w.plates;
          const ensure = (id, name) => { if (!Pw.plates.some((q) => q.id === id)) Pw.plates.push({ id, name: name || `Plate ${id}`, colour: PALETTE[Pw.plates.length % PALETTE.length], fixed: 0, rotations: [] }); };
          for (const p of plates) ensure(p.id, p.name);
          for (const f of features) { ensure(f.plateId); Pw.features.push({ id: newId(), kind: f.kind, plateId: f.plateId, name: f.name || KINDS[f.kind].label, coords: f.coords, left: f.left ?? null, right: f.right ?? null }); }
          for (const f of Pw.features) if (f.kind === 'rift' && !f.left && !f.right) Object.assign(f, sidesOf(Pw, f));
          Pw.nextPlate = Math.max(Pw.nextPlate, ...Pw.plates.map((p) => p.id + 1));
        }, { structural: true });
        toast(`${how}: ${features.length} shapes added`);
      }
      function takeRotations(seqs, how) {
        const Pw = P();
        let n = 0, skipped = 0;
        ctx.mutate(() => {
          for (const s of seqs) {
            const pl = Pw.plates.find((p) => p.id === s.id);
            if (!pl) { skipped++; continue; }
            pl.fixed = s.fixed || 0;
            pl.rotations = s.rotations.filter((r) => r.age < Pw.start && r.age >= 0).map((r) => ({ ...r }));
            if (s.name && /^Plate \d+$/.test(pl.name)) pl.name = s.name;
            n++;
          }
        }, { structural: true });
        toast(`${how}: rotations for ${n} plate${n === 1 ? '' : 's'}${skipped ? `; ${skipped} not drawn here were left out` : ''}`);
      }
      async function exportGplates() {
        try {
          const Pw = P();
          const r = await fetch('api/plates/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ctx.world.name, start: Pw.start, step: Pw.step || 10, plates: Pw.plates, features: Pw.features }) });
          if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
          download(await r.blob(), `${safeName()}-gplates.zip`);
        } catch (err) { toast(`Export failed: ${err.message}`); }
      }
      async function importFile(file) {
        try {
          if (/\.rot$/i.test(file.name)) { takeRotations(parseRot(await file.text()), file.name); return; }
          if (/\.(geo)?json$/i.test(file.name)) {
            const gj = JSON.parse(await file.text());
            const feats = (gj.features || []).map((f) => {
              const p = f.properties || {}, geom = f.geometry || {};
              const kind = KINDS[p.kind] ? p.kind : geom.type === 'Polygon' ? (/craton/i.test(p.gplates || p.TYPE || '') ? 'craton' : 'crust') : 'rift';
              const ring = geom.type === 'Polygon' ? geom.coordinates[0].slice(0, -1) : geom.type === 'LineString' ? geom.coordinates : null;
              return ring ? { kind, plateId: Number(p.PLATEID1 ?? p.plateId ?? 0), name: p.name || p.NAME, coords: ring.map(([lo, la]) => [la, lo]), left: p.left, right: p.right } : null;
            }).filter(Boolean);
            takeIn(feats, [], file.name);
            return;
          }
          const fd = new FormData(); fd.append('file', file);
          const r = await fetch('api/plates/import', { method: 'POST', body: fd });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          takeIn(j.features, j.plates, file.name);
          if (j.skipped) toast(`${j.skipped} other GPlates features were left out`);
        } catch (err) { toast(`Import failed: ${err.message}`); }
      }
      function renderGplates() {
        const fileIn = h('input', { type: 'file', accept: '.gpml,.gpmlz,.rot,.geojson,.json', class: 'sr-only', id: 'plates-import' });
        fileIn.addEventListener('change', () => { const f = fileIn.files && fileIn.files[0]; if (f) importFile(f); fileIn.value = ''; });
        const has = P().features.length > 0;
        replace(gplatesHost,
          h('p', { class: 'muted', style: { fontSize: '13.5px', marginBottom: '10px' } },
            server ? `Through the server’s pyGPlates ${server.version}: a .zip with a .gpml file (cratons, crust, rifts, and a flowline for each opening rift) and a .rot file with every plate’s rotation poles, which GPlates desktop opens as they are.`
              : server === false ? 'GPlates feature files are made by the WorldSmith server (world.yusupov.cloud). Here you can still load a .rot rotation file, and save and load GeoJSON, which GPlates also reads.' : 'Checking the server…'),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn small primary', type: 'button', disabled: !server || !has, onclick: exportGplates }, icon('download'), 'Export for GPlates'),
            h('label', { class: 'btn small', for: 'plates-import', tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } }, icon('upload'), server ? 'Import .gpml / .rot / GeoJSON' : 'Import .rot / GeoJSON'),
            fileIn,
            h('button', { class: 'btn small', type: 'button', disabled: !has, onclick: () => download(new Blob([JSON.stringify(geojson(), null, 1)], { type: 'application/geo+json' }), `${safeName()}-plates.geojson`) }, icon('download'), 'GeoJSON')),
          h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '10px' } }, 'In GPlates: File → Open Feature Collection, pick both files. Ages are in Ma; the shapes are stored as they were at the start age, where every rotation is zero.'));
      }

      function renderSide() { renderTools(); renderMotion(); renderList(); renderStats(); }

      return {
        el,
        update() {
          if (u.age > P().start) u.age = P().start;
          renderTime(); renderSide(); renderGplates();
          if (!ro._on) { ro.observe(host); ro._on = true; } else draw();
          if (server === null) checkServer().then(renderGplates);
        },
        destroy() { ro.disconnect(); u.playing = false; if (raf) cancelAnimationFrame(raf); },
      };
    },
    checks(w, d) {
      const P = w.plates, out = [];
      if (!P || !P.features.length) return [{ level: 'info', text: 'No supercontinent drawn yet.' }];
      const st = stats(P, d.planet.radiusKm);
      if (st.counts.craton < 2) out.push({ level: 'warn', text: 'A supercontinent is several cratons welded together: draw at least two.' });
      if (st.crust < 0.2 || st.crust > 0.55) out.push({ level: 'warn', text: `Continental crust covers ${fmt.num(st.crust * 100, 1)} % of the surface; Earth’s is about 40 %.` });
      else out.push({ level: 'ok', text: `Continental crust covers ${fmt.num(st.crust * 100, 1)} % of the surface (Earth ≈ 40 %).` });
      const crust = P.features.filter((f) => f.kind === 'crust');
      for (const c of P.features.filter((f) => f.kind === 'craton')) {
        if (crust.length && !c.coords.every((p) => crust.some((k) => S.contains(k.coords, p)))) out.push({ level: 'warn', text: `${c.name} pokes out of the continental crust: cratons sit inside it.` });
      }
      const rifts = P.features.filter((f) => f.kind === 'rift');
      if (!rifts.length) out.push({ level: 'info', text: 'No rifts yet: draw where the supercontinent will split.' });
      for (const f of P.features.filter((x) => x.kind === 'failed')) {
        const touches = rifts.some((r) => Math.min(S.distanceToLine(f.coords[0], r.coords), S.distanceToLine(f.coords[f.coords.length - 1], r.coords)) < 3);
        if (!touches) out.push({ level: 'warn', text: `${f.name} doesn’t start on a rift: failed rifts branch off one at a triple junction.` });
      }
      for (const r of rifts) {
        const through = P.features.filter((c) => c.kind === 'craton' && r.coords.some((p) => S.contains(c.coords, p)));
        if (through.length) out.push({ level: 'info', text: `${r.name} runs through ${through.map((c) => c.name).join(', ')}: rifts usually skirt cratons.` });
        if (r.left && r.right && r.left === r.right) out.push({ level: 'warn', text: `${r.name} has the same plate on both sides: split the crust along it so it can open.` });
      }
      // speeds
      for (const p of P.plates) for (const s of plateSpeeds(P, p.id, d.planet.radiusKm)) {
        if (s.cm > SPEED_MAX) out.push({ level: 'fail', text: `${p.name} moves ${fmt.num(s.cm, 1)} cm/yr between ${fmt.int(s.from)} and ${fmt.int(s.to)} Ma: faster than any plate on Earth (${SPEED_MAX}).` });
        else if (s.cm > SPEED_OK) out.push({ level: 'warn', text: `${p.name} moves ${fmt.num(s.cm, 1)} cm/yr between ${fmt.int(s.from)} and ${fmt.int(s.to)} Ma: fast (Earth’s plates mostly 1–${SPEED_OK}).` });
      }
      if (P.plates.some((p) => (p.rotations || []).length) && !out.some((o) => /cm\/yr/.test(o.text))) out.push({ level: 'ok', text: `Every plate moves at a believable speed (≤ ${SPEED_OK} cm/yr).` });
      return out;
    },
  });
})();
