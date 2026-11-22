/*
 * Where things are: Kepler orbits for every body of the system, the home world's moon, and the
 * sky as seen from a place on a world (altitude and azimuth of the star, planets and moon).
 *
 * Frames. Heliocentric ecliptic: the home world's orbital plane is the reference (z = its orbit
 * normal), x points to the home world's vernal equinox: at t = 0 the star stands at ecliptic
 * longitude 0 seen from home, i.e. the home world is at heliocentric longitude 180°.
 * Time t is in Earth days.
 * Pure functions: runs in the page and in Node.
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const AU_KM = 149597870.7;
  const wrap360 = (x) => ((x % 360) + 360) % 360;

  // small deterministic hash → [0, 1)
  function unit(str, salt = 0) {
    let h = 2166136261 ^ salt;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  }

  function solveKepler(M, e) {
    let E = e < 0.8 ? M : Math.PI;
    for (let k = 0; k < 30; k++) {
      const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      E -= d;
      if (Math.abs(d) < 1e-12) break;
    }
    return E;
  }

  /*
   * Orbital elements for every body: { id, name, kind, home, a (AU), e, i, node, peri (argument
   * of periapsis, deg), M0 (mean anomaly at t = 0, deg), period (days), radius (R⊕), albedo, atmosphere }.
   * Bodies other than home have no stored phase; theirs is drawn from their id, so it is stable.
   */
  function elements(world, d) {
    const M = world.star.mass;
    const period = (a) => Math.sqrt(a ** 3 / M) * 365.256;
    const p = world.planet;
    // home: the star's geocentric longitude of periapsis is lonPeriapsis, so the planet's
    // heliocentric one is that + 180°; at t = 0 its true longitude is 180°.
    const varpi = wrap360(p.lonPeriapsis + 180);
    const nu0 = wrap360(180 - varpi) * D2R;
    const E0 = 2 * Math.atan2(Math.sqrt(1 - p.e) * Math.sin(nu0 / 2), Math.sqrt(1 + p.e) * Math.cos(nu0 / 2));
    const M0 = wrap360((E0 - p.e * Math.sin(E0)) * R2D);
    const home = {
      id: 'home', name: p.name, kind: 'terrestrial', home: true, a: p.a, e: p.e, i: 0, node: 0, peri: varpi, M0,
      period: period(p.a), radius: d.planet.radius, albedo: 0.367, atmosphere: true,
      tilt: p.tilt, rotation: p.rotation, pressure: p.pressure, gravity: d.planet.gravity,
    };
    const others = world.system.bodies.map((b) => ({
      id: b.id, name: b.name, kind: b.kind, home: false, a: b.a,
      e: b.e ?? 0.02 * unit(b.id, 1), i: b.inc ?? 3 * unit(b.id, 2), node: b.node ?? 360 * unit(b.id, 3),
      peri: b.peri ?? 360 * unit(b.id, 4), M0: b.M0 ?? 360 * unit(b.id, 5),
      period: period(b.a), radius: b.radius, albedo: b.albedo, atmosphere: !!b.atmosphere,
      tilt: b.tilt ?? 20 * unit(b.id, 6), rotation: b.rotation ?? (b.kind === 'gas' || b.kind === 'ice' ? 10 : 24 + 20 * unit(b.id, 7)),
      pressure: b.pressure ?? (b.atmosphere ? (b.kind === 'gas' || b.kind === 'ice' ? 1 : 1) : 0),
      gravity: b.gravity ?? Math.max(0.05, b.radius),                     // Earth's density assumed
    }));
    return [home, ...others].sort((x, y) => x.a - y.a);
  }

  /* Heliocentric ecliptic position (AU) of a body at time t (days). */
  function position(el, t) {
    const M = (el.M0 + 360 * t / el.period) * D2R;
    const E = solveKepler(((M % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), el.e);
    const xv = el.a * (Math.cos(E) - el.e), yv = el.a * Math.sqrt(1 - el.e * el.e) * Math.sin(E);
    const v = Math.atan2(yv, xv), r = Math.hypot(xv, yv);
    const node = el.node * D2R, w = (el.peri - el.node) * D2R, inc = el.i * D2R;
    const u = v + w;
    return [
      r * (Math.cos(node) * Math.cos(u) - Math.sin(node) * Math.sin(u) * Math.cos(inc)),
      r * (Math.sin(node) * Math.cos(u) + Math.cos(node) * Math.sin(u) * Math.cos(inc)),
      r * Math.sin(u) * Math.sin(inc),
    ];
  }

  /* Points along an orbit, for drawing. */
  function orbitPath(el, n = 96) {
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const M0 = el.M0;
      pts.push(position({ ...el, M0: M0 + (360 * k) / n }, 0));
    }
    return pts;
  }

  /*
   * The home world's moon: position relative to the planet (AU), on a circular orbit of the moon's
   * semi-major axis and sidereal period, inclined to the ecliptic by its inclination.
   */
  function moonOffset(world, d, t) {
    if (!world.moon.enabled || !d.moon) return null;
    const a = world.moon.a / AU_KM;
    const ang = (360 * t / d.moon.sidereal + 180) * D2R;              // full at t = 0
    const inc = world.moon.inclination * D2R;
    return [a * Math.cos(ang), a * Math.sin(ang) * Math.cos(inc), a * Math.sin(ang) * Math.sin(inc)];
  }

  // ── from a place on a world ───────────────────────────────────────────
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const len = (v) => Math.hypot(v[0], v[1], v[2]);

  /*
   * A direction in the ecliptic frame → altitude/azimuth for an observer on a world with axial
   * tilt `tilt` (toward ecliptic longitude 90°+, so the star crosses the equator at longitude 0 and
   * 180), latitude `lat`, and local sidereal angle `theta` (rad). Azimuth from north through east.
   */
  function horizontal(v, tilt, lat, theta) {
    const e = tilt * D2R;
    const x = v[0], y = v[1] * Math.cos(e) - v[2] * Math.sin(e), z = v[1] * Math.sin(e) + v[2] * Math.cos(e);
    const ra = Math.atan2(y, x), dec = Math.atan2(z, Math.hypot(x, y));
    const H = theta - ra, phi = lat * D2R;
    const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    const az = Math.atan2(-Math.cos(dec) * Math.sin(H), Math.sin(dec) * Math.cos(phi) - Math.cos(dec) * Math.cos(H) * Math.sin(phi));
    return { alt: alt * R2D, az: wrap360(az * R2D), ra, dec };
  }

  /*
   * Everything in the sky from body `bodyId` at time t (days), local solar time `hour` (fraction
   * of the local day, 0.5 = noon) and latitude `lat`. Returns the star, the other bodies and the
   * moon (when looking from home) with alt/az, distance, angular size and phase.
   */
  function skyFrom(world, d, els, bodyId, t, lat, hourFrac) {
    const self = els.find((b) => b.id === bodyId) || els.find((b) => b.home);
    const here = position(self, t);
    const toStar = sub([0, 0, 0], here);
    // local sidereal angle: the star's hour angle is set by the local solar time
    const tilt = self.tilt || 0;
    const e = tilt * D2R;
    const sx = toStar[0], sy = toStar[1] * Math.cos(e) - toStar[2] * Math.sin(e);
    const raStar = Math.atan2(sy, sx);
    const theta = raStar + (hourFrac - 0.5) * 2 * Math.PI;
    const pos = (v) => horizontal(v, tilt, lat, theta);

    const starR = d.star.radius * 696340 / AU_KM;
    const dStar = len(toStar);
    const star = { ...pos(toStar), dist: dStar, size: 2 * Math.atan(starR / dStar) * R2D };

    const bodies = els.filter((b) => b.id !== self.id).map((b) => {
      const p = position(b, t), v = sub(p, here), dist = len(v);
      // phase angle: star–body–observer
      const toS = sub([0, 0, 0], p), toO = sub(here, p);
      const cosA = (toS[0] * toO[0] + toS[1] * toO[1] + toS[2] * toO[2]) / (len(toS) * len(toO));
      const phase = Math.acos(Math.max(-1, Math.min(1, cosA))) * R2D;
      const rKm = b.radius * 6371;
      return { ...b, ...pos(v), dist, phase, size: 2 * Math.atan(rKm / (dist * AU_KM)) * R2D, helio: len(p) };
    });

    let moon = null;
    if (self.home) {
      const off = moonOffset(world, d, t);
      if (off) {
        const dist = len(off);
        const mp = [here[0] + off[0], here[1] + off[1], here[2] + off[2]];
        const toS = sub([0, 0, 0], mp), toO = sub(here, mp);
        const cosA = (toS[0] * toO[0] + toS[1] * toO[1] + toS[2] * toO[2]) / (len(toS) * len(toO));
        moon = {
          name: world.moon.name, ...pos(off), dist, phase: Math.acos(Math.max(-1, Math.min(1, cosA))) * R2D,
          size: 2 * Math.atan(d.moon.radiusKm / (dist * AU_KM)) * R2D,
          // bright limb direction: toward the star, in the sky
          toStar: pos(sub([0, 0, 0], mp)),
        };
      }
    }
    return { self, here, star, bodies, moon, theta };
  }

  /* The length of the local solar day on a body, in Earth days (synodic, from sidereal rotation). */
  function solarDay(el) {
    const sid = el.rotation / 24;
    return Math.abs(1 / (1 / sid - 1 / el.period));
  }

  const api = { elements, position, orbitPath, moonOffset, horizontal, skyFrom, solveKepler, solarDay, unit, AU_KM };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.orbits = api; }
})(typeof window !== 'undefined' ? window : globalThis);
