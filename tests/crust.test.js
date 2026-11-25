/* Mountain belts from what the plates did (js/crust.js): thickening, isostasy, the gravity cap, and the
   plates' closing read from the rotation model. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const CR = require('../js/crust.js');
const Q = require('../js/rotation.js');
const G = require('../js/supercontinent.js');
const C = CR.C;
const kept = (shorteningKm) => C.CRUST_KEPT * shorteningKm * C.CRUST_KM;     // km² of crust a collision keeps

test('Airy isostasy: thickened crust stands at (ρm − ρc)/ρm of the extra thickness', () => {
  assert.ok(Math.abs(CR.airy(35) - 35000 * (C.RHO_MANTLE - C.RHO_CRUST) / C.RHO_MANTLE) < 1e-9);
  assert.ok(Math.abs(CR.airy(35) - 5303) < 5, `doubling 35 km crust: ${CR.airy(35)} m`);
  // the thickest crust that stands holds up the cap exactly
  assert.ok(Math.abs(CR.airy(CR.thickMax(1) - C.CRUST_KM) - C.MEAN_CAP_M) < 1e-6);
});

test('Earth-like inputs, Earth-like belts: a long fast collision a high range and a plateau, a short slow one hills', () => {
  // India into Asia: some 2000 km shortened (5 cm/yr for 40 Myr)
  const big = CR.thicken(kept(2000));
  assert.ok(big.plateau, 'a plateau');
  assert.ok(big.height > 0.8 * C.MEAN_CAP_M && big.height <= C.MEAN_CAP_M + 1e-6, `mean ${big.height} m (Tibet ~5000)`);
  assert.ok(big.width > 700 && big.width < 2000, `${big.width} km wide (Himalaya and Tibet ~1000-1500)`);
  // the Alps: some 200 km
  const alps = CR.thicken(kept(200));
  assert.ok(!alps.plateau && alps.height > 1000 && alps.height < 3000 && alps.crest > 2500 && alps.crest < 5000, `Alps-like: mean ${alps.height}, crest ${alps.crest} m`);
  // a short slow one: 0.3 cm/yr for 10 Myr, 30 km
  const hills = CR.thicken(kept(30));
  assert.ok(!hills.plateau && hills.crest < 1500, `hills: crest ${hills.crest} m`);
});

test('more shortening never makes a lower or narrower belt', () => {
  let prev = CR.thicken(0);
  for (let s = 5; s <= 5000; s += 5) {
    const b = CR.thicken(kept(s));
    assert.ok(b.height >= prev.height - 1e-9 && b.crest >= prev.crest - 1e-9 && b.width >= prev.width - 1e-9, `at ${s} km`);
    prev = b;
  }
});

test('gravity scales the cap: heavier worlds hold up less, and widen into plateaus sooner', () => {
  const f = 1.5 ** 2;                                      // 1.5 g, scaling 2
  assert.ok(Math.abs(CR.airy(CR.thickMax(f) - C.CRUST_KM) - C.MEAN_CAP_M / f) < 1e-6);
  const earth = CR.thicken(kept(2000), 1), heavy = CR.thicken(kept(2000), f), light = CR.thicken(kept(2000), 0.5 ** 1);
  assert.ok(heavy.height < earth.height && heavy.width > earth.width, 'lower and wider under more gravity');
  assert.ok(light.height > earth.height, 'higher under less');
  assert.ok(CR.thicken(kept(300), f).plateau && !CR.thicken(kept(300), 1).plateau, 'a plateau sooner');
});

test('the plates’ motion: a plate turning about the pole at a known rate', () => {
  // 9° in 100 Myr about the north pole: at the equator 1000 km in 100 Myr = 1 cm/yr, eastward
  const plates = [{ id: 1, rotations: [{ age: 0, lat: 90, lon: 0, angle: 0 }, { age: 100, lat: 90, lon: 0, angle: -9 }] }];
  const m = Q.model(plates, 1000);
  const v = CR.velocity(m, 1, Q.rotate(m.absolute(1, 50), [1, 0, 0]), 50, 6371);
  assert.ok(Math.abs(Math.hypot(...v) - 1.0007) < 0.01, `${Math.hypot(...v)} cm/yr`);
});

test('every belt of a made world gets what its plates did; the same every time; no belt above the cap', () => {
  const P = G.makeWorld({ seed: 7, plates: 4 });
  const a = CR.belts(P), b = CR.belts(P);
  assert.deepEqual(a, b);
  assert.equal(a.length, P.features.filter((f) => f.kind === 'orogen').length);
  for (const r of a) {
    assert.ok([r.closing, r.myr, r.shortening, r.width, r.height, r.crest].every(Number.isFinite), r.id);
    assert.ok(r.height <= C.MEAN_CAP_M + 1e-6 && r.crestDT <= CR.thickMax(1) - C.CRUST_KM + 1e-9, r.id);
  }
  // collisions close from when the continents meet until they weld, as the history records it
  const sut = new Map(P.features.filter((f) => f.kind === 'suture').map((f) => [`o${f.id}`, f]));
  const col = a.filter((r) => r.type === 'collision' && r.shortening > 0);
  assert.ok(col.length >= 3, `${col.length} collisions`);
  for (const r of col) { const s = sut.get(r.id); assert.equal(r.path, 'weld'); assert.ok(r.myr > 0 && r.myr <= s.begin - s.weld + 2.5, `${r.myr} vs ${s.begin} → ${s.weld}`); }
  // trenches: a range only from compression episodes
  for (const r of a.filter((x) => x.type === 'cordillera')) assert.equal(r.path, 'episodes');
});

test('an older history, without those records, still gets its belts by the assumptions', () => {
  const P = G.makeWorld({ seed: 7, plates: 4 });
  const old = { ...P, features: P.features.map((f) => { const g = { ...f }; delete g.episodes; delete g.weld; return g; }) };
  const rows = CR.belts(old);
  assert.ok(rows.filter((r) => r.type === 'cordillera').every((r) => r.path === 'assumed'));
  assert.ok(rows.filter((r) => r.type === 'collision').every((r) => r.path === 'assumed'));
});

// ── a belt through time (part two: the map's belts) ──
const KEPT = C.CRUST_KEPT * C.CRUST_KM;
/* A belt fed `cm` cm/yr of closing (× share) for `myr` Myr, ending `after` Myr ago, under `rain` (1: Earth's mean). */
function grown(cm, myr, { rain = 1, after = 0, share = 1, f = 1, g = 1 } = {}) {
  const t = [], F = [];
  for (let x = myr; x > 1e-9; x -= C.STEP_MYR) { t.push(x + after); F.push(KEPT * share * cm * 10); }
  return CR.thicken(CR.evolve(t, F, 0, () => rain ** C.RAIN_EXP * Math.sqrt(g), f).A, f);
}

test('Earth-like inputs give Earth-like young belts: within the heights the map once drew by type', () => {
  // (the old fixed crest heights by type, kept here only as a yardstick)
  const PEAK = { collision: 6600, cordillera: 4600, accretion: 2600 };
  const india = grown(5, 50, { rain: 0.5 }), alps = grown(1, 30), andes = grown(3, 50, { rain: 0.5, share: C.ANDEAN_SHARE });
  const arc = CR.thicken(CR.evolve([C.STEP_MYR], [(150 * C.ARC_CRUST_KM) / C.STEP_MYR], 0, () => 1, 1).A, 1);   // a 150 km arc, just accreted
  const within = (b, peak, lo, hi) => b.crest >= lo * peak && b.crest <= hi * peak;
  assert.ok(india.plateau && within(india, PEAK.collision, 0.6, 1) && india.width > 800, `India-Asia: a plateau, crest ${india.crest} m, ${india.width} km wide`);
  assert.ok(!alps.plateau && within(alps, PEAK.collision, 0.4, 0.8) && alps.width > 150 && alps.width < 450, `Alps: crest ${alps.crest} m, ${alps.width} km wide`);
  assert.ok(within(andes, PEAK.cordillera, 0.7, 1.1), `Andes: crest ${andes.crest} m`);
  assert.ok(within(arc, PEAK.accretion, 0.8, 1.6), `an accreted arc: crest ${arc.crest} m`);
  // a short slow one: hills
  assert.ok(grown(0.3, 10).crest < 0.3 * PEAK.collision, 'a short slow collision makes hills');
});

test('rain wears a belt: a wet one stands lower and narrower than a dry one fed alike', () => {
  for (const [cm, myr] of [[1, 30], [2, 40], [3, 50]]) {
    const wet = grown(cm, myr, { rain: 1.8 }), dry = grown(cm, myr, { rain: 0.4 });
    assert.ok(wet.width < dry.width && wet.height <= dry.height, `${cm} cm/yr × ${myr} Myr: wet ${wet.width} km / ${wet.height} m, dry ${dry.width} km / ${dry.height} m`);
  }
  // erosion follows Montgomery & Brandon's relation: slow where relief is low, steep near the limit
  assert.ok(CR.erosionRate(0.5, 1) < 0.1 && CR.erosionRate(4.9, 1) > 5 && CR.erosionRate(4.9, 1) < 10);
  // more fed, never lower or narrower
  let prev = grown(0.2, 40);
  for (let cm = 0.4; cm <= 6; cm += 0.2) { const b = grown(cm, 40); assert.ok(b.height >= prev.height - 1e-6 && b.width >= prev.width - 1e-6, `${cm} cm/yr`); prev = b; }
});

test('once it stops rising a belt wears down slowly, held up by its root: old belts last', () => {
  const at = (after) => grown(3, 40, { after });
  const h = [0, 50, 100, 250, 500].map((a) => at(a).crest);
  for (let i = 1; i < h.length; i++) assert.ok(h[i] < h[i - 1], `lower with age: ${h.join(', ')}`);
  assert.ok(h[3] > 500 && h[3] < 2500, `after 250 Myr an Appalachian-like ${h[3]} m crest`);
  assert.ok(h[4] < 300, `after 500 Myr nearly a plain: ${h[4]} m`);
});

test('under heavier gravity a belt holds up less and spreads; under lighter, more', () => {
  const earth = grown(3, 40), heavy = grown(3, 40, { f: 1.97 ** 2, g: 1.97 }), light = grown(3, 40, { f: 0.51 ** 2, g: 0.51 });
  assert.ok(heavy.crest < 0.5 * earth.crest && heavy.width > earth.width, `heavy: ${heavy.crest} m, ${heavy.width} km`);
  assert.ok(light.crest > earth.crest, `light: ${light.crest} m`);
});

test('the map’s belts: point by point along each, from the record; the same every time; an older history by its fallbacks', () => {
  const P = G.makeWorld({ seed: 21, plates: 4 });
  const a = CR.beltsAt(P), b = CR.beltsAt(P);
  assert.deepEqual(a.map((x) => x.stations.map((s) => s.A)), b.map((x) => x.stations.map((s) => s.A)));
  assert.deepEqual([...new Set(a.map((x) => x.path))].sort(), ['arc', 'episodes', 'weld']);
  // along a belt, where the plates fed it more it stands higher
  const varied = a.filter((x) => x.stations.length >= 3 && x.rising).filter((x) => { const c = x.stations.map((s) => s.crest); return Math.max(...c) > 1.1 * Math.min(...c); });
  assert.ok(varied.length >= 2, `${varied.length} young belts vary along their length`);
  // a few belts at the height cap at most
  assert.ok(a.filter((x) => x.atCap).length <= 5, `${a.filter((x) => x.atCap).length} at the cap`);
  // an older history, without the new records: every belt still built
  const old = { ...P, features: P.features.map((f) => { const g = { ...f }; delete g.episodes; delete g.weld; return g; }) };
  const rows = CR.beltsAt(old);
  assert.equal(rows.length, a.length);
  assert.ok(rows.filter((r) => r.type !== 'accretion').every((r) => r.path === 'assumed'));
  // a belt drawn by hand: from its outline, an assumed closing while it rose
  const drawn = CR.beltsAt({ start: 1000, plates: [{ id: 1, rotations: [] }], features: [{ id: 'x', kind: 'orogen', type: 'collision', plateId: 1, coords: [[0, 0], [0, 5], [3, 5], [3, 0]], begin: 60, active: 0 }] });
  assert.equal(drawn[0].path, 'drawn');
  assert.ok(drawn[0].stations[0].crest > 1000);
});

test('a heavy world raises cordilleras behind its trenches (from the coast, not a gravity-scaled distance)', () => {
  const P = G.makeWorld({ seed: 11, plates: 4, radiusKm: 9299, gravity: 1.97, scaling: 2 });
  const comp = P.features.filter((f) => f.kind === 'subduction' && (f.episodes || []).some((e) => e.mode === 'compression')).length;
  const cords = P.features.filter((f) => f.kind === 'orogen' && f.type === 'cordillera').length;
  assert.ok(cords > 0.3 * comp, `${cords} cordilleras from ${comp} trenches that compressed`);
});
