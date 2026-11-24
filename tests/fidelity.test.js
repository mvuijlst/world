/* The fidelity suite: hard rules R1-R7 and the measures, on the map as the app builds it (land,
 * climate, glaciers and rivers carving it, rivers and biomes), seed 7 at 720 cells, Earth settings.
 * Run with: npm test
 * A rule or measure that fails today is a TODO test carrying today's value, and is listed in
 * EXPECTED_FAIL; the last test fails if one of them starts to pass, so the list is kept current.
 * Each later phase turns its share green and moves it out of the list. */
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../js/worldmap.js');
const F = require('../js/fidelity.js');
const T = require('../tools/fidelity.js');

// today's values (seed 7, 720 cells), and the phase of docs/worldmap-plan.md that should fix each
const EXPECTED_FAIL = {
  r1Uphill: ['10.2 % of drawn river segments run uphill (climbing 55 % of their descent)', 4],
  r1Carve: ['5.3 % of carved channels drain to a higher cell', 4],
  r2Outside: ['52 % of lake area is not in a hollow of the map', 4],
  r4Error: ['rock out of balance by 11.7 % (glacier troughs 9.2 %: their rock goes nowhere)', 4],
  r6Uncaused: ['63 % of land above 1500 m has no tectonic cause near', 4],
  landKept: ['76 % of land kept when only the map’s noise seed changes', 4],
  roughDrawn: ['900 m of noise under the drawn rivers’ routing', 4],
  roughCarve: ['600 m of noise under the carving’s routing', 4],
  valleys: ['85 % of drawn river beds below the ground beside them', 4],
  valleysCarve: ['83 % of carved channels below the ground beside them', 4],
  riversAgree: ['72 % of drawn rivers within a cell of a carved channel', 4],
  bigRiversNear: ['76 % of big-river cells kept when the rivers’ seed changes', 4],
  mouthsKept: ['6 of the 10 largest mouths keep their place', 4],
  rainShadow: ['rain upwind / downwind of high ground 1.21', 5],
  hackCarve: ['Hack’s exponent on the carving 0.48', 4],
  concavity: ['concavity of the drawn rivers 0.35 (just under)', 4],
  outputNoiseWorld: ['27 noise terms added to outputs on the world map, climate and rivers', 4],
  outputNoiseRegion: ['18 noise terms added to outputs on the Region, Close-up and Atlas', 6],
};
const LABEL = {
  r1Uphill: 'R1 no drawn river runs uphill', r1Carve: 'R1 no carved channel runs uphill', r2Outside: 'R2 lakes fill hollows of the map',
  r3Error: 'R3 water balances within 1 %', r4Error: 'R4 rock balances within 1 %', r6Uncaused: 'R6 high ground has a tectonic cause',
  outputNoiseWorld: 'R7 no noise added to outputs (world)', outputNoiseRegion: 'R7 no noise added to outputs (Region, Close-up, Atlas)',
  landKept: 'stability: land kept under a new noise seed', roughDrawn: 'no noise under the drawn rivers', roughCarve: 'no noise under the carving',
  valleys: 'drawn rivers lie in valleys', valleysCarve: 'carved channels lie in valleys', riversAgree: 'drawn rivers follow the carved channels',
  bigRiversNear: 'stability: big rivers kept under a new rivers’ seed', mouthsKept: 'stability: great river mouths kept',
  below200: 'hypsometry: land below 200 m', above2000: 'hypsometry: land above 2000 m', rainShadow: 'rain shadows',
  hack: 'Hack’s law (drawn rivers)', hackCarve: 'Hack’s law (carving)', concavity: 'channel concavity (drawn rivers)', concavityCarve: 'channel concavity (carving)',
  lakes: 'lakes, share of land', endorheic: 'land draining inland',
};

const scan = F.scan(T.sources());
const r = { ...T.run(T.seedWorld(7), 720), outputNoiseWorld: scan.outputNoiseWorld, outputNoiseRegion: scan.outputNoiseRegion };
const fmt = (v) => (v == null ? 'none' : Number.isInteger(v) ? String(v) : v.toFixed(4));

for (const id of Object.keys(LABEL)) {
  const known = EXPECTED_FAIL[id];
  test(LABEL[id], known ? { todo: `fails until Phase ${known[1]}: ${known[0]}` } : {}, () => {
    assert.ok(F.inRange(id, r[id]), `${id} = ${fmt(r[id])}, target ${F.TARGETS[id].join('-')}`);
  });
}

test('R3 on every example world (180 cells)', () => {
  for (const f of T.EXAMPLES()) {
    const p = T.pipeline(T.exampleWorld(f), { res: 180 });
    assert.ok(F.waterBalance(p.map, p.bio).error <= 0.01, f);
  }
});

test('R5 same inputs, same map: twice in a row, and the same as on other machines', () => {
  const w = T.seedWorld(7), a = T.pipeline(w, { res: 180 }), b = T.pipeline(w, { res: 180 });
  assert.deepEqual(a.map.z, b.map.z);
  assert.deepEqual(a.bio.flow, b.bio.flow);
  const hash = (arr) => { let x = 2166136261; for (const v of arr) { x ^= Math.round(v) & 0xffffffff; x = Math.imul(x, 16777619) >>> 0; } return x.toString(16); };
  // pinned on Windows and checked on Linux in CI; change it only with a deliberate change to the map
  assert.equal(hash(a.map.z), 'cf0df2dc');
});

test('R7 every random number is in the register', () => {
  assert.deepEqual(scan.unregistered, [], 'random numbers outside the register (list them in RANDOM in js/fidelity.js)');
  assert.deepEqual(scan.stale.map((e) => `${e.file}: ${e.at}`), [], 'register entries that match no code');
  for (const e of F.RANDOM) assert.ok(['source', 'input', 'seed', 'output'].includes(e.kind) && e.what, `${e.file}: ${e.at}`);
});

test('the measures on made-up cases', () => {
  // a power law is fitted exactly
  const xs = [1, 2, 3, 4, 5], ys = xs.map((x) => 0.3 + 0.56 * x);
  assert.ok(Math.abs(F.fit(xs, ys).slope - 0.56) < 1e-9);
  // a ring of hills 600 m high round a basin 200 m above the sea: a lake in the basin lies in a
  // hollow, one on the outer slope does not; a river up the inner slope climbs
  const gr = M.makeGrid(90), N = gr.N, z = new Float32Array(N).fill(-100);
  const centre = M.cellOf(gr, 0, 0);
  M.stamp(gr, [0, 0], 20, (k, d) => { z[k] = 600 - 40 * Math.abs(d - 10); });
  const map = { W: gr.W, H: gr.H, z, grid: gr, planet: { factor: 1, radiusKm: 6371 } };
  const fill = F.filled(map);
  assert.ok(fill[centre] > z[centre] + 100, 'the basin fills');
  const lake = new Int8Array(N); lake[centre] = 1;
  assert.equal(F.lakesInHollows(map, { lake }, fill).share, 0);
  lake[M.cellOf(gr, 0, 19)] = 1;
  assert.ok(F.lakesInHollows(map, { lake }, fill).share > 0.4);
  assert.equal(F.uphill(map, { rivers: [{ pts: [[0, 1], [0, 5], [0, 9]] }] }).share, 1, 'up the inner slope');
  assert.equal(F.uphill(map, { rivers: [{ pts: [[0, 9], [0, 5], [0, 1]] }] }).share, 0, 'down it');
  // a carving that drains each cell to its higher neighbour runs uphill everywhere outside the basin
  const recv = new Int32Array(N).fill(-1), discharge = new Float32Array(N).fill(1000);
  for (let k = 0; k < N; k++) if (z[k] > 0) { let best = -1; M.stamp(gr, [gr.lat[Math.floor(k / gr.W)], -180 + ((k % gr.W) + 0.5) * gr.dx], 1.5 * gr.dx, (q) => { if (q !== k && z[q] > z[k] && (best < 0 || z[q] > z[best])) best = q; }); recv[k] = best; }
  assert.ok(F.carveUphill({ ...map, rivers: { recv, discharge } }, fill).share > 0.9);
  // rock: 10 m off one cell, laid on another, the rest booked to the deep sea
  const before = Float32Array.from(z), carved = Float32Array.from(z); carved[centre] -= 10; carved[centre + 1] += 4;
  const cellKm3 = (k) => (gr.dx * 111.19) ** 2 * gr.cosl[Math.floor(k / gr.W)] / 1000;
  const deep = 10 * cellKm3(centre) - 4 * cellKm3(centre + 1);
  const rb = F.rockBalance({ ...map, rivers: { eroded: deep + 4 * cellKm3(centre + 1), basins: 4 * cellKm3(centre + 1), delta: 0 } }, before, carved);
  assert.ok(rb.error < 1e-3, `balanced: ${rb.error}`);
  // the same map twice overlaps fully
  assert.deepEqual(F.landOverlap(map, map), { iou: 1, flip: 0 });
});

test('expected failures still fail (move any that pass out of EXPECTED_FAIL)', () => {
  const passing = Object.keys(EXPECTED_FAIL).filter((id) => F.inRange(id, r[id]));
  assert.deepEqual(passing, []);
});
