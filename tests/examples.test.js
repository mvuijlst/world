/* The example worlds (examples/*.worldsmith.json: unusual planets) through the whole surface pipeline,
   at low detail: map, climate, glaciers and rivers, rivers & biomes. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const C = require('../js/calc.js');
const M = require('../js/worldmap.js');
const K = require('../js/climate.js');
const B = require('../js/biomes.js');

const DIR = path.join(__dirname, '..', 'examples');
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.worldsmith.json'));

// as the app does it (js/steps/climate.js, biomes.js, worldmap.js)
const climPlanet = (w, d) => ({
  tilt: w.planet.tilt, rotation: w.planet.rotation, retrograde: w.planet.tilt > 90, flux: d.star.luminosity / (w.planet.a * w.planet.a),
  pressure: w.planet.pressure, meanC: d.planet.temperatureC, gravity: d.planet.gravity, radiusKm: d.planet.radiusKm,
  cells: (d.planet.cells && d.planet.cells.bands) || [], locked: w.planet.rotation >= 0.95 * d.planet.yearEarthDays * 24, subsolarLon: w.planet.subsolarLon ?? 0, seed: w.plates.seed ?? 1,
});

test('there are example worlds', () => assert.ok(files.length >= 8, files.join()));

for (const f of files) {
  test(`example world ${f}`, () => {
    const w = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
    const d = C.computeAll(w);
    assert.ok(w.planet.a >= d.star.hzIn && w.planet.a <= d.star.hzOut, 'in the habitable zone');
    assert.ok(d.system.orbits.some((o) => Math.abs(o.a - w.planet.a) / o.a < 0.03), 'on a stable orbit');
    const tides = M.planetTides({ moonMass: w.moon.enabled ? w.moon.mass : 0, moonKm: w.moon.a, starMass: w.star.mass, au: w.planet.a, locked: w.planet.rotation >= 0.95 * d.planet.yearEarthDays * 24, radiusKm: d.planet.radiusKm, gravity: d.planet.gravity });
    const map = M.build(w.plates, { res: 180, land: w.population.land / 100, seed: w.plates.seed, gravity: d.planet.gravity, scaling: w.tectonics.scaling, radiusKm: d.planet.radiusKm, ridgeDepth: w.tectonics.ridgeDepth, cells: d.planet.cells.count, tides, carve: false });
    const clim = K.build(map, climPlanet(w, d)), bpl = { pressure: w.planet.pressure, seed: w.plates.seed, radiusKm: d.planet.radiusKm, gravity: d.planet.gravity };
    const water = B.water(map, clim, bpl);
    M.carveMap(map, { water, iceAge: w.map.iceAge ?? 6 });
    assert.ok(map.z.every(Number.isFinite), 'every height is a number');
    assert.ok(map.land > 0.1 && map.land < 0.6, `land ${map.land}`);
    const bio = B.build(map, clim, bpl);
    if (w.planet.pressure < 0.0061) {
      assert.equal(map.rivers, null, 'no liquid water: nothing carved');
      assert.equal(bio.rivers.length, 0, 'and no rivers');
    } else {
      assert.ok(map.rivers && map.rivers.eroded > 0, 'carved');
      assert.ok(bio.rivers.length > 0, 'rivers');
      // big tides make estuaries, none make deltas
      const kinds = map.rivers.mouthList.map((m) => m.kind);
      if (tides > 5) assert.ok(kinds.filter((k) => k === 'estuary').length > kinds.filter((k) => /delta/.test(k)).length, `tides ${tides}: ${kinds.join()}`);
      if (tides === 0) assert.ok(!kinds.includes('estuary'), 'no tides, no estuaries');
    }
  });
}
