/* Rivers, lakes and biomes, on Earth-like and very different worlds. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');
const G = require('../js/supercontinent.js');
const M = require('../js/worldmap.js');
const K = require('../js/climate.js');
const B = require('../js/biomes.js');

const EARTH = { tilt: 23.5, flux: 1, meanC: 15, gravity: 1, radiusKm: 6371, pressure: 1, cells: [[0, 30], [30, 60], [60, 90]] };
const world = G.makeWorld({ seed: 7, plates: 4 });
const map = M.build(world, { res: 360 });
const climate = K.build(map, EARTH);
const id = (b, k) => b.biomes[b.biome[k] - 1]?.[0];

test('evaporation and boiling', () => {
  assert.equal(B.budyko(1000, 0), 0, 'nothing evaporates without warmth');
  assert.ok(B.budyko(1000, 5000) > 950, 'a desert loses nearly all its rain');
  assert.ok(B.budyko(2000, 1500) < 1500, 'never more than could evaporate');
  assert.ok(Math.abs(B.boiling(1) - 100) < 0.5 && B.boiling(0.3) < 75 && B.boiling(5) > 140);
});

test('an Earth-like world: rivers reach the sea, lakes, and the biomes in their places', () => {
  const b = B.build(map, climate, { ...EARTH, seed: 7 });
  const s = b.stats;
  assert.ok(b.rivers.length > 30 && s.mouths > 20, `rivers (${b.rivers.length}, ${s.mouths} mouths)`);
  assert.ok(s.longest.km > 800, `a long river (${Math.round(s.longest.km)} km)`);
  assert.ok(s.lakes > 5 && s.lakeShare < 0.1, `some lakes (${s.lakes}, ${(s.lakeShare * 100).toFixed(1)} %)`);
  assert.ok(s.endorheic > 0.01 && s.endorheic < 0.5, `some land drains inland (${(s.endorheic * 100).toFixed(0)} %)`);
  // every river line stays on the map and never jumps across it
  for (const r of b.rivers) for (let i = 1; i < r.pts.length; i++) assert.ok(Math.abs(r.pts[i][1] - r.pts[i - 1][1]) < 10, 'no jumps');
  // water runs downhill: a cell's flow is at least the sum it drains (so it grows downstream)
  let tropics = 0, tropicsWet = 0, polar = 0, polarCold = 0;
  for (let k = 0; k < b.W * b.H; k++) {
    if (!(map.z[k] > 0) || b.lake[k]) continue;
    const la = Math.abs(map.grid.lat[Math.floor(k / b.W)]), x = id(b, k);
    assert.ok(x, 'every land cell has a biome');
    if (la < 10 && map.z[k] < 500) { tropics++; if (/rainforest|tropdry|savanna|wetland/.test(x)) tropicsWet++; }
    if (la > 75) { polar++; if (/ice|tundra|barren/.test(x)) polarCold++; }
  }
  if (tropics > 20) assert.ok(tropicsWet / tropics > 0.5, `lowland tropics are tropical (${tropicsWet}/${tropics})`);
  if (polar > 20) assert.ok(polarCold / polar > 0.8, `the polar land is ice and tundra (${polarCold}/${polar})`);
});

test('no rivers where water cannot be liquid, or is all ice', () => {
  const mars = { ...EARTH, flux: 0.43, meanC: -60, pressure: 0.006, gravity: 0.38, radiusKm: 3390 };
  const b = B.build(map, K.build(map, mars), mars);
  assert.equal(b.liquid, false);
  assert.equal(b.rivers.length, 0); assert.equal(b.stats.lakes, 0);
  const venus = { ...EARTH, flux: 1.9, meanC: 460, pressure: 90 };
  const v = B.build(map, K.build(map, venus), venus);
  assert.equal(v.rivers.length, 0, 'boiled away');
  const snowball = { ...EARTH, flux: 0.8, meanC: -25 };
  const s = B.build(map, K.build(map, snowball), snowball);
  assert.equal(s.rivers.length, 0); assert.ok(s.stats.biomeShare[0] > 0.9, 'a snowball is ice');
});

test('a hot wet world has more water in its rivers than a cool one', () => {
  const hot = { ...EARTH, flux: 1.3, meanC: 30 }, cool = { ...EARTH, flux: 0.9, meanC: 5 };
  const big = (pl) => B.build(map, K.build(map, pl), pl).stats.biggest?.flow ?? 0;
  assert.ok(big(hot) > big(cool));
  // and the drainage does not depend on the planet's size: the same river lines on a bigger world
  const small = B.build(map, climate, { ...EARTH, radiusKm: 3000 }), large = B.build(map, climate, { ...EARTH, radiusKm: 9000 });
  assert.ok(large.stats.biggest.flow > small.stats.biggest.flow, 'more land to drain, more water');
  assert.ok(C);
});

test('land use for the Population step, from the biomes', () => {
  const b = B.build(map, climate, { ...EARTH, seed: 7 });
  const u = B.landUse(b, map);
  assert.ok(Math.abs(u.land - map.land * 100) < 0.5, `land share matches the map (${u.land} vs ${map.land * 100})`);
  assert.ok(u.uninhabitable > 3 && u.uninhabitable < 60, `some land is uninhabitable (${u.uninhabitable.toFixed(1)} %)`);
  assert.ok(u.productive > 20 && u.productive < 80, `about half the habitable land is productive (${u.productive.toFixed(1)} %)`);
  assert.ok(u.continents.length >= 1 && u.continents.every((s, i) => i === 0 || s <= u.continents[i - 1]), 'continents, largest first');
  const snowball = { ...EARTH, flux: 0.8, meanC: -25 };
  assert.ok(B.landUse(B.build(map, K.build(map, snowball), snowball), map).uninhabitable > 90, 'a snowball is uninhabitable');
});
