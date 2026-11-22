/*
 * Plate rotations as GPlates models them.
 *
 * Each plate has a rotation sequence: total rotations at given ages (Ma) relative to a fixed plate
 * (0 = the reference frame). A total rotation (pole lat, lon, angle in degrees, right-handed about
 * the pole, as in GPlates .rot files) carries the plate's reference geometry to where it is at that
 * age. Between samples the rotation is interpolated by spherical linear interpolation of unit
 * quaternions, the shorter way round; outside the samples the nearest one holds. A plate's absolute
 * rotation is its fixed plate's absolute rotation followed by its own:  R_abs = R_fixed ∘ R_rel.
 *
 * Here the reference geometry is the supercontinent as drawn, so every plate's rotation at the
 * start age is the identity. Pure functions: runs in the page and in Node.
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const vec = ([lat, lon]) => { const p = lat * D2R, l = lon * D2R; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; };
  const latLon = ([x, y, z]) => [Math.asin(Math.max(-1, Math.min(1, z))) * R2D, Math.atan2(y, x) * R2D];

  // quaternions as [w, x, y, z]
  const IDENTITY = [1, 0, 0, 0];
  function fromPole(lat, lon, angleDeg) {
    const a = vec([lat, lon]), h = (angleDeg * D2R) / 2, s = Math.sin(h);
    return [Math.cos(h), a[0] * s, a[1] * s, a[2] * s];
  }
  function fromAxisAngle(axis, angleRad) {
    const l = Math.hypot(...axis) || 1, h = angleRad / 2, s = Math.sin(h) / l;
    return [Math.cos(h), axis[0] * s, axis[1] * s, axis[2] * s];
  }
  function mul(a, b) { // a ∘ b: first b, then a
    return [
      a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
      a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
      a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
      a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
    ];
  }
  const inverse = (q) => [q[0], -q[1], -q[2], -q[3]];
  function normalise(q) { const l = Math.hypot(...q) || 1; return q.map((v) => v / l); }
  function rotate(q, v) {
    const p = mul(mul(q, [0, v[0], v[1], v[2]]), inverse(q));
    return [p[1], p[2], p[3]];
  }
  const rotatePoint = (q, p) => latLon(rotate(q, vec(p)));
  function slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map((v) => -v); d = -d; }
    if (d > 0.9995) return normalise(a.map((v, i) => v + (b[i] - v) * t));
    const th = Math.acos(d), s = Math.sin(th);
    return a.map((v, i) => (v * Math.sin((1 - t) * th) + b[i] * Math.sin(t * th)) / s);
  }
  /* Pole (lat, lon) and angle in degrees of a rotation; the angle kept in (-180, 180], pole on the + side. */
  function toPole(q) {
    let [w, x, y, z] = normalise(q);
    if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
    const s = Math.hypot(x, y, z);
    if (s < 1e-12) return { lat: 90, lon: 0, angle: 0 };
    const [lat, lon] = latLon([x / s, y / s, z / s]);
    return { lat, lon, angle: 2 * Math.atan2(s, w) * R2D };
  }
  const angleOf = (q) => toPole(q).angle;

  /* Interpolated relative rotation of a sequence of samples [{age, lat, lon, angle}] at an age. */
  function sampleAt(samples, age) {
    if (!samples || !samples.length) return IDENTITY;
    const s = samples.slice().sort((a, b) => a.age - b.age);   // young → old
    const q = (k) => fromPole(k.lat, k.lon, k.angle);
    if (age <= s[0].age) return q(s[0]);
    if (age >= s[s.length - 1].age) return q(s[s.length - 1]);
    for (let i = 1; i < s.length; i++) {
      if (age <= s[i].age) {
        const t = (age - s[i - 1].age) / (s[i].age - s[i - 1].age);
        return slerp(q(s[i - 1]), q(s[i]), t);
      }
    }
    return IDENTITY;
  }

  /*
   * A rotation model over the plates [{id, fixed, rotations: [{age, lat, lon, angle}]}], with the
   * identity at `start` for every plate (the supercontinent as drawn).
   */
  function model(plates, start) {
    const byId = new Map(plates.map((p) => [p.id, p]));
    const cache = new Map();
    const samplesOf = (p) => {
      const r = (p.rotations || []).filter((k) => k.age !== start);
      return [...r, { age: start, lat: 90, lon: 0, angle: 0 }];
    };
    function absolute(id, age, depth = 0) {
      if (!id || depth > 50) return IDENTITY;
      const key = `${id}@${age}`;
      if (cache.has(key)) return cache.get(key);
      const p = byId.get(id);
      if (!p) return IDENTITY;
      const rel = sampleAt(samplesOf(p), age);
      const out = mul(absolute(p.fixed || 0, age, depth + 1), rel);
      cache.set(key, out);
      return out;
    }
    return {
      absolute,
      relative: (id, age) => { const p = byId.get(id); return p ? sampleAt(samplesOf(p), age) : IDENTITY; },
      reconstruct: (id, coords, age) => { const q = absolute(id, age); return coords.map((c) => rotatePoint(q, c)); },
      /* back from the position at `age` to the reference geometry */
      unreconstruct: (id, coords, age) => { const q = inverse(absolute(id, age)); return coords.map((c) => rotatePoint(q, c)); },
    };
  }

  /*
   * Stage rotation of a plate between two ages (from the older t0 to the younger t1), in the
   * reference frame: S = R(t1) ∘ R(t0)⁻¹. Its angle over the time is the plate's angular speed.
   */
  function stage(m, id, t0, t1) { return mul(m.absolute(id, t1), inverse(m.absolute(id, t0))); }

  /*
   * Speed of a plate (cm/yr) between ages t0 > t1, measured at a point of the plate (its centroid
   * at t0) on a planet of radius R km: 1 km/Myr = 0.1 cm/yr.
   */
  function speed(m, id, point, t0, t1, radiusKm) {
    const dt = Math.abs(t0 - t1);
    if (dt <= 0) return 0;
    const p0 = vec(rotatePoint(m.absolute(id, t0), point)), p1 = vec(rotatePoint(m.absolute(id, t1), point));
    const ang = Math.atan2(Math.hypot(p0[1] * p1[2] - p0[2] * p1[1], p0[2] * p1[0] - p0[0] * p1[2], p0[0] * p1[1] - p0[1] * p1[0]), p0[0] * p1[0] + p0[1] * p1[1] + p0[2] * p1[2]);
    return (ang * radiusKm / dt) * 0.1;
  }

  /*
   * Seafloor spreading between two plates on either side of a rift (GPlates' flowlines and
   * half-stage ridge): the ridge moves with the average of the two plates' motions (half of their
   * relative stage rotation, in small steps), and the crust it makes is carried away on both plates.
   * Returns, for the ages from `start` down to `age` in `step` Myr:
   *   ridge     the ridge line at `age`
   *   isochrons [{age, left, right}]: the line of crust of that age, on each flank, at `age`
   *   flowlines [{seed, left, right}]: for each seed point, the track of crust on each flank
   */
  function spreading(m, rift, leftId, rightId, start, age, step = 10) {
    if (age >= start || rift.length < 2) return { ridge: rift, isochrons: [], flowlines: [] };
    const ages = [];
    for (let a = start; a > age; a -= step) ages.push(a);
    ages.push(age);
    // the ridge at each age, in the reference frame of the left plate, advanced by half-stages
    let ridgeL = rift.map(vec);                         // ridge points, in the left plate's reference frame
    const iso = [];
    for (let k = 1; k < ages.length; k++) {
      const a0 = ages[k - 1], a1 = ages[k];
      // motion of right relative to left over [a0, a1], in left's reference frame
      const L0 = m.absolute(leftId, a0), L1 = m.absolute(leftId, a1), R0 = m.absolute(rightId, a0), R1 = m.absolute(rightId, a1);
      const relR0 = mul(inverse(L0), R0), relR1 = mul(inverse(L1), R1);
      const st = mul(relR1, inverse(relR0));              // stage of right w.r.t. left, in left's frame
      const half = slerp(IDENTITY, st, 0.5);
      ridgeL = ridgeL.map((v) => rotate(half, v));
      iso.push({ age: a1, ridgeL: ridgeL.slice(), stageAcc: null });
    }
    // carry each isochron (made at its age on the ridge) on both plates to `age`
    const Lnow = m.absolute(leftId, age), Rnow = m.absolute(rightId, age);
    const isochrons = [];
    let ridgeNow = rift;
    for (const it of iso) {
      // on the left flank: crust stays on the left plate, so its left-frame position is fixed
      const left = it.ridgeL.map((v) => latLon(rotate(Lnow, v)));
      // on the right flank: the same crust, carried by the right plate from then to now
      const L = m.absolute(leftId, it.age), R = m.absolute(rightId, it.age);
      const toRight = mul(inverse(R), L);                 // left-frame → right-frame at that age
      const right = it.ridgeL.map((v) => latLon(rotate(mul(Rnow, toRight), v)));
      isochrons.push({ age: it.age, left, right });
      if (it.age === age) ridgeNow = left;
    }
    const flowlines = rift.map((seed, i) => ({ seed, left: isochrons.map((c) => c.left[i]), right: isochrons.map((c) => c.right[i]) }));
    // the original rift edge, as it now lies on each plate
    const edgeL = rift.map((p) => rotatePoint(Lnow, p)), edgeR = rift.map((p) => rotatePoint(Rnow, p));
    return { ridge: ridgeNow, isochrons, flowlines, edgeL, edgeR };
  }

  const api = { IDENTITY, fromPole, fromAxisAngle, mul, inverse, rotate, rotatePoint, slerp, toPole, angleOf, sampleAt, model, stage, speed, spreading, vec, latLon };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.rotation = api; }
})(typeof window !== 'undefined' ? window : globalThis);
