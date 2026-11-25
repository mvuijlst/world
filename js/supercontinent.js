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
  // (the mountain model, js/crust.js: loaded after this file in the page, so looked up when needed)
  const crustModel = () => (node ? require('./crust.js') : root.WS.crust);
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const ll = (v) => S.latLon(v).map((x) => +x.toFixed(3));

  // After two continents meet they keep closing, slower and slower as the crust between them thickens
  // and resists, until they weld: the closing speed falls by e every COLLISION_TAU_MYR, and the two are
  // welded once it is under WELD_CM_YR. Calibrated on India and Asia, which have converged by 2400-3200
  // km since about 50 Ma and still converge (van Hinsbergen et al. 2011, Tectonics 30, TC5003): a
  // collision closing at 6 cm/yr then takes up some 2000 km, one at 1 cm/yr some 200 km (the Alps).
  const COLLISION_TAU_MYR = 40, WELD_CM_YR = 0.5;
  // A subduction zone shortens its upper plate when that plate advances on the trench and stretches it
  // (a back-arc basin) when it moves away: the slab is anchored in the mantle, so the landward plate's
  // own motion decides (Uyeda & Kanamori 1979, JGR 84, 1049; Heuret & Lallemand 2005, PEPI 149, 31:
  // 75 % of oceanic subduction zones, upper plate retreat with extension and advance with compression,
  // trench retreat not tied to slab age). Within NEUTRAL_CM_YR of standing still, neither (their class
  // 0 arcs lie at about -2.5 to +2 cm/yr; Fig. 8).
  const NEUTRAL_CM_YR = 1, EPISODE_STEP_MYR = 5, OCEAN_LIFE_MYR = 200;

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
    // a slow swing, a smaller one, and a jagged one: rifts and coasts are irregular at every scale
    const t = [[1 / scale, r() * 6.283, amp * (0.5 + 0.5 * r())], [2.7 / scale, r() * 6.283, amp * 0.45 * r()], [7.3 / scale, r() * 6.283, amp * 0.18 * r()]];
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

    // the outline: a lobed, ragged disc (big lobes and small jags), scaled until it covers the share
    const C = S.vec([U(-35, 35), U(-180, 180)]);
    const lumps = periodic(r, 0.42, 2, 6), jags = periodic(r, 0.16, 7, 24);
    const ring = (R) => Array.from({ length: 180 }, (_, k) => dest(C, k * 2, clamp(R * (1 + lumps(k * 2) + jags(k * 2)), 0.42 * R, 84)));
    // the triple junction lies off-centre, so the pieces differ in size
    const jb = U(0, 360), jf = U(0.08, 0.38);
    const reach = (from, b, inside) => {
      let d = 1;
      while (d < 150 && inside(dest(from, b, d))) d += 1;
      let lo = Math.max(0, d - 1), hi = d;
      for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (inside(dest(from, b, m))) lo = m; else hi = m; }
      return lo;
    };
    // the coast as seen from the junction (every piece is star-shaped round it), scaled to the share
    const shape = (R) => {
      const blobLL = ring(R).map(S.latLon), inB = S.within(blobLL), J = dest(C, jb, jf * R);
      const inBlob = (v) => inB(v);
      const coast = Array.from({ length: 180 }, (_, k) => ({ b: k * 2, v: dest(J, k * 2, reach(J, k * 2, inBlob)) }));
      return { J, inBlob, coast };
    };
    let R0 = capRadius(target), sh = shape(R0);
    for (let it = 0; it < 4; it++) {
      const got = S.areaFraction(sh.coast.map((c) => S.latLon(c.v)));
      R0 = Math.min(82, R0 * capRadius(target) / capRadius(got));
      sh = shape(R0);
    }
    const { J, inBlob, coast } = sh;
    const scale = R0 / 68;

    // three rift arms from the junction to the coast, at uneven angles (70-170°), wavering
    const arms = [];
    const gaps = [U(0.6, 1.4), U(0.6, 1.4), U(0.6, 1.4)], gsum = gaps[0] + gaps[1] + gaps[2];
    let b = U(0, 360);
    for (let i = 0; i < 3; i++) {
      const w = wander(r, 14, 12 * scale), pts = [J];
      let s = 3;
      for (; s < 170; s += 3) { const bb = b + w(s); if (s >= reach(J, bb, inBlob)) break; pts.push(dest(J, bb, s)); }
      const be = b + w(s), se = reach(J, be, inBlob);
      pts.push(dest(J, be, se));
      arms.push({ pts, end: mod360(be), ext: dest(J, be, se + 2.5) });
      b += (360 * gaps[i]) / gsum;
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
    const mode = ['apart', 'wander', 'together', 'indent'].includes(opts.mode) ? opts.mode : 'apart';
    // indent: each mover heads straight for its target, fast (India for Asia); the rest wander
    const indents = mode === 'indent' ? (opts.indent || []) : [];
    const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : (Math.random() * 2 ** 31) | 0;
    const r = rng((seed ^ 0x5eed ^ Math.round(from * 7919)) >>> 0), U = (a, b) => a + (b - a) * r();
    const vmin = opts.minSpeed ?? 2, vmax = Math.max(vmin, opts.maxSpeed ?? 6), R = opts.radiusKm ?? 6371;
    const m0 = Q.model(P.plates, start);
    const pole = (q, age) => { const p = Q.toPole(q); return { age: +age.toFixed(3), lat: +p.lat.toFixed(4), lon: +p.lon.toFixed(4), angle: +p.angle.toFixed(4) }; };

    // Log 13: a plate split off another rides on it (fixed to it) until their rift opens. Riding,
    // it is carried in its parent's block; once the rift has opened by `from`, it parts from it here,
    // and a split that opens during the run cuts the run in two at that age.
    const between = (f, a, b) => (f.left === a && f.right === b) || (f.left === b && f.right === a);
    const rides = (a, b, at) => m0.fixedAt(a, at) === b || m0.fixedAt(b, at) === a;
    const splits = P.features.filter((f) => f.kind === 'rift' && f.left && f.right && (f.begin ?? start) < from - 1e-9 && (f.begin ?? start) > end + 1e-9 && rides(f.left, f.right, f.begin)).map((f) => f.begin);
    if (splits.length) {
      const at = Math.max(...splits);
      const first = simulate(P, { ...opts, from, duration: from - at });
      const second = simulate({ ...P, plates: first.plates }, { ...opts, from: first.end, duration: first.end - end });
      return { ...second, welds: [...first.welds, ...second.welds], phases: undefined };
    }
    const parentOf = (id) => {
      const f = m0.fixedAt(id, from);
      return f && P.plates.some((q) => q.id === f) && !P.features.some((x) => x.kind === 'rift' && between(x, id, f) && (x.begin ?? start) >= from - 1e-9) ? f : 0;
    };
    const carrier = (id, depth = 0) => { const f = parentOf(id); return f && depth < 20 ? carrier(f, depth + 1) : id; };

    // the continental blocks: each free plate's crust (or its cratons, if it has no crust), with that
    // of the plates riding on it, in its own frame
    const bodies = P.plates.filter((p) => carrier(p.id) === p.id).map((p) => {
      const toOwn = Q.mul(Q.inverse(m0.absolute(p.id, from)), Q.IDENTITY);
      const all = P.plates.filter((q) => carrier(q.id) === p.id).flatMap((q) => {
        const fs = P.features.filter((f) => (f.kind === 'crust' || f.kind === 'craton') && f.plateId === q.id && f.coords.length >= 3 && (f.begin ?? start) >= from);
        const use = fs.some((f) => f.kind === 'crust') ? fs.filter((f) => f.kind === 'crust') : fs;
        const turn = Q.mul(toOwn, m0.absolute(q.id, from));
        return use.map((f) => ({ ring: f.coords.map((c) => Q.rotate(turn, S.vec(c))), area: S.areaFraction(f.coords) }));
      });
      if (!all.length) return null;
      const rings = all.map((x) => x.ring);
      const c0 = norm(rings.flat().reduce((acc, v) => acc.map((x, k) => x + v[k]), [0, 0, 0]));
      const samples = rings.flatMap((rg) => rg.filter((_, i) => i % Math.max(1, Math.round(rg.length / 36)) === 0));
      return {
        id: p.id, rings, samples, c0, rad: Math.max(...rings.flat().map((v) => angle(c0, v))),
        area: all.reduce((sum, x) => sum + x.area, 0),
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
    // in a breakup, the contacts that do not rift stay welded (as Eurasia across the Urals)
    for (const [a, b] of opts.keep || []) {
      const i = bodies.findIndex((x) => x.id === a), j = bodies.findIndex((x) => x.id === b);
      if (i >= 0 && j >= 0) parent[find(j)] = find(i);
    }
    const middle = () => norm(bodies.reduce((s, b) => s.map((v, k) => v + b.area * b.now.c[k]), [0, 0, 0]));
    /*
     * A collision is not a kiss: the ocean between closes along the whole front. After first contact
     * the smaller block turns about the contact point, a degree at a time, while that brings more of
     * the two margins together without one riding over the other.
     */
    const overlaps = (i, j) => bodies[j].now.samples.filter((sm) => bodies[i].now.inside.some((f) => f(sm))).length + bodies[i].now.samples.filter((sm) => bodies[j].now.inside.some((f) => f(sm))).length;
    const front = (i, j, gap = 3) => { const c = Math.cos(gap * D2R); return bodies[i].now.samples.filter((sm) => bodies[j].now.samples.some((t) => dot(sm, t) > c)).length; };
    function zip(i, j, gi, gj) {
      const area = (g) => bodies.reduce((sum, b, x) => sum + (find(x) === g ? b.area : 0), 0);
      const turnG = area(gi) <= area(gj) ? gi : gj, a = turnG === gi ? i : j, o = turnG === gi ? j : i;
      // the contact: the closest pair of coast samples
      let best = -2, pivot = null;
      for (const sm of bodies[a].now.samples) for (const t of bodies[o].now.samples) { const d = dot(sm, t); if (d > best) { best = d; pivot = norm(sm.map((x, q) => x + t[q])); } }
      if (!pivot) return;
      const members = bodies.map((_, x) => x).filter((x) => find(x) === turnG);
      const turn = (deg) => { const rq = Q.fromAxisAngle(pivot, deg * D2R); for (const x of members) { bodies[x].tot = Q.mul(rq, bodies[x].tot); place(bodies[x]); } };
      // more of the front together is better; riding far over the other is not (some overlap is the
      // collision itself)
      const value = () => front(a, o) - 2 * Math.max(0, overlaps(a, o) - 3);
      let score = value(), dir = 0;
      for (const sg of [1, -1]) { turn(sg); const sc = value(); turn(-sg); if (sc > score) { score = sc; dir = sg; } }
      if (!dir) return;
      turn(dir);
      for (let step = 1; step < 40; step++) {
        turn(dir);
        const sc = value();
        if (sc < score) { turn(-dir); break; }
        score = sc;
      }
    }
    const C0 = middle();
    const biggest = bodies.reduce((a, b) => (b.area > a.area ? b : a), bodies[0]);
    for (const b of bodies) b.v = mode !== 'wander' && b === biggest ? U(0.3, 0.9) : U(vmin, vmax);
    if (mode === 'indent') for (const b of bodies) {
      const job = indents.find((x) => x.mover === b.id), tg = job && bodies.find((x) => x.id === job.target);
      if (!tg) { b.v = indents.some((x) => x.target === b.id) ? U(0.3, 0.9) : U(vmin * 0.6, vmax * 0.7); continue; }   // targets nearly still, the rest drifting
      // fast enough to arrive within some 60 % of the time (India reached 15-18 cm/yr)
      const gap = Math.max(2, angle(b.now.c, tg.now.c) - 0.6 * (b.rad + tg.rad));
      b.v = clamp((((gap * Math.PI * R) / 180) / (0.45 * duration)) * 0.1, vmin, 18);
    }
    const heading = new Map();

    // pin each plate where it is when continuing, so it does not glide from an older pole
    if (from < start) for (const b of bodies) b.poles.push(pole(b.tot, from));
    const step = interval / Math.ceil(interval / 2.5), every = Math.round(interval / step);
    const welds = [], closing = [];
    // the area-weighted middle of some blocks; the velocity (cm/yr) a turn of `rad` per Myr about `axis` gives at `c`
    const middleOf = (members) => norm(members.reduce((s, i) => s.map((v, q) => v + bodies[i].area * bodies[i].now.c[q]), [0, 0, 0]));
    const cmYr = (axis, rad, c) => cross(axis, c).map((v) => v * rad * R * 0.1);
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
        const pushing = mode === 'indent' && indents.find((x) => members.some((i) => bodies[i].id === x.mover) && !members.some((i) => bodies[i].id === x.target));
        const tgt = pushing ? bodies.find((x) => x.id === pushing.target) : null;
        if (tgt) {
          axis = cross(c, tgt.now.c);                         // straight at it
          speed = clamp(bodies[members.find((i) => bodies[i].id === pushing.mover)].v * U(0.9, 1.1), 0.2, 15);
        } else if (mode === 'wander' || mode === 'indent') {
          const h = (heading.has(g) ? heading.get(g) : U(0, 360)) + U(-12, 12);
          heading.set(g, h);
          const { east, north } = frame(c), b = h * D2R;
          axis = cross(c, north.map((v, q) => Math.cos(b) * v + Math.sin(b) * east[q]));
        } else {
          const h = clamp((heading.get(g) || 0) + U(-6, 6), -25, 25);
          heading.set(g, h);
          // breaking apart: away from the middle of the other blocks, those it is rifting from (touched at
          // first) counting three times; gathering: toward the middle of all
          const weight = (i) => (members.some((mm) => !apart[Math.min(i, mm)][Math.max(i, mm)]) ? 3 : 1) * bodies[i].area;
          const others = norm(bodies.reduce((acc, bb, i) => (find(i) === g ? acc : acc.map((v, q) => v + weight(i) * bb.now.c[q])), [0, 0, 0]));
          axis = mode === 'apart' ? cross(Math.hypot(...others) > 0.5 ? others : C0, c) : cross(c, G);
          // at the middle: nowhere to go. Gathering, it does not stop there: plates never do, and a
          // supercontinent drifts on as a whole (as Pangaea did), at an ordinary plate speed, no longer
          // the slow anchor the others gathered on
          const middle = Math.hypot(...axis) < 0.03;
          if (middle) { axis = cross(c, Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]); if (mode === 'together') speed = Math.max(speed, (vmin + vmax) / 2); }
          if (mode === 'together' && !middle) speed *= clamp(angle(c, G) / 15, 0.3, 1);   // slow down on arrival
          axis = Q.rotate(Q.fromAxisAngle(c, h * D2R), norm(axis));
        }
        axis = norm(axis);
        const sinD = Math.max(0.2, Math.hypot(...cross(axis, c)));
        stages.set(g, speed > 0 ? Q.fromAxisAngle(axis, (speed * 10 * dt) / R / sinD) : Q.IDENTITY);   // 1 cm/yr = 10 km/Myr
      }
      bodies.forEach((b, i) => { b.tot = Q.mul(stages.get(find(i)), b.tot); place(b); });
      // collisions still closing: the smaller block goes on into the larger, slower and slower, until
      // the two weld (the thickening crust resists; see COLLISION_TAU_MYR)
      for (const cl of closing) {
        const rate = cl.rate * Math.exp(-(cl.t0 - (age - dt)) / COLLISION_TAU_MYR);   // rad/Myr
        const axis = Q.rotate(bodies[cl.lead].tot, cl.axis), c = middleOf(cl.members);
        const vc = cmYr(axis, rate, c);                              // the closing at the block's middle
        if (Math.hypot(...vc) < WELD_CM_YR) { cl.weld.weld = +(age - dt).toFixed(3); cl.done = true; continue; }
        // no faster than the top speed: the closing gives way to the motion the block now shares
        const sp = Q.toPole(stages.get(find(cl.members[0]))), vg = cmYr(S.vec([sp.lat, sp.lon]), (sp.angle * D2R) / dt, c);
        const fast = (f) => Math.hypot(...vg.map((v, q) => v + f * vc[q])) > vmax;
        let f = 1;
        if (fast(1)) { let lo = 0, hi = 1; for (let it = 0; it < 20; it++) { const mid = (lo + hi) / 2; if (fast(mid)) hi = mid; else lo = mid; } f = lo; }
        const turn = Q.fromAxisAngle(axis, f * rate * dt);
        for (const x of cl.members) { bodies[x].tot = Q.mul(turn, bodies[x].tot); place(bodies[x]); }
      }
      for (let c = closing.length - 1; c >= 0; c--) if (closing[c].done) closing.splice(c, 1);
      // blocks that meet: one block from then on, the smaller still closing on the larger
      for (let pass = 0; pass < 4; pass++) {
        let hit = false;
        for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
          if (find(i) === find(j)) continue;
          if (!apart[i][j]) continue;            // rifting apart from each other in this run: they part, not weld
          if (!contact(i, j)) continue;
          const gi = find(i), gj = find(j);
          // how fast they were closing: the smaller group's motion relative to the larger's, this step
          const area = (g) => bodies.reduce((sum, b, x) => sum + (find(x) === g ? b.area : 0), 0);
          const small = area(gi) <= area(gj) ? gi : gj, big = small === gi ? gj : gi;
          const rel = Q.mul(stages.get(small), Q.inverse(stages.get(big))), p = Q.toPole(rel);
          const lead = bodies.map((_, x) => x).filter((x) => find(x) === big).reduce((a, x) => (bodies[x].area > bodies[a].area ? x : a));
          const members = bodies.map((_, x) => x).filter((x) => find(x) === small);
          zip(i, j, gi, gj);
          parent[gj] = gi;
          const weld = { age: +(age - dt).toFixed(3), a: bodies[i].id, b: bodies[j].id, weld: null };
          welds.push(weld);
          const rate = (Math.abs(p.angle) * D2R) / dt, axisW = S.vec([p.lat, p.lon]).map((v) => v * Math.sign(p.angle || 1));
          if (Math.hypot(...cmYr(axisW, rate, middleOf(members))) >= WELD_CM_YR) {
            closing.push({ members, lead, axis: Q.rotate(Q.inverse(bodies[lead].tot), axisW), rate, t0: age - dt, weld });
          } else weld.weld = weld.age;
          hit = true;
        }
        if (!hit) break;
      }
      age -= dt; k++;
      const assembled = mode === 'together' && bodies.every((_, i) => find(i) === find(0));
      if (k % every === 0 || age <= end + 1e-9 || assembled) for (const b of bodies) b.poles.push(pole(b.tot, Math.max(0, age)));
      if (assembled) break;                                    // one supercontinent: the gathering is over
    }
    // (a collision still closing when the run ends: its weld is where the run stops)
    for (const cl of closing) cl.weld.weld = +Math.max(0, age).toFixed(3);

    const plates = P.plates.map((p) => {
      const b = bodies.find((x) => x.id === p.id);
      if (!b) return keep(p);                                   // riding: its parent carries it
      if (from >= start) return { ...p, fixed: 0, rotations: b.poles };
      // the poles before `from` stay as they were, each with the plate it was relative to; if that
      // was another plate (it rode on it), a crossover: the same position, relative to that plate,
      // ends the old segment at `from`, and the new poles, relative to plate 0, begin there
      const was = m0.fixedAt(p.id, from);
      const older = (p.rotations || []).filter((x) => x.age > from).map((x) => ({ ...x, fixed: x.fixed ?? p.fixed ?? 0 }));
      const cross = was ? [{ ...pole(m0.relative(p.id, from), from), fixed: was }] : [];
      const rotations = [...older, ...cross, ...b.poles].map((x) => { const { fixed, ...rest } = x; return fixed ? { ...rest, fixed } : rest; });
      return { ...p, fixed: 0, rotations };
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
    // d: degrees out, or a function of the position along (0-1), as for an arc bowed out to sea
    const at = typeof d === 'function' ? d : () => d;
    const raw = points.map(({ v, n }, i) => { const dd = at(points.length > 1 ? i / (points.length - 1) : 0.5) * D2R; return norm(v.map((x, q) => Math.cos(dd) * x + Math.sin(dd) * n[q])); });
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
    const tag = `s${((opts.seed ?? 1) >>> 0).toString(36)}-${Math.round(from)}`;
    const toLL = (vs) => vs.map(ll);
    for (let age = from; age >= to - 1e-9; age -= every) {
      const runs = leadingCoasts(P, m, age, R).filter((rn) => rn.points.length >= (opts.minPoints ?? 5));
      const used = new Set();
      for (const z of zones) {
        if (z.end !== undefined) continue;
        const hit = runs.findIndex((rn, i) => !used.has(i) && rn.plateId === z.plateId && rn.points.some(({ v }) => S.distanceToLine(S.latLon(v), z.coords) < z.offset + 3));
        if (hit >= 0) used.add(hit); else z.end = +age.toFixed(3);
      }
      runs.forEach((rn, i) => {
        if (used.has(i)) return;
        // an island arc needs a long margin; its trench bows out to sea (arcs are arcs), and the arc is
        // a stretch of it, not the whole coast
        const island = r() < (opts.islandShare ?? 0.35) && rn.points.length >= 8;
        const offset = island ? U(3, 4.5) : U(0.8, 1.5), bow = island ? U(0.25, 0.5) : 0.15;
        const out = (t) => offset * (1 - bow + bow * 2 * Math.sin(Math.PI * t));
        const trench = offshore(rn.points, out).filter((_, k, all) => k % 2 === 0 || k === all.length - 1);
        if (trench.length < 2) return;
        // the teeth point at the plate: from the trench's middle towards the coast it came from
        const tm = trench[Math.max(0, Math.floor((trench.length - 2) / 2))], cm = rn.points[Math.min(rn.points.length - 1, Math.floor((trench.length - 2) / 2) * 2)].v;
        const landward = [cm[0] - tm[0], cm[1] - tm[1], cm[2] - tm[2]];
        zones.push({ id: `${tag}-z${zones.length}`, kind: 'subduction', plateId: rn.plateId, name: `Subduction zone ${++nz}`, coords: toLL(trench), side: sideOf(trench, landward), begin: +age.toFixed(3), offset, auto: true });
        if (!island) return;
        // the island arc: a narrow, lumpy belt of islands about 1.5° behind the trench, on the overriding plate
        const back = U(1.2, 1.8), a0 = U(0, 0.25), a1 = U(0.75, 1);   // the arc covers part of the margin
        const take = rn.points.filter((_, i, all) => { const t = i / (all.length - 1); return t >= a0 && t <= a1; });
        if (take.length < 4) return;
        const line = offshore(take, (t) => out(a0 + t * (a1 - a0)) - back), nrm = take.map((q) => q.n);
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

  const KIND_CLOSED = new Set(['crust', 'craton', 'arc', 'orogen', 'lip']);

  /*
   * Lines of a plate that is splitting (trenches, failed rifts), cut where they cross into the part
   * that becomes the new plate (Log 13; GPlates' Split Feature): each stretch goes with its side.
   * inSide(v) tells whether a unit vector (in the plate's frame) lies in the new plate's part.
   */
  function divideLines(features, plateId, inSide, newId, skipId) {
    return features.flatMap((f) => {
      if (f.plateId !== plateId || f.id === skipId || KIND_CLOSED.has(f.kind) || f.kind === 'rift' || f.coords.length < 2) return [f];
      const side = f.coords.map((c) => inSide(S.vec(c)));
      if (side.every((x) => !x)) return [f];
      if (side.every(Boolean)) return [{ ...f, plateId: newId }];
      const runs = [];
      side.forEach((x, i) => { if (!i || x !== side[i - 1]) runs.push({ x, pts: [] }); runs[runs.length - 1].pts.push(f.coords[i]); });
      // each stretch reaches halfway to the next, so the two meet at the rift
      for (let i = 0; i < runs.length - 1; i++) {
        const a = runs[i].pts[runs[i].pts.length - 1], b = runs[i + 1].pts[0], mid = S.latLon(norm(S.vec(a).map((v, k) => v + S.vec(b)[k])));
        runs[i].pts.push(mid); runs[i + 1].pts.unshift(mid);
      }
      return runs.filter((r) => r.pts.length >= 2).map((r, i) => ({ ...f, id: `${f.id}-${i}`, name: `${f.name} ${String.fromCharCode(65 + i)}`, plateId: r.x ? newId : plateId, coords: r.pts.map(([la, lo]) => [+la.toFixed(4), +lo.toFixed(4)]) }));
    });
  }

  // ── Logs 14-19: microcontinents, collisions, orogens, hotspots, and the whole history at once ─

  const fix4 = (p) => [+p[0].toFixed(4), +p[1].toFixed(4)];
  /* Points along a line round a ring-like chain: order loose points by walking to the nearest. */
  function chain(vs) {
    if (vs.length < 2) return vs;
    // start at one end: the point farthest from the middle
    const c = norm(vs.reduce((s, v) => s.map((x, k) => x + v[k]), [0, 0, 0]));
    let cur = vs.reduce((a, v) => (angle(c, v) > angle(c, a) ? v : a), vs[0]);
    const left = vs.filter((v) => v !== cur), out = [cur];
    while (left.length) {
      let bi = 0;
      for (let i = 1; i < left.length; i++) if (dot(left[i], cur) > dot(left[bi], cur)) bi = i;
      if (angle(left[bi], cur) > 6) break;                        // a gap: keep the first stretch
      cur = left.splice(bi, 1)[0];
      out.push(cur);
    }
    return out;
  }
  /* A belt either side of a line (unit vectors), half-width w degrees (or w(j) at its j-th point), tapering at the ends. */
  function belt(line, w, lump) {
    if (line.length < 2) return null;
    const side = (sg) => line.map((v, j) => {
      const a = line[Math.max(0, j - 1)], b = line[Math.min(line.length - 1, j + 1)];
      const n = norm(cross(v, [b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
      const t = j / (line.length - 1), wj = (typeof w === 'function' ? w(j) : w) * Math.max(0.3, Math.sin(Math.PI * t) ** 0.4) * (1 + (lump ? lump(j) : 0));
      return norm(v.map((x, k) => x + sg * wj * D2R * n[k]));
    });
    return [...side(1), ...side(-1).reverse()];
  }

  /*
   * Split one piece of crust along a line (in its plate's frame) at an age: the chosen part becomes a
   * new plate riding the old one (fixed to it) until then, with a rift between them that opens then.
   * Shapes inside the new part go with it; lines crossing are cut. Returns {plates, features, nextPlate, rift}.
   */
  function splitWith(P, age, f, lineLL, pick, opts = {}) {
    const parts = S.splitPolygon(f.coords, lineLL);
    if (!parts) return null;
    const sizes = parts.map((q) => S.areaFraction(q)), small = pick(parts, sizes);
    if (small === null) return null;
    const pid = f.plateId, newId = Math.max(P.nextPlate ?? 0, ...P.plates.map((p) => p.id + 1));
    const inSmall = S.within(parts[small]);
    const moves = (x) => x.plateId === pid && x.coords.length && inSmall(S.vec(KIND_CLOSED.has(x.kind) ? S.latLon(S.centroid(x.coords)) : x.coords[Math.floor(x.coords.length / 2)]));
    let features = P.features.flatMap((x) => {
      if (x === f) return parts.map((ring, i) => ({ ...x, id: `${x.id}-${i ? 'b' : 'a'}`, name: `${x.name} ${i === small ? 'B' : 'A'}`, plateId: i === small ? newId : pid, coords: ring.map(fix4) }));
      return [KIND_CLOSED.has(x.kind) && x.kind !== 'crust' && moves(x) ? { ...x, plateId: newId } : x];
    });
    features = divideLines(features, pid, inSmall, newId);
    const line = lineLL.map(S.vec), mid = Math.floor(line.length / 2), nx = Math.min(line.length - 1, mid + 1), m0 = nx === mid ? mid - 1 : mid;
    const n = norm(cross(line[m0], [line[nx][0] - line[m0][0], line[nx][1] - line[m0][1], line[nx][2] - line[m0][2]]));
    const leftIsSmall = inSmall(norm(line[m0].map((x, q) => x + 0.03 * n[q])));
    const rift = { id: `r${pid}-${newId}-${Math.round(age)}`, kind: 'rift', plateId: pid, name: opts.name || `Rift ${P.features.filter((x) => x.kind === 'rift').length + 1}`, coords: lineLL.map(fix4), left: leftIsSmall ? newId : pid, right: leftIsSmall ? pid : newId, begin: +age.toFixed(3), ...(opts.auto ? { auto: true } : {}) };
    features.push(rift);
    const plates = [...P.plates.map((p) => ({ ...p })), { id: newId, name: opts.plateName || `Plate ${newId}`, colour: opts.colour, fixed: pid, rotations: [] }];
    return { plates, features, nextPlate: newId + 1, rift };
  }

  /*
   * Log 14, microcontinents: a sliver of a continent's margin rifts off at an age and becomes a plate
   * of its own (as Madagascar, Japan, the Lord Howe Rise). Preferably behind a coast that leads its
   * plate (back-arc rifting), otherwise along any coast: the cut runs 3-7° inland, parallel to it,
   * clear of cratons. Returns as splitWith, or null.
   */
  function microcontinent(P, age, opts = {}) {
    const start = P.start ?? 1000, m = Q.model(P.plates, start);
    const r = rng((((Number.isFinite(opts.seed) ? opts.seed : 1) ^ 0x31c0) + Math.round(age)) >>> 0), U = (a, b) => a + (b - a) * r();
    const runs = leadingCoasts(P, m, age, opts.radiusKm ?? 6371).filter((rn) => rn.points.length >= 8).sort((a, b) => b.points.length - a.points.length);
    const crusts = P.features.filter((f) => f.kind === 'crust' && f.coords.length >= 3 && (f.begin ?? start) >= age).sort((a, b) => S.areaFraction(b.coords) - S.areaFraction(a.coords));
    // candidate stretches of coast: leading ones first, then 12-25° of the largest pieces' coasts
    const cands = runs.map((rn) => ({ f: rn.feature, pts: rn.points }));
    for (const f of crusts.slice(0, 4)) {
      const mg = margins(f), len = Math.min(mg.length - 1, Math.round(U(8, 16)));
      const at = Math.floor(r() * mg.length);
      cands.push({ f, pts: Array.from({ length: len }, (_, k) => mg[(at + k) % mg.length]) });
    }
    for (const { f, pts } of cands) {
      const cratons = P.features.filter((c) => c.kind === 'craton' && c.plateId === f.plateId);
      for (let tries = 0; tries < 6; tries++) {
        const take = pts.length > 16 ? pts.slice(Math.floor(r() * (pts.length - 14)), undefined).slice(0, 14) : pts;
        const d = U(3, 7);
        const inland = offshore(take, -d), out0 = offshore([take[0]], 2.5)[0], out1 = offshore([take[take.length - 1]], 2.5)[0];
        const lineLL = [out0, ...inland, out1].map(S.latLon);
        if (cratons.some((k) => lineLL.some((p) => S.contains(k.coords, p)) || lineLL.some((p) => S.distanceToLine(p, [...k.coords, k.coords[0]]) < 1))) continue;
        const coastMid = take[Math.floor(take.length / 2)].v;
        const res = splitWith(P, age, f, lineLL, (parts, sizes) => {
          const i = S.within(parts[0])(coastMid) ? 0 : 1;
          const share = sizes[i] / (sizes[0] + sizes[1]);
          return share > 0.02 && share < 0.35 ? i : null;
        }, { ...opts, name: `Rift ${P.features.filter((x) => x.kind === 'rift').length + 1} (microcontinent)` });
        if (res) return res;
      }
    }
    return null;
  }

  /*
   * A second rifting event, Log 12's way: a rift across the largest plate's largest piece of crust,
   * roughly across its long axis and clear of its cratons, the smaller part riding the old plate
   * until then. Returns as splitWith, or null.
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
        const lineLL = [...arm(-1).reverse(), centre, ...arm(1)].map(S.latLon);
        if (cratons.some((k) => lineLL.some((p) => S.contains(k.coords, p)) || S.distanceToLine(S.latLon(S.centroid(k.coords)), lineLL) < 3)) continue;
        const res = splitWith(P, age, f, lineLL, (parts, sizes) => { const s = sizes[0] < sizes[1] ? 0 : 1; return sizes[s] >= 0.25 * (sizes[0] + sizes[1]) ? s : null; }, opts);
        if (res) return res;
      }
    }
    return null;
  }

  /* Each plate's coast at an age, as unit vectors placed then, with quick tests. */
  function coastsAt(P, m, age) {
    const start = P.start ?? 1000, out = new Map();
    for (const f of P.features) {
      if (f.kind !== 'crust' || f.coords.length < 3 || (f.begin ?? start) < age) continue;
      const A = m.absolute(f.plateId, age), placed = f.coords.map((c) => Q.rotate(A, S.vec(c)));
      const e = out.get(f.plateId) || { plateId: f.plateId, pieces: [], pts: [] };
      e.pieces.push({ f, inside: S.within(placed.map(S.latLon)), coast: margins(f).map(({ v }) => Q.rotate(A, v)) });
      e.pts.push(...e.pieces[e.pieces.length - 1].coast.filter((_, i) => i % 2 === 0));
      out.set(f.plateId, e);
    }
    for (const e of out.values()) { e.c = norm(e.pts.reduce((s, v) => s.map((x, k) => x + v[k]), [0, 0, 0])); e.rad = Math.max(...e.pts.map((v) => angle(e.c, v))); }
    return out;
  }
  const touching = (A, B, gap = 1.2) => {
    if (angle(A.c, B.c) > A.rad + B.rad + gap + 1) return false;
    const near = Math.cos(gap * D2R);
    return A.pts.some((s) => B.pieces.some((p) => p.inside(s))) || B.pts.some((s) => A.pieces.some((p) => p.inside(s))) || A.pts.some((s) => B.pts.some((t) => dot(s, t) > near));
  };

  /*
   * Logs 15 and 16: what happens when things meet, found by stepping through the history.
   *  - An island arc that runs into another plate's continent is accreted to it: from then on it
   *    rides that plate (a terrane), and its trench stops.
   *  - Two continents that meet (after having been apart) collide: a suture where they touch, on the
   *    larger plate, and the trenches between them stop: the ocean between them has closed. With
   *    opts.contacts (the simulation's own meetings, [{age, a, b, weld}]) the sutures are taken from
   *    those, each with its weld age; without, from coasts found touching every `every` Myr.
   * Returns {features} (the input's, changed and added to) and the events [{age, kind, a, b}].
   */
  function markCollisions(P, opts = {}) {
    const start = P.start ?? 1000, step = opts.every ?? 10, m = Q.model(P.plates, start), contacts = opts.contacts || null;
    const features = P.features.map((f) => ({ ...f }));
    const events = [], area = new Map();
    for (const f of features) if (f.kind === 'crust') area.set(f.plateId, (area.get(f.plateId) || 0) + S.areaFraction(f.coords));
    let prev = null, n = features.filter((f) => f.kind === 'suture').length;
    const parted = new Set();
    // trenches and arcs closed at the age they began never were: they go, with what came of them
    const stillborn = new Set();
    const end = Math.max(0, opts.to ?? 0);
    // from: begin there (to carry on a history: what touches then has not just met)
    const top = opts.from != null ? Math.min(start, opts.from) : start - step;
    for (let age = top; age >= end - 1e-9; age -= step) {
      const live = (f) => (f.begin ?? start) >= age && (f.end == null || f.end < age);
      const coasts = coastsAt({ ...P, features }, m, age), ids = [...coasts.keys()];
      const now = new Map();
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const key = `${ids[i]}:${ids[j]}`, A = coasts.get(ids[i]), B = coasts.get(ids[j]);
        // the simulation welds blocks a degree or two apart: that is a meeting
        const touch = touching(A, B, 2.5);
        now.set(key, touch);
        // a meeting counts only after the two have been clearly apart (4°), not a graze while parting
        if (!touch && !touching(A, B, 4)) parted.add(key);
      }
      // arcs that hit another plate's continent
      for (const a of features.filter((x) => x.kind === 'arc' && live(x) && !x.accreted)) {
        const A = m.absolute(a.plateId, age), pts = a.coords.map((c) => Q.rotate(A, S.vec(c)));
        const hit = [...coasts.values()].find((e) => e.plateId !== a.plateId && angle(e.c, pts[0]) < e.rad + 3 && (pts.some((p) => e.pieces.some((q) => q.inside(p))) || pts.some((p) => e.pts.some((t) => dot(p, t) > Math.cos(D2R)))));
        if (!hit) continue;
        a.end = +age.toFixed(3);
        if (a.end >= (a.begin ?? start)) stillborn.add(a.id);
        const B = Q.inverse(m.absolute(hit.plateId, age));
        features.push({ ...a, id: `${a.id}-t${hit.plateId}`, name: `${a.name} (accreted)`, plateId: hit.plateId, coords: pts.map((p) => fix4(S.latLon(Q.rotate(B, p)))), begin: +age.toFixed(3), end: undefined, accreted: true });
        for (const z of features.filter((x) => x.kind === 'subduction' && x.plateId === a.plateId && live(x) && Math.min(...a.coords.map((q) => S.distanceToLine(q, x.coords))) < 8)) { z.end = +age.toFixed(3); if (z.end >= (z.begin ?? start)) stillborn.add(z.id); }
        events.push({ age, kind: 'arc', a: a.plateId, b: hit.plateId, name: a.name });
      }
      // continents that meet (from the simulation's own contacts, if given: below)
      if (prev && !contacts) for (const [key, touch] of now) {
        if (!touch || !parted.has(key)) continue;
        parted.delete(key);
        const [ia, ib] = key.split(':').map(Number), big = (area.get(ia) || 0) >= (area.get(ib) || 0) ? ia : ib, other = big === ia ? ib : ia;
        const A = coasts.get(big), B = coasts.get(other), near = Math.cos(6 * D2R);   // the facing margins: one collision zone
        const contact = chain(A.pieces.flatMap((p) => p.coast).filter((s) => B.pts.some((t) => dot(s, t) > near) || B.pieces.some((q) => q.inside(s))));
        if (contact.length < 3) continue;
        const back = Q.inverse(m.absolute(big, age));
        features.push({ id: `u${big}-${other}-${Math.round(age)}`, kind: 'suture', plateId: big, partner: other, name: `Suture ${++n}`, coords: contact.map((v) => fix4(S.latLon(Q.rotate(back, v)))), begin: +age.toFixed(3), auto: true });
        for (const z of features.filter((x) => x.kind === 'subduction' && (x.plateId === big || x.plateId === other) && live(x))) {
          const Z = m.absolute(z.plateId, age), zs = z.coords.map((c) => Q.rotate(Z, S.vec(c)));
          if (zs.some((p) => contact.some((q) => angle(p, q) < 8))) { z.end = +age.toFixed(3); if (z.end >= (z.begin ?? start)) stillborn.add(z.id); }
        }
        events.push({ age, kind: 'continent', a: big, b: other });
      }
      prev = now;
    }
    // the simulation's contacts: a suture where the two blocks' continents touch at the age they met,
    // with the age they welded (when the belt there stopped rising)
    if (contacts) for (const c of contacts.filter((x) => x.age <= top + 1e-9 && x.age >= end - 1e-9).sort((x, y) => y.age - x.age)) {
      const age = c.age, live = (f) => (f.begin ?? start) >= age && (f.end == null || f.end < age);
      const carrier = (id) => { let x = id; for (let d = 0; d < 20; d++) { const f = m.fixedAt(x, age); if (!f) break; x = f; } return x; };
      const coasts = coastsAt({ ...P, features }, m, age), ids = [...coasts.keys()];
      const pairs = [];
      for (const ia of ids) for (const ib of ids) if (carrier(ia) === c.a && carrier(ib) === c.b && touching(coasts.get(ia), coasts.get(ib), 3)) pairs.push([ia, ib]);
      for (const [ia, ib] of pairs) {
        const big = (area.get(ia) || 0) >= (area.get(ib) || 0) ? ia : ib, other = big === ia ? ib : ia;
        const A = coasts.get(big), B = coasts.get(other), near = Math.cos(6 * D2R);
        const contact = chain(A.pieces.flatMap((q) => q.coast).filter((sv) => B.pts.some((t) => dot(sv, t) > near) || B.pieces.some((q) => q.inside(sv))));
        if (contact.length < 3) continue;
        const back = Q.inverse(m.absolute(big, age));
        features.push({ id: `u${big}-${other}-${Math.round(age)}`, kind: 'suture', plateId: big, partner: other, name: `Suture ${++n}`, coords: contact.map((v) => fix4(S.latLon(Q.rotate(back, v)))), begin: +age.toFixed(3), weld: +Math.min(age, c.weld ?? age).toFixed(3), auto: true });
        for (const z of features.filter((x) => x.kind === 'subduction' && (x.plateId === big || x.plateId === other) && live(x))) {
          const Z = m.absolute(z.plateId, age), zs = z.coords.map((q) => Q.rotate(Z, S.vec(q)));
          if (zs.some((pt) => contact.some((q) => angle(pt, q) < 8))) { z.end = +age.toFixed(3); if (z.end >= (z.begin ?? start)) stillborn.add(z.id); }
        }
        events.push({ age, kind: 'continent', a: big, b: other });
      }
    }
    const gone = (f) => f.auto && (stillborn.has(f.id) || (f.accreted && [...stillborn].some((id) => f.id.startsWith(`${id}-t`))) || (f.kind === 'orogen' && stillborn.has(f.id.slice(1))));
    return { features: stillborn.size ? features.filter((f) => !gone(f)) : features, events };
  }

  /*
   * The ocean floor at a point (unit vector, placed at `age`): which plate carries it (the flank of the
   * rift that made it, as the map lays out the floor) and how old it is there, or null where no rift
   * on record made it (older ocean). cache: a Map shared between calls.
   */
  function floorAt(P, m, x, age, cache) {
    const start = P.start ?? 1000, step = P.step || 10;
    for (const f of P.features) {
      if (f.kind !== 'rift' || !f.left || !f.right || f.left === f.right || f.coords.length < 2) continue;
      const begin = f.begin ?? start;
      if (begin <= age || (f.end != null && f.end >= age)) continue;
      const key = `${f.id}@${age}`;
      // (each strip of floor between two isochrons, its inside-test made once and kept)
      let strips = cache.get(key);
      if (!strips) {
        const sp = Q.spreading(m, f.coords, f.left, f.right, begin, age, step);
        strips = [];
        for (const [edge, flank, pid] of [[sp.edgeL, 'left', f.left], [sp.edgeR, 'right', f.right]]) {
          let prev = edge, prevAge = begin;
          for (const iso of sp.isochrons) {
            if (prevAge - age <= OCEAN_LIFE_MYR && prevAge - iso.age <= 2 * step) strips.push({ inside: S.within([...prev, ...iso[flank].slice().reverse()]), plate: pid, age: (prevAge + iso.age) / 2 - age });
            prev = iso[flank]; prevAge = iso.age;
          }
        }
        cache.set(key, strips);
      }
      for (const st of strips) if (st.inside(x)) return { plate: st.plate, age: st.age };
    }
    return null;
  }

  /*
   * What a subduction zone did through its life, every EPISODE_STEP_MYR: the plate going down (the
   * one carrying the ocean floor just off the trench; 0 for floor older than any rift on record,
   * taken as anchored in the mantle), that floor's age, the upper plate's motion towards the trench
   * (cm/yr: positive advancing, negative retreating) and the closing across the trench; then the
   * episodes they fall into: 'compression' (the upper plate advances: its margin shortens),
   * 'extension' (it retreats: a back-arc basin, no range) or 'neutral'.
   * Returns [{from, to, mode, vup, closing, down, floor}] (ages Ma, speeds cm/yr, floor age Myr or null).
   */
  function subductionEpisodes(P, m, z, R = 6371, cache = new Map()) {
    const start = P.start ?? 1000, from = z.begin ?? start, to = Math.max(0, z.end ?? 0), n = z.coords.length;
    if (n < 2) return [];
    const idx = [0.25, 0.5, 0.75].map((q) => clamp(Math.floor(q * (n - 1)), 0, n - 2));
    const move = (pid, v, t) => { const dt = Math.min(1, t); if (dt <= 0) return [0, 0, 0]; const a = Q.rotate(m.absolute(pid, t), v), b = Q.rotate(m.absolute(pid, t - dt), v); return [0, 1, 2].map((k) => ((b[k] - a[k]) * R * 0.1) / dt); };
    // (the floor off the trench, which plate carries it and how old it is, every FLOOR_STEP_MYR at the
    // trench's middle: a record, while the upper plate's motion, read every step, decides the episodes)
    const FLOOR_STEP_MYR = 25, floors = new Map();
    const geometry = (i, t) => {
      const A = m.absolute(z.plateId, t), pa = S.vec(z.coords[i]), a = Q.rotate(A, pa), b = Q.rotate(A, S.vec(z.coords[i + 1]));
      const left = norm(cross(a, [b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
      return { pa, a, sea: z.side === 'left' ? left.map((c) => -c) : left };
    };
    const floorNear = (t) => {
      const tf = Math.max(to, Math.round(t / FLOOR_STEP_MYR) * FLOOR_STEP_MYR);
      if (!floors.has(tf)) {
        const { a, sea } = geometry(idx[1], tf), x = norm(a.map((c, k) => c + Math.sin(D2R) * sea[k]));   // a degree off the trench
        const fl = floorAt(P, m, x, tf, cache), down = fl ? fl.plate : 0;
        floors.set(tf, { down, floor: fl ? fl.age : null, vd: down ? dot(move(down, Q.rotate(Q.inverse(m.absolute(down, tf)), x), tf), sea) : 0 });
      }
      return floors.get(tf);
    };
    const samples = [];
    for (let t = from; t >= to - 1e-9; t -= EPISODE_STEP_MYR) {
      let vup = 0;
      for (const i of idx) { const { pa, sea } = geometry(i, t); vup += dot(move(z.plateId, pa, t), sea) / idx.length; }
      const f = floorNear(t);
      const mode = vup > NEUTRAL_CM_YR ? 'compression' : vup < -NEUTRAL_CM_YR ? 'extension' : 'neutral';
      samples.push({ t, vup, closing: vup - f.vd, down: f.down, floor: f.floor, mode });
    }
    const out = [];
    for (const s of samples) {
      const last = out[out.length - 1];
      if (last && last.mode === s.mode && last.down === s.down) { last.n++; last.to = s.t; last.vup += s.vup; last.closing += s.closing; if (s.floor != null) { last.fl += s.floor; last.nf++; } }
      else out.push({ from: s.t, to: s.t, mode: s.mode, down: s.down, vup: s.vup, closing: s.closing, n: 1, fl: s.floor ?? 0, nf: s.floor != null ? 1 : 0 });
    }
    const r1 = (v) => +v.toFixed(2);
    return out.map((e) => ({ from: +e.from.toFixed(3), to: +Math.max(to, e.to - EPISODE_STEP_MYR).toFixed(3), mode: e.mode, vup: r1(e.vup / e.n), closing: r1(e.closing / e.n), down: e.down, floor: e.nf ? Math.round(e.fl / e.nf) : null }));
  }

  /* When a suture's plates stopped closing (welded), read from the rotation model; for sutures with no weld on record. */
  function weldOf(P, m, s, R = 6371) {
    const start = P.start ?? 1000;
    const middle = (pid, t) => {
      const fs = P.features.filter((f) => f.kind === 'crust' && f.plateId === pid && f.coords.length >= 3 && (f.begin ?? start) >= t);
      return fs.length ? norm(fs.flatMap((f) => f.coords.map((c) => Q.rotate(m.absolute(pid, t), S.vec(c)))).reduce((acc, v) => acc.map((x, k) => x + v[k]), [0, 0, 0])) : null;
    };
    const at = S.vec(s.coords[Math.floor(s.coords.length / 2)]);
    for (let t = s.begin; t > 0; t -= 2.5) {
      const cb = middle(s.plateId, t), cp = middle(s.partner, t);
      if (!cb || !cp) return +t.toFixed(3);
      const x = Q.rotate(m.absolute(s.plateId, t), at), d = [cb[0] - cp[0], cb[1] - cp[1], cb[2] - cp[2]];
      const u = norm(d.map((c, k) => c - x[k] * dot(d, x)));
      const vOf = (pid) => { const own = Q.rotate(Q.inverse(m.absolute(pid, t)), x), y = Q.rotate(m.absolute(pid, Math.max(0, t - 1)), own); return [0, 1, 2].map((k) => ((y[k] - x[k]) * R * 0.1) / Math.min(1, t)); };
      const vp = vOf(s.partner), vb = vOf(s.plateId);
      if (dot([vp[0] - vb[0], vp[1] - vb[1], vp[2] - vb[2]], u) < WELD_CM_YR) return +t.toFixed(3);
    }
    return 0;
  }

  /*
   * Log 17, orogeny: the mountain belts, each from its cause, and when it was last pushed up.
   *  - cordillera: behind a subduction zone off a continent, from its coast inland, while the upper
   *    plate advanced on the trench (its compression episodes, subductionEpisodes);
   *  - collision: astride a suture, pushed up until the two continents welded; where it was fed more
   *    crust than rock holds up, it is a plateau as wide as that crust makes it (Tibet);
   *  - accretion: where an island arc was accreted, at that age.
   * Each belt is drawn as wide as it grew at its widest, point by point (js/crust.js: the crust the plates
   * fed it, worn under an Earth-average rain); the map works out how it stands at its own age and climate.
   * Old belts are worn down: their `active` age says until when they grew.
   */
  function markOrogens(P, opts = {}) {
    const start = P.start ?? 1000, R = opts.radiusKm ?? 6371, CRm = crustModel();
    const g = Math.max(0.05, opts.gravity ?? 1), fg = g ** (opts.scaling ?? 2), kmDeg = (Math.PI * R) / 180;
    const out = [], m = Q.model(P.plates, start), cache = new Map();
    const byId = new Map(P.features.map((x) => [String(x.id), x]));
    let n = P.features.filter((f) => f.kind === 'orogen').length;
    const crustOf = (id) => P.features.filter((f) => f.kind === 'crust' && f.plateId === id).map((f) => S.within(f.coords));
    // a belt's width (km) along it, at its widest: what the plates fed it, worn under an Earth-average rain
    const widths = (o) => {
      const inp = CRm.beltInputs(P, m, o, R, byId);
      if (!inp || !inp.t.length) return null;
      const end = Math.max(0, inp.t[inp.t.length - 1] - CRm.C.STEP_MYR);
      const st = inp.stations.map((x, i) => ({ frac: x.frac, w: CRm.thicken(CRm.evolve(inp.t, inp.F[i], end, () => Math.sqrt(g), fg).peak, fg).width }));
      return (q) => { let i = 1; while (i < st.length - 1 && st[i].frac < q) i++; const a = st[i - 1], c = st[i], u = c.frac > a.frac ? Math.max(0, Math.min(1, (q - a.frac) / (c.frac - a.frac))) : 0; return a.w + (c.w - a.w) * u; };
    };
    // fractions along a line of unit vectors
    const fracs = (line) => { const c = [0]; for (let j = 1; j < line.length; j++) c.push(c[j - 1] + angle(line[j - 1], line[j])); const L = c[c.length - 1] || 1; return c.map((x) => x / L); };
    for (const z of P.features.filter((f) => f.kind === 'subduction' && f.coords.length >= 2)) {
      // a range only where, and while, the upper plate advanced on the trench and its margin shortened;
      // a margin that only stretched has a back-arc basin, not a range
      const comp = (z.episodes || subductionEpisodes(P, m, z, R, cache)).filter((e) => e.mode === 'compression');
      if (!comp.length) continue;
      const line = S.densify(z.coords, false, 1.5).map(S.vec), inC = crustOf(z.plateId), sg = z.side === 'right' ? -1 : 1;
      const nrm = line.map((v, j) => { const a = line[Math.max(0, j - 1)], b = line[Math.min(line.length - 1, j + 1)]; return norm(cross(v, [b[0] - a[0], b[1] - a[1], b[2] - a[2]])); });
      const inward = (j, d) => norm(line[j].map((x, k) => Math.cos(d * D2R) * x + sg * Math.sin(d * D2R) * nrm[j][k]));
      // the coast behind the trench at each point: the range rises from it, inland. Where the trench lies
      // far out (an island-arc margin, the arc between), the arc is its mountains, not the continent
      const coast = line.map((_, j) => { for (let d = 0; d <= 4.5 + 1e-9; d += 0.1) if (inC.some((fn) => fn(inward(j, d)))) return d; return null; });
      const near = coast.filter((d) => d != null && d <= 2.5).sort((x, y) => x - y);
      if (near.length < 0.6 * line.length) continue;
      const med = near[near.length >> 1];
      const o = { id: `o${z.id}`, kind: 'orogen', type: 'cordillera', plateId: z.plateId, name: `${['Cordillera', 'Range', 'Sierra'][n % 3]} ${n + 1}`, coords: [], begin: comp[0].from, active: comp[comp.length - 1].to, episodes: comp, auto: true };
      const wAt = widths(o), q = fracs(line);
      if (!wAt) continue;
      const d0 = coast.map((d) => (d != null && d <= 2.5 ? d : med));
      const a = line.map((_, j) => inward(j, d0[j])), b = line.map((_, j) => inward(j, d0[j] + Math.max(10, wAt(q[j])) / kmDeg));
      o.coords = [...a, ...b.reverse()].map((v) => fix4(S.latLon(v)));
      n++;
      out.push(o);
    }
    for (const s of P.features.filter((f) => f.kind === 'suture' && f.coords.length >= 2)) {
      // a collision range astride the suture (the Himalaya, the Alps), pushed up until the two welded
      const line = S.densify(s.coords, false, 1.5).map(S.vec), active = Math.max(0, s.weld ?? weldOf(P, m, s, R));
      const o = { id: `o${s.id}`, kind: 'orogen', type: 'collision', plateId: s.plateId, name: `Mountains ${n + 1}`, coords: [], begin: s.begin, active, auto: true };
      const wAt = widths(o), q = fracs(line);
      // (two continents that met without closing raised nothing)
      if (!wAt || !(Math.max(...q.map(wAt)) > 1)) continue;
      const ring = belt(line, (j) => Math.max(5, wAt(q[j])) / 2 / kmDeg);
      if (!ring) continue;
      o.coords = ring.map((v) => fix4(S.latLon(v)));
      n++;
      out.push(o);
    }
    for (const a of P.features.filter((f) => f.kind === 'arc' && f.accreted)) {
      // (the arc stops at its accretion: what rises is the arc's own crust, added to the margin)
      out.push({ id: `o${a.id}`, kind: 'orogen', type: 'accretion', plateId: a.plateId, name: `Highlands ${++n}`, coords: a.coords, begin: a.begin, active: a.begin, auto: true });
    }
    return out;
  }

  /*
   * Log 18: hotspots, plumes fixed in the mantle (plate 0), each starting with a large igneous
   * province where its plume head first reaches the surface: a flood basalt on a continent, or a
   * plateau on the ocean floor beside one. Some breakups are heralded by one (as the Atlantic by the
   * CAMP): a LIP and a hotspot at the rift as it opens.
   */
  function addHotspots(P, opts = {}) {
    const start = P.start ?? 1000, m = Q.model(P.plates, start);
    const r = rng(((Number.isFinite(opts.seed) ? opts.seed : 1) ^ 0x4075) >>> 0), U = (a, b) => a + (b - a) * r();
    const out = [];
    let nh = P.features.filter((f) => f.kind === 'hotspot').length, nl = P.features.filter((f) => f.kind === 'lip').length;
    const blob = (c, rad) => { const sh = periodic(r, 0.2, 2, 5), k = 12, turn = U(0, 360); return Array.from({ length: k }, (_, j) => fix4(S.latLon(dest(c, turn + (j * 360) / k, rad * (1 + sh((j * 360) / k)))))); };
    const lipAt = (v, age, name) => {
      const co = coastsAt(P, m, age);
      let host = [...co.values()].find((e) => e.pieces.some((p) => p.inside(v))), kind = 'flood basalt';
      if (!host) { host = [...co.values()].map((e) => [Math.min(...e.pts.map((t) => angle(v, t))), e]).filter(([d]) => d < 12).sort((a, b) => a[0] - b[0])[0]?.[1]; kind = 'oceanic plateau'; }
      if (!host) return;
      const back = Q.inverse(m.absolute(host.plateId, age));
      out.push({ id: `l${++nl}-${Math.round(age)}`, kind: 'lip', type: kind, plateId: host.plateId, name: name || `LIP ${nl}`, coords: blob(Q.rotate(back, v), kind === 'flood basalt' ? U(3, 6) : U(4, 8)), begin: +age.toFixed(3), auto: true });
    };
    // window: [older, younger] Ma, to add only the hotspots that begin in it (about two per 100 Myr)
    const [hi, lo] = opts.window || [0.7 * start, 0.05 * start];
    const count = opts.count ?? (opts.window ? Math.round((U(1.2, 2.4) * (hi - lo)) / 100) : Math.round(U(8, 14)));
    for (let i = 0; i < count; i++) {
      const v = S.vec([Math.asin(2 * r() - 1) * R2D, U(-180, 180)]);
      const begin = Math.max(1, Math.round(U(lo, hi))), life = U(80, 400), end = begin - life > 0 ? Math.round(begin - life) : undefined;
      out.push({ id: `h${++nh}`, kind: 'hotspot', plateId: 0, name: `Hotspot ${nh}`, coords: [fix4(S.latLon(v))], begin, ...(end ? { end } : {}), auto: true });
      lipAt(v, begin);
    }
    // rifts that open (in the window, if one is given) may be heralded by a plume
    const [rHi, rLo] = opts.window ? [hi, lo] : [start, -Infinity];
    for (const rf of P.features.filter((f) => f.kind === 'rift' && (f.begin ?? start) < Math.min(start, rHi + 1e-9) && (f.begin ?? start) > rLo && f.left && f.right)) {
      if (r() > 0.6) continue;
      const age = Math.min(start, rHi, Math.round((rf.begin ?? start) + U(1, 8)));
      const v = Q.rotate(m.absolute(rf.plateId, age), S.vec(rf.coords[Math.floor(rf.coords.length / 2)]));
      out.push({ id: `h${++nh}`, kind: 'hotspot', plateId: 0, name: `Hotspot ${nh}`, coords: [fix4(S.latLon(v))], begin: age, end: Math.max(1, Math.round(age - U(60, 200))), auto: true });
      lipAt(v, age, `LIP ${nl + 1} (${rf.name})`);
    }
    return out;
  }

  /*
   * Log 19 (as we read it): a hotspot's track, the chain of volcanoes it leaves on the plates moving
   * over it, as seen at `age`: for every `step` Myr since it began (back to `span` Myr), the point
   * above the plume, carried on the plate it lay on (the continent there, or the one whose ocean floor
   * it was, taken as the nearest within 15°). Returns [{age, at: [lat, lon]}], youngest first.
   */
  function hotspotTrack(P, m, h, age, opts = {}) {
    const start = P.start ?? 1000, step = opts.step ?? 5, span = opts.span ?? 150, v = S.vec(h.coords[0]);
    const from = Math.min(h.begin ?? start, age + span), to = Math.max(age, h.end ?? 0), out = [];
    const cache = opts.cache || new Map();
    for (let a = Math.floor(to / step) * step; a <= from; a += step) {
      if (a < to) continue;
      if (!cache.has(a)) cache.set(a, coastsAt(P, m, a));
      const co = cache.get(a);
      let host = [...co.values()].find((e) => e.pieces.some((p) => p.inside(v)));
      if (!host) host = [...co.values()].map((e) => [Math.min(...e.pts.map((t) => angle(v, t))), e]).filter(([d]) => d < 15).sort((x, y) => x[0] - y[0])[0]?.[1];
      if (!host) continue;
      const q = Q.mul(m.absolute(host.plateId, age), Q.inverse(m.absolute(host.plateId, a)));
      out.push({ age: a, plateId: host.plateId, at: S.latLon(Q.rotate(q, v)) });
    }
    return out;
  }

  /*
   * Rifts along every contact between plates that are about to part (a breakup of an assembled
   * supercontinent: new rifts form close to the old sutures). Each in its left plate's frame.
   */
  function riftContacts(P, age, opts = {}) {
    const start = P.start ?? 1000, m = Q.model(P.plates, start), co = coastsAt(P, m, age), ids = [...co.keys()], out = [];
    let n = P.features.filter((f) => f.kind === 'rift').length;
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
      const A = co.get(ids[i]), B = co.get(ids[j]);
      if (!touching(A, B, 1.5)) continue;
      const near = Math.cos(2 * D2R);
      const line = chain(A.pieces.flatMap((p) => p.coast).filter((s) => B.pts.some((t) => dot(s, t) > near) || B.pieces.some((q) => q.inside(s))));
      if (line.length < 3) continue;
      const mid = Math.floor(line.length / 2), nx = Math.min(line.length - 1, mid + 1), m0 = nx === mid ? mid - 1 : mid;
      const nn = norm(cross(line[m0], [line[nx][0] - line[m0][0], line[nx][1] - line[m0][1], line[nx][2] - line[m0][2]]));
      const probe = norm(line[m0].map((x, k) => x + 0.03 * nn[k]));
      const leftIsA = A.pieces.some((p) => p.inside(probe)) || !B.pieces.some((p) => p.inside(probe));
      const left = leftIsA ? A.plateId : B.plateId, right = leftIsA ? B.plateId : A.plateId;
      const back = Q.inverse(m.absolute(left, age));
      out.push({ id: `c${left}-${right}-${Math.round(age)}`, kind: 'rift', plateId: left, left, right, name: `Rift ${++n}`, coords: line.map((v) => fix4(S.latLon(Q.rotate(back, v)))), begin: +age.toFixed(3), auto: true });
    }
    void opts;
    return out;
  }

  /*
   * The breakup of an assembled supercontinent at an age. Of the contacts between its plates, only
   * some rift (the rest stay welded, their old mountains inland). A rift does not follow the old
   * suture but runs a few degrees inside the plate that leaves, so a sliver of it stays welded to the
   * other with the suture and its mountains between them (as Avalonia with North America, the
   * Appalachians inland). Returns {P, keep: pairs that stay welded, events}.
   */
  function breakup(P, age, opts = {}) {
    const start = P.start ?? 1000, m = Q.model(P.plates, start), co = coastsAt(P, m, age), ids = [...co.keys()];
    const r = rng((((Number.isFinite(opts.seed) ? opts.seed : 1) ^ 0xb7ea) + Math.round(age)) >>> 0), U = (a, b) => a + (b - a) * r();
    const area = (id) => P.features.filter((f) => f.kind === 'crust' && f.plateId === id).reduce((sum, f) => sum + S.areaFraction(f.coords), 0);
    const pairs = [];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) if (touching(co.get(ids[i]), co.get(ids[j]), 3)) pairs.push([ids[i], ids[j]]);   // welded blocks keep a small gap
    for (let i = pairs.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [pairs[i], pairs[j]] = [pairs[j], pairs[i]]; }
    const nRift = pairs.length ? Math.max(1, Math.round(pairs.length * U(0.35, 0.6))) : 0;
    const keep = pairs.slice(nRift), events = [];
    let Q2 = P, n = P.features.filter((f) => f.kind === 'rift').length;
    for (const [a, b] of pairs.slice(0, nRift)) {
      const stay = area(a) >= area(b) ? a : b, go = stay === a ? b : a;
      const A = co.get(stay), B = co.get(go), near = Math.cos(2 * D2R);
      const contact = chain(A.pieces.flatMap((q) => q.coast).filter((v) => B.pts.some((t) => dot(v, t) > near) || B.pieces.some((q) => q.inside(v))));
      let done = false;
      if (contact.length >= 3) {
        // the new rift: the contact moved some degrees into the leaving plate, smoothed, run on past both ends
        const d = U(2.5, 6), cB = B.c;
        const moved = contact.map((v) => { const t = norm(cB.map((x, k) => x - dot(cB, v) * v[k])); return norm(v.map((x, k) => Math.cos(d * D2R) * x + Math.sin(d * D2R) * t[k])); });
        const sm = moved.map((_, i) => norm(moved.slice(Math.max(0, i - 2), i + 3).reduce((acc, w) => acc.map((x, k) => x + w[k]), [0, 0, 0])));
        const back = Q.inverse(m.absolute(go, age));
        const piece0 = P.features.filter((f) => f.kind === 'crust' && f.plateId === go && (f.begin ?? start) >= age).sort((x, y) => S.areaFraction(y.coords) - S.areaFraction(x.coords))[0];
        const inPiece = piece0 ? S.within(piece0.coords) : () => false;
        // run on past each end, straight on, until out of the leaving plate's crust
        const ext = (p, q) => {
          const dir = norm(p.map((x, k) => x - dot(p, q) * q[k])), pts = [];
          for (let st = 1; st <= 20; st++) {
            const v = norm(p.map((x, k) => Math.cos(st * 3 * D2R) * x + Math.sin(st * 3 * D2R) * dir[k]));
            pts.push(v);
            if (!inPiece(Q.rotate(back, v))) { pts.push(norm(p.map((x, k) => Math.cos((st + 1) * 3 * D2R) * x + Math.sin((st + 1) * 3 * D2R) * dir[k]))); break; }
          }
          return pts;
        };
        const head = ext(sm[0], sm[1]).reverse(), tail = ext(sm[sm.length - 1], sm[sm.length - 2]);
        const lineLL = [...head, ...sm, ...tail].map((v) => S.latLon(Q.rotate(back, v)));
        const piece = P.features.filter((f) => f.kind === 'crust' && f.plateId === go && (f.begin ?? start) >= age).sort((x, y) => S.areaFraction(y.coords) - S.areaFraction(x.coords))[0];
        // a point of the leaving plate between the contact and the new rift: the sliver's side
        const cm = contact[Math.floor(contact.length / 2)], tm = norm(cB.map((x, k) => x - dot(cB, cm) * cm[k]));
        const probe = S.latLon(Q.rotate(back, norm(cm.map((x, k) => Math.cos(d * 0.4 * D2R) * x + Math.sin(d * 0.4 * D2R) * tm[k]))));
        const res = piece && splitWith(Q2, age, Q2.features.find((f) => f.id === piece.id) || piece, lineLL, (parts, sizes) => {
          const i = S.within(parts[0])(S.vec(probe)) ? 0 : S.within(parts[1])(S.vec(probe)) ? 1 : null;
          if (i === null) return null;
          const share = sizes[i] / (sizes[0] + sizes[1]);
          return share > 0.01 && share < 0.45 ? i : null;
        }, { name: `Rift ${++n}`, auto: true });
        if (res) {
          Q2 = { ...Q2, ...res };
          keep.push([stay, res.nextPlate - 1]);                      // the sliver stays with the other side
          events.push({ age, kind: 'rift', how: 'sliver', a: go, b: res.nextPlate - 1 });
          done = true;
        }
      }
      if (!done && contact.length >= 3) {                           // otherwise along the contact itself
        const mid = Math.floor(contact.length / 2), nx = Math.min(contact.length - 1, mid + 1), m0 = nx === mid ? mid - 1 : mid;
        const nn = norm(cross(contact[m0], [contact[nx][0] - contact[m0][0], contact[nx][1] - contact[m0][1], contact[nx][2] - contact[m0][2]]));
        const probe = norm(contact[m0].map((x, k) => x + 0.03 * nn[k]));
        const leftIsA = A.pieces.some((q) => q.inside(probe)) || !B.pieces.some((q) => q.inside(probe));
        const left = leftIsA ? stay : go, right = leftIsA ? go : stay, back = Q.inverse(m.absolute(left, age));
        Q2 = { ...Q2, features: Q2.features.concat([{ id: `c${left}-${right}-${Math.round(age)}`, kind: 'rift', plateId: left, left, right, name: `Rift ${++n}`, coords: contact.map((v) => fix4(S.latLon(Q.rotate(back, v)))), begin: +age.toFixed(3), auto: true }]) };
        events.push({ age, kind: 'rift', how: 'contact', a: left, b: right });
      }
    }
    return { P: Q2, keep, events };
  }

  /*
   * The whole history at once, Logs 10-19: a supercontinent, its breakup, a second rift, a
   * microcontinent, wandering, a gathering with collisions, a long-lived supercontinent, then the
   * modern breakup to the present; then the subduction zones and island arcs, accretions and
   * collisions, the mountain belts, hotspots and LIPs. The end state at 0 Ma is ready to draw on.
   * opts: seed, plates (3-5), crust, start (Ma), maxSpeed, radiusKm, gravity, scaling. Returns {plates, features,
   * nextPlate, start, step, seed, events}.
   */
  function makeWorld(opts = {}) {
    const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : (Math.random() * 2 ** 31) | 0;
    const start = clamp(Math.round(opts.start ?? 1000), 300, 4000), R = opts.radiusKm ?? 6371, speed = opts.maxSpeed ?? 4;
    const r = rng((seed ^ 0x7e57) >>> 0), U = (a, b) => a + (b - a) * r();
    const g = generate({ seed, plates: opts.plates ?? 4, crust: opts.crust ?? 0.33 });
    let P = { plates: g.plates, features: g.features, nextPlate: g.nextPlate, start, step: 10, seed };
    const events = [];
    const at = (f) => Math.round((start * f) / 5) * 5;                  // ages as fractions of the history
    // when things happen varies with the seed
    const f1 = 0.8 + 0.1 * r(), f2 = f1 - 0.07 - 0.07 * r(), f3 = f2 - 0.09 - 0.08 * r(), f4 = f3 - 0.1 - 0.08 * r();
    const run = (mode, from, to, extra = {}) => {
      if (from <= to) return from;
      const res = simulate(P, { seed: seed + from, mode, from, duration: from - to, interval: 25, minSpeed: Math.min(1.5, speed), maxSpeed: speed, radiusKm: R, ...extra });
      P = { ...P, plates: res.plates };
      events.push(...res.welds.map((w) => ({ ...w, kind: 'weld' })));
      return res.end;
    };
    const split = (res, what, age) => { if (res) { P = { ...P, ...res }; events.push({ age, kind: what, a: res.rift.plateId, b: res.nextPlate - 1 }); } };
    // the first breakup (Log 11)
    run('apart', start, at(f1));
    // a second rifting event (Logs 12-13)
    split(secondRift(P, at(f1), { seed: seed + 1 }), 'rift', at(f1));
    run('apart', at(f1), at(f2));
    // a microcontinent or two (Log 14), and the continents wander
    split(microcontinent(P, at(f2), { seed: seed + 2, radiusKm: R }), 'microcontinent', at(f2));
    if (r() < 0.5) { const fm = (f2 + f3) / 2; run('wander', at(f2), at(fm)); split(microcontinent(P, at(fm), { seed: seed + 5, radiusKm: R }), 'microcontinent', at(fm)); run('wander', at(fm), at(f3)); }
    else run('wander', at(f2), at(f3));
    // they come together again: arcs and continents collide (Logs 15-16)
    let gathered = run('together', at(f3), Math.max(at(Math.max(0.25, f4)), 0));
    // the supercontinent holds a while, then the modern breakup: rifts near the old sutures
    const split2 = Math.max(Math.min(gathered, at(0.2 + 0.08 * r())), 0);
    gathered = run('wander', gathered, split2);
    if (split2 > 0) {
      const bu = breakup(P, split2, { seed: seed + 3 });
      P = bu.P; events.push(...bu.events);
      // the parts drift apart, then some meet again in the last stretch (India and Asia, Africa and
      // Europe): young, high collision ranges
      const late = Math.min(split2 - 20, Math.round(U(70, 140)));
      const sep = run('apart', split2, Math.max(0, late), { keep: bu.keep });
      if (sep > 0) {
        // one or two smaller continents run into larger ones: young, high collision ranges
        const m2 = Q.model(P.plates, start), co = coastsAt(P, m2, sep);
        const areaOf = (id) => P.features.filter((f) => f.kind === 'crust' && f.plateId === id).reduce((sum, f) => sum + S.areaFraction(f.coords), 0);
        const blocks = [...co.values()].map((e) => ({ id: e.plateId, c: e.c, a: areaOf(e.plateId) })).filter((b) => b.a > 0.004);
        // what is welded to what now (touching, or kept together at the breakup): groups that move as one
        const touches = (x, y) => touching(co.get(x), co.get(y), 3) || bu.keep.some(([p1, p2]) => (p1 === x && p2 === y) || (p1 === y && p2 === x));
        const grp = new Map(blocks.map((b) => [b.id, b.id]));
        const root = (x) => (grp.get(x) === x ? x : root(grp.get(x)));
        for (const x of blocks) for (const y of blocks) if (x.id < y.id && touches(x.id, y.id)) grp.set(root(y.id), root(x.id));
        const groups = [...new Set(blocks.map((b) => root(b.id)))].map((g) => blocks.filter((b) => root(b.id) === g));
        const gArea = (g) => g.reduce((sum, b) => sum + b.a, 0);
        // the smaller groups run at the nearest continent of another group
        const indent = [];
        for (const g of groups.slice().sort((x, y) => gArea(x) - gArea(y))) {
          if (indent.length >= (r() < 0.5 ? 1 : 2) || groups.length < 2 || g === groups.reduce((x, y) => (gArea(y) > gArea(x) ? y : x))) break;   // any but the largest
          const mv = g.slice().sort((x, y) => y.a - x.a)[0];
          const tg = blocks.filter((b) => root(b.id) !== root(mv.id) && !indent.some((x) => x.target === b.id || x.mover === b.id)).sort((x, y) => angle(x.c, mv.c) - angle(y.c, mv.c))[0];
          if (tg && angle(tg.c, mv.c) < 120) indent.push({ mover: mv.id, target: tg.id });
        }
        run(indent.length ? 'indent' : 'together', sep, 0, { indent, keep: bu.keep });
        events.push(...indent.map((x) => ({ age: sep, kind: 'indent', a: x.mover, b: x.target })));
      }
    }
    // the marks (Logs 12, 15-18), the hotspot tracks being drawn from the hotspots (Log 19)
    P = { ...P, features: P.features.concat(markSubduction(P, { seed, every: 50, minPoints: 7, radiusKm: R, to: 0 })) };
    const col = markCollisions(P, { every: 10, contacts: events.filter((e) => e.kind === 'weld') });
    P = { ...P, features: col.features };
    events.push(...col.events);
    P = { ...P, features: withEpisodes(P, R) };
    P = { ...P, features: P.features.concat(markOrogens(P, { seed, radiusKm: R, gravity: opts.gravity, scaling: opts.scaling }), addHotspots(P, { seed })) };
    return { ...P, events: events.sort((a, b) => b.age - a.age) };
  }

  /* The subduction zones of a history, each with what it did (subductionEpisodes), where not yet recorded. */
  function withEpisodes(P, R = 6371, test = () => true) {
    const m = Q.model(P.plates, P.start ?? 1000), cache = new Map();
    return P.features.map((f) => (f.kind === 'subduction' && !f.episodes && test(f) ? { ...f, episodes: subductionEpisodes(P, m, f, R, cache) } : f));
  }

  /*
   * The whole history d Myr older: the start, every rotation pole and every feature's begin, end,
   * active and weld ages, and its episodes' (features' not below 0, the present). What lasts to the present (no end) still does.
   */
  function shiftHistory(P, d) {
    const sh = (x) => (Number.isFinite(x) ? +(x + d).toFixed(3) : x);
    return {
      ...P,
      start: sh(P.start ?? 1000),
      plates: P.plates.map((p) => ({ ...p, rotations: (p.rotations || []).map((q) => ({ ...q, age: sh(q.age) })) })),
      features: P.features.map((f) => {
        const g = { ...f };
        for (const k of ['begin', 'end', 'active', 'weld']) if (Number.isFinite(g[k])) g[k] = Math.max(0, sh(g[k]));
        if (Array.isArray(g.episodes)) g.episodes = g.episodes.map((e) => ({ ...e, from: Math.max(0, sh(e.from)), to: Math.max(0, sh(e.to)) }));
        return g;
      }),
    };
  }

  /*
   * Carry a finished history on: everything moves `duration` Myr into the past, the plates move on
   * from then to the present (mode as in simulate, Wilson cycle included), and the new stretch gets
   * its own marks, as the earlier ones were made: subduction zones and island arcs, collisions and
   * accretions, mountain belts and hotspots (each only if the history has that kind of mark made by
   * a step). The earlier marks keep their shapes; what reached the present stops where the new
   * stretch begins: trenches and arcs, belts still rising, and plumes whose time is up.
   * opts: duration, mode (apart, wander, together, cycle, or breakup: new rifts between the
   * continents that touch, then apart), seed, interval, minSpeed, maxSpeed, radiusKm, gravity, scaling.
   * Returns {plates, features, start, ..., events, welds, phases, end, duration}.
   */
  function advance(P, opts = {}) {
    const D = Math.round(clamp(opts.duration ?? 100, 1, 5000));
    const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : (Math.random() * 2 ** 31) | 0;
    const R = opts.radiusKm ?? 6371, start0 = P.start ?? 1000;
    const r = rng((seed ^ 0xadd0 ^ Math.round(start0 * 31)) >>> 0), U = (a, b) => a + (b - a) * r();
    const hasAuto = (test) => P.features.some((f) => f.auto && test(f));
    const marks = {
      subduction: hasAuto((f) => f.kind === 'subduction' || (f.kind === 'arc' && !f.accreted)),
      collisions: hasAuto((f) => f.kind === 'suture' || f.accreted),
      orogens: hasAuto((f) => f.kind === 'orogen'),
      hotspots: hasAuto((f) => f.kind === 'hotspot' || f.kind === 'lip'),
      ...(opts.marks || {}),
    };
    // (in the old ages, before the shift: 0 is the old present, -D the new one)
    const byId = new Map(P.features.map((f) => [f.id, f]));
    const trench = (f) => f.auto && (f.kind === 'subduction' || (f.kind === 'arc' && !f.accreted));
    // trenches and arcs that only began at the old present would stop as they start: the new stretch makes its own
    const gone = new Set(P.features.filter((f) => trench(f) && f.end == null && (f.begin ?? start0) <= 1e-9).map((f) => f.id));
    const before = P.features.filter((f) => !gone.has(f.id) && !(f.auto && f.kind === 'orogen' && gone.has(f.id.slice(1)))).map((f) => {
      if (!f.auto) return f;
      if (trench(f) && f.end == null) return { ...f, end: 0 };
      if (f.kind === 'hotspot' && f.end == null) {
        const end = Math.round((f.begin ?? start0) - U(80, 400));
        return end > -D ? { ...f, end } : f;
      }
      if (f.kind === 'orogen' && !(f.active > 0)) {
        if (f.type === 'cordillera') {
          const src = byId.get(f.id.slice(1));
          return src && !src.auto && src.end == null ? { ...f, active: undefined } : { ...f, active: 0 };
        }
        // a collision still closing at the old present welds there (the new stretch starts them as one
        // block); an accreted arc stopped when it was accreted
        return { ...f, active: f.type === 'accretion' ? Math.max(0, f.begin ?? 0) : 0 };
      }
      return f;
    });
    let Q2 = shiftHistory({ ...P, features: before }, D);
    const events = [];

    // the plates move on; 'breakup' first rifts the continents that touch (near their old sutures)
    const interval = clamp(opts.interval ?? 20, 1, D);
    let mode = opts.mode || 'wander', keep;
    if (mode === 'breakup') {
      const bu = breakup(Q2, D, { seed: seed + Q2.start });
      Q2 = bu.P; keep = bu.keep; mode = 'apart';
      events.push(...bu.events);
    }
    const sim = simulate(Q2, { seed: seed + Q2.start, mode, from: D, duration: D, interval, minSpeed: opts.minSpeed ?? 1.5, maxSpeed: opts.maxSpeed ?? 4, radiusKm: R, ...(keep ? { keep } : {}) });
    Q2 = { ...Q2, plates: sim.plates };
    events.push(...sim.welds.map((w) => ({ ...w, kind: 'weld' })));

    // the marks of the new stretch
    const ids = new Set(Q2.features.map((f) => f.id));
    const fresh = (list) => list.map((f) => { let id = f.id; while (ids.has(id)) id = `${id}+`; ids.add(id); return id === f.id ? f : { ...f, id }; });
    if (marks.subduction) {
      const every = Math.min(25, Math.max(5, Math.round(D / 2)));
      Q2 = { ...Q2, features: Q2.features.concat(fresh(markSubduction(Q2, { seed: seed + Q2.start, every, minPoints: 7, radiusKm: R, from: D, to: 0 }))) };
    }
    if (marks.collisions) {
      const col = markCollisions(Q2, { every: Math.min(10, D), from: D, contacts: sim.welds }), n0 = Q2.features.length;
      Q2 = { ...Q2, features: col.features.slice(0, n0).concat(fresh(col.features.slice(n0))) };
      events.push(...col.events);
    }
    // new trenches closed by a collision the moment they began never were
    Q2 = { ...Q2, features: Q2.features.filter((f) => !(trench(f) && (f.begin ?? Q2.start) <= D + 1e-9 && f.end != null && f.end >= (f.begin ?? Q2.start) - 1e-9)) };
    Q2 = { ...Q2, features: withEpisodes(Q2, R, (f) => (f.begin ?? Q2.start) <= D + 1e-9) };
    if (marks.orogens) {
      const cause = (f) => f.kind === 'subduction' || f.kind === 'suture' || (f.kind === 'arc' && f.accreted);
      const made = markOrogens({ ...Q2, features: Q2.features.filter((f) => !cause(f) || (f.begin ?? Q2.start) <= D + 1e-9) }, { seed: seed + Q2.start, radiusKm: R, gravity: opts.gravity, scaling: opts.scaling });
      Q2 = { ...Q2, features: Q2.features.concat(fresh(made)) };
    }
    if (marks.hotspots) Q2 = { ...Q2, features: Q2.features.concat(fresh(addHotspots(Q2, { seed: seed + Q2.start, window: [D, 0] }))) };
    return { ...Q2, events: events.sort((a, b) => b.age - a.age), welds: sim.welds, phases: sim.phases, end: sim.end, duration: D };
  }

  const api = { generate, simulate, leadingCoasts, markSubduction, subductionEpisodes, floorAt, weldOf, withEpisodes, secondRift, divideLines, microcontinent, markCollisions, markOrogens, addHotspots, hotspotTrack, riftContacts, breakup, makeWorld, shiftHistory, advance };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.supercontinent = api; }
})(typeof window !== 'undefined' ? window : globalThis);
