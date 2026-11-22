/*
 * Plates: a world's tectonic history, as Artifexian builds it in GPlates (Worldbuilder's Log 10-19):
 * the supercontinent (cratons, crust, rifts), its breakup with rotation poles through time, new ocean
 * floor, subduction zones and island arcs, second rifts and microcontinents (plates that change
 * parent: crossovers), collisions of arcs and continents, mountain belts, hotspots, large igneous
 * provinces and hotspot tracks; or all of it at once (js/supercontinent.js makeWorld).
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
    subduction: { label: 'Subduction zone', closed: false, gplates: 'SubductionZone', help: 'A trench, where ocean floor dives under another plate. It belongs to the overriding plate and its teeth point at it; usually just off a continent’s leading coast, or further out with an island arc behind. Drawn at an age, it begins then.' },
    arc: { label: 'Island arc', closed: true, gplates: 'IslandArc', help: 'Volcanic islands on the overriding plate, a little behind a subduction zone’s trench (Japan, the Aleutians). Drawn at an age, they rise then.' },
    suture: { label: 'Suture', closed: false, gplates: 'Suture', help: 'Where two continents collided and welded together: the scar of a closed ocean.' },
    orogen: { label: 'Mountain belt', closed: true, gplates: 'OrogenicBelt', help: 'An orogenic belt: a cordillera behind a subduction zone, a collision range on a suture, or highlands where an arc was accreted. Old belts are worn down.' },
    lip: { label: 'Large igneous province', closed: true, gplates: 'LargeIgneousProvince', help: 'A vast outpouring of basalt where a plume head reached the surface: a flood basalt on land, a plateau at sea.' },
    hotspot: { label: 'Hotspot', closed: false, min: 1, gplates: 'HotSpot', help: 'A plume fixed in the mantle. Plates slide over it, so it leaves a track of volcanoes, oldest furthest away. Tap once to place it.' },
  };
  const minPoints = (k) => k.min ?? (k.closed ? 3 : 2);
  const LATER = new Set(['rift', 'subduction', 'arc', 'suture', 'orogen', 'lip', 'hotspot']);
  const OROGEN = '#8a5a2e', LIP = '#6e2443';              // kinds that can begin after the start
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
  // ocean floor older than this has gone down a subduction zone (Earth's oldest is about 180-200 Myr)
  const OCEAN_LIFE = 200;
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
    const crust = S.coverage([...of('crust'), ...of('craton')].filter((f) => (f.begin ?? P.start) >= P.start).map((f) => f.coords));
    const cratons = S.coverage(of('craton').map((f) => f.coords));
    const length = (k) => of(k).reduce((s, f) => s + f.coords.slice(1).reduce((t, p, i) => t + S.distance(f.coords[i], p), 0), 0) * Math.PI / 180 * radiusKm;
    return { crust, cratons, land: crust * (29 / 41), rift: length('rift'), failed: length('failed'), subduction: length('subduction'), counts: { craton: of('craton').length, crust: of('crust').length, rift: of('rift').length, failed: of('failed').length, subduction: of('subduction').length, arc: of('arc').length, orogen: of('orogen').length, suture: of('suture').length, hotspot: of('hotspot').length, lip: of('lip').length } };
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
    blurb: 'A whole tectonic history, from the supercontinent to the present day.',
    lede: ['The plates of your world through its whole history: a supercontinent, its breakups and collisions, mountains and hotspots, to the present day. Make one with a click, then draw on it.'],
    build(ctx) {
      const P = () => ctx.world.plates;
      const u = (ctx.ui.plates = ctx.ui.plates || { lat: 20, lon: 10, zoom: 1, tool: 'look', draft: [], selected: null, plate: null, age: null, playing: false, spread: true, flow: false, subduction: false, tracks: true });
      if (u.tracks === undefined) u.tracks = true;
      if (u.age === null || u.age > P().start) u.age = P().start;
      u.playing = false;                                        // a fresh view starts paused
      const host = h('div', { class: 'scene-host globe-host' });
      const hint = h('div', { class: 'scene-status mono' });
      const timeHost = h('div', { class: 'time-bar' });
      const autoHost = h('div'), toolsHost = h('div'), listHost = h('div'), statsHost = h('div'), gplatesHost = h('div'), motionHost = h('div');
      let server = null;

      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' },
          panel('Make a world', { ticks: true, tag: 'AUTOMATIC' }, autoHost),
          panel('Draw & move', { tag: 'TOOLS' }, toolsHost),
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
      /* Whether it exists at the age on view: from its begin age (the start, by default) to its end. */
      const shown = (f) => (f.begin ?? P().start) >= u.age && (f.end == null || f.end < u.age);

      function pathOf(pr, coords, closed) {
        g.beginPath();
        pr.trace(g, S.densify(coords, closed, 2), closed);
      }

      /* Rift ends that meet (within 0.05°), three or more of them: triple junctions. */
      function junctions(spreads) {
        const ends = spreads.flatMap(({ f, sp }) => [
          { key: f.coords[0], f, sp, at: () => 0 },
          { key: f.coords[f.coords.length - 1], f, sp, at: (line) => line.length - 1 },
        ]);
        const groups = [];
        for (const e of ends) {
          const g2 = groups.find((gr) => S.distance(gr[0].key, e.key) < 0.05);
          if (g2) g2.push(e); else groups.push([e]);
        }
        return groups.filter((gr) => gr.length >= 3);
      }
      /* Points round their middle, in order, as a ring. */
      function fan(points) {
        const c = S.centroid(points), [lat, lon] = S.latLon(c), k = Math.PI / 180;
        const east = [-Math.sin(lon * k), Math.cos(lon * k), 0], north = [-Math.sin(lat * k) * Math.cos(lon * k), -Math.sin(lat * k) * Math.sin(lon * k), Math.cos(lat * k)];
        const ang = (p) => { const v = S.vec(p); return Math.atan2(v[0] * east[0] + v[1] * east[1] + v[2] * east[2], v[0] * north[0] + v[1] * north[1] + v[2] * north[2]); };
        return points.slice().sort((a, b) => ang(a) - ang(b));
      }
      /*
       * Leading coasts: where each continent's coast leads its plate's motion and so overrides the
       * ocean floor, a hint of where subduction zones belong (dashed). Marked zones are drawn solid.
       */
      function drawSubduction(pr, m, dpr, col) {
        const runs = WS.supercontinent.leadingCoasts(P(), m, u.age, ctx.d.planet.radiusKm);
        g.save(); g.globalAlpha = 0.6; g.strokeStyle = col.text; g.lineWidth = 1.3 * dpr; g.setLineDash([5 * dpr, 4 * dpr]);
        for (const rn of runs) { const A = m.absolute(rn.plateId, u.age); g.beginPath(); pr.trace(g, rn.points.map((q) => S.latLon(Q.rotate(A, q.v))), false); g.stroke(); }
        g.restore();
      }
      /* Hotspot tracks: the volcanoes each hotspot left on the plates passing over it, by age. */
      function drawTracks(pr, m, dpr, col) {
        const Pw = P(), cache = new Map();
        for (const hsp of Pw.features.filter((f) => f.kind === 'hotspot' && (f.begin ?? Pw.start) >= u.age)) {
          const tr = WS.supercontinent.hotspotTrack(Pw, m, hsp, u.age, { cache, span: OCEAN_LIFE });
          for (const t of tr) {
            const q = pr.project(t.at);
            if (!q[2]) continue;
            g.beginPath(); g.arc(q[0], q[1], (t.age - u.age < 10 ? 3.5 : 2.4) * dpr, 0, 2 * Math.PI);
            g.fillStyle = ageColour((t.age - u.age) / OCEAN_LIFE, 0.95); g.fill();
          }
        }
        void col;
      }
      /* The teeth of a subduction zone, every 3° or so, pointing at the overriding plate. */
      function teeth(pr, coords, side, dpr, colour) {
        const line = S.densify(coords, false, 1).map(S.vec), sg = side === 'right' ? -1 : 1;
        g.fillStyle = colour;
        for (let i = 1; i < line.length - 1; i += 3) {
          const p = line[i], a = line[i - 1], b = line[i + 1];
          const t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], tl = Math.hypot(...t) || 1;
          const n = [p[1] * t[2] - p[2] * t[1], p[2] * t[0] - p[0] * t[2], p[0] * t[1] - p[1] * t[0]], nl = Math.hypot(...n) || 1;
          const at = (dx, dn) => S.latLon(p.map((x, k) => x + (dx * t[k]) / tl + (sg * dn * n[k]) / nl));
          const tri = [at(0.008, 0), at(-0.008, 0), at(0, 0.014)].map((q) => pr.project(q));
          if (!tri.every((x) => x[2])) continue;
          g.beginPath(); g.moveTo(tri[0][0], tri[0][1]); g.lineTo(tri[1][0], tri[1][1]); g.lineTo(tri[2][0], tri[2][1]); g.closePath(); g.fill();
        }
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
          const span = Math.max(1, Math.min(OCEAN_LIFE, Pw.start - u.age)), spreads = [];
          const alive = (age) => age - u.age <= OCEAN_LIFE;
          for (const f of Pw.features.filter((x) => x.kind === 'rift' && x.left && x.right && x.left !== x.right && x.coords.length >= 2 && shown(x))) {
            const sp = Q.spreading(m, f.coords, f.left, f.right, f.begin ?? Pw.start, u.age, Pw.step || 10);
            if (!sp.isochrons.length || !alive(sp.isochrons[sp.isochrons.length - 1].age)) continue;   // an extinct ridge, long subducted
            spreadRifts.add(f.id);
            spreads.push({ f, sp });
          }
          // where three rifts meet, the ocean between their strips: nested rings, oldest outside
          for (const ends of junctions(spreads)) {
            const ages = [...new Set(ends.flatMap((e) => e.sp.isochrons.map((i) => i.age)))].sort((a, b) => b - a);
            let stale = false;
            const ring = (age) => fan(ends.flatMap(({ sp, at }) => {
              const iso = age === null ? null : sp.isochrons.filter((i) => i.age >= age).pop();
              if (age !== null && (!iso || iso.age - age > 2 * (Pw.step || 10))) stale = true;   // that ridge was idle: no fan here
              return iso ? [iso.left[at(iso.left)], iso.right[at(iso.right)]] : [sp.edgeL[at(sp.edgeL)], sp.edgeR[at(sp.edgeR)]];
            }));
            // only while the gap stays a gap: once the plates have travelled far and turned, its corners
            // scatter round the globe and there is no single opening left to fill
            const compact = (rg) => { const c = S.latLon(S.centroid(rg)); return rg.every((q) => S.distance(c, q) < 30); };
            const paint = (rg, f) => { if (stale || !compact(rg)) return; pathOf(pr, rg, true); g.fillStyle = ageColour(f, 0.8); g.fill(); };
            if (alive(Math.max(...ends.map((e) => e.f.begin ?? Pw.start)))) paint(ring(null), 1);
            for (const a of ages) { stale = false; const rg = ring(a); if (alive(a)) paint(rg, Math.min(1, (a - u.age) / span)); }
          }
          for (const { f, sp } of spreads) {
            for (const [edge, flank] of [[sp.edgeL, 'left'], [sp.edgeR, 'right']]) {
              let prev = edge, prevAge = f.begin ?? Pw.start;
              for (const iso of sp.isochrons) {
                const line = iso[flank];
                // a band of floor made in one go: older bands have been subducted, and the first band
                // after a long pause would reach back to a line long gone
                if (alive(prevAge) && prevAge - iso.age <= 2 * (Pw.step || 10)) {
                  pathOf(pr, [...prev, ...line.slice().reverse()], true);
                  g.fillStyle = ageColour(Math.min(1, (prevAge - u.age) / span), 0.8); g.fill();
                }
                prev = line; prevAge = iso.age;
              }
            }
          }
          // the ridges meet at the junction: join each ridge end to the middle of their ends
          for (const ends of junctions(spreads)) {
            const tips = ends.map(({ sp, at }) => sp.ridge[at(sp.ridge)]), mid = S.latLon(S.centroid(tips));
            if (tips.some((t) => S.distance(mid, t) > 30)) continue;
            for (const t of tips) { pathOf(pr, [t, mid], false); g.strokeStyle = col.red; g.lineWidth = 2.4 * dpr; g.setLineDash([10 * dpr, 4 * dpr, 2 * dpr, 4 * dpr]); g.stroke(); g.setLineDash([]); }
          }
          for (const { sp } of spreads) {
            pathOf(pr, sp.ridge, false); g.strokeStyle = col.red; g.lineWidth = 2.4 * dpr; g.setLineDash([10 * dpr, 4 * dpr, 2 * dpr, 4 * dpr]); g.stroke(); g.setLineDash([]);
            if (u.flow) for (const fl of sp.flowlines) for (const arm of [fl.left, fl.right]) { pathOf(pr, arm, false); g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = dpr; g.stroke(); }
          }
        }
        const plates = Pw.plates;
        const order = { crust: 0, lip: 1, craton: 2, orogen: 3, arc: 4, rift: 5, failed: 6, suture: 7, subduction: 8, hotspot: 9 };
        for (const f of Pw.features.filter(shown).sort((a, b) => order[a.kind] - order[b.kind])) {
          const c = colourOf(plates, f.plateId), kind = KINDS[f.kind], at = placed(m, f);
          if (f.kind === 'subduction' && at.length >= 2) {
            pathOf(pr, at, false); g.strokeStyle = col.text; g.lineWidth = 2.2 * dpr; g.stroke();
            teeth(pr, at, f.side, dpr, col.text);
          } else if (f.kind === 'hotspot') {
            const q = pr.project(at[0]);
            if (q[2]) { g.beginPath(); g.arc(q[0], q[1], 5 * dpr, 0, 2 * Math.PI); g.fillStyle = col.red; g.fill(); g.lineWidth = 1.5 * dpr; g.strokeStyle = col.bg; g.stroke(); g.beginPath(); g.arc(q[0], q[1], 9 * dpr, 0, 2 * Math.PI); g.strokeStyle = col.red; g.stroke(); }
          } else if (f.kind === 'orogen' && at.length >= 3) {
            // a belt still being pushed up is dark; an old one is worn down and faint
            const worn = u.age >= (f.active ?? 0) ? 0 : (f.active ?? 0) - u.age, h = Math.exp(-worn / 150);
            pathOf(pr, at, true); g.fillStyle = hexA(OROGEN, 0.25 + 0.6 * h); g.fill();
            g.strokeStyle = hexA(OROGEN, 0.4 + 0.5 * h); g.lineWidth = dpr; g.stroke();
          } else if (f.kind === 'lip' && at.length >= 3) {
            pathOf(pr, at, true); g.fillStyle = hexA(LIP, 0.8); g.fill(); g.strokeStyle = col.red; g.lineWidth = dpr; g.stroke();
          } else if (f.kind === 'suture' && at.length >= 2) {
            pathOf(pr, at, false); g.strokeStyle = col.amber; g.lineWidth = 2 * dpr; g.setLineDash([2 * dpr, 3 * dpr]); g.stroke(); g.setLineDash([]);
          } else if (kind.closed && at.length >= 3) {
            pathOf(pr, at, true);
            g.fillStyle = hexA(c, f.kind === 'craton' ? 0.8 : f.kind === 'arc' ? 0.9 : 0.5); g.fill();
            g.strokeStyle = f.kind === 'arc' ? col.amber : c; g.lineWidth = (f.kind === 'craton' ? 1.6 : f.kind === 'arc' ? 2 : 1.2) * dpr;
            if (f.kind === 'arc') g.setLineDash([3 * dpr, 2 * dpr]);                // a chain of islands
            g.stroke(); g.setLineDash([]);
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
        if (!atStart() && u.subduction) drawSubduction(pr, m, dpr, col);
        if (u.tracks) drawTracks(pr, m, dpr, col);
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
          if (!f.name || (f.coords.length < 2 && f.kind !== 'hotspot') || !shown(f) || ['arc', 'orogen', 'lip', 'subduction', 'suture'].includes(f.kind)) continue;
          const at = placed(m, f);
          const pos = KINDS[f.kind].closed ? S.latLon(S.centroid(at)) : at[Math.floor((at.length - 1) / 2)];
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
        if (minPoints(k) === 1) return `${k.label}: tap the globe to place it`;
        if (!u.draft.length) return `${k.label}: tap the globe to place the first point`;
        return k.closed ? `${u.draft.length} points · tap the first point or press Enter to close · Backspace undoes · Esc cancels` : `${u.draft.length} points · double-tap or press Enter to finish · Backspace undoes · Esc cancels`;
      }

      // ── editing ──
      function commitDraft() {
        const tool = u.tool, k = KINDS[tool];
        if (!k) return;
        const pts = u.draft.slice();
        u.draft = []; cursor = null;
        if (pts.length < minPoints(k)) { draw(); return; }
        ctx.mutate((w) => {
          const Pw = w.plates, m = modelOf(Pw);
          const where = (f) => (atStart() ? f.coords : m.reconstruct(f.plateId, f.coords, u.age));
          let plateId = null;
          if (tool === 'craton') {
            plateId = Pw.nextPlate++;
            Pw.plates.push({ id: plateId, name: `Plate ${plateId}`, colour: PALETTE[Pw.plates.length % PALETTE.length], fixed: 0, rotations: [] });
            const mid = S.latLon(S.centroid(pts));
            for (const f of Pw.features) if (f.kind === 'crust' && !Pw.plates.some((q) => q.id === f.plateId) && S.contains(where(f), mid)) f.plateId = plateId;
          } else if (tool === 'hotspot') {
            plateId = 0;                                            // fixed in the mantle
          } else if (tool === 'subduction' || tool === 'arc') {
            plateId = u.plate ?? overriding(Pw, m, pts, tool);
          } else {
            const host2 = Pw.features.find((f) => f.kind === 'craton' && S.contains(where(f), pts[0])) || Pw.features.find((f) => f.kind === 'crust' && S.contains(where(f), pts[0]));
            plateId = host2 ? host2.plateId : (u.plate ?? (Pw.plates[0] ? Pw.plates[0].id : 0));
          }
          // drawn at another age: store where it was at the start (its plate's rotation undone)
          const ref = atStart() || !plateId ? pts : modelOf(Pw).unreconstruct(plateId, pts, u.age);
          const n = Pw.features.filter((f) => f.kind === tool).length + 1;
          const f = { id: newId(), kind: tool, plateId, name: `${k.label} ${n}`, coords: ref.map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]) };
          if (LATER.has(tool) && !atStart()) f.begin = Math.round(u.age);
          if (tool === 'rift') Object.assign(f, sidesOf(Pw, f));
          if (tool === 'subduction') f.side = sideToward(Pw, m, pts, plateId);
          Pw.features.push(f);
          u.selected = f.id;
        });
        renderSide(); draw();
      }
      /* The plate a new subduction zone or arc belongs to: the nearest crust (an arc: the nearest zone's plate). */
      function overriding(Pw, m, pts, tool) {
        const mid = pts[Math.floor(pts.length / 2)];
        if (tool === 'arc') {
          const z = Pw.features.filter((f) => f.kind === 'subduction' && shown(f)).map((f) => [S.distanceToLine(mid, placed(m, f)), f]).sort((a, b) => a[0] - b[0])[0];
          if (z && z[0] < 8) return z[1].plateId;
        }
        const near = Pw.features.filter((f) => f.kind === 'crust' && shown(f)).map((f) => { const at = placed(m, f); return [S.contains(at, mid) ? 0 : S.distanceToLine(mid, [...at, at[0]]), f]; }).sort((a, b) => a[0] - b[0])[0];
        return near ? near[1].plateId : (Pw.plates[0] ? Pw.plates[0].id : 0);
      }
      /* The side of a line (as drawn) its plate's crust lies on: where the teeth point. */
      function sideToward(Pw, m, pts, plateId) {
        const i = Math.max(0, Math.floor((pts.length - 2) / 2)), a = S.vec(pts[i]), b = S.vec(pts[i + 1]);
        const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], l = Math.hypot(...n) || 1;
        const crust = Pw.features.filter((f) => f.kind === 'crust' && f.plateId === plateId && shown(f)).map((f) => placed(m, f));
        const dist = (sg) => { const p = S.latLon(a.map((x, k) => x + (sg * 0.03 * n[k]) / l)); return Math.min(Infinity, ...crust.map((c) => (S.contains(c, p) ? 0 : S.distanceToLine(p, [...c, c[0]])))); };
        return dist(1) <= dist(-1) ? 'left' : 'right';
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
        const spot = P().features.filter((f) => f.kind === 'hotspot' && shown(f)).map((f) => [S.distance(at, f.coords[0]), f]).filter(([d]) => d < tol * 1.5).sort((a, b) => a[0] - b[0])[0];
        if (spot && u.tool !== 'move') return spot[1];
        const lines = P().features.filter((f) => !KINDS[f.kind].closed && f.coords.length >= 2 && shown(f)).map((f) => [S.distanceToLine(at, placed(m, f)), f]).filter(([d]) => d < tol).sort((a, b) => a[0] - b[0]);
        if (lines.length && u.tool !== 'move') return lines[0][1];
        const polys = P().features.filter((f) => KINDS[f.kind].closed && shown(f) && S.contains(placed(m, f), at)).sort((a, b) => S.areaFraction(a.coords) - S.areaFraction(b.coords));
        return polys[0] || null;
      }
      /* Split every crust polygon a rift crosses into two, each on the plate of the craton it holds. */
      function splitAlong(rift) {
        if ((rift.begin ?? P().start) < P().start) { splitLater(rift); return; }
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

      /*
       * A second rifting event: the rift begins after the start, so it splits only the crust of its own
       * plate; the smaller part becomes a new plate riding on the old one (fixed to it, no rotation of
       * its own) until the two are moved apart, by hand or by simulating from the rift's age.
       */
      function splitLater(rift) {
        let made = [];
        ctx.mutate((w) => {
          const Pw = w.plates, out = [], cuts = [];
          for (const f of Pw.features.slice()) {
            const parts = f.kind === 'crust' && f.plateId === rift.plateId ? S.splitPolygon(f.coords, rift.coords) : null;
            if (!parts) { out.push(f); continue; }
            const sizes = parts.map((q) => S.areaFraction(q)), small = sizes[0] < sizes[1] ? 0 : 1, id = Pw.nextPlate++;
            Pw.plates.push({ id, name: `Plate ${id}`, colour: PALETTE[Pw.plates.length % PALETTE.length], fixed: rift.plateId, rotations: [] });
            made.push(id);
            const inSmall = S.within(parts[small]);
            for (const x of Pw.features) {
              if (x.plateId !== rift.plateId || x === f || x.kind === 'crust' || x === rift || !x.coords.length || !KINDS[x.kind].closed) continue;
              if (inSmall(S.vec(S.latLon(S.centroid(x.coords))))) x.plateId = id;
            }
            cuts.push([inSmall, id]);
            parts.forEach((ring, i) => out.push({ id: newId(), kind: 'crust', plateId: i === small ? id : f.plateId, name: `${f.name} ${i === small ? 'B' : 'A'}`, coords: ring.map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]) }));
          }
          Pw.features = out;
          // lines crossing the rift (trenches, failed rifts) are cut in two, like GPlates' Split Feature
          for (const [inSmall, id] of cuts) Pw.features = WS.supercontinent.divideLines(Pw.features, rift.plateId, inSmall, id, rift.id);
          const r = Pw.features.find((x) => x.id === rift.id);
          if (r) Object.assign(r, sidesOf(Pw, r));
        });
        toast(made.length ? `${rift.name} splits off plate ${made.join(', ')}, moving with plate ${rift.plateId} until ${fmt.int(rift.begin)} Ma: simulate from then, or move it by hand` : `${rift.name} doesn’t cross its plate’s crust from edge to edge`);
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
            const m0 = modelOf(P()), fx = pl ? m0.fixedAt(pl.id, u.age) : 0;
            if (pl) gesture.plate = { id: pl.id, from: start, fixed: fx, base: m0.absolute(pl.id, u.age), fixedAbs: m0.absolute(fx, u.age), original: JSON.parse(JSON.stringify(pl.rotations || [])) };
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
          setPole(pl, gesture.plate.original, u.age, rel, gesture.plate.fixed);
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
        if (minPoints(k) === 1) { u.draft = [at]; commitDraft(); return; }
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
      const lastPole = () => { const ys = P().plates.flatMap((p) => (p.rotations || []).map((r) => r.age)); return ys.length ? Math.min(...ys) : null; };
      /* Play runs to the last pole (nothing moves after it), or on to the present from there. */
      const playEnd = () => { const ys = P().plates.flatMap((p) => (p.rotations || []).map((r) => r.age)); const last = ys.length ? Math.min(...ys) : 0; return u.age > last ? last : 0; };
      const startPlay = () => {
        if (u.age <= playEnd()) u.age = P().start;
        u.playing = true; lastT = 0;
        if (!raf) raf = requestAnimationFrame(play);
        renderTime(); draw();
      };
      const play = (ts) => {
        raf = null;
        if (!u.playing || !host.isConnected) return;
        if (!lastT) lastT = ts;
        if (ts - lastT > 280) { lastT = ts; if (u.age <= playEnd()) { u.playing = false; renderTime(); return; } setAge(Math.max(playEnd(), u.age - (P().step || 10))); }
        raf = requestAnimationFrame(play);
      };
      function renderTime() {
        const Pw = P();
        const last = lastPole();
        const slider = h('input', { type: 'range', min: 0, max: Pw.start, step: 1, value: Pw.start - u.age, 'aria-label': 'Age on view (drag right to go forward in time)' });
        slider.addEventListener('input', () => setAge(Pw.start - Number(slider.value)));
        const startIn = h('input', { class: 'txt num', type: 'number', min: 10, max: 4500, step: 10, value: Pw.start, 'aria-label': 'Start age of the supercontinent (Ma)', style: { width: '90px' } });
        startIn.addEventListener('change', () => {
          const v = clamp(Math.round(Number(startIn.value) || Pw.start), 10, 4500);
          ctx.mutate((w) => { const d = v - w.plates.start; w.plates.start = v; for (const p of w.plates.plates) for (const r of p.rotations || []) r.age += d; });
          u.age = v; renderSide(); renderTime(); draw();
        });
        replace(timeHost,
          h('button', { class: 'btn small primary', type: 'button', onclick: () => { if (u.playing) { u.playing = false; renderTime(); } else startPlay(); } }, u.playing ? '❚❚' : '▶'),
          h('button', { class: 'btn small', type: 'button', 'aria-label': 'Back one step', onclick: () => setAge(u.age + (Pw.step || 10)) }, '−'),
          h('div', { class: 'time-slider' },
            last !== null ? h('i', { class: 'sim-span', title: `Plate motion runs from ${fmt.int(Pw.start)} to ${fmt.int(last)} Ma`, style: { width: `${(100 * (Pw.start - last)) / Pw.start}%` } }) : null,
            slider,
            h('div', { class: 'time-scale mono' }, h('span', null, `${fmt.int(Pw.start)} Ma`),
              h('span', { class: 't-amber' }, `${fmt.int(u.age)} Ma · ${fmt.int(Pw.start - u.age)} Myr after the start${last !== null && u.age < last ? ` · after the last pole (${fmt.int(last)} Ma) nothing moves` : ''}`),
              h('span', null, '0 Ma'))),
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
          h('option', { value: '' }, 'automatic (the craton underneath; for a trench, the nearest crust)'),
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
            btn('subduction', 'Subduction', sw({ background: 'linear-gradient(var(--text), var(--text)) bottom / 100% 2px no-repeat, linear-gradient(135deg, transparent 50%, var(--text) 50%) 3px 0 / 6px 6px no-repeat', height: '8px' })),
            btn('arc', 'Island arc', sw({ background: 'var(--amber)', borderRadius: '40%', width: '12px', height: '6px' })),
            btn('suture', 'Suture', sw({ background: 'repeating-linear-gradient(90deg, var(--amber) 0 2px, transparent 2px 5px)', height: '3px' })),
            btn('orogen', 'Mountains', sw({ background: OROGEN })),
            btn('lip', 'LIP', sw({ background: LIP, border: '1px solid var(--red)' })),
            btn('hotspot', 'Hotspot', sw({ background: 'var(--red)', borderRadius: '50%', width: '10px' })),
            btn('move', 'Move plate', sw({ background: 'var(--teal)', borderRadius: '50%', width: '10px' }))),
          h('p', { class: 'muted', style: { fontSize: '13.5px', margin: '10px 0' } },
            u.tool === 'look' ? 'Choose a tool, then tap points on the globe. Each craton starts a plate of its own; crust and rifts join the plate of the craton they start on.'
              : u.tool === 'move' ? 'Pick an age with the time slider, then drag a plate to where it should be then. Each drag writes a rotation pole for that age; between ages the plate glides as in GPlates.'
                : KINDS[u.tool].help),
          KINDS[u.tool] && minPoints(KINDS[u.tool]) > 1 ? h('div', { class: 'btn-row' },
            h('button', { class: 'btn small primary', type: 'button', onclick: commitDraft }, 'Finish shape'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { u.draft.pop(); draw(); } }, 'Undo point'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { u.draft = []; cursor = null; draw(); } }, 'Cancel')) : null,
          sel && sel.kind === 'rift' ? h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            h('button', { class: 'btn small primary', type: 'button', onclick: () => splitAlong(sel) }, (sel.begin ?? P().start) < P().start ? `Split its plate along ${sel.name} (from ${fmt.int(sel.begin)} Ma)` : `Split the crust along ${sel.name}`)) : null,
          plates.length ? h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', { class: 'field-label', for: 'plate-for-new' }, 'Plate for new shapes'), plateSel) : null,
          !atStart() && LATER.has(u.tool) ? h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '8px' } }, `Drawn now, it begins at ${fmt.int(u.age)} Ma.`) : null,
          h('div', { class: 'btn-row', style: { marginTop: '12px' } }, toggle('spread', 'New ocean floor & ridges'), toggle('flow', 'Flowlines'), toggle('subduction', 'Leading coasts'), toggle('tracks', 'Hotspot tracks')));
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
          // (one plate for the whole history: crossovers merge into single poles)
          const ages = [...new Set((pl.rotations || []).map((r) => r.age))];
          const rots = ages.map((age) => { const abs = m.absolute(pl.id, age); const rel = Q.toPole(Q.mul(Q.inverse(m.absolute(nf, age)), abs)); return { age, lat: +rel.lat.toFixed(4), lon: +rel.lon.toFixed(4), angle: +rel.angle.toFixed(4) }; });
          ctx.mutate(() => { pl.fixed = nf; pl.rotations = rots; });
          renderMotion(); draw();
        });
        const mm = modelOf(Pw), rides = !atStart() ? mm.fixedAt(pl.id, u.age) : 0;
        const crossed = (pl.rotations || []).some((r) => (r.fixed ?? pl.fixed ?? 0) !== (pl.fixed ?? 0));
        const rows = (pl.rotations || []).slice().sort((a, b) => b.age - a.age || ((a.fixed ?? pl.fixed ?? 0) === (pl.fixed ?? 0) ? -1 : 1)).map((r) => {
          const num = (key, step, label) => { const i = h('input', { class: 'txt num', type: 'number', step, value: r[key], 'aria-label': `${label} at ${r.age} Ma` }); i.addEventListener('change', () => { const v = Number(i.value); if (!Number.isFinite(v)) return; r[key] = key === 'age' ? clamp(Math.round(v), 0, Pw.start - 1) : v; ctx.set('plates.plates', Pw.plates); renderMotion(); draw(); }); return i; };
          const sp = speeds.find((s) => s.to === r.age);
          return h('tr', null, h('td', null, num('age', 1, 'Age')), h('td', null, num('lat', 0.1, 'Pole latitude')), h('td', null, num('lon', 0.1, 'Pole longitude')), h('td', null, num('angle', 0.1, 'Angle')),
            crossed ? h('td', { class: 'num mono' }, String(r.fixed ?? pl.fixed ?? 0)) : null,
            h('td', { class: ['num', sp && (sp.cm > SPEED_MAX ? 't-red' : sp.cm > SPEED_OK ? 't-amber' : 't-teal')] }, sp ? fmt.num(sp.cm, 1) : '—'),
            h('td', null, h('button', { type: 'button', class: 'btn small danger', 'aria-label': `Delete the pole at ${r.age} Ma`, onclick: () => { pl.rotations = pl.rotations.filter((x) => x !== r); ctx.set('plates.plates', Pw.plates); renderMotion(); draw(); } }, icon('x'))));
        });
        replace(motionHost,
          h('div', { class: 'plate-head', style: { marginBottom: '8px' } }, h('i', { class: 'plate-chip', style: { background: colourOf(Pw.plates, pl.id) } }), h('b', null, `${pl.id} · ${pl.name}`)),
          h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Moves relative to', info('Plate 0 is the fixed reference frame. Choose another plate to move this one along with it (as GPlates’ fixed plate).')), fixedSel),
          h('div', { class: 'table-wrap', style: { marginTop: '10px' } }, h('table', { class: 'data poles' },
            h('thead', null, h('tr', null, h('th', null, 'Age Ma'), h('th', null, 'Pole lat'), h('th', null, 'Pole lon'), h('th', null, 'Angle °'), crossed ? h('th', null, ['Rel. to ', info('The plate this pole is relative to. Where it changes, two poles share an age (a crossover): the end of riding on the old plate, the start of moving on its own.')]) : null, h('th', null, ['cm/yr ', info(`Speed of the plate’s centre since the previous pole. Earth’s plates move 1–${SPEED_OK} cm a year; above ${SPEED_MAX} is implausibly fast.`)]), h('th'))),
            h('tbody', null, h('tr', { class: 'hz' }, h('td', { class: 'num' }, fmt.int(Pw.start)), h('td', { class: 'txtcell', colspan: crossed ? 4 : 3 }, 'as drawn (no rotation)'), h('td'), h('td')), rows))),
          h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            h('button', { class: 'btn small', type: 'button', disabled: atStart(), onclick: () => {
              const m = modelOf(Pw), fx = m.fixedAt(pl.id, u.age);
              setPole(pl, pl.rotations || [], u.age, Q.toPole(m.relative(pl.id, u.age)), fx);
              ctx.set('plates.plates', Pw.plates); renderMotion();
            } }, icon('plus'), `Pole at ${fmt.int(u.age)} Ma`),
            rides ? h('button', { class: 'btn small primary', type: 'button', onclick: () => partAt(pl, rides) }, `Part from plate ${rides} at ${fmt.int(u.age)} Ma`) : null),
          rides ? h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '8px' } }, `At ${fmt.int(u.age)} Ma this plate rides on plate ${rides}. Parting writes a crossover: from then on it moves relative to the frame, and you can drag it away with Move plate.`) : null);
      }
      /* Set the pole of a plate at an age, relative to the plate it moves with there (crossovers kept). */
      function setPole(pl, rotations, age, rel, fixed) {
        const own = (r) => r.age === age && (r.fixed ?? pl.fixed ?? 0) === fixed;
        const k = { age, lat: +rel.lat.toFixed(4), lon: +rel.lon.toFixed(4), angle: +rel.angle.toFixed(4) };
        if (fixed !== (pl.fixed ?? 0)) k.fixed = fixed;
        pl.rotations = rotations.filter((r) => !own(r)).concat([k]);
      }
      /*
       * Log 13: part a riding plate from the plate it rides on, at the age on view: a crossover, the
       * same position twice, relative to the old plate (ending its segment) and to the frame (starting
       * the new one); younger poles relative to the old plate are dropped.
       */
      function partAt(pl, parent) {
        const Pw = P(), m = modelOf(Pw), age = Math.round(u.age);
        ctx.mutate(() => {
          const keep = (pl.rotations || []).filter((r) => r.age > age).map((r) => ({ ...r, fixed: r.fixed ?? pl.fixed ?? 0 }));
          const rel = Q.toPole(m.relative(pl.id, age)), abs = Q.toPole(m.absolute(pl.id, age));
          const k = (q, fixed) => ({ age, lat: +q.lat.toFixed(4), lon: +q.lon.toFixed(4), angle: +q.angle.toFixed(4), ...(fixed ? { fixed } : {}) });
          pl.fixed = 0;
          pl.rotations = [...keep.map((r) => { const { fixed, ...rest } = r; return fixed ? { ...rest, fixed } : rest; }), k(rel, parent), k(abs, 0)];
        });
        toast(`Plate ${pl.id} moves on its own from ${fmt.int(age)} Ma: drag it with Move plate, or continue the simulation`);
        renderMotion(); renderAuto(); draw();
      }
      function wouldLoop(Pw, id, fixed) { let f = fixed, n = 0; while (f && n++ < 60) { if (f === id) return true; const p = Pw.plates.find((x) => x.id === f); f = p ? p.fixed : 0; } return false; }

      function renderList() {
        const Pw = P();
        if (!Pw.features.length) { replace(listHost, h('p', { class: 'muted' }, 'Nothing drawn yet. Start with a craton.')); return; }
        const plateOpts = (sel) => Pw.plates.map((p) => h('option', { value: p.id, selected: p.id === sel }, `${p.id}`));
        const rows = Pw.plates.map((pl) => {
          const name = h('input', { class: 'txt', value: pl.name, 'aria-label': `Name of plate ${pl.id}` });
          name.addEventListener('change', () => { pl.name = name.value || `Plate ${pl.id}`; ctx.set('plates.plates', Pw.plates); renderTools(); renderMotion(); });
          const mine = Pw.features.filter((f) => f.plateId === pl.id).sort((a, b) => Object.keys(KINDS).indexOf(a.kind) - Object.keys(KINDS).indexOf(b.kind));
          const count = Object.keys(KINDS).map((k) => [k, mine.filter((f) => f.kind === k).length]).filter(([, n]) => n).map(([k, n]) => `${n} ${KINDS[k].label.toLowerCase()}${n > 1 ? 's' : ''}`).join(' · ');
          const det = h('details', { class: 'plate-block', open: mine.length <= 8 || mine.some((f) => f.id === u.selected) },
            h('summary', { class: 'plate-head' }, h('i', { class: 'plate-chip', style: { background: colourOf(Pw.plates, pl.id) } }), h('span', { class: 'mono' }, String(pl.id)), name, h('span', { class: 'muted', style: { fontSize: '12.5px' } }, count)),
            mine.map((f) => featureRow(f, plateOpts)));
          return det;
        });
        const loose = Pw.features.filter((f) => !Pw.plates.some((p) => p.id === f.plateId));
        const spots = loose.filter((f) => f.kind === 'hotspot'), other = loose.filter((f) => f.kind !== 'hotspot');
        replace(listHost, rows,
          spots.length ? h('details', { class: 'plate-block', open: spots.length <= 8 }, h('summary', { class: 'plate-head' }, h('span', { class: 'muted' }, `The mantle: ${spots.length} hotspot${spots.length > 1 ? 's' : ''}`)), spots.map((f) => featureRow(f, plateOpts))) : null,
          other.length ? h('div', { class: 'plate-block' }, h('div', { class: 'plate-head' }, h('span', { class: 'muted' }, 'Not on a plate')), other.map((f) => featureRow(f, plateOpts))) : null);
      }
      function featureRow(f, plateOpts) {
        const Pw = P();
        const name = h('input', { class: 'txt', value: f.name, 'aria-label': `${KINDS[f.kind].label} name` });
        name.addEventListener('change', () => { f.name = name.value; ctx.set('plates.features', Pw.features); draw(); });
        const sel = h('select', { class: 'sel', 'aria-label': `Plate of ${f.name}` }, plateOpts(f.plateId));
        sel.addEventListener('change', () => { f.plateId = Number(sel.value); ctx.set('plates.features', Pw.features); renderList(); draw(); });
        const area = f.kind === 'hotspot' ? `${fmt.int(f.begin ?? Pw.start)} Ma` : KINDS[f.kind].closed ? `${fmt.num(S.areaFraction(f.coords) * 100, 1)} %` : `${fmt.int(f.coords.slice(1).reduce((t, p, i) => t + S.distance(f.coords[i], p), 0) * Math.PI / 180 * ctx.d.planet.radiusKm)} km`;
        const row = h('div', { class: ['feature-row', u.selected === f.id && 'selected'] },
          h('button', { type: 'button', class: 'btn small', title: 'Show on the globe', 'aria-label': `Select ${f.name}`, onclick: () => { u.selected = f.id; if (u.tool !== 'move') u.tool = 'look'; const c = S.latLon(S.centroid(placed(modelOf(Pw), f))); u.lat = clamp(c[0], -89, 89); u.lon = c[1]; renderSide(); draw(); } }, KINDS[f.kind].label),
          name, f.kind === 'craton' ? h('span', { class: 'muted mono' }, String(f.plateId)) : sel, h('span', { class: 'mono t-amber' }, area),
          h('button', { type: 'button', class: 'btn small danger', 'aria-label': `Delete ${f.name}`, onclick: () => { u.selected = f.id; removeSelected(); } }, icon('x')));
        // when it exists: from its begin age (the start by default) to its end (the present by default)
        const when = LATER.has(f.kind) ? (() => {
          const age = (key, label, blank) => {
            const i = h('input', { class: 'txt num', type: 'number', min: 0, max: Pw.start, step: 1, value: f[key] ?? '', placeholder: blank, 'aria-label': `${label} of ${f.name}` });
            i.addEventListener('change', () => {
              const v = i.value === '' ? null : clamp(Math.round(Number(i.value)), 0, Pw.start);
              if (v === null || v === (key === 'begin' ? Pw.start : 0)) delete f[key]; else f[key] = v;
              ctx.set('plates.features', Pw.features); renderList(); draw();
            });
            return h('label', { class: 'rift-side' }, h('span', { class: 'field-label' }, label), i);
          };
          const flip = f.kind === 'subduction' ? h('button', { type: 'button', class: 'btn small', title: 'Point the teeth at the other side', onclick: () => { f.side = f.side === 'right' ? 'left' : 'right'; ctx.set('plates.features', Pw.features); renderList(); draw(); } }, `Teeth ${f.side === 'right' ? 'right' : 'left'} · flip`) : null;
          return h('div', { class: 'rift-sides' }, age('begin', f.kind === 'rift' ? 'Opens at, Ma' : 'From, Ma', String(Pw.start)), f.kind === 'subduction' || f.kind === 'hotspot' || f.kind === 'arc' ? age('end', 'Until, Ma', '0') : null, f.kind === 'orogen' ? age('active', 'Rising until, Ma', '0') : null, flip);
        })() : null;
        if (f.kind !== 'rift') return when ? h('div', null, row, when) : row;
        // a rift opens between two plates
        const side = (key, label) => {
          const s = h('select', { class: 'sel', 'aria-label': `${label} plate of ${f.name}` }, h('option', { value: '' }, '—'), Pw.plates.map((p) => h('option', { value: p.id, selected: p.id === f[key] }, `${p.id}`)));
          s.addEventListener('change', () => { f[key] = s.value === '' ? null : Number(s.value); ctx.set('plates.features', Pw.features); draw(); });
          return h('label', { class: 'rift-side' }, h('span', { class: 'field-label' }, label), s);
        };
        return h('div', null, row, h('div', { class: 'rift-sides' }, side('left', 'Opens between'), side('right', 'and'),
          h('button', { type: 'button', class: 'btn small', onclick: () => { Object.assign(f, sidesOf(Pw, f)); ctx.set('plates.features', Pw.features); renderList(); draw(); } }, 'Detect')), when);
      }

      function renderStats() {
        const Pw = P(), st = stats(Pw, ctx.d.planet.radiusKm);
        const fastest = Pw.plates.map((p) => ({ p, s: plateSpeeds(Pw, p.id, ctx.d.planet.radiusKm) })).flatMap(({ p, s }) => s.map((x) => ({ ...x, p }))).sort((a, b) => b.cm - a.cm)[0];
        replace(statsHost, h('div', { class: 'readouts' },
          [['Continental crust', `${fmt.num(st.crust * 100, 1)} %`, 'of the surface · Earth ≈ 40 %', 'Union of all crust and cratons, measured on the sphere.'],
            ['Cratons', `${fmt.num(st.cratons * 100, 1)} %`, `${st.counts.craton} drawn`, null],
            ['Land, estimated', `${fmt.num(st.land * 100, 1)} %`, 'crust × 29/41, Earth’s share above the sea', 'On Earth about 29 % of the surface is land on about 41 % continental crust: the rest is flooded shelf.'],
            ['Rifts', `${fmt.int(st.rift)} km`, `${st.counts.rift} rifts · ${st.counts.failed} failed (${fmt.int(st.failed)} km)`, null],
            ['Subduction zones', `${fmt.int(st.subduction)} km`, `${st.counts.subduction} zones · ${st.counts.arc} island arcs`, 'The length of every subduction zone marked, whenever it is active.'],
            ['Mountain belts', `${st.counts.orogen}`, `${st.counts.suture} sutures · ${st.counts.hotspot} hotspots · ${st.counts.lip} LIPs`, 'Orogenic belts from subduction, collisions and accreted arcs, through the whole history.'],
            ['Fastest plate', fastest ? `${fmt.num(fastest.cm, 1)} cm/yr` : '—', fastest ? `${fastest.p.name}, ${fmt.int(fastest.from)}–${fmt.int(fastest.to)} Ma` : 'no poles yet', `Earth’s plates: 1–${SPEED_OK} cm/yr; the fastest about 15–${SPEED_MAX}.`]]
            .map(([l, v, sub, tip]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l, info(tip)), h('div', { class: 'val' }, v), h('div', { class: 'sub' }, sub)))),
          st.crust > 0 ? h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            h('button', { class: 'btn small', type: 'button', onclick: () => { ctx.mutate((w) => { w.population.land = +(st.land * 100).toFixed(1); }); toast(`Population land set to ${fmt.num(st.land * 100, 1)} %`); } }, `Use ${fmt.num(st.land * 100, 1)} % as land on Population`),
            h('span', { class: 'muted', style: { fontSize: '13px', alignSelf: 'center' } }, `now ${fmt.num(ctx.world.population.land, 1)} %`)) : null,
          !atStart() && u.spread ? h('div', { class: 'age-key' }, h('span', { class: 'mono' }, 'ocean floor age'), h('i', { style: { background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => ageColour(t, 1)).join(',')})` } }), h('span', { class: 'mono' }, `0 → ${fmt.int(Math.min(OCEAN_LIFE, P().start - u.age))} Myr`), P().start - u.age > OCEAN_LIFE ? h('span', { class: 'muted', style: { fontSize: '12.5px' } }, 'older floor has been subducted') : null) : null);
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
          features: Pw.features.filter((f) => f.coords.length >= minPoints(KINDS[f.kind])).map((f) => ({
            type: 'Feature',
            properties: { name: f.name, kind: f.kind, PLATEID1: f.plateId, plate: (Pw.plates.find((p) => p.id === f.plateId) || {}).name || '', gplates: KINDS[f.kind].gplates, left: f.left ?? null, right: f.right ?? null, begin: f.begin ?? Pw.start, end: f.end ?? 0, side: f.side ?? null },
            geometry: f.kind === 'hotspot' ? { type: 'Point', coordinates: [f.coords[0][1], f.coords[0][0]] } : KINDS[f.kind].closed ? { type: 'Polygon', coordinates: [[...f.coords, f.coords[0]].map(([la, lo]) => [lo, la])] } : { type: 'LineString', coordinates: f.coords.map(([la, lo]) => [lo, la]) },
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
          const s = seqs.get(+id) || { id: +id, name: (note || '').trim(), rotations: [] };
          s.rotations.push({ age: +age, lat: +lat, lon: +lon, angle: +ang, fixed: +fixed });
          seqs.set(+id, s);
        }
        // the plate's fixed plate is that of its youngest pole; older ones name theirs where it differs (crossovers)
        for (const s of seqs.values()) {
          const youngest = s.rotations.reduce((a, b) => (b.age < a.age ? b : a));
          s.fixed = youngest.fixed;
          s.rotations = s.rotations.map((r) => { const { fixed, ...rest } = r; return fixed === s.fixed ? rest : { ...rest, fixed }; });
        }
        return [...seqs.values()];
      }
      async function takeIn(features, plates, how) {
        if (!features.length) { toast(`${how}: no cratons, crust or rifts found`); return; }
        if (P().features.length && !await WS.ui.ask(`Add ${features.length} shapes from ${how} to the ones already drawn?`, { title: 'Import', ok: 'Add them' })) return;
        ctx.mutate((w) => {
          const Pw = w.plates;
          const ensure = (id, name) => { if (!Pw.plates.some((q) => q.id === id)) Pw.plates.push({ id, name: name || `Plate ${id}`, colour: PALETTE[Pw.plates.length % PALETTE.length], fixed: 0, rotations: [] }); };
          for (const p of plates) ensure(p.id, p.name);
          for (const f of features) { ensure(f.plateId); Pw.features.push({ id: newId(), kind: f.kind, plateId: f.plateId, name: f.name || KINDS[f.kind].label, coords: f.coords, left: f.left ?? null, right: f.right ?? null, ...(f.begin != null && f.begin < Pw.start ? { begin: f.begin } : {}), ...(f.end ? { end: f.end } : {}), ...(f.side ? { side: f.side } : {}), ...(f.type ? { type: f.type } : {}), ...(f.active != null ? { active: f.active } : {}) }); }
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
              const ring = geom.type === 'Polygon' ? geom.coordinates[0].slice(0, -1) : geom.type === 'LineString' ? geom.coordinates : geom.type === 'Point' ? [geom.coordinates] : null;
              return ring ? { kind, plateId: Number(p.PLATEID1 ?? p.plateId ?? 0), name: p.name || p.NAME, coords: ring.map(([lo, la]) => [la, lo]), left: p.left, right: p.right, begin: p.begin, end: p.end, side: p.side } : null;
            }).filter(Boolean);
            await takeIn(feats, [], file.name);
            return;
          }
          const fd = new FormData(); fd.append('file', file);
          const r = await fetch('api/plates/import', { method: 'POST', body: fd });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          await takeIn(j.features, j.plates, file.name);
          if (j.skipped) toast(`${j.skipped} other GPlates features were left out`);
        } catch (err) { toast(`Import failed: ${err.message}`); }
      }
      function renderGplates() {
        const fileIn = h('input', { type: 'file', accept: '.gpml,.gpmlz,.rot,.geojson,.json', class: 'sr-only', id: 'plates-import' });
        fileIn.addEventListener('change', () => { const f = fileIn.files && fileIn.files[0]; if (f) importFile(f); fileIn.value = ''; });
        const has = P().features.length > 0;
        replace(gplatesHost,
          h('p', { class: 'muted', style: { fontSize: '13.5px', marginBottom: '10px' } },
            server ? `Through the server’s pyGPlates ${server.version}: a .zip with a .gpml file (cratons, crust, rifts, subduction zones with their polarity, island arcs, sutures, mountain belts, large igneous provinces and hotspots, each with the ages it exists, and a flowline for each opening rift) and a .rot file with every plate’s rotation poles, which GPlates desktop opens as they are.`
              : server === false ? 'GPlates feature files are made by the WorldSmith server (world.yusupov.cloud). Here you can still load a .rot rotation file, and save and load GeoJSON, which GPlates also reads.' : 'Checking the server…'),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn small primary', type: 'button', disabled: !server || !has, onclick: exportGplates }, icon('download'), 'Export for GPlates'),
            h('label', { class: 'btn small', for: 'plates-import', tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } }, icon('upload'), server ? 'Import .gpml / .rot / GeoJSON' : 'Import .rot / GeoJSON'),
            fileIn,
            h('button', { class: 'btn small', type: 'button', disabled: !has, onclick: () => download(new Blob([JSON.stringify(geojson(), null, 1)], { type: 'application/geo+json' }), `${safeName()}-plates.geojson`) }, icon('download'), 'GeoJSON')),
          h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '10px' } }, 'In GPlates: File → Open Feature Collection, pick both files. Ages are in Ma; the shapes are stored as they were at the start age, where every rotation is zero.'));
      }

      // ── make a world, or build it step by step ──
      function renderAuto() {
        const a = (u.auto = u.auto || { seed: P().seed ?? ((Math.random() * 1e6) | 0), plates: 4, crust: 33, duration: 100, every: 20, speed: 4, mode: 'apart' });
        const num = (key, attrs, label, tip) => {
          const i = h('input', { class: 'txt num', type: 'number', value: a[key], 'aria-label': label, ...attrs });
          i.addEventListener('change', () => { const v = Number(i.value); if (Number.isFinite(v)) a[key] = clamp(v, Number(attrs.min), Number(attrs.max)); i.value = a[key]; });
          return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, tip ? info(tip) : null), i);
        };
        const choice = (key, opts, label, tip) => {
          const sel = h('select', { class: 'sel', 'aria-label': label }, opts.map(([v, t]) => h('option', { value: v, selected: a[key] === v }, t)));
          sel.addEventListener('change', () => { a[key] = typeof a[key] === 'string' ? sel.value : Number(sel.value); renderAuto(); });
          return h('label', { class: 'field' }, h('span', { class: 'field-label' }, label, tip ? info(tip) : null), sel);
        };
        const dice = h('button', { class: 'btn small', type: 'button', 'aria-label': 'New random seed', title: 'New random seed', onclick: () => { a.seed = (Math.random() * 1e6) | 0; renderAuto(); } }, '⚄');
        const Pw = P(), has = Pw.features.length > 0, last = lastPole();
        const canAt = last !== null && !atStart() && u.age > 0 && Pw.features.some((f) => f.kind === 'crust');
        const marked = Pw.features.some((f) => f.auto && (f.kind === 'subduction' || f.kind === 'arc'));
        const step = (label, onclick, disabled, tip) => h('button', { class: 'btn small', type: 'button', disabled, onclick, title: tip }, label);
        replace(autoHost,
          h('div', { class: 'auto-grid' },
            h('div', { class: 'seed-row' }, num('seed', { min: 0, max: 2147483647, step: 1 }, 'Seed', 'The same seed and settings make the same world.'), dice),
            choice('plates', [[3, '3'], [4, '4'], [5, '5']], 'Plates at first'),
            num('crust', { min: 15, max: 40, step: 1 }, 'Crust, % of surface', 'Earth’s continental crust covers about 40 % of it.'),
            num('speed', { min: 2, max: 15, step: 0.5 }, 'Top speed, cm/yr', `Earth’s plates mostly move 1–${SPEED_OK} cm a year.`)),
          h('div', { class: 'btn-row', style: { marginTop: '12px' } },
            h('button', { class: 'btn primary', type: 'button', onclick: makeWorld }, has ? 'Make a new world' : 'Make a world'),
            h('span', { class: 'muted', style: { fontSize: '13px', alignSelf: 'center' } }, `${fmt.int(Pw.start)} Myr of history, to the present`)),
          h('details', { class: 'fold', style: { marginTop: '14px' } }, h('summary', null, 'Step by step'),
            h('div', { class: 'auto-grid', style: { marginTop: '10px' } },
              choice('mode', [['apart', 'Break apart'], ['wander', 'Wander'], ['together', 'Come together'], ['cycle', 'Wilson cycle, repeating']], 'Motion', 'Break apart: blocks drift away from each other. Wander: each its own way. Come together: into a new supercontinent (the run ends when it is whole). Wilson cycle: all three, again and again. Continents that meet weld and move on as one.'),
              choice('duration', [[100, '100 Myr'], [200, '200 Myr'], [300, '300 Myr'], [500, '500 Myr'], [0, 'to the present']], 'For'),
              choice('every', [[10, '10 Myr'], [20, '20 Myr'], [25, '25 Myr'], [50, '50 Myr']], 'A pole every')),
            h('div', { class: 'btn-row', style: { marginTop: '10px' } },
              step(has ? 'New supercontinent' : 'Supercontinent', generate, false, 'Plates, cratons, crust, rifts and failed rifts, still together'),
              step('Simulate from the start', () => simulate(false), !has),
              step(last > 0 ? `Continue from ${fmt.int(last)} Ma` : 'Continue', () => simulate(true), !(last > 0))),
            h('div', { class: 'btn-row', style: { marginTop: '8px' } },
              step(canAt ? `Second rift at ${fmt.int(u.age)} Ma` : 'Second rift', () => splitHere('rift'), !canAt, 'A new rift across the largest plate at the age on view, then the parts break apart'),
              step(canAt ? `Microcontinent at ${fmt.int(u.age)} Ma` : 'Microcontinent', () => splitHere('micro'), !canAt, 'A sliver of a continent’s margin rifts off at the age on view')),
            h('div', { class: 'btn-row', style: { marginTop: '8px' } },
              step(marked ? 'Subduction zones & arcs again' : 'Subduction zones & arcs', markZones, last === null),
              step('Collisions & accreted arcs', markMeetings, last === null),
              step('Mountain belts', markMountains, !Pw.features.some((f) => f.kind === 'subduction' || f.kind === 'suture' || (f.kind === 'arc' && f.accreted))),
              step('Hotspots & LIPs', markHotspots, last === null)),
            h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '8px' } }, 'Pick ages with the time slider. Each step replaces what the same step made before; what you drew yourself stays.')));
      }
      const auto = (kinds) => (f) => f.auto && kinds.includes(f.kind);
      async function makeWorld() {
        const a = u.auto, Pw = P();
        if (Pw.features.length && !await WS.ui.ask('Replace everything on this globe with a new world? The plates, shapes and poles there now are lost.', { title: 'Make a new world', ok: 'Make it', danger: true })) return;
        toast('Making a world…');
        await new Promise((r) => setTimeout(r, 30));
        const w = WS.supercontinent.makeWorld({ seed: a.seed, plates: a.plates, crust: a.crust / 100, start: Pw.start, maxSpeed: a.speed, radiusKm: ctx.d.planet.radiusKm });
        ctx.mutate((wd) => {
          wd.plates.plates = w.plates.map((p, i) => ({ ...p, colour: p.colour || PALETTE[i % PALETTE.length] }));
          wd.plates.features = w.features; wd.plates.nextPlate = w.nextPlate; wd.plates.seed = w.seed; wd.plates.step = w.step;
        });
        u.selected = null; u.draft = []; u.playing = false; u.age = 0; u.spread = true;
        const crust = w.features.filter((f) => f.kind === 'crust'), m = modelOf(P());
        const c = S.latLon(S.centroid(crust.flatMap((f) => m.reconstruct(f.plateId, f.coords, 0))));
        u.lat = clamp(c[0], -60, 60); u.lon = c[1]; u.zoom = 1;
        const n = (k) => w.events.filter((e) => e.kind === k).length;
        toast(`World ${a.seed}: ${w.plates.length} plates over ${fmt.int(Pw.start)} Myr, ${n('continent')} continental collisions, ${n('arc')} arcs accreted, ${w.features.filter((f) => f.kind === 'orogen').length} mountain belts`);
        renderAuto(); renderTime(); renderSide(); draw();
      }
      async function generate() {
        const a = u.auto;
        if (P().features.length && !await WS.ui.ask('Replace everything drawn on this globe with a new supercontinent? The plates, shapes and poles there now are lost.', { title: 'New supercontinent', ok: 'Replace', danger: true })) return;
        const g = WS.supercontinent.generate({ seed: a.seed, plates: a.plates, crust: a.crust / 100 });
        ctx.mutate((w) => {
          w.plates.plates = g.plates.map((p, i) => ({ ...p, colour: PALETTE[i % PALETTE.length] }));
          w.plates.features = g.features;
          w.plates.nextPlate = g.nextPlate;
          w.plates.seed = g.seed;
        });
        u.selected = null; u.draft = []; u.playing = false; u.age = P().start;
        const c = S.latLon(S.centroid(g.features.filter((f) => f.kind === 'crust').flatMap((f) => f.coords)));
        u.lat = clamp(c[0], -60, 60); u.lon = c[1]; u.zoom = 1;
        if (g.plates.length < a.plates) toast(`Only ${g.plates.length} plates would fit with seed ${a.seed}: try another seed`);
        else toast(`Supercontinent ${a.seed}: ${g.plates.length} plates, ${g.features.filter((f) => f.kind === 'craton').length} cratons`);
        renderAuto(); renderTime(); renderSide(); draw();
      }
      const MODES = { apart: 'Breaking apart', wander: 'Wandering', together: 'Coming together', cycle: 'Wilson cycle' };
      async function simulate(cont) {
        const a = u.auto, Pw = P(), last = lastPole();
        if (!cont && last !== null && !await WS.ui.ask('Replace every plate’s rotation poles with a new simulation from the start?', { title: 'Simulate again', ok: 'Replace the poles', danger: true })) return;
        const from = cont && last !== null ? last : Pw.start;
        const duration = a.duration ? Math.min(a.duration, from) : from;
        if (duration <= 0) return;
        const res = WS.supercontinent.simulate(Pw, { seed: a.seed, mode: a.mode, from, duration, interval: Math.min(a.every, duration), minSpeed: Math.min(1.5, a.speed), maxSpeed: a.speed, radiusKm: ctx.d.planet.radiusKm });
        ctx.mutate((w) => {
          w.plates.plates = res.plates;
          for (const f of w.plates.features) if (f.kind === 'rift' && !(f.left && f.right)) Object.assign(f, sidesOf(w.plates, f));
        });
        const name = (id) => (Pw.plates.find((p) => p.id === id) || {}).name || `Plate ${id}`;
        const hits = res.welds.map((x) => `${name(x.a)} and ${name(x.b)} collide at ${fmt.int(x.age)} Ma`);
        const whole = res.assembled ? `; the new supercontinent is whole at ${fmt.int(res.end)} Ma` : '';
        const cycles = res.phases ? `: ${res.phases.filter((x) => x.mode === 'together').length} gatherings, ${res.welds.length} collisions` : '';
        toast(`${MODES[a.mode]}, ${fmt.int(from)} to ${fmt.int(res.end)} Ma${cycles || (hits.length ? `: ${hits.slice(0, 2).join('; ')}${hits.length > 2 ? ` and ${hits.length - 2} more` : ''}` : '')}${whole}`);
        u.age = from; u.spread = true;
        renderAuto(); renderSide(); startPlay();
      }
      async function markZones() {
        const Pw = P(), a = u.auto || {};
        const old = Pw.features.filter(auto(['subduction', 'arc']));
        const made = WS.supercontinent.markSubduction({ ...Pw, features: Pw.features.filter((f) => !old.includes(f)) }, { seed: (a.seed ?? Pw.seed ?? 1) + Pw.features.length, every: Math.max(25, a.every || 25), radiusKm: ctx.d.planet.radiusKm });
        ctx.mutate((w) => { w.plates.features = w.plates.features.filter((f) => !old.includes(f)).concat(made); });
        const z = made.filter((f) => f.kind === 'subduction').length, arcs = made.filter((f) => f.kind === 'arc').length;
        toast(z ? `${z} subduction zones and ${arcs} island arcs, from ${fmt.int(Math.max(...made.map((f) => f.begin)))} Ma on` : 'No coast leads its plate into the ocean: nothing to subduct yet');
        renderAuto(); renderSide(); draw();
      }
      function markMeetings() {
        const Pw = P();
        // the step's own results go first: accreted copies, sutures, and the ends it gave arcs and trenches
        const base = Pw.features.filter((f) => !(f.auto && (f.kind === 'suture' || f.accreted))).map((f) => { const c = { ...f }; if (c.auto && (c.kind === 'arc' || c.kind === 'subduction') && c.endBy === 'meeting') { delete c.end; delete c.endBy; } return c; });
        const res = WS.supercontinent.markCollisions({ ...Pw, features: base }, { every: 10 });
        for (const f of res.features) if (f.end != null && !base.some((b) => b.id === f.id && b.end === f.end)) f.endBy = 'meeting';
        ctx.mutate((w) => { w.plates.features = res.features; });
        const n = (k) => res.events.filter((e) => e.kind === k).length;
        toast(`${n('continent')} continental collisions with their sutures, ${n('arc')} island arcs accreted`);
        renderAuto(); renderSide(); draw();
      }
      function markMountains() {
        const Pw = P(), a = u.auto || {};
        const keep = Pw.features.filter((f) => !auto(['orogen'])(f));
        const made = WS.supercontinent.markOrogens({ ...Pw, features: keep }, { seed: a.seed ?? Pw.seed });
        ctx.mutate((w) => { w.plates.features = keep.concat(made); });
        toast(`${made.length} mountain belts: ${['cordillera', 'collision', 'accretion'].map((t) => `${made.filter((o) => o.type === t).length} ${t}`).join(', ')}`);
        renderAuto(); renderSide(); draw();
      }
      function markHotspots() {
        const Pw = P(), a = u.auto || {};
        const keep = Pw.features.filter((f) => !auto(['hotspot', 'lip'])(f));
        const made = WS.supercontinent.addHotspots({ ...Pw, features: keep }, { seed: a.seed ?? Pw.seed });
        ctx.mutate((w) => { w.plates.features = keep.concat(made); });
        u.tracks = true;
        toast(`${made.filter((f) => f.kind === 'hotspot').length} hotspots and ${made.filter((f) => f.kind === 'lip').length} large igneous provinces`);
        renderAuto(); renderSide(); renderTools(); draw();
      }
      /* A second rift across the largest plate, or a microcontinent off a margin, at the age on view. */
      async function splitHere(what) {
        const Pw = P(), a = u.auto || {}, age = Math.round(u.age);
        const duration = a.duration ? Math.min(a.duration, age) : age;
        const label = what === 'micro' ? 'A microcontinent' : 'A second rift';
        if (!await WS.ui.ask(`${label} at ${fmt.int(age)} Ma, and everything simulated from then for ${fmt.int(duration)} Myr (${MODES[a.mode === 'cycle' ? 'apart' : a.mode].toLowerCase()})? Every pole after ${fmt.int(age)} Ma is replaced.`, { title: label, ok: 'Do it', danger: true })) return;
        const opts = { seed: (a.seed ?? Pw.seed ?? 1) + age, colour: PALETTE[Pw.plates.length % PALETTE.length], radiusKm: ctx.d.planet.radiusKm };
        const sr = what === 'micro' ? WS.supercontinent.microcontinent(Pw, age, opts) : WS.supercontinent.secondRift(Pw, age, opts);
        if (!sr) { toast(what === 'micro' ? 'No margin to rift a sliver off, clear of the cratons, at this age' : 'No plate has crust wide enough to rift clear of its cratons at this age'); return; }
        const mode = a.mode === 'cycle' ? 'apart' : what === 'micro' && a.mode === 'apart' ? 'wander' : a.mode;
        const res = WS.supercontinent.simulate({ ...Pw, ...sr }, { seed: (a.seed ?? 1) + age, mode, from: age, duration, interval: Math.min(a.every || 20, duration), minSpeed: Math.min(1.5, a.speed || 4), maxSpeed: a.speed || 4, radiusKm: ctx.d.planet.radiusKm });
        // new subduction zones and island arcs for the new motion, if they were marked before
        let features = sr.features;
        if (features.some(auto(['subduction', 'arc']))) {
          const kept = features.filter((f) => !auto(['subduction', 'arc'])(f));
          features = kept.concat(WS.supercontinent.markSubduction({ ...Pw, features: kept, plates: res.plates }, { seed: (a.seed ?? 1) + age, every: Math.max(25, a.every || 25), radiusKm: ctx.d.planet.radiusKm }));
        }
        ctx.mutate((w) => { w.plates.features = features; w.plates.plates = res.plates; w.plates.nextPlate = sr.nextPlate; });
        toast(`${sr.rift.name} splits off plate ${sr.nextPlate - 1} from ${sr.rift.plateId} at ${fmt.int(age)} Ma; simulated to ${fmt.int(res.end)} Ma`);
        u.selected = sr.rift.id; renderAuto(); renderSide(); startPlay();
      }

      function renderSide() { renderTools(); renderMotion(); renderList(); renderStats(); renderAuto(); }

      return {
        el,
        update() {
          if (u.age > P().start) u.age = P().start;
          if (!autoHost.childNodes.length) renderAuto();
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
      // Log 12
      const zones = P.features.filter((f) => f.kind === 'subduction');
      if (P.plates.some((p) => (p.rotations || []).length) && !zones.length) out.push({ level: 'info', text: 'The plates move but no subduction zones are marked: the ocean floor they push against has to go somewhere.' });
      for (const a of P.features.filter((f) => f.kind === 'arc')) {
        const near = zones.some((z) => z.plateId === a.plateId && S.distanceToLine(S.latLon(S.centroid(a.coords)), z.coords) < 8);
        if (!near) out.push({ level: 'warn', text: `${a.name} has no subduction zone on its plate nearby: island arcs rise a little behind a trench.` });
      }
      // Log 13: a rift that opens between a plate and the one it rides on, which it never leaves
      const mdl = Q.model(P.plates, P.start);
      for (const r of rifts) {
        const b = r.begin ?? P.start, after = Math.max(0, b - 10);
        if (r.left && r.right && b < P.start && (mdl.fixedAt(r.left, after) === r.right || mdl.fixedAt(r.right, after) === r.left)) out.push({ level: 'warn', text: `${r.name} opens at ${fmt.int(b)} Ma, but plates ${r.left} and ${r.right} still move as one after it: part them there (Plate motion) or simulate from that age.` });
      }
      for (const z of zones) if (z.end != null && z.begin != null && z.end >= z.begin) out.push({ level: 'warn', text: `${z.name} ends (${z.end} Ma) before it begins (${z.begin} Ma).` });
      return out;
    },
  });
})();
