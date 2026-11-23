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

  const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /*
   * Lay out the planetary system around the world's current star: orbit 1 and
   * the spacing are chosen so a stable orbit falls inside the habitable zone,
   * the home world moves onto it, and the other bodies fill the remaining
   * orbits (terrestrials inside the frost line, the largest giant on the first
   * orbit past it, often a belt just inside). Changes w.system and w.planet.a
   * (and w.planet.e, trimmed so the orbit stays inside the zone).
   * keepNames: names to reuse, by kind, before rolling new ones.
   */
  function layoutSystem(w, st, r, name, keepNames = {}) {
    const C = WS.calc;
    const U = (a, b) => a + (b - a) * r();
    const pool = {};
    Object.keys(keepNames).forEach((k) => { pool[k] = keepNames[k].slice(); });
    const nameFor = (kind) => (pool[kind] && pool[kind].length ? pool[kind].shift() : kind === 'belt' ? `${name()} Belt` : name());

    // Orbits: pick spacing, then nudge the first orbit so one lands mid-HZ.
    // aim for the orbit where this planet (its albedo and greenhouse) is about as warm as Earth,
    // 15 °C: Earth-like sunlight, near the inner part of the zone (its middle is some 20 °C colder)
    const T1 = C.surfaceTemperature(st.luminosity, Math.sqrt(st.luminosity), w.planet.albedo ?? 0.29, w.planet.greenhouse ?? 1).kelvin;
    const hzMid = clamp(Math.sqrt(st.luminosity) * (T1 / 288) ** 2, st.hzIn * 1.04, st.hzOut * 0.96);
    const fits = (o) => o.a > st.hzIn * 1.03 && o.a < st.hzOut * 0.97 && !o.crowded && !o.insideLimit;
    const nearest = (orbits) => orbits.filter(fits).sort((x, y) => Math.abs(x.a - hzMid) - Math.abs(y.a - hzMid))[0] || null;
    let sys = null, homeOrbit = null;
    for (let attempt = 0; attempt < 8 && !homeOrbit; attempt++) {
      w.system.spacing = round(U(0.22, 0.4), 2);
      const k = Math.max(0, Math.round(Math.log2(Math.max(1e-3, (hzMid - 0.3 * Math.sqrt(st.luminosity)) / w.system.spacing)) + 1));
      let first = hzMid - (k === 0 ? 0 : w.system.spacing * 2 ** (k - 1));
      if (first < 0.08) first = hzMid; // the home world becomes orbit 1
      w.system.firstOrbit = round(first, 3);
      sys = C.system(w.system, st);
      if (!sys.orbits.some(fits)) { w.system.firstOrbit = round(hzMid, 3); sys = C.system(w.system, st); }
      homeOrbit = nearest(sys.orbits);
    }
    if (!homeOrbit) { // a star too small or odd for the rules above: put the home world on orbit 1, mid-zone
      w.system.firstOrbit = Math.max(round(hzMid, 4), 1e-4);
      sys = C.system(w.system, st);
      homeOrbit = sys.orbits[0];
    }

    w.planet.a = round(homeOrbit.a, 4);
    const eMax = Math.max(0, Math.min(1 - st.hzIn / w.planet.a, st.hzOut / w.planet.a - 1)) * 0.8;
    w.planet.e = round(U(0, Math.min(0.04, eMax)), 4);

    // Bodies on the computed orbits.
    const bodies = [];
    const fb = sys.firstBeyondFrost;
    sys.orbits.forEach((o, i) => {
      if (o.a > 60 * Math.max(1, Math.sqrt(st.luminosity)) || o.crowded || o.insideLimit) return;
      if (o.n === homeOrbit.n) return;
      let kind = null;
      if (i === fb) kind = 'gas';
      else if (i === fb - 1) kind = r() < 0.7 ? 'belt' : null;
      else if (i < fb) kind = r() < 0.65 ? 'terrestrial' : null;
      else kind = r() < 0.8 ? (r() < 0.55 ? 'gas' : 'ice') : null;
      if (!kind) return;
      const b = WS.data.blankBody(kind, round(o.a, 4));
      b.name = nameFor(kind);
      if (kind === 'terrestrial') { b.radius = round(U(0.3, 1.3), 3); b.atmosphere = r() < 0.6; b.albedo = round(U(0.1, 0.6), 3); }
      if (kind === 'gas') { b.radius = round(U(6, 12), 2); b.albedo = round(U(0.4, 0.55), 3); }
      if (kind === 'ice') { b.radius = round(U(3, 5), 2); b.albedo = round(U(0.4, 0.5), 3); }
      const dMin = Math.abs(b.a - w.planet.a), dMax = b.a + w.planet.a;
      b.distance = round(U(dMin, dMax), 3);
      bodies.push(b);
    });
    w.system.bodies = bodies;
    const giants = bodies.filter((b) => b.kind === 'gas' || b.kind === 'ice');
    w.system.outerGasGiant = giants.length ? giants[giants.length - 1].a : round(Math.max(st.frostLine * 1.5, w.system.outerGasGiant || 0), 3);
    return w;
  }

  /*
   * A new planetary system around the world's current star, with the home
   * world on a habitable orbit. The star, the planet itself (mass, tilt, air…)
   * and its moon are kept (the eccentricity is trimmed if it would leave the
   * zone, the moon is only drawn in if the new orbit leaves
   * it unbound); body names are reused where the kinds allow.
   * Returns { system, planet: { a, e }, moon?: { a } } to merge into the world.
   */
  function regenerateSystem(world, seed = (Math.random() * 2 ** 31) | 0) {
    const r = rng(seed);
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const name = () => { const n = pick(SYL_A) + (r() < 0.6 ? pick(SYL_A) : '') + pick(SYL_B); return n[0].toUpperCase() + n.slice(1); };
    const st = WS.calc.star(world.star);
    const keepNames = {};
    for (const b of (world.system && world.system.bodies) || []) (keepNames[b.kind] = keepNames[b.kind] || []).push(b.name);
    const w = { system: { ...world.system, bodies: [] }, planet: { ...world.planet } };
    layoutSystem(w, st, r, name, keepNames);
    // keep the planet's own eccentricity unless it would carry it out of the zone
    const a = w.planet.a, eMax = Math.max(0, Math.min(1 - st.hzIn / a, st.hzOut / a - 1)) * 0.8;
    const e0 = Number.isFinite(world.planet.e) ? world.planet.e : 0;
    w.planet.e = e0 <= eMax ? e0 : round(eMax, 4);
    const out = { system: w.system, planet: { a, e: w.planet.e } };
    // A closer orbit or a smaller star shrinks the Hill sphere: bring the moon
    // inside half of it (the long-term stable part) if it now falls outside.
    if (world.moon) {
      const mz = WS.calc.moon(world.moon, w.planet, WS.calc.planet(w.planet, st), st);
      const e = world.moon.e || 0;
      const aMax = (0.45 * mz.zoneOut) / (1 + e), aMin = (mz.zoneIn * 1.5) / (1 - e);
      if (world.moon.a * (1 + e) >= mz.zoneOut / 2 && aMax > aMin) out.moon = { a: Math.round(aMax) };
    }
    return out;
  }

  /** True when the home world orbits inside the star's habitable zone. */
  function homeIsHabitable(world, st = WS.calc.star(world.star)) {
    return world.planet.a >= st.hzIn && world.planet.a <= st.hzOut;
  }

  function randomWorld(seed = (Math.random() * 2 ** 31) | 0) {
    const r = rng(seed);
    const U = (a, b) => a + (b - a) * r();
    const pick = (arr) => arr[Math.floor(r() * arr.length)];
    const name = () => { const n = pick(SYL_A) + (r() < 0.6 ? pick(SYL_A) : '') + pick(SYL_B); return n[0].toUpperCase() + n.slice(1); };
    const C = WS.calc;

    const w = WS.data.defaultWorld(`${name()} System`);
    w.galaxy.seed = 1 + Math.floor(r() * 2e9);
    w.galaxy.location = Math.round(U(0.49, 0.58) * w.galaxy.radius);
    w.star.name = name();
    w.star.mass = round(U(0.65, 1.3), 2);
    const st = C.star(w.star);
    w.star.age = round(U(3.6, Math.min(st.maxAge * 0.85, 9)), 1);

    w.planet.name = name();
    w.planet.mass = round(U(0.6, 1.8), 2);
    w.planet.cmf = round(U(26, 38), 1);
    w.planet.tilt = round(U(8, 32), 1);
    w.planet.rotation = round(U(16, 36), 1);
    w.planet.lonPeriapsis = Math.round(U(0, 360));
    w.planet.albedo = round(U(0.27, 0.33), 2);
    w.planet.o2 = round(U(17, 26), 2);
    const pr = C.pressureRangeForO2(w.planet.o2);
    w.planet.pressure = round(U(Math.max(pr[0], 0.16 / (w.planet.o2 / 100)) * 1.05, Math.min(pr[1], 0.5 / (w.planet.o2 / 100)) * 0.9), 2);
    layoutSystem(w, st, r, name);

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

  WS.generate = { randomWorld, regenerateSystem, homeIsHabitable };
})(typeof window !== 'undefined' ? window : globalThis);
