/*
 * Checks the calculation engine against the values cached in
 * "The WorldSmith 8.00.xlsx" for its default (Sol / Earth / Luna) inputs.
 * Run with:  node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');
const D = require('../js/data.js');

const close = (actual, expected, rel = 1e-6, label = '') => {
  const tol = Math.max(Math.abs(expected) * rel, 1e-9);
  assert.ok(Math.abs(actual - expected) <= tol, `${label} expected ${expected}, got ${actual}`);
};

const w = D.defaultWorld();
const d = C.computeAll(w);

test('STAR sheet', () => {
  const s = d.star;
  assert.equal(s.spectral.code, 'G2.8V'); // STAR!C5
  close(s.maxAge, 10); // C8
  close(s.radius, 1); close(s.luminosity, 1); close(s.density, 1);
  close(s.temperature, 5776); // C12
  close(s.hzIn, 0.9534625892, 1e-9); close(s.hzOut, 1.373605639, 1e-9); // C14
  assert.equal(s.life, 'Yes'); // C15
  close(s.frostLine, 4.85);
  const red = C.star({ mass: 0.3, age: 4 });
  assert.equal(red.spectral.letter, 'M');
  assert.equal(red.life, 'No');
});

test('GALAXY sheet', () => {
  const g = d.galaxy;
  assert.equal(g.ghzIn, 23500); assert.equal(g.ghzOut, 30000);
  assert.deepEqual(
    [g.counts.O, g.counts.B, g.counts.A, g.counts.F, g.counts.G, g.counts.K, g.counts.M, g.counts.D, g.counts.BD, g.counts.other],
    [0, 0, 0, 0, 1, 1, 9, 1, 5, 0],
  );
  assert.equal(g.totalObjects, 17);
  assert.deepEqual([g.single, g.binary, g.triple, g.quad, g.totalSystems], [6, 4, 1, 0, 11]);
  assert.equal(g.systems.length, 10);
  const s1 = g.systems[0];
  close(s1.distance, 4.397389104, 1e-9); // GALAXY!F46
  assert.deepEqual([s1.x, s1.y, s1.z].map((v) => Math.round(v * 100) / 100), [-2.2, -1.63, 3.44]); // C46
  assert.equal(C.lehmer(1), 48271); // Calculations!F14
});

test('PLANETARY SYSTEM sheet', () => {
  const s = d.system;
  close(s.innerLimit, 0.007300358894, 1e-8);
  const expected = [0.4, 0.7, 1, 1.6, 2.8, 5.2, 10, 19.6, 38.8, 77.2, 154, 307.6];
  expected.forEach((a, i) => close(s.orbits[i].a, a, 1e-12, `orbit ${i + 1}`));
  close(s.debrisIn, 39.40284686, 1e-8); close(s.debrisOut, 47.73314963, 1e-8);
  assert.equal(s.orbits[2].habitable, true); // 1 AU in HZ
  assert.equal(s.orbits[5].beyondFrost, true); // 5.2 AU
  assert.equal(s.orbits[5].role, 'Largest gas giant');
});

test('PLANET sheet', () => {
  const p = d.planet;
  close(p.density, 5.512314848, 1e-9); // C13
  close(p.radius, 0.99986, 1e-5); // C14
  close(p.gravity, 1.000280059, 1e-8); // C15
  close(p.escape, 1.000070007, 1e-8); // C16
  assert.equal(p.rotationDir, 'Prograde');
  close(p.tropics, 23.5); close(p.polar, 66.5);
  assert.equal(p.temperature, 288); // C23
  close(p.horizon, 4.721798521, 1e-7); // C27
  close(p.periapsis, 0.9833); close(p.apoapsis, 1.0167);
  close(p.yearLocalDays, 365.256, 1e-9); // C37
  close(p.pct.n2, 78.08, 1e-9); // C54
  close(p.atmDensity, 1.225255202, 1e-8); // C56
  close(p.stability.o2, 0.5802397229, 1e-6); // Calculations!C141
  assert.equal(p.cells.count, 3);
  close(p.starApparentSize, 0.5332);
});

test('MOON sheet', () => {
  const m = d.moon;
  close(m.radius, 1); close(m.gravity, 0.1654); close(m.escape, 2.38);
  close(m.zoneIn, 18368.16656, 1e-8); // C30
  close(m.zoneOut, 1500000, 1e-9); // C31
  close(m.sidereal, 27.33093732, 1e-8); // C38
  close(m.synodic, 29.5414278, 1e-8); // C39
  close(m.tides, 1, 1e-9); // C44
  close(m.tideMoonPct, 68.4770517, 1e-8); close(m.tideStarPct, 31.5229483, 1e-8);
  close(m.tMoonLock, 0.01224900008, 1e-6); // Calculations!C253
  close(m.tPlanetMoon, 1.012650551, 1e-6); // C256
  close(m.tPlanetStar, 4.778549077, 1e-6); // C267
  assert.equal(m.moonLocked, true);
  assert.equal(m.planetLockedToMoon.text, 'Possibly Locked in Billions of Years');
  assert.equal(m.planetLockedToStar, false);
});

test('APPARENT SIZE & BRIGHTNESS sheet', () => {
  const s = d.sky;
  close(d.star.magnitude, 4.81013);
  close(s.home.magnitude, -26.76199566, 1e-9); // D12
  close(s.home.brightness, 0.9999960055, 1e-8); // E12
  const byName = Object.fromEntries(s.bodies.map((b) => [b.name, b]));
  close(byName.Mercury.fromBody.magnitude, -28.82289103, 1e-9); // D13
  close(byName.Pluto.fromBody.magnitude, -18.77999994, 1e-8); // D20
  const H = [-0.7047107917, -4.392500592, -1.618321448, -9.437145684, -8.958592957, -7.143709366, -6.917681179, -0.6646170702];
  const J = [-1.39, -4.1, 1.22, -2.29, 0.73, 5.67, 7.86, 15.4];
  const naked = ['Yes', 'Yes', 'Yes', 'Yes', 'Yes', 'Maybe', 'No', 'No'];
  ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto'].forEach((n, i) => {
    close(byName[n].fromHome.H, H[i], 1e-8, `${n} H`);
    close(byName[n].fromHome.magnitude, J[i], 1e-9, `${n} mag`);
    assert.equal(byName[n].fromHome.nakedEye, naked[i], `${n} naked eye`);
  });
  close(byName.Mercury.fromHome.phase, 14.52575984, 1e-8); // Calculations!D151
  close(byName.Mercury.fromHome.elong, 5.57162893, 1e-8); // E151
  close(byName.Mercury.fromHome.x, -0.3635275692, 1e-8); // M156
  assert.equal(byName.Mercury.fromHome.observable, 'Too close to star'); // K37
  close(s.moon.H, 0.2794050198, 1e-8); // C64
  assert.equal(s.moon.magnitude, -12.67); // C65
  assert.equal(s.moon.totalEclipses, true);
});

test('a saved distance the orbits no longer allow falls back to the best view', () => {
  const st = d.star;
  const inner = C.bodyFromHome({ a: 0.44, distance: 0.44, radius: 0.4, albedo: 0.1, atmosphere: false }, 1.2, st, 1);
  assert.equal(inner.distanceValid, false);
  close(inner.distance, Math.sqrt(1.2 ** 2 - 0.44 ** 2), 1e-12, 'greatest elongation');
  assert.ok(inner.distance >= inner.dMin && inner.distance <= inner.dMax);
  assert.ok(inner.elong > 20 && inner.magnitude !== null, `seen in the sky (${inner.elong}°)`);
  const outer = C.bodyFromHome({ a: 5, distance: 1, radius: 11, albedo: 0.5, atmosphere: true }, 1, st, 1);
  assert.equal(outer.distanceValid, false);
  close(outer.distance, 4, 1e-12, 'opposition');
  close(outer.elong, 180, 1e-9);
});

test('TECTONICS sheet', () => {
  const t = d.tectonics;
  // the sheet's gravity input is 1 g; the app links the planet's gravity (1.00028 g)
  const t1 = C.tectonics(w.tectonics, { gravity: 1 });
  close(t1.maxPeak, 9266.981744, 1e-9); // C7
  const f = t1.ranges[0].features;
  assert.equal(f[0].name, 'Outer-Arc Ridge');
  assert.equal(f[0].heightRange.text, '200 – 1500');
  assert.equal(f[0].widthRange.text, '0 – 100');
  assert.deepEqual(f.map((x) => x.erodedHeight), [1250, 250, null, 5750, null, 550]); // C40:C45
  const depths = [2600, 3706.797181, 4165.247584, 4494.213513, 4774.754131, 5013.997867, 5774.844528];
  depths.forEach((v, i) => close(t1.ocean[i].depth, v, 1e-8, `ocean ${i}`));
  const ural = C.mountainRange({ type: 'Ural', heights: [], widths: [], erosion: 5, age: 50 }, 1, 2);
  assert.deepEqual(ural.features.map((x) => x.name), ['Foreland Basin', 'Foreslope', 'Plateau', 'Back Slope']);
  const lar = C.mountainRange({ type: 'Laramide', heights: [], widths: [], erosion: 5, age: 50 }, 1, 2);
  assert.equal(lar.features[2].heightRange.text, 'Taper to peak of 1500 – 6000');
  assert.ok(t.maxPeak > 0);
});

test('POPULATION sheet', () => {
  // the sheet's radius input is 1 R⊕; the app links the planet radius
  // the sheet's own (unrounded) land inputs
  const p = C.population({ ...w.population, land: 29.40804707263154, uninhabitable: 28.666666666666668 }, { radius: 1 });
  close(p.area, 510.0644719, 1e-9);
  close(p.land, 150, 1e-9); close(p.uninhabitable, 43, 1e-9); close(p.habitable, 107, 1e-9);
  close(p.productive, 49.22, 1e-9); close(p.livestock, 37.8994, 1e-9); close(p.crops, 11.3206, 1e-8);
  close(p.capacity, 590640000, 1e-9);
  close(p.world, 47048.00748, 1e-9); // C33
  close(p.density, 0.0003136533832, 1e-8);
  close(p.continents[0], 19203.26836, 1e-9); // C44
  close(p.regions[0], 6556.325195, 1e-9); // C78
  close(p.subregions[0], 1975.850735, 1e-9); // C112
});

test('CALENDAR sheet', () => {
  const c = C.calendar(w.calendar);
  assert.equal(c.solar.common, 365); assert.equal(c.solar.leap, 366);
  const so = c.solar.leapOptions.map((o) => o.value);
  [0.25, 0.2413793103, 0.2424242424, 0.2421875, 0.2422018349].forEach((v, i) => close(so[i], v, 1e-9, `solar leap ${i}`));
  assert.equal(c.solar.months, 12); assert.equal(c.solar.daysPerMonth, 30); assert.equal(c.solar.intercalary, 5);
  assert.equal(c.solar.daysPerWeek, 7); assert.equal(c.solar.weekIntercalary, 2);
  assert.equal(c.lunar.year, 354); assert.equal(c.lunar.commonMonth, 29); assert.equal(c.lunar.leapMonth, 30);
  const lo = c.lunar.leapOptions.map((o) => o.value);
  [1, 0.5, 0.5333333333, 0.5294117647, 0.5306122449].forEach((v, i) => close(lo[i], v, 1e-9, `lunar leap ${i}`));
  assert.equal(c.lunar.daysPerWeek, 7); assert.equal(c.lunar.weekIntercalary, 1);
  assert.equal(c.lunisolar.common, 354); assert.equal(c.lunisolar.leap, 383); assert.equal(c.lunisolar.leapMonths, 13);
  const lso = c.lunisolar.leapOptions.map((o) => o.value);
  [0.5, 0.3333333333, 0.375, 0.3636363636, 0.3684210526].forEach((v, i) => close(lso[i], v, 1e-9, `lunisolar leap ${i}`));
  assert.deepEqual(c.lunisolar.leapOptions.map((o) => `${o.p}/${o.q}`), ['1/2', '1/3', '3/8', '4/11', '7/19']);
});

test('daylight grid is sane for Earth', () => {
  const g = C.daylightGrid(w.planet, d.planet, { days: 4, lats: 37 });
  const eq = g.hours[18];
  eq.forEach((h) => assert.ok(h > 11.9 && h < 12.3, `equator ${h}`));
  // north pole: equinox ~ half day, June solstice 24h, December 0h
  assert.equal(Math.round(g.hours[36][1]), 24);
  assert.equal(Math.round(g.hours[36][3]), 0);
});
