/*
 * A supercontinent made to order, and its first breakup, following Artifexian's Worldbuilder's
 * Log 10 and 11.
 *
 *   generate(opts): one continent of continental crust, broken into plates by rifts that meet at a
 *     triple junction (with further junctions for 4 or 5 plates). Each plate gets one or two
 *     cratons, well inside its crust. Failed rifts branch off the rifts into the plates, as
 *     aulacogens do. It comes out already split, every rift knowing the plates on either side.
 *   simulate(P, opts): rotation poles that carry every plate away from the middle of the
 *     supercontinent at Earth-like speeds, the direction wandering a little from pole to pole.
 *
 * Seeded, so the same seed gives the same world. Pure functions: runs in the page and in Node.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const S = node ? require('./sphere.js') : root.WS.sphere;
  const Q = node ? require('./rotation.js') : root.WS.rotation;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ll = (v) => S.latLon(v).map((x) => +x.toFixed(3));

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function frame(c) {
    const east = norm(Math.abs(c[2]) > 0.999 ? cross([0, 1, 0], c) : cross([0, 0, 1], c));
    return { east, north: cross(c, east) };
  }
  /* The point d degrees from c on a bearing (degrees clockwise from north). */
  function dest(c, bearing, d) {
    const { east, north } = frame(c), b = bearing * D2R, r = d * D2R;
    return norm(c.map((v, i) => Math.cos(r) * v + Math.sin(r) * (Math.cos(b) * north[i] + Math.sin(b) * east[i])));
  }
  const bearingTo = (c, p) => { const { east, north } = frame(c); return Math.atan2(dot(p, east), dot(p, north)) * R2D; };
  const angle = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b)) * R2D;
  const mod360 = (x) => ((x % 360) + 360) % 360;
  // smooth random wobble round a circle, and along a path (zero at its start)
  function periodic(r, amp, from = 2, to = 7) {
    const t = [];
    for (let j = from; j <= to; j++) t.push([j, (amp * (0.35 + 0.65 * r())) / j ** 0.8, r() * 2 * Math.PI]);
    return (deg) => t.reduce((s, [j, a, p]) => s + a * Math.cos(j * deg * D2R + p), 0);
  }
  function wander(r, amp, scale) {
    const t = [[1 / scale, r() * 6.283, amp * (0.5 + 0.5 * r())], [2.7 / scale, r() * 6.283, amp * 0.45 * r()]];
    return (s) => t.reduce((acc, [k, p, a]) => acc + a * (Math.sin(k * s + p) - Math.sin(p)), 0);
  }

  /*
   * opts: seed, plates (3-5), crust (fraction of the surface, 0.15-0.4), firstId (101).
   * Returns {seed, plates: [{id, name, fixed, rotations}], features: [...], nextPlate}.
   */
  function generate(opts = {}) {
    const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : (Math.random() * 2 ** 31) | 0;
    const r = rng(seed), U = (a, b) => a + (b - a) * r();
    const nPlates = clamp(Math.round(opts.plates ?? 3), 3, 5);
    const target = clamp(opts.crust ?? 0.33, 0.15, 0.4);
    const firstId = opts.firstId ?? 101;
    const capRadius = (f) => Math.acos(1 - 2 * f) * R2D;

    // the outline: a lumpy disc round the centre, scaled until it covers the target share
    const C = S.vec([U(-35, 35), U(-180, 180)]);
    const lumps = periodic(r, 0.24);
    const ring = (R) => Array.from({ length: 90 }, (_, k) => dest(C, k * 4, clamp(R * (1 + lumps(k * 4)), 0.5 * R, 84)));
    let R0 = capRadius(target);
    for (let it = 0; it < 4; it++) R0 = Math.min(80, R0 * capRadius(target) / capRadius(S.areaFraction(ring(R0).map(S.latLon))));
    const blobLL = ring(R0).map(S.latLon);
    const inBlob = (v) => S.contains(blobLL, S.latLon(v));
    const scale = R0 / 68;

    // the triple junction, and the coast seen from it (so every shape is star-shaped round it)
    const J = dest(C, U(0, 360), U(0, 0.18 * R0));
    const reach = (from, b, inside) => {
      let d = 1;
      while (d < 150 && inside(dest(from, b, d))) d += 1;
      let lo = Math.max(0, d - 1), hi = d;
      for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (inside(dest(from, b, m))) lo = m; else hi = m; }
      return lo;
    };
    const coast = Array.from({ length: 120 }, (_, k) => ({ b: k * 3, v: dest(J, k * 3, reach(J, k * 3, inBlob)) }));

    // three rift arms from the junction to the coast, about 120° apart, wavering
    const arms = [];
    let b = U(0, 360);
    for (let i = 0; i < 3; i++) {
      const w = wander(r, 9, 14 * scale), pts = [J];
      let s = 3;
      for (; s < 170; s += 3) { const bb = b + w(s); if (s >= reach(J, bb, inBlob)) break; pts.push(dest(J, bb, s)); }
      const be = b + w(s), se = reach(J, be, inBlob);
      pts.push(dest(J, be, se));
      arms.push({ pts, end: mod360(be), ext: dest(J, be, se + 2.5) });
      b += 120 + U(-22, 22);
    }
    // the plates between them: arm i, the coast clockwise to arm i+1, arm i+1 back to the junction
    let pieces = arms.map((a, i) => {
      const nx = arms[(i + 1) % 3], span = mod360(nx.end - a.end);
      const shore = coast.filter((c) => { const d = mod360(c.b - a.end); return d > 0.5 && d < span - 0.5; }).sort((x, y) => mod360(x.b - a.end) - mod360(y.b - a.end)).map((c) => c.v);
      return { id: firstId + i, ring: [...a.pts, ...shore, ...nx.pts.slice(1).reverse()].map(S.latLon) };
    });
    let rifts = arms.map((a, i) => ({ pts: [...a.pts, a.ext], arm: i }));

    // a fourth and fifth plate: another rift from a junction part-way along an arm, across a plate
    for (let extra = 0; extra < nPlates - 3; extra++) {
      const order = pieces.map((p, i) => [S.areaFraction(p.ring), i]).sort((x, y) => y[0] - x[0]);
      let done = false;
      for (const [, pi] of order) {
        const piece = pieces[pi], ai = pi < 3 ? pi : -1;  // a first-round plate, and the arm on its anticlockwise side
        const ri = rifts.findIndex((rf) => rf.arm === ai && !rf.split);
        if (ai < 0 || ri < 0) continue;
        const arm = rifts[ri].pts, inPiece = (v) => S.contains(piece.ring, S.latLon(v));
        for (let tries = 0; tries < 30 && !done; tries++) {
          const m = Math.floor(U(0.25, 0.65) * (arm.length - 3)) + 1;
          if (m < 1 || m > arm.length - 4) continue;
          const J2 = norm(arm[m].map((v, k) => v + arm[m + 1][k]));
          const next = arms[(ai + 1) % 3];
          const aim = dest(J, mod360(arms[ai].end + mod360(next.end - arms[ai].end) * U(0.3, 0.5)), angle(J, arms[ai].pts[arms[ai].pts.length - 1]) * 0.95);
          const b2 = bearingTo(J2, aim), w = wander(r, 8, 10 * scale), pts = [];
          let s = 3;
          for (; s < 150; s += 3) { const v = dest(J2, b2 + w(s), s); if (!inPiece(v)) break; pts.push(v); }
          if (pts.length < 3) continue;
          const be = b2 + w(s), se = reach(J2, be, inPiece) || s - 3;
          const end = dest(J2, be, se), ext = dest(J2, be, se + 2.5);
          const line = [dest(J2, b2 + 180, 1.5), ...pts, end, ext].map(S.latLon);
          const parts = S.splitPolygon(piece.ring, line);
          if (!parts) continue;
          const a0 = S.areaFraction(piece.ring), sizes = parts.map((q) => S.areaFraction(q));
          if (Math.min(...sizes) < 0.22 * a0 || Math.abs(sizes[0] + sizes[1] - a0) > 0.02 * a0) continue;
          // the outer part touches the arm beyond the new junction
          const probe = dest(J, mod360(bearingTo(J, arm[arm.length - 3]) + 2), angle(J, arm[arm.length - 3]));
          const outer = S.contains(parts[0], S.latLon(probe)) ? 0 : 1;
          const newId = firstId + pieces.length;
          pieces = pieces.map((p, i) => (i === pi ? { id: p.id, ring: parts[1 - outer] } : p)).concat([{ id: newId, ring: parts[outer] }]);
          rifts = rifts.flatMap((rf, i) => (i === ri ? [{ pts: [...arm.slice(0, m + 1), J2], split: true }, { pts: [J2, ...arm.slice(m + 1)], split: true }] : [rf]));
          rifts.push({ pts: [J2, ...pts, end, ext], split: true });
          done = true;
        }
        if (done) break;
      }
    }

    // the plates either side of each rift: probe just left and right of its middle
    const plateAt = (v) => { const p = pieces.find((q) => S.contains(q.ring, S.latLon(v))); return p ? p.id : null; };
    const sides = (pts) => {
      const i = Math.max(0, Math.floor((pts.length - 2) / 2)), a = pts[i], c = pts[i + 1];
      const mid = norm(a.map((v, k) => v + c[k])), n = norm(cross(a, c));
      const side = (sg) => { for (const d of [0.01, 0.02, 0.04]) { const id = plateAt(norm(mid.map((v, k) => v + sg * d * n[k]))); if (id) return id; } return null; };
      return { left: side(1), right: side(-1) };
    };

    // cratons: one or two per plate, well inside it
    const cratons = [];
    for (const piece of pieces) {
      const edge = [...piece.ring, piece.ring[0]], cen = S.centroid(piece.ring);
      const far = Math.max(...piece.ring.map((p) => angle(cen, S.vec(p))));
      const count = 1 + (r() < 0.45 ? 1 : 0);
      for (let k = 0; k < count; k++) {
        let rc = U(6, 10.5) * scale;
        for (let tries = 0; tries < 160; tries++) {
          if (tries && tries % 40 === 0) rc *= 0.8;
          const p = dest(cen, U(0, 360), U(0, far * 0.75)), pl = S.latLon(p);
          const shape = periodic(r, 0.2, 2, 5), n = 10 + Math.floor(r() * 5);
          const radii = Array.from({ length: n }, (_, j) => rc * (1 + shape((j * 360) / n)));
          const maxR = Math.max(...radii);
          if (!S.contains(piece.ring, pl) || S.distanceToLine(pl, edge) < maxR + 1.5) continue;
          if (cratons.some((c) => angle(c.centre, p) < c.maxR + maxR + 3)) continue;
          const turn = U(0, 360);
          cratons.push({ plateId: piece.id, centre: p, maxR, ring: radii.map((rr, j) => S.latLon(dest(p, turn + (j * 360) / n, rr))) });
          break;
        }
      }
    }

    // failed rifts: from a point on a rift into one of the plates beside it, short of any craton
    const failed = [];
    const wanted = 2 + Math.floor(r() * 2) + (nPlates > 3 ? 1 : 0);
    for (let tries = 0; tries < 80 && failed.length < wanted; tries++) {
      const rf = rifts[Math.floor(r() * rifts.length)].pts;
      if (rf.length < 6) continue;
      const i = Math.floor(U(0.25, 0.7) * (rf.length - 2)) + 1, start = rf[i];
      if (failed.some((f) => angle(f[0], start) < 10 * scale) || angle(start, J) < 6 * scale) continue;
      const along = bearingTo(start, rf[i + 1]), sg = r() < 0.5 ? 1 : -1;
      const b0 = along + sg * (90 + U(-30, 30)), w = wander(r, 10, 6 * scale);
      const home = plateAt(dest(start, b0, 2));
      if (!home) continue;
      const piece = pieces.find((p) => p.id === home), len = U(7, 15) * scale, pts = [start];
      for (let s = 2; s <= len; s += 2) {
        const v = dest(start, b0 + w(s), s), vl = S.latLon(v);
        if (!S.contains(piece.ring, vl) || S.distanceToLine(vl, [...piece.ring, piece.ring[0]]) < 1) break;
        if (cratons.some((c) => angle(c.centre, v) < c.maxR + 1.5)) break;
        pts.push(v);
      }
      if (pts.length >= 4) failed.push(pts);
    }

    const tag = seed.toString(36);
    let n = 0;
    const fid = () => `g${tag}-${(n++).toString(36)}`;
    const features = [
      ...pieces.map((p) => ({ id: fid(), kind: 'crust', plateId: p.id, name: `Crust ${p.id}`, coords: p.ring.map(([a, o]) => [+a.toFixed(3), +o.toFixed(3)]) })),
      ...cratons.map((c, i) => ({ id: fid(), kind: 'craton', plateId: c.plateId, name: `Craton ${i + 1}`, coords: c.ring.map(([a, o]) => [+a.toFixed(3), +o.toFixed(3)]) })),
      ...rifts.map((rf, i) => { const sd = sides(rf.pts); return { id: fid(), kind: 'rift', plateId: sd.left || sd.right || pieces[0].id, name: `Rift ${i + 1}`, coords: rf.pts.map(ll), left: sd.left, right: sd.right }; }),
      ...failed.map((f, i) => ({ id: fid(), kind: 'failed', plateId: plateAt(f[Math.min(2, f.length - 1)]) || pieces[0].id, name: `Failed rift ${i + 1}`, coords: f.map(ll) })),
    ];
    const plates = pieces.map((p) => ({ id: p.id, name: `Plate ${p.id}`, fixed: 0, rotations: [] }));
    return { seed, plates, features, nextPlate: firstId + pieces.length };
  }

  /*
   * Plate motion through time, stepped every 2.5 Myr or so, written out as rotation poles.
   * P: {plates, features, start}. opts:
   *   mode      'apart': every block drifts away from the middle of the continents (a breakup);
   *             'wander': each block goes its own way, its heading wandering;
   *             'together': every block heads for the middle of the continents (a new
   *             supercontinent assembles).
   *   from      the age to run from: the start age (the default) replaces every pole; a younger
   *             age continues the motion from there, keeping the poles before it
   *   duration  Myr to run (100), interval: Myr between poles (20), minSpeed, maxSpeed (cm/yr),
   *             radiusKm, seed
   * Continents that run into each other weld (a collision, an orogeny) and from then on move as one
   * block. The largest block barely moves while breaking apart or gathering, as Africa has barely
   * moved since Pangaea. Plates with no crust keep their poles.
   * Returns {plates, welds: [{age, a, b}], end}.
   */
  function simulate(P, opts = {}) {
    if (opts.mode === 'cycle') return cycle(P, opts);
    const start = P.start ?? 1000;
    const from = clamp(opts.from ?? start, 0, start);
    const duration = clamp(opts.duration ?? 100, 0, from), end = from - duration;
    const interval = clamp(opts.interval ?? 20, 1, Math.max(1, duration));
    const mode = ['apart', 'wander', 'together'].includes(opts.mode) ? opts.mode : 'apart';
    const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : (Math.random() * 2 ** 31) | 0;
    const r = rng((seed ^ 0x5eed ^ Math.round(from * 7919)) >>> 0), U = (a, b) => a + (b - a) * r();
    const vmin = opts.minSpeed ?? 2, vmax = Math.max(vmin, opts.maxSpeed ?? 6), R = opts.radiusKm ?? 6371;
    const m0 = Q.model(P.plates, start);
    const pole = (q, age) => { const p = Q.toPole(q); return { age: +age.toFixed(3), lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4), angle: +p.angle.toFixed(4) }; };

    // the continental blocks: each plate's crust (or its cratons, if it has no crust)
    const bodies = P.plates.map((p) => {
      const all = P.features.filter((f) => (f.kind === 'crust' || f.kind === 'craton') && f.plateId === p.id && f.coords.length >= 3);
      const use = all.some((f) => f.kind === 'crust') ? all.filter((f) => f.kind === 'crust') : all;
      if (!use.length) return null;
      const rings = use.map((f) => f.coords.map(S.vec));
      const c0 = S.centroid(use.flatMap((f) => f.coords));
      const samples = rings.flatMap((rg) => rg.filter((_, i) => i % Math.max(1, Math.round(rg.length / 36)) === 0));
      return {
        id: p.id, rings, samples, c0, rad: Math.max(...rings.flat().map((v) => angle(c0, v))),
        area: use.reduce((s, f) => s + S.areaFraction(f.coords), 0),
        tot: from >= start ? Q.IDENTITY : m0.absolute(p.id, from), poles: [],
      };
    }).filter(Boolean);
    const keep = (p) => ({ ...p, rotations: (p.rotations || []).map((x) => ({ ...x })) });
    if (!bodies.length || duration <= 0) return { plates: P.plates.map(keep), welds: [], end: from };

    const place = (b) => {
      const rings = b.rings.map((rg) => rg.map((v) => Q.rotate(b.tot, v)));
      b.now = { c: Q.rotate(b.tot, b.c0), samples: b.samples.map((v) => Q.rotate(b.tot, v)), inside: rings.map((rg) => S.within(rg.map(S.latLon))) };
    };
    bodies.forEach(place);
    // touching: overlapping, or coasts within `gap` degrees
    const contact = (i, j, gap = 1) => {
      const A = bodies[i], B = bodies[j], near = Math.cos(gap * D2R);
      if (angle(A.now.c, B.now.c) > A.rad + B.rad + gap + 1) return false;
      if (B.now.samples.some((s) => A.now.inside.some((f) => f(s))) || A.now.samples.some((s) => B.now.inside.some((f) => f(s)))) return true;
      return A.now.samples.some((s) => B.now.samples.some((t) => dot(s, t) > near));
    };
    // sharing an edge, vertex for vertex (as the pieces of a split supercontinent do)
    const joined = (i, j) => {
      const near = Math.cos(0.3 * D2R), rot = (b) => b.rings.flat().map((v) => Q.rotate(b.tot, v)), B = rot(bodies[j]);
      return angle(bodies[i].now.c, bodies[j].now.c) <= bodies[i].rad + bodies[j].rad + 1 && rot(bodies[i]).some((s) => B.some((t) => dot(s, t) > near));
    };

    // blocks: plates welded together. In a breakup the pieces that touch at first are rifting apart
    // and never weld again in that run; otherwise whatever touches now is one block already.
    const parent = bodies.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const apart = bodies.map(() => bodies.map(() => false));
    for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
      const c = contact(i, j) || joined(i, j);
      apart[i][j] = !c;
      if (c && mode !== 'apart') parent[find(j)] = find(i);
    }
    const middle = () => norm(bodies.reduce((s, b) => s.map((v, k) => v + b.area * b.now.c[k]), [0, 0, 0]));
    const C0 = middle();
    const biggest = bodies.reduce((a, b) => (b.area > a.area ? b : a), bodies[0]);
    for (const b of bodies) b.v = mode !== 'wander' && b === biggest ? U(0.3, 0.9) : U(vmin, vmax);
    const heading = new Map();

    // pin each plate where it is when continuing, so it does not glide from an older pole
    if (from < start) for (const b of bodies) b.poles.push(pole(b.tot, from));
    const step = interval / Math.ceil(interval / 2.5), every = Math.round(interval / step);
    const welds = [];
    let age = from, k = 0;
    while (age > end + 1e-9) {
      const dt = Math.min(step, age - end);
      const groups = new Map();
      bodies.forEach((b, i) => { const g = find(i); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); });
      const G = middle(), stages = new Map();
      for (const [g, members] of groups) {
        const lead = members.reduce((a, i) => (bodies[i].area > bodies[a].area ? i : a), members[0]);
        const c = norm(members.reduce((s, i) => s.map((v, q) => v + bodies[i].area * bodies[i].now.c[q]), [0, 0, 0]));
        let axis, speed = clamp(bodies[lead].v * U(0.85, 1.15), 0.2, vmax);
        if (mode === 'wander') {
          const h = (heading.has(g) ? heading.get(g) : U(0, 360)) + U(-12, 12);
          heading.set(g, h);
          const { east, north } = frame(c), b = h * D2R;
          axis = cross(c, north.map((v, q) => Math.cos(b) * v + Math.sin(b) * east[q]));
        } else {
          const h = clamp((heading.get(g) || 0) + U(-6, 6), -25, 25);
          heading.set(g, h);
          // breaking apart: away from the middle of the other blocks; gathering: toward the middle of all
          const others = norm(bodies.reduce((acc, bb, i) => (find(i) === g ? acc : acc.map((v, q) => v + bb.area * bb.now.c[q])), [0, 0, 0]));
          axis = mode === 'apart' ? cross(Math.hypot(...others) > 0.5 ? others : C0, c) : cross(c, G);
          if (Math.hypot(...axis) < 0.03) {                    // at the middle: no way to go
            if (mode === 'together') speed = 0;
            axis = cross(c, Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
          }
          if (mode === 'together') speed *= clamp(angle(c, G) / 15, 0.3, 1);   // slow down on arrival
          axis = Q.rotate(Q.fromAxisAngle(c, h * D2R), norm(axis));
        }
        axis = norm(axis);
        const sinD = Math.max(0.2, Math.hypot(...cross(axis, c)));
        stages.set(g, speed > 0 ? Q.fromAxisAngle(axis, (speed * 10 * dt) / R / sinD) : Q.IDENTITY);   // 1 cm/yr = 10 km/Myr
      }
      const before = bodies.map((b) => b.tot);
      bodies.forEach((b, i) => { b.tot = Q.mul(stages.get(find(i)), b.tot); place(b); });
      // collisions: blocks that meet stop where they touched and weld
      for (let pass = 0; pass < 4; pass++) {
        let hit = false;
        for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
          if (find(i) === find(j)) continue;
          if (!apart[i][j]) continue;            // rifting apart from each other in this run: they part, not weld
          if (!contact(i, j)) continue;
          const gi = find(i), gj = find(j);
          bodies.forEach((b, x) => { if (find(x) === gi || find(x) === gj) { b.tot = before[x]; place(b); } });
          parent[gj] = gi;
          welds.push({ age: +(age - dt).toFixed(3), a: bodies[i].id, b: bodies[j].id });
          hit = true;
        }
        if (!hit) break;
      }
      age -= dt; k++;
      const assembled = mode === 'together' && bodies.every((_, i) => find(i) === find(0));
      if (k % every === 0 || age <= end + 1e-9 || assembled) for (const b of bodies) b.poles.push(pole(b.tot, Math.max(0, age)));
      if (assembled) break;                                    // one supercontinent: the gathering is over
    }

    const priorAges = [...new Set(P.plates.flatMap((q) => (q.rotations || []).map((x) => x.age)).filter((a) => a > from && a < start))].sort((x, y) => y - x);
    const plates = P.plates.map((p) => {
      const b = bodies.find((x) => x.id === p.id);
      if (!b) return keep(p);
      // the poles before `from`, as rotations relative to plate 0 like the new ones
      // (a plate riding on another, such as half of a newly split plate, takes its poles at every age any plate has one)
      const older = from >= start ? [] : p.fixed ? priorAges.map((a) => pole(m0.absolute(p.id, a), a)) : (p.rotations || []).filter((x) => x.age > from).map((x) => ({ ...x }));
      return { ...p, fixed: 0, rotations: [...older, ...b.poles] };
    });
    return { plates, welds, end: +Math.max(0, age).toFixed(3), assembled: mode === 'together' && bodies.every((_, i) => find(i) === find(0)) };
  }

  /*
   * A Wilson cycle, over and over until the time runs out: the continents break apart, wander, then
   * come together into a new supercontinent, which breaks apart again. Returns as simulate does, with
   * the phases [{mode, from, end}].
   */
  function cycle(P, opts) {
    const start = P.start ?? 1000;
    let from = clamp(opts.from ?? start, 0, start);
    const end = Math.max(0, from - clamp(opts.duration ?? 100, 0, from));
    const r = rng(((Number.isFinite(opts.seed) ? opts.seed : 1) ^ 0xc1c1e) >>> 0);
    // after a gathering (or at the start) break apart; after a breakup wander, then gather
    let mode = opts.next || 'apart', plates = P.plates, welds = [];
    const phases = [];
    for (let guard = 0; guard < 40 && from > end + 1e-6; guard++) {
      const step = opts.interval || 20;
      const span = Math.max(step, Math.round((mode === 'apart' ? 150 + 100 * r() : mode === 'wander' ? 80 + 80 * r() : 400) / step) * step);
      const res = simulate({ ...P, plates }, { ...opts, mode, from, duration: Math.min(span, from - end) });
      plates = res.plates; welds = welds.concat(res.welds);
      phases.push({ mode, from, end: res.end });
      if (res.end >= from - 1e-6) break;
      from = res.end;
      mode = mode === 'apart' ? 'wander' : mode === 'wander' ? 'together' : 'apart';
    }
    return { plates, welds, end: from, phases };
  }

  // ── Log 12: subduction zones, island arcs, a second rift ──────────────────────────────────

  /* Points round a crust shape's coast, every 1.5°, with the outward normal: unit vectors in its plate's frame. */
  const marginCache = new Map();
  function margins(f) {
    const key = `${f.id}:${f.coords.length}:${f.coords[0]}:${f.coords[f.coords.length - 1]}`;
    if (marginCache.has(key)) return marginCache.get(key);
    const ring = S.densify(f.coords, true, 1.5), inside = S.within(f.coords), vs = ring.map(S.vec);
    const out = vs.map((v, i) => {
      const a = vs[(i - 1 + vs.length) % vs.length], b = vs[(i + 1) % vs.length];
      let n = norm(cross(v, [b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
      if (inside(norm(v.map((x, q) => x + 0.01 * n[q])))) n = n.map((x) => -x);
      return { v, n };
    });
    marginCache.set(key, out);
    if (marginCache.size > 500) marginCache.delete(marginCache.keys().next().value);
    return out;
  }

  /*
   * Leading coasts at an age: stretches of continental coast that lead their plate's motion
   * (faster than 0.8 cm/yr over the `dt` Myr before), facing the sea rather than another plate's
   * crust. There the continent overrides the ocean floor in front of it: a subduction zone.
   * Returns [{plateId, feature, points: [{v, n}]}], v and n in the plate's own frame (rotate by
   * m.absolute(plateId, age) to place them).
   */
  function leadingCoasts(P, m, age, radiusKm = 6371, dt = 5) {
    const start = P.start ?? 1000;
    const a0 = Math.min(start, age + dt), a1 = a0 - dt;
    if (a0 <= a1 || a1 < 0) return [];
    const crusts = P.features.filter((f) => f.kind === 'crust' && f.coords.length >= 3 && (f.begin ?? start) >= age);
    const others = crusts.map((f) => ({ plateId: f.plateId, inside: S.within(m.reconstruct(f.plateId, f.coords, age)) }));
    const out = [];
    for (const f of crusts) {
      const A = m.absolute(f.plateId, age), A0 = m.absolute(f.plateId, a0), A1 = m.absolute(f.plateId, a1);
      const pts = margins(f).map(({ v, n }) => {
        const p0 = Q.rotate(A0, v), p1 = Q.rotate(A1, v), d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], len = Math.hypot(...d);
        const nn = Q.rotate(A0, n), cm = ((len * radiusKm) / dt) * 0.1;
        const lead = cm > 0.8 && dot(d, nn) / len > 0.35;
        const cur = Q.rotate(A, v), nc = Q.rotate(A, n);
        const open = lead && !others.some((o) => o.plateId !== f.plateId && o.inside(norm(cur.map((x, q) => x + 0.02 * nc[q]))));
        return { v, n, on: open };
      });
      if (!pts.some((q) => q.on)) continue;
      const len = pts.length, first = pts.findIndex((q) => !q.on);
      if (first < 0) { out.push({ plateId: f.plateId, feature: f, points: pts.concat([pts[0]]) }); continue; }
      let run = [];
      for (let i = 1; i <= len; i++) {
        const q = pts[(first + i) % len];
        if (q.on) run.push(q); else { if (run.length >= 3) out.push({ plateId: f.plateId, feature: f, points: run }); run = []; }
      }
    }
    return out;
  }

  /* A line `d` degrees out from a run of coast, smoothed. */
  function offshore(points, d) {
    const raw = points.map(({ v, n }) => norm(v.map((x, q) => Math.cos(d * D2R) * x + Math.sin(d * D2R) * n[q])));
    return raw.map((_, i) => norm(raw.slice(Math.max(0, i - 2), i + 3).reduce((s, w) => s.map((x, q) => x + w[q]), [0, 0, 0])));
  }
  /* Which side of a line (as drawn) a direction points to: 'left' or 'right'. */
  function sideOf(line, towards) {
    const i = Math.max(0, Math.floor((line.length - 2) / 2)), a = line[i], b = line[i + 1];
    return dot(cross(a, [b[0] - a[0], b[1] - a[1], b[2] - a[2]]), towards) > 0 ? 'left' : 'right';
  }

  /*
   * Subduction zones and island arcs through a simulation, as in Log 12. Every `every` Myr from
   * `from` down to `to`, the leading coasts are found; each new one starts a subduction zone (a
   * SubductionZone on the overriding plate, polarity towards that plate), which lasts until its
   * coast stops leading. Some are Andean margins, the trench just offshore; others have the trench
   * well out to sea, with a chain of island arcs on the overriding plate behind it (as Japan).
   * Returns new features, in the plates' own frames, with begin and end ages.
   */
  function markSubduction(P, opts = {}) {
    const start = P.start ?? 1000, R = opts.radiusKm ?? 6371;
    const every = Math.max(5, opts.every ?? 25);
    const ages = P.plates.flatMap((p) => (p.rotations || []).map((x) => x.age));
    const to = opts.to ?? (ages.length ? Math.min(...ages) : start), from = Math.min(start - 5, opts.from ?? start - every);
    const m = Q.model(P.plates, start);
    const r = rng(((Number.isFinite(opts.seed) ? opts.seed : 1) ^ 0x5ab) >>> 0), U = (a, b) => a + (b - a) * r();
    const zones = [], arcs = [];
    let nz = P.features.filter((f) => f.kind === 'subduction').length, na = P.features.filter((f) => f.kind === 'arc').length;
    const tag = `s${Date.now().toString(36)}`;
    const toLL = (vs) => vs.map(ll);
    for (let age = from; age >= to - 1e-9; age -= every) {
      const runs = leadingCoasts(P, m, age, R).filter((rn) => rn.points.length >= 5);
      const used = new Set();
      for (const z of zones) {
        if (z.end !== undefined) continue;
        const hit = runs.findIndex((rn, i) => !used.has(i) && rn.plateId === z.plateId && rn.points.some(({ v }) => S.distanceToLine(S.latLon(v), z.coords) < z.offset + 3));
        if (hit >= 0) used.add(hit); else z.end = +age.toFixed(3);
      }
      runs.forEach((rn, i) => {
        if (used.has(i)) return;
        const island = r() < (opts.islandShare ?? 0.5) && rn.points.length >= 5;
        const offset = island ? U(4, 6) : U(0.8, 1.5);
        const trench = offshore(rn.points, offset).filter((_, k, all) => k % 2 === 0 || k === all.length - 1);
        if (trench.length < 2) return;
        const landward = rn.points[Math.floor(rn.points.length / 2)].n.map((x) => -x);
        zones.push({ id: `${tag}-z${zones.length}`, kind: 'subduction', plateId: rn.plateId, name: `Subduction zone ${++nz}`, coords: toLL(trench), side: sideOf(trench, landward), begin: +age.toFixed(3), offset, auto: true });
        if (!island) return;
        // the island arc: a narrow, lumpy belt of islands about 1.5° behind the trench, on the overriding plate
        const line = offshore(rn.points, offset - U(1.2, 1.8)), nrm = rn.points.map((q) => q.n);
        const w = U(0.3, 0.5), lump = wander(r, 0.35, 1.5);
        const half = (sg) => line.map((v, j) => {
          const t = j / (line.length - 1), wj = w * Math.max(0.25, Math.sin(Math.PI * t) ** 0.5 * (1 + lump(j))), n = nrm[j];
          return norm(v.map((x, q) => x + sg * wj * D2R * n[q]));
        });
        arcs.push({ id: `${tag}-a${arcs.length}`, kind: 'arc', plateId: rn.plateId, name: `Island arc ${++na}`, coords: toLL([...half(1), ...half(-1).reverse()]), begin: +age.toFixed(3), auto: true });
      });
    }
    for (const z of zones) delete z.offset;
    return [...zones, ...arcs];
  }

  /*
   * A second rifting event at an age (Log 12): a rift across the largest plate's largest piece of
   * crust, roughly across its long axis and clear of its cratons. The piece is split; the smaller
   * part becomes a new plate moving with the old one until then (fixed to it, no rotation of its
   * own), so the two can part from that age. Returns {plates, features, nextPlate, rift} or null.
   */
  function secondRift(P, age, opts = {}) {
    const start = P.start ?? 1000;
    const r = rng((((Number.isFinite(opts.seed) ? opts.seed : 1) ^ 0x2e1f) + Math.round(age)) >>> 0), U = (a, b) => a + (b - a) * r();
    const crusts = P.features.filter((f) => f.kind === 'crust' && f.coords.length >= 3 && (f.begin ?? start) >= age);
    const area = (id) => crusts.filter((f) => f.plateId === id).reduce((s, f) => s + S.areaFraction(f.coords), 0);
    const plateIds = [...new Set(crusts.map((f) => f.plateId))].sort((a, b) => area(b) - area(a));
    for (const pid of plateIds) {
      const f = crusts.filter((x) => x.plateId === pid).sort((a, b) => S.areaFraction(b.coords) - S.areaFraction(a.coords))[0];
      const cratons = P.features.filter((c) => c.kind === 'craton' && c.plateId === pid);
      const inside = S.within(f.coords), c = S.centroid(f.coords);
      const far = f.coords.map(S.vec).reduce((a, v) => (angle(c, v) > angle(c, a) ? v : a), S.vec(f.coords[0]));
      for (let tries = 0; tries < 30; tries++) {
        const centre = dest(c, U(0, 360), U(0, 6)), b = bearingTo(centre, far) + 90 + U(-25, 25), w = wander(r, 7, 8);
        const arm = (sg) => { const pts = []; for (let s = 2; s < 120; s += 2) { const v = dest(centre, b + (sg > 0 ? 0 : 180) + w(sg * s), s); pts.push(v); if (!inside(v)) { pts.push(dest(centre, b + (sg > 0 ? 0 : 180) + w(sg * s), s + 2.5)); break; } } return pts; };
        const line = [...arm(-1).reverse(), centre, ...arm(1)];
        const lineLL = line.map(S.latLon);
        if (cratons.some((k) => lineLL.some((p) => S.contains(k.coords, p)) || S.distanceToLine(S.latLon(S.centroid(k.coords)), lineLL) < 3)) continue;
        const parts = S.splitPolygon(f.coords, lineLL);
        if (!parts) continue;
        const sizes = parts.map((q) => S.areaFraction(q)), small = sizes[0] < sizes[1] ? 0 : 1;
        if (sizes[small] < 0.25 * (sizes[0] + sizes[1])) continue;
        const newId = Math.max(P.nextPlate ?? 0, ...P.plates.map((p) => p.id + 1));
        const inSmall = S.within(parts[small]);
        const moves = (x) => x.plateId === pid && x.coords.length && inSmall(S.vec(KIND_CLOSED.has(x.kind) ? S.latLon(S.centroid(x.coords)) : x.coords[Math.floor(x.coords.length / 2)]));
        const features = P.features.flatMap((x) => {
          if (x === f) return parts.map((ring, i) => ({ ...x, id: `${x.id}-${i ? 'b' : 'a'}`, name: `${x.name} ${i === small ? 'B' : 'A'}`, plateId: i === small ? newId : pid, coords: ring.map(([la, lo]) => [+la.toFixed(4), +lo.toFixed(4)]) }));
          return [x.kind !== 'rift' && x.kind !== 'crust' && moves(x) ? { ...x, plateId: newId } : x];
        });
        const mid = Math.floor(line.length / 2), n = norm(cross(line[mid], [line[mid + 1][0] - line[mid][0], line[mid + 1][1] - line[mid][1], line[mid + 1][2] - line[mid][2]]));
        const leftIsSmall = inSmall(norm(line[mid].map((x, q) => x + 0.03 * n[q])));
        const rift = { id: `r${Date.now().toString(36)}`, kind: 'rift', plateId: pid, name: `Rift ${P.features.filter((x) => x.kind === 'rift').length + 1}`, coords: lineLL.map(([la, lo]) => [+la.toFixed(4), +lo.toFixed(4)]), left: leftIsSmall ? newId : pid, right: leftIsSmall ? pid : newId, begin: +age.toFixed(3) };
        features.push(rift);
        const plates = [...P.plates.map((p) => ({ ...p })), { id: newId, name: `Plate ${newId}`, colour: opts.colour, fixed: pid, rotations: [] }];
        return { plates, features, nextPlate: newId + 1, rift };
      }
    }
    return null;
  }
  const KIND_CLOSED = new Set(['crust', 'craton', 'arc']);

  const api = { generate, simulate, leadingCoasts, markSubduction, secondRift };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.supercontinent = api; }
})(typeof window !== 'undefined' ? window : globalThis);
