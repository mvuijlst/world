/* Climate: sunlight, Köppen, and climates of very different planets. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');
const G = require('../js/supercontinent.js');
const M = require('../js/worldmap.js');
const K = require('../js/climate.js');

test('sunlight by latitude and season', () => {
  near(K.insolation(0, 0, 1361), 1361 / Math.PI, 0.5, 'equator at equinox');
  assert.ok(K.insolation(90, 23.5, 1361) > K.insolation(0, 23.5, 1361), 'a pole in midsummer gets more than the equator');
  assert.equal(K.insolation(80, -23.5, 1361), 0, 'polar night');
});

test('Köppen from seasons', () => {
  assert.equal(K.koppen(28, 26, 1500, 1200), 'Af');
  assert.equal(K.koppen(34, 18, 20, 10), 'BWh');
  assert.equal(K.koppen(17, 5, 400, 500), 'Cfb');
  assert.equal(K.koppen(16, -25, 300, 150), 'Dfb');
  assert.equal(K.koppen(6, -30, 150, 100), 'ET');
  assert.equal(K.koppen(-5, -40, 50, 50), 'EF');
  assert.equal(K.koppen(26, 8, 40, 500), 'Csa');
});

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);
const EARTH = { tilt: 23.5, flux: 1, meanC: 15, gravity: 1, radiusKm: 6371, pressure: 1, cells: [[0, 30], [30, 60], [60, 90]] };
const world = G.makeWorld({ seed: 7, plates: 4 });
const map = M.build(world, { res: 360 });
const zonal = (c, f, la) => { const j = c.lat.findIndex((x) => Math.abs(x - la) <= 180 / c.H); let s = 0; for (let i = 0; i < c.W; i++) s += f(j * c.W + i); return s / c.W; };
const share = (c, pick) => { let a = 0, n = 0; for (let k = 0; k < c.W * c.H; k++) if (c.land[k]) { const w = Math.cos((c.lat[Math.floor(k / c.W)] * Math.PI) / 180); n += w; if (pick(c.zones[c.zone[k] - 1][0])) a += w; } return a / n; };

test('an Earth-like planet: warm equator, cold poles, trade winds, deserts and forests', () => {
  const c = K.build(map, EARTH);
  for (const s of Object.values(c.seasons)) for (const f of [s.T, s.Pr, s.u, s.v, s.P]) assert.ok(f.every(Number.isFinite));
  const ann = (k) => (c.seasons.jan.T[k] + c.seasons.jul.T[k]) / 2;
  assert.ok(zonal(c, ann, 0) > zonal(c, ann, 70) + 20, 'equator much warmer than 70°');
  // the trades blow from the east over the sea at 15°
  const trades = zonal(c, (k) => (c.land[k] ? 0 : c.seasons.jan.u[k] + c.seasons.jul.u[k]), 15);
  assert.ok(trades < 0, `easterlies at 15° (${trades})`);
  assert.ok(share(c, (z) => z[0] === 'B') > 0.03 && share(c, (z) => /^[ACD]/.test(z)) > 0.2, 'some deserts, more green');
  assert.ok(c.sst.some((v) => v > 1) && c.sst.some((v) => v < -1), 'warm and cold currents');
});

test('other worlds: high tilt warms the poles, retrograde spin turns the winds, a locked world has a hot face', () => {
  const ann = (c) => (k) => (c.seasons.jan.T[k] + c.seasons.jul.T[k]) / 2;
  const tilted = K.build(map, { ...EARTH, tilt: 85 });
  assert.ok(zonal(tilted, ann(tilted), 80) > zonal(tilted, ann(tilted), 0), 'at 85° tilt the poles are warmer over the year');
  // ...but the equator still has a warm season, at the equinoxes, when the sun is overhead
  assert.ok(zonal(tilted, (k) => tilted.equinoxT[k], 0) > zonal(tilted, (k) => Math.max(tilted.seasons.jan.T[k], tilted.seasons.jul.T[k]), 0) + 10, 'equinox warmth at the equator');
  const retro = K.build(map, { ...EARTH, tilt: 156.5, retrograde: true });
  const trades = zonal(retro, (k) => (retro.land[k] ? 0 : retro.seasons.jan.u[k] + retro.seasons.jul.u[k]), 15);
  assert.ok(trades > 0, `westerly "trades" on a retrograde world (${trades})`);
  const locked = K.build(map, { ...EARTH, locked: true, tilt: 0, subsolarLon: 0, cells: C.circulationCells(5000).bands });
  const at = (c, la, lo) => c.seasons.jul.T[c.lat.findIndex((x) => Math.abs(x - la) <= 180 / c.H) * c.W + Math.floor(((lo + 180) / 360) * c.W)];
  assert.ok(at(locked, 0, 0) > at(locked, 0, 179) + 40, 'day face far warmer than the night face');
  assert.deepEqual(Array.from(locked.seasons.jan.T.slice(0, 50)), Array.from(locked.seasons.jul.T.slice(0, 50)), 'no seasons');
});

test('cold and hot worlds, thin and thick air, dry and wet', () => {
  const frozen = K.build(map, { ...EARTH, flux: 0.43, meanC: -60, pressure: 0.006, gravity: 0.38, radiusKm: 3390 });
  assert.ok(share(frozen, (z) => z[0] === 'E') > 0.99, 'a Mars-like world is all ice and tundra');
  const hot = K.build(map, { ...EARTH, flux: 1.6, meanC: 45, pressure: 3 });
  assert.ok(share(hot, (z) => z[0] === 'E') < 0.05 && share(hot, (z) => /^[AB]/.test(z)) > 0.5, 'a hothouse is tropical and desert');
  const thick = K.build(map, { ...EARTH, pressure: 10 }), thin = K.build(map, { ...EARTH, pressure: 0.2 });
  const range = (c) => { const a = (k) => (c.seasons.jan.T[k] + c.seasons.jul.T[k]) / 2; return zonal(c, a, 0) - zonal(c, a, 70); };
  assert.ok(range(thick) < range(thin), 'thicker air, smaller pole-to-equator range');
  const dryMap = M.build(world, { res: 360, land: 0.33 });
  const rain = (c) => { let s = 0, n = 0; for (let k = 0; k < c.W * c.H; k++) if (c.land[k]) { s += c.seasons.jan.Pr[k] + c.seasons.jul.Pr[k]; n++; } return s / n; };
  assert.ok(rain(K.build(dryMap, EARTH)) < rain(K.build(map, EARTH)), 'less sea, less rain');
});
