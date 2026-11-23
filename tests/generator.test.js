'use strict';
// Regenerating the planetary system around any star puts the home world on a
// stable, habitable orbit and keeps the moon bound.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/calc.js');
const D = require('../js/data.js');
globalThis.WS = Object.assign(globalThis.WS || {}, { calc: C, data: D });
require('../js/generator.js');
const G = globalThis.WS.generate;

test('regenerated systems always hold a habitable home world', () => {
  for (const mass of [0.075, 0.1, 0.3, 0.5, 0.8, 1, 1.4, 2, 5, 20, 100]) {
    for (let seed = 1; seed <= 40; seed++) {
      const w = D.defaultWorld();
      w.star.mass = mass;
      w.star.age = 0.01;
      const st = C.star(w.star);
      const before = JSON.parse(JSON.stringify(w.planet));
      const p = G.regenerateSystem(w, seed);
      Object.assign(w.planet, p.planet);
      w.system = p.system;
      if (p.moon) Object.assign(w.moon, p.moon);
      const where = `M=${mass} seed=${seed}`;
      assert.ok(G.homeIsHabitable(w, st), `home in HZ (${where})`);
      const sys = C.system(w.system, st);
      assert.ok(sys.orbits.some((o) => o.habitable && !o.crowded && !o.insideLimit && Math.abs(o.a - w.planet.a) / o.a < 0.03), `home on a stable orbit (${where})`);
      const pl = C.planet(w.planet, st);
      assert.ok(pl.periapsis >= st.hzIn && pl.apoapsis <= st.hzOut, `whole orbit in HZ (${where})`);
      const mz = C.moon(w.moon, w.planet, pl, st);
      assert.ok(mz.periapsis > mz.zoneIn && mz.apoapsis < mz.zoneOut / 2, `moon bound and stable (${where})`);
      assert.equal(w.planet.mass, before.mass);
      assert.equal(w.planet.tilt, before.tilt);
      for (const b of w.system.bodies) {
        if (b.kind === 'gas' || b.kind === 'ice') assert.ok(b.a >= st.frostLine, `giant beyond frost line (${where})`);
      }
    }
  }
});

test('body names are reused by kind', () => {
  const w = D.defaultWorld();
  w.system.bodies = [D.blankBody('terrestrial', 0.4), D.blankBody('gas', 5)];
  w.system.bodies[0].name = 'Hermes';
  w.system.bodies[1].name = 'Zeus';
  w.star.mass = 0.7;
  const p = G.regenerateSystem(w, 7);
  const names = p.system.bodies.map((b) => b.name);
  if (p.system.bodies.some((b) => b.kind === 'gas')) assert.equal(p.system.bodies.find((b) => b.kind === 'gas').name, 'Zeus');
  if (p.system.bodies.some((b) => b.kind === 'terrestrial')) assert.equal(p.system.bodies.find((b) => b.kind === 'terrestrial').name, 'Hermes');
  assert.ok(names.length > 0);
});

test('rolled worlds still sit in the habitable zone', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const w = G.randomWorld(seed);
    assert.ok(G.homeIsHabitable(w), `seed ${seed}`);
  }
});
