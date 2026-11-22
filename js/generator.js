/*
 * "Roll a world": a random star system that stays inside the method's
 * Earth-like guidance, as a starting point for new users.
 */
(function (root) {
  'use strict';
  const WS = (root.WS = root.WS || {});

  const SYL_A = ['ka', 've', 'lo', 'ra', 'thi', 'mor', 'an', 'sel', 'du', 'qua', 'ny', 'ori', 'zen', 'bal', 'tes', 'ul', 'ima', 'cor', 'ash', 'eri'];
  const SYL_B = ['n', 'th', 'ra', 'lis', 'dor', 'mae', 'x', 'ria', 'on', 'us', 'el', 'ka', 'ten', 'is', 'ar', 'yn', 'os', 'ae', 'ith', 'em'];

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  function randomWorld(seed = (Math.random() * 2 ** 31) | 0) {
    const r = rng(seed);
    const U = (a, b) => a + (b - a) * r();
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const name = () => { const n = pick(SYL_A) + (r() < 0.6 ? pick(SYL_A) : '') + pick(SYL_B); return n[0].toUpperCase() + n.slice(1); };
    const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
    const C = WS.calc;

    const w = WS.data.defaultWorld(`${name()} System`);
    w.galaxy.seed = 1 + Math.floor(r() * 2e9);
    w.galaxy.location = Math.round(U(0.49, 0.58) * w.galaxy.radius);
    w.star.name = name();
    w.star.mass = round(U(0.65, 1.3), 2);
    const st = C.star(w.star);
    w.star.age = round(U(3.6, Math.min(st.maxAge * 0.85, 9)), 1);

    // Orbits: pick spacing, then nudge the first orbit so one lands mid-HZ.
    w.system.spacing = round(U(0.22, 0.4), 2);
    const hzMid = (st.hzIn + st.hzOut) / 2;
    const k = Math.max(0, Math.round(Math.log2(Math.max(1e-3, (hzMid - 0.3 * Math.sqrt(st.luminosity)) / w.system.spacing)) + 1));
    let first = hzMid - (k === 0 ? 0 : w.system.spacing * 2 ** (k - 1));
    if (first < 0.08) first = hzMid; // the home world becomes orbit 1
    w.system.firstOrbit = round(first, 3);
    let sys = C.system(w.system, st);
    const fits = (o) => o.a > st.hzIn * 1.03 && o.a < st.hzOut * 0.97 && !o.crowded;
    if (!sys.orbits.some(fits)) { w.system.firstOrbit = round(hzMid, 3); sys = C.system(w.system, st); }
    const homeOrbit = sys.orbits.find(fits) || null;

    w.planet.name = name();
    w.planet.a = homeOrbit ? round(homeOrbit.a, 3) : round(U(st.hzIn * 1.05, st.hzOut * 0.95), 3);
    w.planet.mass = round(U(0.6, 1.8), 2);
    w.planet.cmf = round(U(26, 38), 1);
    w.planet.tilt = round(U(8, 32), 1);
    w.planet.rotation = round(U(16, 36), 1);
    const eMax = Math.max(0, Math.min(1 - st.hzIn / w.planet.a, st.hzOut / w.planet.a - 1)) * 0.8;
    w.planet.e = round(U(0, Math.min(0.04, eMax)), 4);
    w.planet.lonPeriapsis = Math.round(U(0, 360));
    w.planet.albedo = round(U(0.27, 0.33), 2);
    w.planet.o2 = round(U(17, 26), 2);
    const pr = C.pressureRangeForO2(w.planet.o2);
    w.planet.pressure = round(U(Math.max(pr[0], 0.16 / (w.planet.o2 / 100)) * 1.05, Math.min(pr[1], 0.5 / (w.planet.o2 / 100)) * 0.9), 2);

    // Bodies on the computed orbits.
    const bodies = [];
    const fb = sys.firstBeyondFrost;
    sys.orbits.forEach((o, i) => {
      if (o.a > 60 || o.crowded || o.insideLimit) return;
      if (homeOrbit && o.n === homeOrbit.n) return;
      let kind = null;
      if (i === fb) kind = 'gas';
      else if (i === fb - 1) kind = r() < 0.7 ? 'belt' : null;
      else if (i < fb) kind = r() < 0.65 ? 'terrestrial' : null;
      else kind = r() < 0.8 ? (r() < 0.55 ? 'gas' : 'ice') : null;
      if (!kind) return;
      const b = WS.data.blankBody(kind, round(o.a, 3));
      b.name = kind === 'belt' ? `${name()} Belt` : name();
      if (kind === 'terrestrial') { b.radius = round(U(0.3, 1.3), 3); b.atmosphere = r() < 0.6; b.albedo = round(U(0.1, 0.6), 3); }
      if (kind === 'gas') { b.radius = round(U(6, 12), 2); b.albedo = round(U(0.4, 0.55), 3); }
      if (kind === 'ice') { b.radius = round(U(3, 5), 2); b.albedo = round(U(0.4, 0.5), 3); }
      const dMin = Math.abs(b.a - w.planet.a), dMax = b.a + w.planet.a;
      b.distance = round(U(dMin, dMax), 3);
      bodies.push(b);
    });
    w.system.bodies = bodies;
    const giants = bodies.filter((b) => b.kind === 'gas' || b.kind === 'ice');
    if (giants.length) w.system.outerGasGiant = giants[giants.length - 1].a;

    const pl = C.planet(w.planet, st);
    w.moon.name = name();
    w.moon.mass = round(U(0.4, 2.2), 2);
    const mz = C.moon(w.moon, w.planet, pl, st);
    w.moon.a = Math.round(U(Math.max(mz.zoneIn * 6, pl.radiusKm * 25), mz.zoneOut / 2 * 0.45));
    // keep the planet from locking to its moon within a few billion years (lock time ∝ a⁶)
    const lock = C.moon(w.moon, w.planet, pl, st).tPlanetMoon;
    if (lock < 2) w.moon.a = Math.round(Math.min(w.moon.a * (2.5 / lock) ** (1 / 6), (mz.zoneOut / 2) * 0.85));
    w.moon.e = round(U(0.005, 0.06), 3);
    w.moon.inclination = round(U(0, 8), 2);

    // mountain range sized to this gravity: midpoints of the suggested ranges
    const mr = C.mountainRange({ type: 'Andean', heights: [], widths: [], erosion: 0, age: 0 }, pl.gravity, w.tectonics.scaling);
    const mid = (r) => (r.min !== undefined ? Math.round((r.min + r.max) / 20) * 10 : null);
    Object.assign(w.tectonics.ranges[0], {
      heights: mr.features.map((f) => mid(f.heightRange)),
      widths: mr.features.map((f) => mid(f.widthRange)),
    });

    w.calendar.linked = true;
    w.galaxy.name = 'The Galaxy';
    return w;
  }

  WS.generate = { randomWorld };
})(typeof window !== 'undefined' ? window : globalThis);
