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

test('breaking apart: poles every 20 Myr, plates drifting apart at the speeds asked for', () => {
  const w = G.generate({ seed: 5, plates: 4 });
  const P = { ...w, start: 1000 };
  const { plates } = G.simulate(P, { seed: 5, duration: 100, interval: 20, minSpeed: 3, maxSpeed: 6, radiusKm: 6371 });
  const m = R.model(plates, 1000);
  const area = (id) => w.features.filter((f) => f.plateId === id && f.kind === 'crust').reduce((s, f) => s + S.areaFraction(f.coords), 0);
  const anchor = plates.slice().sort((a, b) => area(b.id) - area(a.id))[0].id;
  const cen = (id) => S.latLon(S.centroid(w.features.filter((f) => f.plateId === id && f.kind === 'crust').flatMap((f) => f.coords)));
  for (const p of plates) {
    assert.deepEqual(p.rotations.map((r) => r.age), [980, 960, 940, 920, 900]);
    for (let a = 1000; a > 900; a -= 20) assert.ok(R.speed(m, p.id, cen(p.id), a, a - 20, 6371) <= 6.05, `plate ${p.id} not too fast`);
    const v = R.speed(m, p.id, cen(p.id), 1000, 980, 6371);
    if (p.id === anchor) assert.ok(v < 1.1, `the largest plate ${p.id} barely moves: ${v} cm/yr`);
    else assert.ok(v > 2.3, `plate ${p.id} drifts: ${v} cm/yr`);
  }
  const [a, b] = plates.map((p) => p.id).filter((id) => id !== anchor);
  const d0 = S.distance(cen(a), cen(b)), d1 = S.distance(m.reconstruct(a, [cen(a)], 900)[0], m.reconstruct(b, [cen(b)], 900)[0]);
  assert.ok(d1 > d0 + 5, `apart: ${d0} → ${d1}`);
});

test('continuing, then coming together: older poles kept, continents collide and weld', () => {
  const w = G.generate({ seed: 11, plates: 4 });
  const P = { ...w, start: 1000 };
  P.plates = G.simulate(P, { seed: 11, mode: 'apart', duration: 150, interval: 25, minSpeed: 3, maxSpeed: 5 }).plates;
  const first = JSON.parse(JSON.stringify(P.plates));
  const run = G.simulate(P, { seed: 11, mode: 'together', from: 850, duration: 400, interval: 25, minSpeed: 3, maxSpeed: 5 });
  for (const p of run.plates) {
    const old = first.find((q) => q.id === p.id).rotations;
    assert.deepEqual(p.rotations.filter((r) => r.age >= 850), old.filter((r) => r.age >= 850), `plate ${p.id} keeps its poles up to 850 Ma`);
    assert.equal(Math.min(...p.rotations.map((r) => r.age)), run.end, 'poles run to where the gathering ended');
  }
  assert.ok(run.assembled && run.end >= 450, `one supercontinent by ${run.end} Ma`);
  assert.ok(run.welds.length >= 1, 'continents collided');
  // once welded, two plates keep their places relative to each other
  const m = R.model(run.plates, 1000);
  const { a, b, age } = run.welds[0];
  const pa = S.latLon(S.centroid(w.features.filter((f) => f.plateId === b && f.kind === 'crust').flatMap((f) => f.coords)));
  const gap = (t) => S.distance(m.reconstruct(a, [pa], t)[0], m.reconstruct(b, [pa], t)[0]);
  const late = Math.max(run.end, age - 100);
  assert.ok(Math.abs(gap(Math.floor(age / 25) * 25) - gap(late)) < 0.6, `welded at ${age} Ma: ${gap(Math.floor(age / 25) * 25)} vs ${gap(late)}`);
});

test('a Wilson cycle runs to the present: apart, wander, together, and round again', () => {
  const w = G.generate({ seed: 2026, plates: 4 });
  const run = G.simulate({ ...w, start: 1000 }, { seed: 2026, mode: 'cycle', duration: 1000, interval: 20, maxSpeed: 4 });
  assert.equal(run.end, 0);
  assert.deepEqual(run.phases.slice(0, 3).map((p) => p.mode), ['apart', 'wander', 'together']);
  assert.ok(run.phases.length >= 4, `${run.phases.length} phases`);
  assert.ok(run.welds.length >= 2, 'continents collided');
  for (const p of run.plates) assert.equal(Math.min(...p.rotations.map((r) => r.age)), 0, `plate ${p.id} has poles to the present`);
});

test('Log 12: subduction zones on leading coasts, island arcs behind them', () => {
  const w = G.generate({ seed: 2026, plates: 4 });
  const P = { ...w, start: 1000 };
  P.plates = G.simulate(P, { seed: 2026, mode: 'apart', duration: 200, interval: 20, maxSpeed: 4 }).plates;
  const marks = G.markSubduction(P, { seed: 2026, every: 25 });
  const zones = marks.filter((f) => f.kind === 'subduction'), arcs = marks.filter((f) => f.kind === 'arc');
  assert.ok(zones.length >= 2, `${zones.length} subduction zones`);
  const m = R.model(P.plates, 1000);
  for (const z of zones) {
    assert.ok(P.plates.some((p) => p.id === z.plateId), 'on a plate');
    assert.ok(z.begin < 1000 && z.begin >= 800 && (z.end === undefined || z.end < z.begin), `${z.name} ${z.begin}-${z.end}`);
    // the overriding side (the teeth) faces the zone's own plate's crust
    const crust = w.features.filter((f) => f.kind === 'crust' && f.plateId === z.plateId);
    const i = Math.floor((z.coords.length - 2) / 2), a = S.vec(z.coords[i]), b = S.vec(z.coords[i + 1]);
    const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], l = Math.hypot(...n);
    const at = (sg) => S.latLon(a.map((x, k) => x + (sg * 0.03 * n[k]) / l));
    const dist = (p) => Math.min(...crust.map((c) => (S.contains(c.coords, p) ? 0 : S.distanceToLine(p, [...c.coords, c.coords[0]]))));
    const over = z.side === 'left' ? 1 : -1;
    assert.ok(dist(at(over)) < dist(at(-over)), `${z.name}: teeth towards its plate`);
    void m;
  }
  for (const a of arcs) assert.ok(zones.some((z) => z.plateId === a.plateId && z.begin === a.begin && Math.min(...a.coords.map((q) => S.distanceToLine(q, z.coords))) < 3), `${a.name} behind its trench`);
});

test('Log 12: a second rifting event splits a plate that moves as one until then', () => {
  const w = G.generate({ seed: 2026, plates: 4 });
  let P = { ...w, start: 1000 };
  P.plates = G.simulate(P, { seed: 2026, mode: 'apart', duration: 200, interval: 20, maxSpeed: 4 }).plates;
  const sr = G.secondRift(P, 900, { seed: 3 });
  assert.ok(sr, 'a rift was found');
  const pid = sr.rift.plateId, nid = sr.nextPlate - 1;
  assert.deepEqual([sr.rift.left, sr.rift.right].sort(), [pid, nid].sort());
  assert.equal(sr.rift.begin, 900);
  const cratons = sr.features.filter((f) => f.kind === 'craton');
  assert.ok(!cratons.some((c) => sr.rift.coords.some((p) => S.contains(c.coords, p))), 'clear of the cratons');
  P = { ...P, ...sr };
  const run = G.simulate(P, { seed: 4, mode: 'apart', from: 900, duration: 100, interval: 20 });
  const m = R.model(run.plates, 1000);
  const c = S.latLon(S.centroid(sr.features.find((f) => f.plateId === nid && f.kind === 'crust').coords));
  const gap = (a) => S.distance(m.reconstruct(nid, [c], a)[0], m.reconstruct(pid, [c], a)[0]);
  for (const a of [1000, 960, 920, 900]) assert.ok(gap(a) < 1e-6, `together at ${a} Ma`);
  assert.ok(gap(800) > 5, `apart by 800 Ma: ${gap(800)}`);
});

test('Log 13: a split-off plate rides its parent until its rift opens, even re-simulated from the start', () => {
  const w = G.generate({ seed: 2026, plates: 4 });
  let P = { ...w, start: 1000 };
  P.plates = G.simulate(P, { seed: 2026, mode: 'apart', duration: 200, interval: 20, maxSpeed: 4 }).plates;
  const sr = G.secondRift(P, 900, { seed: 3 });
  P = { ...P, ...sr };
  const pid = sr.rift.plateId, nid = sr.nextPlate - 1;
  const c = S.latLon(S.centroid(sr.features.find((f) => f.plateId === nid && f.kind === 'crust').coords));
  for (const seed of [7, 8]) {
    // the whole history again, from the start: the run is cut at 900 Ma, where the rift opens
    const run = G.simulate(P, { seed, mode: 'apart', duration: 300, interval: 20, maxSpeed: 4 });
    const m = R.model(run.plates, 1000);
    const gap = (a) => S.distance(m.reconstruct(nid, [c], a)[0], m.reconstruct(pid, [c], a)[0]);
    for (const a of [990, 950, 920, 900]) assert.ok(gap(a) < 1e-6, `seed ${seed}: together at ${a} Ma (${gap(a)})`);
    assert.ok(gap(750) > 5, `seed ${seed}: apart by 750 Ma (${gap(750)})`);
    const child = run.plates.find((p) => p.id === nid);
    const at900 = child.rotations.filter((r) => r.age === 900);
    assert.equal(at900.length, 2, 'a crossover at 900 Ma');
    assert.deepEqual(at900.map((r) => r.fixed ?? 0).sort(), [0, pid].sort());
    assert.equal(m.fixedAt(nid, 950), pid);
    assert.equal(m.fixedAt(nid, 850), 0);
  }
});

test('Log 13: lines crossing a split are cut in two, each stretch on its side', () => {
  const inEast = (v) => v[1] > 0;                       // lon > 0
  const fs = [
    { id: 't', kind: 'subduction', plateId: 1, name: 'Trench', coords: [[0, -20], [0, -10], [0, 10], [0, 20]], side: 'left' },
    { id: 'f', kind: 'failed', plateId: 1, name: 'Arm', coords: [[10, 5], [20, 15]] },
    { id: 'o', kind: 'subduction', plateId: 2, name: 'Other', coords: [[0, -20], [0, 20]] },
  ];
  const out = G.divideLines(fs, 1, inEast, 9);
  const t = out.filter((f) => f.name.startsWith('Trench'));
  assert.equal(t.length, 2);
  assert.deepEqual(t.map((f) => f.plateId).sort(), [1, 9]);
  assert.ok(t.every((f) => f.side === 'left'), 'the polarity carries over');
  assert.deepEqual(t[0].coords[t[0].coords.length - 1], t[1].coords[0], 'the two stretches meet');
  assert.equal(out.find((f) => f.name === 'Arm').plateId, 9, 'wholly on the new side');
  assert.equal(out.find((f) => f.name === 'Other').plateId, 2, 'other plates untouched');
});
