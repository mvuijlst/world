/* The supercontinent generator and drift simulation. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/sphere.js');
const R = require('../js/rotation.js');
const G = require('../js/supercontinent.js');

for (const plates of [3, 4, 5]) for (const seed of [1, 7, 42, 1234, 99991]) {
  test(`supercontinent: ${plates} plates, seed ${seed}`, () => {
    const w = G.generate({ seed, plates, crust: 0.33 });
    const crust = w.features.filter((f) => f.kind === 'crust');
    const cratons = w.features.filter((f) => f.kind === 'craton');
    const rifts = w.features.filter((f) => f.kind === 'rift');
    const failed = w.features.filter((f) => f.kind === 'failed');
    assert.equal(w.plates.length, plates, 'plates');
    assert.equal(crust.length, plates, 'one crust piece per plate');
    // the pieces tile the continent: their areas add up to about a third of the sphere
    const total = crust.reduce((s, f) => s + S.areaFraction(f.coords), 0);
    assert.ok(total > 0.27 && total < 0.39, `crust ${total}`);
    const cover = S.coverage(crust.map((f) => f.coords), 8000);
    assert.ok(Math.abs(cover - total) < 0.015, `pieces do not overlap (${cover} vs ${total})`);
    // every plate has a craton, every craton sits inside its own plate's crust
    for (const p of w.plates) assert.ok(cratons.some((c) => c.plateId === p.id), `craton on ${p.id}`);
    for (const c of cratons) {
      const home = crust.find((f) => f.plateId === c.plateId);
      assert.ok(c.coords.every((q) => S.contains(home.coords, q)), `${c.name} inside its crust`);
    }
    // rifts open between two different plates and do not run through cratons
    assert.equal(rifts.length, 3 + 2 * (plates - 3), 'rifts');
    for (const r of rifts) {
      assert.ok(r.left && r.right && r.left !== r.right, `${r.name} between two plates (${r.left}/${r.right})`);
      assert.ok(!cratons.some((c) => r.coords.some((q) => S.contains(c.coords, q))), `${r.name} skirts the cratons`);
    }
    // failed rifts start on a rift
    assert.ok(failed.length >= 1, 'failed rifts');
    for (const f of failed) assert.ok(rifts.some((r) => S.distanceToLine(f.coords[0], r.coords) < 0.5), `${f.name} on a rift`);
    // same seed, same world
    assert.deepEqual(G.generate({ seed, plates, crust: 0.33 }), w);
  });
}

test('simulation: poles every 20 Myr, plates drifting apart at the speeds asked for', () => {
  const w = G.generate({ seed: 5, plates: 4 });
  const P = { ...w, start: 1000 };
  const plates = G.simulate(P, { seed: 5, duration: 100, interval: 20, minSpeed: 3, maxSpeed: 6, radiusKm: 6371 });
  const m = R.model(plates, 1000);
  const area = (id) => w.features.filter((f) => f.plateId === id && f.kind === 'crust').reduce((s, f) => s + S.areaFraction(f.coords), 0);
  const anchor = plates.slice().sort((a, b) => area(b.id) - area(a.id))[0].id;
  for (const p of plates) {
    assert.deepEqual(p.rotations.map((r) => r.age), [980, 960, 940, 920, 900]);
    const c = S.latLon(S.centroid(w.features.filter((f) => f.plateId === p.id && f.kind === 'crust').flatMap((f) => f.coords)));
    for (let a = 1000; a > 900; a -= 20) {
      const v = R.speed(m, p.id, c, a, a - 20, 6371);
      if (p.id === anchor) assert.ok(v < 1.1, `the largest plate ${p.id} barely moves: ${v} cm/yr`);
      else assert.ok(v > 2.3 && v <= 6.05, `plate ${p.id} ${a}-${a - 20} Ma: ${v} cm/yr`);
    }
  }
  // the plates' centres end further apart than they started
  const cen = (id) => S.latLon(S.centroid(w.features.filter((f) => f.plateId === id && f.kind === 'crust').flatMap((f) => f.coords)));
  const [a, b] = plates.map((p) => p.id).filter((id) => id !== anchor);
  const d0 = S.distance(cen(a), cen(b)), d1 = S.distance(m.reconstruct(a, [cen(a)], 900)[0], m.reconstruct(b, [cen(b)], 900)[0]);
  assert.ok(d1 > d0 + 5, `apart: ${d0} → ${d1}`);
});
