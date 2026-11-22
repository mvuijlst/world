/*
 * WorldSmith calculation engine.
 *
 * A faithful port of the formulas in Artifexian's "The WorldSmith 8.00"
 * spreadsheet (visible sheets + the hidden "Calculations" sheet). Cell
 * references are noted next to each formula so values can be traced back.
 *
 * Pure functions only: no DOM, no state. Loads as a classic browser script
 * (exposes window.WS.calc) and as a CommonJS module for the Node tests.
 *
 * Where the spreadsheet has a quirk, the quirk is kept on purpose so results
 * match the workbook; each one is marked "QUIRK".
 */
(function (root) {
  'use strict';

  // ── constants (as used in the workbook) ──────────────────────────────
  const K = {
    MSOL_KG: 1.989e30,
    RSOL_KM: 696340,
    LSOL_W: 3.828e26,
    DSOL_GCM3: 1.408,
    MEARTH_KG: 5.972e24,
    REARTH_KM: 6371,
    G_MS2: 9.81,
    VESC_EARTH: 11.186,
    MMOON_KG: 7.35e22,
    MMOON_KG_ORBIT: 7.342e22,
    RMOON_KM: 1737.4,
    AU_MKM: 149.6,
    G: 6.67e-11,
    EARTH_TIDE_TOTAL: 1501373691439.2996, // Calculations!C273
    LEHMER_M: 2147483647, // 2^31 - 1
    LEHMER_A: 48271,
  };

  const log10 = Math.log10;
  const rad = (d) => (d * Math.PI) / 180;
  const deg = (r) => (r * 180) / Math.PI;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  // Excel ROUNDDOWN(x, n): truncate toward zero
  const roundDown = (x, n = 0) => { const f = 10 ** n; return Math.trunc(x * f) / f; };
  const roundUp = (x, n = 0) => { const f = 10 ** n; return (x < 0 ? Math.floor : Math.ceil)(x * f) / f; };
  const round = (x, n = 0) => { const f = 10 ** n; return Math.round(x * f) / f; };
  const round10 = (x) => Math.round(x / 10) * 10; // ROUND(x,-1)

  // ── STAR ─────────────────────────────────────────────────────────────
  function starLuminosity(m) { // STAR!C10
    if (m < 0.43) return 0.23 * m ** 2.3;
    if (m < 2) return m ** 4;
    return 1.4 * m ** 3.5;
  }
  function starRadius(m) { return m < 1 ? m ** 0.8 : m ** 0.57; } // STAR!C9

  const SPECTRAL = [ // Calculations!B4:C10 — [class, Tmin, Tmax]
    ['M', 2000, 3700], ['K', 3700, 5200], ['G', 5200, 6000], ['F', 6000, 7500],
    ['A', 7500, 10000], ['B', 10000, 33000], ['O', 33000, 95000],
  ];

  function spectralClass(T) {
    for (const [c, lo, hi] of SPECTRAL) {
      if (T > lo && T < hi) {
        const sub = roundDown((1 - (T - lo) / (hi - lo)) * 10, 1);
        return { letter: c, sub, code: `${c}${sub}V` };
      }
    }
    // the workbook returns "" exactly on a boundary; fall back to nearest band
    for (const [c, lo, hi] of SPECTRAL) {
      if (T >= lo && T <= hi) return { letter: c, sub: T === lo ? 10 : 0, code: `${c}${T === lo ? 9.9 : 0}V` };
    }
    return { letter: '?', sub: null, code: 'NA' };
  }

  function star(s) {
    const m = s.mass;
    const valid = m >= 0.075 && m <= 100;
    const L = starLuminosity(m);
    const R = starRadius(m);
    const D = m / R ** 3;
    const T = (L / R ** 2) ** 0.25 * 5776;
    const maxAge = (m / L) * 10;
    const hzIn = Math.sqrt(L / 1.1);
    const hzOut = Math.sqrt(L / 0.53);
    const life = (m >= 0.5 && m <= 1.4) ? (s.age >= 3.5 ? 'Yes' : 'Star Too Young') : 'No';
    return {
      valid, mass: m, massKg: K.MSOL_KG * m, age: s.age, maxAge,
      radius: R, radiusKm: K.RSOL_KM * R,
      luminosity: L, luminosityW: K.LSOL_W * L,
      density: D, densityGcm3: K.DSOL_GCM3 * D,
      temperature: T,
      spectral: valid ? spectralClass(T) : { letter: '?', sub: null, code: 'NA' },
      hzIn, hzOut, life,
      magnitude: 4.81013 - 2.5 * log10(L), // APPARENT!C6 (bolometric absolute)
      frostLine: 4.85 * Math.sqrt(L), // PLANETARY SYSTEM!C12
    };
  }

  // ── GALAXY ───────────────────────────────────────────────────────────
  function lehmer(x) {
    // MOD(48271*x, 2^31-1) — product stays < 2^53 so doubles are exact
    return (K.LEHMER_A * x) % K.LEHMER_M;
  }

  function galaxy(g) {
    const ghzIn = Math.round(g.radius * 0.47);
    const ghzOut = Math.round(g.radius * 0.6);
    const N = g.density * ((4 / 3) * Math.PI * g.hoodRadius ** 3);
    const counts = {
      O: Math.round(N * 0.9 * 0.0000003),
      B: Math.round(N * 0.9 * 0.0013),
      A: Math.round(N * 0.9 * 0.006),
      F: Math.round(N * 0.9 * 0.03),
      G: Math.round(N * 0.9 * 0.076),
      K: Math.round(N * 0.9 * 0.121),
      M: Math.round(N * 0.9 * 0.7645),
      D: Math.round(N * 0.09),
      BD: Math.round(N / 2.5),
      other: roundDown(N * 0.01, 0),
    };
    const totalObjects = Object.values(counts).reduce((a, b) => a + b, 0);
    const binary = Math.round((totalObjects / 1.58) * 0.33);
    const triple = Math.round((totalObjects / 1.58) * 0.08);
    const quad = Math.round((totalObjects / 1.58) * 0.03);
    const single = totalObjects - (binary * 2 + triple * 3 + quad * 4);
    const totalSystems = single + binary + triple + quad;

    // Star system coordinate generator — Calculations!B17:J115
    const n = Math.max(0, Math.min(totalSystems, 100) - 1);
    const systems = [];
    let prev = lehmer(g.seed); // Calculations!F14
    for (let i = 0; i < n; i++) {
      const e = lehmer(prev);
      const f = lehmer(e);
      const gg = lehmer(f);
      prev = gg;
      const rho = (e / K.LEHMER_M) ** (1 / 3) * g.hoodRadius;
      const theta = (f / K.LEHMER_M) * 2 * Math.PI;
      const phi = Math.acos(2 * (gg / K.LEHMER_M) - 1);
      systems.push({
        index: i + 1,
        x: rho * Math.sin(phi) * Math.cos(theta),
        y: rho * Math.sin(phi) * Math.sin(theta),
        z: rho * Math.cos(phi),
        distance: rho,
      });
    }
    let nearest = null, farthest = null;
    for (const s of systems) {
      if (!nearest || s.distance < nearest.distance) nearest = s;
      if (!farthest || s.distance > farthest.distance) farthest = s;
    }
    return {
      ghzIn, ghzOut, inGhz: g.location >= ghzIn && g.location <= ghzOut,
      objects: N, counts, totalObjects,
      single, binary, triple, quad, totalSystems,
      systems, nearest, farthest, capped: totalSystems > 100,
    };
  }

  // ── PLANETARY SYSTEM ─────────────────────────────────────────────────
  function system(sys, st) {
    const innerLimit = (2.455 * (st.radius * K.RSOL_KM) * ((st.density * 1408) / 5400) ** (1 / 3)) / 149600000;
    const orbits = [];
    for (let i = 0; i < 20; i++) {
      const a = i === 0 ? sys.firstOrbit : sys.firstOrbit + sys.spacing * 2 ** (i - 1);
      orbits.push({ n: i + 1, a });
    }
    const firstBeyondFrost = orbits.findIndex((o) => o.a >= st.frostLine);
    orbits.forEach((o, i) => {
      o.habitable = o.a >= st.hzIn && o.a <= st.hzOut;
      o.beyondFrost = o.a >= st.frostLine;
      o.insideLimit = o.a <= innerLimit;
      const prev = orbits[i - 1], next = orbits[i + 1];
      o.crowded = (prev && Math.abs(o.a - prev.a) < 0.15) || (next && Math.abs(next.a - o.a) < 0.15);
      o.role = '';
      if (i === firstBeyondFrost) o.role = 'Largest gas giant';
      else if (i === firstBeyondFrost - 1) o.role = 'Empty or asteroid belt';
    });
    // Debris disk — Calculations!C119:C123
    const ggPeriod = Math.sqrt(sys.outerGasGiant ** 3 / st.mass);
    const p23 = (ggPeriod / 2) * 3;
    const p12 = ggPeriod * 2;
    const debrisIn = (p23 ** 2 * st.mass) ** (1 / 3);
    const debrisOut = (p12 ** 2 * st.mass) ** (1 / 3);
    return {
      innerLimit, orbits, firstBeyondFrost,
      ggPeriod, debrisIn, debrisOut,
      outerGasGiantBeyondFrost: sys.outerGasGiant >= st.frostLine,
    };
  }

  // ── PLANET ───────────────────────────────────────────────────────────
  function planetDensity(mass, cmfPct) { // PLANET!C13
    const c = cmfPct / 100;
    const f = (5.51 * mass ** 0.189) / (1.07 - 0.21 * c) ** 3;
    if (mass > 0.6) return f;
    return f > 3.5 + 4.37 * c ? f : 3.5 + 4.37 * c;
  }

  const O2_PRESSURE_TABLE = [ // PLANET!C48 note — O2 % → [min, max] atm
    [10, 0.75, 3.40], [20, 0.48, 2.72], [30, 0.34, 1.84], [40, 0.27, 1.36], [50, 0.23, 1.09],
    [60, 0.20, 0.88], [70, 0.18, 0.75], [80, 0.16, 0.68], [90, 0.15, 0.65], [100, 0.14, 0.61],
  ];
  function pressureRangeForO2(o2) {
    const t = O2_PRESSURE_TABLE;
    if (o2 <= t[0][0]) return [t[0][1], t[0][2]];
    for (let i = 1; i < t.length; i++) {
      if (o2 <= t[i][0]) {
        const k = (o2 - t[i - 1][0]) / (t[i][0] - t[i - 1][0]);
        return [t[i - 1][1] + k * (t[i][1] - t[i - 1][1]), t[i - 1][2] + k * (t[i][2] - t[i - 1][2])];
      }
    }
    return [t[t.length - 1][1], t[t.length - 1][2]];
  }

  const GASES = [ // Calculations!B141:B144
    { key: 'o2', name: 'Oxygen', formula: 'O₂', molar: 0.032 },
    { key: 'co2', name: 'Carbon Dioxide', formula: 'CO₂', molar: 0.044 },
    { key: 'ar', name: 'Argon', formula: 'Ar', molar: 0.04 },
    { key: 'n2', name: 'Nitrogen', formula: 'N₂', molar: 0.028 },
  ];

  function circulationCells(rot) { // PLANET!C60:C67
    let n;
    if (rot >= 48) n = 1;
    else if (rot >= 6) n = 3;
    else if (rot >= 3) n = 7;
    else if (rot > 0) n = 5;
    else return { count: null, bands: [] };
    const B = {
      1: [[0, 90]],
      3: [[0, 30], [30, 60], [60, 90]],
      7: [[0, 24], [24, 27], [27, 31], [31, 41], [41, 58], [58, 71], [71, 90]],
      5: [[0, 23], [23, 30], [30, 47], [47, 56], [56, 90]],
    }[n];
    return { count: n, bands: B };
  }

  function surfaceTemperature(L, a, albedo, greenhouse) { // Calculations!C127:C135
    const sigma = 0.000056703;
    const Lerg = 3.846e33 * L;
    const dcm = 14960000000000 * a;
    const tg = greenhouse * 0.5841;
    const X = Math.sqrt(((1 - albedo) * Lerg) / (16 * Math.PI * sigma));
    const Teff = Math.sqrt(X) * (1 / Math.sqrt(dcm));
    const Teq = Teff ** 4 * (1 + (3 * tg) / 4);
    const Tsur = Teq / 0.9;
    return { Teff, kelvin: Math.round(Math.sqrt(Math.sqrt(Tsur))) };
  }

  function planet(p, st) {
    const density = planetDensity(p.mass, p.cmf);
    const radius = (p.mass / (density / 5.51)) ** (1 / 3);
    const gravity = p.mass / radius ** 2;
    const escape = Math.sqrt(p.mass / radius);
    const tilt = p.tilt;
    const rotationDir = tilt === 90 ? 'Undefined' : (tilt >= 0 && tilt < 90 ? 'Prograde' : 'Retrograde');
    const effTilt = tilt < 90 ? tilt : 180 - tilt;
    const tropics = effTilt;
    const polar = 90 - effTilt;
    const temp = surfaceTemperature(st.luminosity, p.a, p.albedo, p.greenhouse);
    const T = temp.kelvin;
    const horizon = Math.sqrt(2 * radius * 6371000 * p.observerHeight + p.observerHeight ** 2) / 1000;
    const periapsis = p.a * (1 - p.e);
    const apoapsis = p.a * (1 + p.e);
    const yearEarthYears = Math.sqrt(p.a ** 3 / st.mass);
    const yearEarthDays = yearEarthYears * 365.256;
    const yearLocalDays = (yearEarthDays * 24) / p.rotation;
    const orbitDir = p.inclination > 90 ? 'Retrograde' : (p.inclination < 90 ? 'Prograde' : 'Undefined');

    // atmosphere
    const n2 = 100 - (p.o2 + p.co2 + p.ar);
    const pct = { o2: p.o2, co2: p.co2, ar: p.ar, n2 };
    const pp = {};
    for (const k in pct) pp[k] = p.pressure * (pct[k] / 100);
    const molar = (n2 * 0.028 + p.o2 * 0.032 + p.co2 * 0.044 + p.ar * 0.04) / 100; // C138
    const atmDensity = (p.pressure * 101325 * molar) / (8.3145 * T);
    const tEarth = T / 287; // C136
    const stability = {};
    for (const gas of GASES) {
      // C141:C144 — ratio of (1500×T-scaled) thermal velocity to vesc/6; ≥1 → gas escapes
      stability[gas.key] = Math.sqrt((3 * 8.3145 * (tEarth * 1500)) / gas.molar) / ((escape * 11200) / 6);
    }
    const starApparentSize = (st.radius / p.a) * 0.5332; // C146, degrees

    return {
      density, radius, radiusKm: radius * K.REARTH_KM, massKg: p.mass * K.MEARTH_KG,
      gravity, gravityMs2: gravity * K.G_MS2,
      escape, escapeKms: escape * K.VESC_EARTH,
      rotationDir, tropics, polar,
      temperature: T, temperatureC: T - 273, Teff: temp.Teff,
      horizon,
      periapsis, apoapsis,
      yearEarthYears, yearEarthDays, yearLocalDays, orbitDir,
      pct, pp, molar, atmDensity, stability,
      pressureRange: pressureRangeForO2(p.o2),
      cells: circulationCells(p.rotation),
      starApparentSize,
      solarEventsUrl: 'https://artifexian.github.io/SolarEvents/desmos.html?P=' + yearLocalDays +
        '&w=' + p.lonPeriapsis + '&d=' + p.rotation + '&e_{t}=' + p.tilt + '&s=' + starApparentSize +
        '&e_{c}=' + p.e + '&l_{s}=' + p.subsolarLon,
    };
  }

  /*
   * Daylight hours by latitude through the local year. Not in the workbook
   * (it links out to rue_cr's Desmos calculator); added so the planet page
   * can show seasons without leaving the app. Uses Kepler's equation for the
   * star's ecliptic longitude and the standard sunrise equation, with the
   * star's apparent radius as the horizon correction.
   * Day 0 = northern vernal equinox.
   */
  function daylightGrid(p, pl, opts = {}) {
    const days = opts.days || 72;
    const lats = opts.lats || 37; // -90..90 step 5
    const e = p.e, eps = rad(p.tilt), varpi = rad(p.lonPeriapsis);
    const nu0 = -varpi; // true anomaly at equinox (λ = ν + ϖ = 0)
    const E0 = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(nu0 / 2));
    const M0 = E0 - e * Math.sin(E0);
    const halfDisk = rad(pl.starApparentSize / 2);
    const rows = [];
    for (let j = 0; j < lats; j++) rows.push([]);
    for (let i = 0; i < days; i++) {
      const M = M0 + (2 * Math.PI * i) / days;
      let E = M;
      for (let k = 0; k < 12; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      const nu = 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(E / 2), Math.sqrt(1 - e) * Math.cos(E / 2));
      const lambda = nu + varpi;
      const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
      for (let j = 0; j < lats; j++) {
        const phi = rad(-90 + (180 * j) / (lats - 1));
        const cosH = (-Math.sin(halfDisk) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec) || 1e-12);
        const H = cosH <= -1 ? Math.PI : cosH >= 1 ? 0 : Math.acos(cosH);
        rows[j].push((H / Math.PI) * p.rotation); // hours of daylight
      }
    }
    return { days, lats, hours: rows };
  }

  // ── MOON ─────────────────────────────────────────────────────────────
  function lockCategory(gyr) { // Calculations!B258:C264
    if (gyr < 0.001) return { text: 'Very Likely Locked', level: 0 };
    if (gyr < 0.01) return { text: 'Possibly Locked in Millions of Years', level: 1 };
    if (gyr < 0.1) return { text: 'Possibly Locked in 10s of Millions of Years', level: 2 };
    if (gyr < 1) return { text: 'Possibly Locked in 100s of Millions of Years', level: 3 };
    if (gyr < 10) return { text: 'Possibly Locked in Billions of Years', level: 4 };
    if (gyr < 100) return { text: 'Possibly Locked in 10s of Billions of Years', level: 5 };
    return { text: 'Possibly Locked in 100s of Billions of Years', level: 6 };
  }

  function moon(m, p, pl, st) {
    const radius = (m.mass / (m.density / 3.34)) ** (1 / 3);
    const gravity = (m.mass / radius ** 2) * 0.1654;
    const escape = Math.sqrt(m.mass / radius) * 2.38;
    const zoneIn = 2.44 * pl.radius * 6371 * (pl.density / m.density) ** (1 / 3);
    const zoneOut = p.a * 150000000 * ((p.mass * 5.97e24) / (3 * st.mass * 1.99e30)) ** (1 / 3);
    const periapsis = m.a * (1 - m.e);
    const apoapsis = m.a * (1 + m.e);
    const orbitDir = (m.inclination >= 0 && m.inclination < 90) ? 'Prograde' : ((m.inclination > 90 && m.inclination <= 180) ? 'Retrograde' : 'Undefined');
    const sidereal = (2 * Math.PI * Math.sqrt((m.a * 1000) ** 3 / (K.G * (p.mass * K.MEARTH_KG + m.mass * K.MMOON_KG_ORBIT)))) / 86400;
    const synodic = 1 / Math.abs(1 / sidereal - 1 / pl.yearEarthDays);

    // Tidal locking — Calculations!C238:C267
    const mM = m.mass * K.MMOON_KG, mP = p.mass * K.MEARTH_KG, mS = st.mass * K.MSOL_KG;
    const aM = m.a * 1000, aP = p.a * 149600000000;
    const rM = radius * K.RMOON_KM * 1000, rP = pl.radiusKm * 1000;
    const wM = (2 * Math.PI) / (12 * 3600), wP = (2 * Math.PI) / (p.rotation * 3600);
    const IM = 0.5 * mM * rM ** 2, IP = 0.4 * mP * rP ** 2;
    const QM = 40, QP = 13, mu = 30000000000;
    const k2M = 1.5 / (1 + (19 * mu) / (2 * m.density * 1000 * gravity * 9.81 * rM));
    const k2P = 1.5 / (1 + (19 * mu) / (2 * pl.density * 1000 * pl.gravityMs2 * rP));
    const S_TO_GYR = 3.171e-17;
    const tMoonLock = ((wM * aM ** 6 * IM * QM) / (3 * K.G * mP ** 2 * k2M * rM ** 5)) * S_TO_GYR;
    const tPlanetMoon = ((wP * aM ** 6 * IP * QP) / (3 * K.G * mM ** 2 * k2P * rP ** 5)) * S_TO_GYR;
    const tPlanetStar = ((wP * aP ** 6 * IP * QP) / (3 * K.G * mS ** 2 * k2P * rP ** 5)) * S_TO_GYR;
    const moonLocked = tMoonLock <= st.age;
    // QUIRK: MOON!C50 tests the star-lock time against 0, so it is always "No".
    const planetLockedToStar = tPlanetStar <= 0;

    const fMoon = (2 * K.G * mM * mP) / aM ** 3;
    const fStar = (2 * K.G * mP * mS) / aP ** 3;
    const total = fMoon + fStar;

    return {
      radius, radiusKm: radius * K.RMOON_KM, massKg: mM,
      gravity, gravityMs2: gravity * K.G_MS2, escape,
      zoneIn, zoneOut, periapsis, apoapsis, orbitDir,
      sidereal, synodic,
      rotation: moonLocked ? synodic : null, // QUIRK: workbook uses the synodic period
      tMoonLock, tPlanetMoon, tPlanetStar,
      moonLocked, planetLockedToMoon: lockCategory(tPlanetMoon), planetLockedToStar,
      tides: total / K.EARTH_TIDE_TOTAL,
      tideMoonPct: (fMoon / total) * 100,
      tideStarPct: (fStar / total) * 100,
      massRatioOk: mM < mP,
    };
  }

  // ── APPARENT SIZE & BRIGHTNESS ───────────────────────────────────────
  function starFrom(st, a) {
    const mag = st.magnitude + 5 * log10(a / 206264.806) - 5;
    return { a, magnitude: mag, brightness: 2.512 ** (-26.762 - mag), size: st.radius / a };
  }

  function bodyType(radius, atmosphere) { // Calculations!B151
    if (!atmosphere && radius > 0.1 && radius < 1.5) return 1; // terrestrial, airless
    if (!atmosphere && radius < 0.1) return 4; // asteroid
    if (atmosphere && radius < 1.5) return 2; // terrestrial with atmosphere
    return 3; // jovian
  }

  function phaseTerm(type, a) {
    const t = Math.tan(rad(a) / 2);
    switch (type) {
      case 1: return -2.5 * log10((1 - 0.28) * Math.exp(-3.332 * t ** 0.631) + 0.28 * Math.exp(-1.862 * t ** 1.218));
      case 2: return -0.00106 * a + 0.0002054 * a ** 2;
      case 3: {
        if (a <= 12) return -0.00037 * a + 0.000616 * a ** 2;
        const x = a / 180;
        return -0.033 - 2.5 * log10(1 - 1.507 * x - 0.363 * x ** 2 - 0.062 * x ** 3 + 2.809 * x ** 4 - 1.876 * x ** 5);
      }
      default: return -2.5 * log10((1 - 0.15) * Math.exp(-3.332 * t ** 0.631) + 0.15 * Math.exp(-1.862 * t ** 1.218));
    }
  }

  function bodyFromHome(b, aHome, st, homeStarSize) {
    const a = b.a, F = b.distance;
    const type = bodyType(b.radius, b.atmosphere);
    const H = 5 * log10(1329 / st.luminosity / ((b.radius * 12742) * Math.sqrt(b.albedo)));
    const dMin = Math.abs(a - aHome), dMax = a + aHome;
    const near = (x, y) => Math.abs(x - y) < 1e-9;
    let phase, elong;
    if (near(F, dMin) && a > aHome) phase = 0;
    else if (near(F, dMin) && a < aHome) phase = 180;
    else if (near(F, dMax) && a > aHome) phase = 0;
    else phase = deg(Math.acos(clamp((F ** 2 + a ** 2 - aHome ** 2) / (2 * F * a), -1, 1)));
    if (near(F, dMin) && a < aHome) elong = 0;
    else if (near(F, dMin) && a > aHome) elong = 180;
    else if (near(F, dMax) && a > aHome) elong = 0;
    else elong = deg(Math.acos(clamp((F ** 2 + aHome ** 2 - a ** 2) / (2 * F * aHome), -1, 1)));
    const pt = phaseTerm(type, phase);
    // naked-eye test uses best-case geometry (I37)
    const best = a < aHome ? H + 5 * log10(a * Math.sqrt(aHome ** 2 - a ** 2)) : H + 5 * log10(a * dMin);
    const nakedEye = best < 5 ? 'Yes' : (best < 7 ? 'Maybe' : 'No');
    let mag = null; // J37 — null means "NA"
    if (phase < 160 && elong !== 0) mag = round(H + 5 * log10(a * F) + pt, 2);
    const mv = mag === null ? Infinity : mag; // Sheets sorts text above numbers
    let observable;
    if (elong < (homeStarSize * 0.5) / 2 && F < aHome) observable = 'Transit';
    else if (mv < -6 && elong > 20) observable = 'Day and night';
    else if (elong < 20) observable = 'Too close to star';
    else if (elong < 50) observable = 'In twilight';
    else if (mv > 6 && mv < 30) observable = 'At night';
    else if (mv >= 30) observable = 'Too faint';
    else observable = 'At night';
    let visibility;
    if (observable === 'Too close to star' || mag === null) visibility = 'NA';
    else if (mag >= 30) visibility = 'Too faint';
    else if (mag >= 24) visibility = 'With space telescope';
    else if (mag >= 7) visibility = 'With telescope';
    else if (mag > 5) visibility = 'Possibly with naked eye';
    else if (mag >= 0) visibility = 'Naked eye (bright)';
    else visibility = 'Naked eye (very bright)';
    const ang = rad(180 - phase - elong);
    return {
      type, H, dMin, dMax, distanceValid: F >= dMin - 1e-9 && F <= dMax + 1e-9,
      phase, elong, phaseTerm: pt, nakedEye, magnitude: mag, observable, visibility,
      x: Math.cos(ang) * a, y: Math.sin(ang) * a,
    };
  }

  function sky(w, st, pl, mn) {
    const aHome = w.planet.a;
    const home = starFrom(st, aHome);
    const bodies = w.system.bodies.filter((b) => !b.home).map((b) => ({
      id: b.id, name: b.name,
      fromBody: starFrom(st, b.a),
      fromHome: bodyFromHome(b, aHome, st, home.size),
    }));
    let moonSky = null;
    if (w.moon.enabled && mn) {
      const rm = mn.radius;
      const H = 5 * log10(1329 / st.luminosity / ((rm * 1738.1 * 2) * Math.sqrt(w.moon.geoAlbedo)));
      const ph = w.moon.phase;
      const t = Math.tan(rad(ph) / 2);
      // QUIRK: APPARENT!C65 squares the planet's semi-major axis
      const magnitude = ph >= 180 ? null : round(H + 5 * log10(aHome ** 2 * w.moon.a / 149597870)
        - 2.5 * log10((1 - 0.28) * Math.exp(-3.332 * t ** 0.631) + 0.28 * Math.exp(-1.862 * t ** 1.218)), 2);
      const size = (rm / w.moon.a) * 384748;
      moonSky = {
        H, magnitude, brightness: magnitude === null ? null : 10 ** ((magnitude + 12.67) / -2.5),
        size, totalEclipses: size >= home.size,
      };
    }
    return { home, bodies, moon: moonSky };
  }

  // ── TECTONICS ────────────────────────────────────────────────────────
  const RANGE_TYPES = {
    Andean: {
      blurb: 'Thin orogeny at a subduction margin (e.g. southern Andes).',
      features: ['Outer-Arc Ridge', 'Forearc Basin', 'Fore Slope', 'Plateau', 'Back Slope', 'Back Arc'],
      heights: [[200, 1500], [0, 500], 'T', [1000, 6000], 'T', [500, 800]],
      widths: [[0, 100], [20, 250], [30, 100], [0, 200], [30, 200], 'inf'],
    },
    Laramide: {
      blurb: 'Thick orogeny at a subduction margin (e.g. the Rockies).',
      features: ['Outer-Arc Ridge', 'Forearc Basin', 'Fore Slope', 'Plateau', 'Back Slope', 'Back Arc'],
      heights: [[300, 2500], [0, 500], ['to', 1500, 6000], [1000, 5000], ['from', 1000, 5500], [100, 1500]],
      widths: [[0, 150], [20, 200], [30, 100], [300, 1400], [30, 200], 'inf'],
    },
    Ural: {
      blurb: 'Thin orogeny at a continent–continent collision (e.g. Urals, Alps, Caucasus).',
      features: ['Foreland Basin', 'Foreslope', 'Plateau', 'Back Slope'],
      heights: [[0, 500], 'T', [1000, 5000], 'T'],
      widths: [[0, 300], [30, 80], [0, 150], [30, 100]],
    },
    Himalayan: {
      blurb: 'Thick orogeny at a continent–continent collision (e.g. the Himalayas).',
      features: ['Foreland Basin', 'Foreslope', 'Plateau', 'Back Slope'],
      heights: [[50, 300], ['to', 3000, 8000], [3000, 6000], ['from', 3000, 7000]],
      widths: [[100, 400], [30, 100], [300, 1400], [30, 200]],
    },
  };

  function scaledRange(spec, f) {
    if (spec === 'T') return { kind: 'taper', text: 'Tapering' };
    if (spec === 'inf') return { kind: 'inf', text: '∞' };
    if (spec[0] === 'to' || spec[0] === 'from') {
      const lo = round10(spec[1] / f), hi = round10(spec[2] / f);
      return { kind: 'taper', min: lo, max: hi, text: `Taper ${spec[0]} peak of ${lo} – ${hi}` };
    }
    const lo = round10(spec[0] / f), hi = round10(spec[1] / f);
    return { kind: 'range', min: lo, max: hi, text: `${lo} – ${hi}` };
  }

  function mountainRange(r, gravity, scaling) {
    const T = RANGE_TYPES[r.type] || RANGE_TYPES.Andean;
    const f = gravity ** scaling;
    const features = T.features.map((name, i) => {
      const hR = scaledRange(T.heights[i], f);
      const wR = scaledRange(T.widths[i], f);
      const h = r.heights[i];
      const w = r.widths[i];
      const tapering = T.heights[i] === 'T';
      const hasH = !tapering && h !== null && h !== undefined && h !== '';
      const hasW = wR.kind !== 'inf' && w !== null && w !== undefined && w !== '';
      // Inactive range — TECTONICS!C40:D45
      const eroded = tapering ? null : Math.max(0, (hasH ? +h : 0) - r.erosion * r.age);
      return {
        name, heightRange: hR, widthRange: wR,
        height: hasH ? +h : null, width: hasW ? +w : null, tapering, infinite: wR.kind === 'inf',
        heightOk: !hasH || hR.kind !== 'range' || (h >= hR.min && h <= hR.max),
        widthOk: !hasW || wR.kind !== 'range' || (w >= wR.min && w <= wR.max),
        erodedHeight: eroded,
      };
    });
    return { features, blurb: T.blurb };
  }

  function oceanDepth(ridge, age) { // TECTONICS!C54 + Calculations!C190:C193
    const sub = 350, max = 6400, fall = 62.8;
    const inter = -((ridge + sub * Math.sqrt(20) - max) / Math.exp(-20 / fall));
    return age < 20 ? ridge + sub * Math.sqrt(age) : max - inter * Math.exp(-age / fall);
  }
  const OCEAN_AGES = [0, 10, 20, 30, 40, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 600, 700, 800, 900, 1000];

  function tectonics(t, pl) {
    const g = pl.gravity;
    return {
      gravity: g,
      maxPeak: 250000000 / (2750 * g * K.G_MS2),
      ranges: t.ranges.map((r) => mountainRange(r, g, t.scaling)),
      ocean: OCEAN_AGES.map((age) => ({ age, depth: oceanDepth(t.ridgeDepth, age) })),
    };
  }

  // ── POPULATION ───────────────────────────────────────────────────────
  function zipf(n, A, B, total) {
    n = Math.max(0, Math.floor(n));
    let s = 0;
    for (let j = 1; j <= n; j++) s += (j + B) ** -A;
    const out = [];
    for (let k = 1; k <= n; k++) out.push(((1 / (k + B) ** A) / s) * total);
    return out;
  }

  function population(pop, pl) {
    const R = pl.radius;
    const area = (4 * Math.PI * (R * 6371) ** 2) / 1000000; // million km² (Calculations!E203)
    const land = area * (pop.land / 100);
    const ocean = area - land;
    const uninhabitable = land * (pop.uninhabitable / 100);
    const habitable = land - uninhabitable;
    const productive = (habitable * pop.productive) / 100;
    const unproductive = habitable - productive;
    const livestock = (productive * pop.livestock) / 100;
    const crops = productive - livestock;
    const capacity = productive * pop.fedPerKm2 * 1000000;
    const logistic = (t) => capacity / (1 + ((capacity - pop.initial) / pop.initial) * Math.exp(-(pop.growth / 100) * t));
    const world = logistic(pop.years);
    const curve = [];
    const horizon = Math.max(pop.years * 2, 10);
    for (let i = 0; i <= 60; i++) { const t = (horizon * i) / 60; curve.push([t, logistic(t)]); }
    const continents = zipf(pop.continents.n, pop.continents.a, pop.continents.b, world);
    const ci = clamp(pop.chosenContinent, 1, Math.max(1, continents.length));
    const continentPop = continents[ci - 1] || 0;
    const regions = zipf(pop.regions.n, pop.regions.a, pop.regions.b, continentPop);
    const ri = clamp(pop.chosenRegion, 1, Math.max(1, regions.length));
    const regionPop = regions[ri - 1] || 0;
    const subregions = zipf(pop.subregions.n, pop.subregions.a, pop.subregions.b, regionPop);
    return {
      area, land, ocean, uninhabitable, habitable, productive, unproductive, livestock, crops,
      capacity, world, density: world / (land * 1000000), curve, horizon,
      continents, continentPop, regions, regionPop, subregions,
    };
  }

  // ── CALENDAR ─────────────────────────────────────────────────────────
  /*
   * Leap cycles. The workbook builds continued-fraction convergents of the
   * fractional part (Calculations!B207:C233) and shows them as decimals;
   * here they are also kept as exact p/q ("p leap units every q").
   */
  function leapOptions(x, terms = 5) {
    const frac = x - Math.floor(x);
    const out = [];
    if (frac < 1e-9) return out;
    const a = [];
    let r = frac;
    for (let i = 0; i < terms; i++) {
      const inv = 1 / r;
      const ai = Math.trunc(inv);
      a.push(ai);
      r = inv - ai;
      // convergent of [0; a1..ai]
      let p = 1, q = a[a.length - 1];
      for (let j = a.length - 2; j >= 0; j--) { const np = q; const nq = a[j] * q + p; p = np; q = nq; }
      out.push({ p, q, value: p / q, error: p / q - frac });
      if (r < 1e-9) break;
    }
    return out;
  }

  function calendar(c) {
    const month = c.monthDays / (c.dayHours / 24);
    const year = c.yearDays / (c.dayHours / 24);
    const s = {};
    s.common = roundDown(year);
    s.leap = roundUp(year);
    s.leapOptions = leapOptions(year);
    s.months = roundDown(year / month);
    s.daysPerMonth = s.months ? roundDown(s.common / s.months) : 0;
    s.intercalary = s.common - s.daysPerMonth * s.months;
    s.weeks = c.solarWeeks;
    s.daysPerWeek = c.solarWeeks ? roundDown(s.daysPerMonth / c.solarWeeks) : 0;
    s.weekIntercalary = s.daysPerMonth - c.solarWeeks * s.daysPerWeek;

    const l = {};
    l.months = roundDown(year / month);
    l.year = roundDown(l.months * month);
    l.commonMonth = roundDown(month);
    l.leapMonth = roundUp(month);
    l.leapOptions = leapOptions(month);
    l.weeks = c.lunarWeeks;
    l.daysPerWeek = c.lunarWeeks ? roundDown(month / c.lunarWeeks) : 0;
    l.weekIntercalary = roundDown(month - c.lunarWeeks * l.daysPerWeek);

    const ls = {};
    ls.commonMonths = roundDown(year / month);
    ls.common = roundDown(ls.commonMonths * month);
    ls.leapMonths = roundUp(year / month);
    ls.leap = roundDown(ls.leapMonths * month);
    ls.leapOptions = leapOptions(year / month);
    ls.commonMonth = roundDown(month);
    ls.leapMonth = roundUp(month);
    ls.monthLeapOptions = leapOptions(month);
    ls.weeks = c.lunisolarWeeks;
    ls.daysPerWeek = c.lunisolarWeeks ? roundDown(month / c.lunisolarWeeks) : 0;
    ls.weekIntercalary = roundDown(month - c.lunisolarWeeks * ls.daysPerWeek);

    return { month, year, solar: s, lunar: l, lunisolar: ls };
  }

  // ── everything at once ───────────────────────────────────────────────
  function computeAll(w) {
    const st = star(w.star);
    const gx = galaxy(w.galaxy);
    const sy = system(w.system, st);
    const pl = planet(w.planet, st);
    const mn = w.moon.enabled ? moon(w.moon, w.planet, pl, st) : null;
    const sk = sky(w, st, pl, mn);
    const tc = tectonics(w.tectonics, pl);
    const pp = population(w.population, pl);
    const calIn = calendarInputs(w, pl, mn);
    const cl = calendar(calIn);
    return { star: st, galaxy: gx, system: sy, planet: pl, moon: mn, sky: sk, tectonics: tc, population: pp, calendar: cl, calendarInputs: calIn };
  }

  function calendarInputs(w, pl, mn) {
    const c = w.calendar;
    if (!c.linked) return c;
    return {
      ...c,
      yearDays: pl.yearEarthDays,
      monthDays: mn ? mn.synodic : c.monthDays,
      dayHours: w.planet.rotation,
    };
  }

  const api = {
    K, star, starLuminosity, starRadius, spectralClass, galaxy, lehmer, system,
    planet, planetDensity, surfaceTemperature, circulationCells, pressureRangeForO2, GASES,
    daylightGrid, moon, lockCategory, sky, starFrom, bodyFromHome, bodyType, phaseTerm,
    tectonics, mountainRange, RANGE_TYPES, oceanDepth, population, zipf,
    calendar, leapOptions, calendarInputs, computeAll,
    util: { roundDown, roundUp, round, clamp, rad, deg },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.calc = api; }
})(typeof window !== 'undefined' ? window : globalThis);
