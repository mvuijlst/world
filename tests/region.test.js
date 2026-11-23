/* A region: a closer map that agrees with the world map it is cut from. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/supercontinent.js');
const M = require('../js/worldmap.js');
const K = require('../js/climate.js');
const B = require('../js/biomes.js');
const R = require('../js/region.js');

const EARTH = { tilt: 23.5, flux: 1, meanC: 15, gravity: 1, radiusKm: 6371, pressure: 1, cells: [[0, 30], [30, 60], [60, 90]] };
const map = M.build(G.makeWorld({ seed: 7, plates: 4 }), { res: 360, carve: false });
const clim = K.build(map, EARTH);
M.carveMap(map, { water: B.water(map, clim, { ...EARTH, seed: 7 }) });
const water = B.water(map, clim, { ...EARTH, seed: 7 });
// the mouth of the largest river away from the poles: land, sea and rivers in one window
const mouth = map.rivers.mouthList.filter((m) => m.from >= 0).map((m) => [map.grid.lat[Math.floor(m.from / map.W)], -180 + ((m.from % map.W) + 0.5) * (360 / map.W)]).find(([la]) => Math.abs(la) < 60);
const reg = R.build(map, water, { lat: mouth[0], lon: mouth[1], span: 1200, res: 256, seed: 7 });

test('the window: square in km, the right size, where it was asked for', () => {
  const fr = reg.frame;
  assert.equal(reg.z.length, 256 * 256);
  assert.ok(Math.abs(fr.pxKm - 1200 / 256) < 1e-9);
  assert.ok(Math.abs((fr.north + fr.south) / 2 - mouth[0]) < 1e-6);
  const k = R.pixelOf(reg, mouth[0], mouth[1]);
  assert.ok(Math.abs(k - (128 * 256 + 128)) <= 257, 'the centre pixel');
  assert.equal(R.pixelOf(reg, fr.north + 1, mouth[1]), -1);
});

test('it agrees with the world map: land where it has land, sea where it has sea', () => {
  let same = 0, n = 0, hiDiff = 0;
  for (let y = 0; y < reg.H; y += 4) for (let x = 0; x < reg.W; x += 4) {
    const [la, lo] = R.latLonOf(reg, x + 0.5, y + 0.5), zw = M.sample(map, la, lo), zr = reg.z[y * reg.W + x];
    if (Math.abs(zw) < 150) continue;                 // (the shore may move)
    n++; if ((zw > 0) === (zr > 0)) same++;
    if (zw > 0) hiDiff = Math.max(hiDiff, Math.abs(zr - zw));
  }
  assert.ok(same / n > 0.97, `land and sea agree at ${same} of ${n}`);
  assert.ok(hiDiff < 3000, `heights within the detail: ${hiDiff}`);
});

test('water runs downhill to the sea or out of the window, gathering on the way', () => {
  let bad = 0;
  for (let k = 0; k < reg.z.length; k++) {
    const r = reg.recv[k];
    if (reg.z[k] > 0 && r >= 0 && reg.z[r] > 0 && !reg.lake[k] && reg.flow[r] + 1e-6 < reg.flow[k] && !reg.lake[r]) bad++;
  }
  assert.ok(bad < reg.z.length * 0.002, `flow shrinking downstream at ${bad} pixels`);
  assert.ok(reg.rivers.length > 5, `${reg.rivers.length} rivers`);
  assert.ok(reg.stats.biggest && reg.stats.biggest.q > 100, 'a river of some size leaves the window');
  assert.ok(reg.inflows.every((f) => f.q > 0));
});

test('colder with height: a mountain window has colder biomes on its heights than in its valleys', () => {
  // the world map's highest ground away from the poles
  let best = -1; for (let k = 0; k < map.z.length; k++) if (Math.abs(map.grid.lat[Math.floor(k / map.W)]) < 50 && (best < 0 || map.z[k] > map.z[best])) best = k;
  const at = [map.grid.lat[Math.floor(best / map.W)], -180 + ((best % map.W) + 0.5) * (360 / map.W)];
  const mtn = R.build(map, water, { lat: at[0], lon: at[1], span: 600, res: 192, seed: 7 });
  const land = []; for (let k = 0; k < mtn.z.length; k++) if (mtn.z[k] > 0 && !mtn.lake[k]) land.push(k);
  land.sort((a, b) => mtn.z[a] - mtn.z[b]);
  const tenth = Math.floor(land.length / 10), cold = new Set([B.BI.ice, B.BI.tundra, B.BI.barren, B.BI.boreal]);
  const share = (ks) => ks.filter((k) => cold.has(mtn.biome[k])).length / ks.length;
  assert.ok(mtn.z[land[land.length - 1]] - mtn.z[land[0]] > 1500, 'a window with relief');
  assert.ok(share(land.slice(-tenth)) > share(land.slice(0, tenth)), `cold biomes: heights ${share(land.slice(-tenth))}, lowland ${share(land.slice(0, tenth))}`);
});

test('the same window twice: the same map (seeded)', () => {
  const again = R.build(map, water, { lat: mouth[0], lon: mouth[1], span: 1200, res: 256, seed: 7 });
  assert.deepEqual(again.z, reg.z);
  assert.equal(again.rivers.length, reg.rivers.length);
});
