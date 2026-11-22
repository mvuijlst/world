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
   * Rotation poles for every plate with crust: each drifts away from the middle of the
   * supercontinent at a steady Earth-like speed, its heading wandering a little between poles.
   * The largest plate barely moves (as Africa has barely moved since Pangaea): the others do the
   * travelling, so the new oceans open at Earth-like rates.
   * P: {plates, features, start}. opts: seed, duration (Myr, 100), interval (Myr between poles, 20),
   * minSpeed and maxSpeed (cm/yr, 2 and 6), radiusKm. Returns the plates with new rotations
   * (relative to plate 0); the plates without crust keep theirs.
   */
  function simulate(P, opts = {}) {
    const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : (Math.random() * 2 ** 31) | 0;
    const r = rng(seed ^ 0x5eed), U = (a, b) => a + (b - a) * r();
    const start = P.start ?? 1000, duration = clamp(opts.duration ?? 100, 10, start), interval = clamp(opts.interval ?? 20, 1, duration);
    const vmin = opts.minSpeed ?? 2, vmax = Math.max(vmin, opts.maxSpeed ?? 6), R = opts.radiusKm ?? 6371;
    const shapes = (id) => P.features.filter((f) => (f.kind === 'crust' || f.kind === 'craton') && (id === undefined || f.plateId === id) && f.coords.length >= 3);
    const all = shapes().flatMap((f) => f.coords);
    if (!all.length) return P.plates.map((p) => ({ ...p }));
    const C = S.centroid(all);
    const area = (id) => shapes(id).filter((f) => f.kind === 'crust').reduce((s, f) => s + S.areaFraction(f.coords), 0);
    const anchor = P.plates.map((p) => [area(p.id), p.id]).sort((a, b) => b[0] - a[0])[0][1];
    const ages = [];
    for (let a = start - interval; a > start - duration + 1e-9; a -= interval) ages.push(+a.toFixed(3));
    ages.push(start - duration);
    return P.plates.map((p) => {
      const own = shapes(p.id).flatMap((f) => f.coords);
      if (!own.length) return { ...p };
      const slow = p.id === anchor, c0 = S.centroid(own), v = slow ? U(0.3, 0.9) : U(vmin, vmax);
      let tot = Q.IDENTITY, prev = start, heading = 0;
      const rotations = [];
      for (const age of ages) {
        const c = Q.rotate(tot, c0);
        let axis = cross(C, c);
        if (Math.hypot(...axis) < 0.03) axis = cross(c, Math.abs(c[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]);
        heading = clamp(heading + U(-9, 9), -35, 35);
        axis = Q.rotate(Q.fromAxisAngle(c, heading * D2R), norm(axis));
        const speed = clamp(v * U(0.85, 1.15), slow ? 0.2 : vmin * 0.8, vmax);
        const sinD = Math.max(0.2, Math.hypot(...cross(axis, c)));
        const stage = Q.fromAxisAngle(axis, (speed * 10 * (prev - age)) / R / sinD);   // 1 cm/yr = 10 km/Myr
        tot = Q.mul(stage, tot);
        const pole = Q.toPole(tot);
        rotations.push({ age, lat: +pole.lat.toFixed(4), lon: +pole.lon.toFixed(4), angle: +pole.angle.toFixed(4) });
        prev = age;
      }
      return { ...p, fixed: 0, rotations };
    });
  }

  const api = { generate, simulate };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.supercontinent = api; }
})(typeof window !== 'undefined' ? window : globalThis);
