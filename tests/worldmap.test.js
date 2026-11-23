/* The world map: rasterizing on the sphere, and the map built from a whole history. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/sphere.js');
const G = require('../js/supercontinent.js');
const M = require('../js/worldmap.js');

const cap = (lat, lon, r, n = 72) => {
  const c = S.vec([lat, lon]), e = [-Math.sin(lon * Math.PI / 180), Math.cos(lon * Math.PI / 180), 0];
  const nn = [-c[2] * Math.cos(lon * Math.PI / 180), -c[2] * Math.sin(lon * Math.PI / 180), Math.cos(lat * Math.PI / 180)];
  return Array.from({ length: n }, (_, k) => { const b = (k * 2 * Math.PI) / n, d = (r * Math.PI) / 180; return S.latLon(c.map((v, i) => Math.cos(d) * v + Math.sin(d) * (Math.cos(b) * nn[i] + Math.sin(b) * e[i]))); });
};

test('filling polygons on the grid: right area, across the dateline and round the poles', () => {
  const gr = M.makeGrid(360);
  const area = (ring) => { const hit = new Uint8Array(gr.N); M.fillPolygon(gr, ring, (k) => { hit[k] = 1; }); return M.shareAbove(gr, Float32Array.from(hit), 0.5); };
  for (const [lat, lon, r] of [[10, 40, 20], [0, 179, 25], [-30, -175, 15], [75, 0, 30], [-80, 100, 25]]) {
    const ring = cap(lat, lon, r), got = area(ring), want = S.areaFraction(ring);
    assert.ok(Math.abs(got - want) < 0.01 * want + 0.0015, `cap at ${lat},${lon} r ${r}: ${got} vs ${want}`);
  }
});

test('distances on the grid are in degrees along the sphere', () => {
  const gr = M.makeGrid(360), seed = new Uint8Array(gr.N);
  seed[M.cellOf(gr, 0, 0)] = 1;
  const { d } = M.distance(gr, seed);
  for (const [la, lo, want] of [[0, 20, 20], [20, 0, 20], [60, 0, 60], [0, 90, 90]]) {
    const got = d[M.cellOf(gr, la, lo)];
    assert.ok(Math.abs(got - want) < 0.06 * want + 1, `to ${la},${lo}: ${got} vs ${want}`);
  }
});

test('a map of a whole history: land share, mountains, deep sea, plates everywhere', () => {
  const w = G.makeWorld({ seed: 7, plates: 4 });
  const map = M.build(w, { res: 360 });
  assert.equal(map.z.length, 360 * 180);
  assert.ok(Math.abs(map.land - map.target) < 0.03, `land ${map.land} vs ${map.target}`);
  assert.ok(map.highest.m > 2500 && map.highest.m < 9500, `highest ${map.highest.m}`);
  assert.ok(map.deepest.m < -6500 && map.deepest.m > -12000, `deepest ${map.deepest.m}`);
  assert.ok(!map.plate.some((p) => !p), 'every cell is on a plate');
  // young ocean floor is shallower than old
  let young = 0, ny = 0, old = 0, no = 0;
  for (let k = 0; k < map.z.length; k++) { const a = map.oceanAge[k]; if (a >= 0 && a < 20 && map.z[k] < -1500) { young += map.z[k]; ny++; } if (a > 120 && map.z[k] < -1500) { old += map.z[k]; no++; } }
  if (ny && no) assert.ok(young / ny > old / no + 800, `ridges ${young / ny} vs old floor ${old / no}`);
  // asking for more land raises it
  const more = M.build(w, { res: 180, land: map.target + 0.08 });
  assert.ok(more.land > map.land + 0.05, `${more.land} vs ${map.land}`);
  // a brush stroke raises the ground where it is
  const at = [map.deepest.at[0], map.deepest.at[1]];
  const raised = M.build(w, { res: 180, strokes: [{ lat: at[0], lon: at[1], r: 3, dz: 3000 }] });
  const base = M.build(w, { res: 180 });
  assert.ok(M.sample(raised, ...at) > M.sample(base, ...at) + 2000);
});

test('not only Earth: heavier gravity, lower mountains and shallower trenches (÷ g^scaling)', () => {
  const w = G.makeWorld({ seed: 7, plates: 4 });
  const earth = M.build(w, { res: 180, gravity: 1, scaling: 2 }), heavy = M.build(w, { res: 180, gravity: 1.5, scaling: 2 }), light = M.build(w, { res: 180, gravity: 0.5, scaling: 1 });
  const ratio = (a, b) => a.highest.m / b.highest.m;
  // (widths change with gravity too, so the heights are not exactly in proportion)
  assert.ok(Math.abs(ratio(earth, heavy) - 2.25) < 0.8, `1.5 g: ${ratio(earth, heavy)} times lower (2.25 expected)`);
  assert.ok(Math.abs(ratio(light, earth) - 2) < 0.8, `0.5 g, scaling 1: ${ratio(light, earth)} times higher (2 expected)`);
  assert.ok(heavy.deepest.m > earth.deepest.m, 'trenches shallower under more gravity');
  assert.deepEqual(heavy.planet, { gravity: 1.5, factor: 2.25, radiusKm: 6371, ridgeDepth: 2600 });
});

test('erosion: faster erosion, lower land; an old belt no longer holds the ground up', () => {
  const w = G.makeWorld({ seed: 7, plates: 4 });
  const slow = M.build(w, { res: 180, erosion: 0.3 }), fast = M.build(w, { res: 180, erosion: 3 });
  const mean = (map) => { let s = 0, n = 0; for (const v of map.z) if (v > 0) { s += v; n++; } return s / n; };
  assert.ok(fast.highest.m < slow.highest.m, `highest ${fast.highest.m} vs ${slow.highest.m}`);
  assert.ok(mean(fast) < mean(slow), `mean land ${mean(fast)} vs ${mean(slow)}`);
  // one continent with a belt along its edge: young, the ground under it stays land; worn for a
  // billion years, it no longer does more than the rest of the coast
  const dryUnderBelt = (active) => {
    const P = { start: 1000, plates: [{ id: 1, rotations: [] }], features: [
      { id: 'c', kind: 'crust', plateId: 1, coords: cap(0, 0, 30) },
      { id: 'o', kind: 'orogen', type: 'collision', plateId: 1, coords: cap(0, 26, 5), begin: 999, active },
    ] };
    const map = M.build(P, { res: 180, land: 0.035 });
    let n = 0, dry = 0;
    M.fillPolygon(map.grid, cap(0, 26, 5), (k) => { n++; if (map.z[k] > 0) dry++; });
    return dry / n;
  };
  const young = dryUnderBelt(0), old = dryUnderBelt(990);   // (active: when it stopped rising, Ma)
  assert.ok(young > old + 0.15, `young belt ${young} dry vs old ${old}`);
});

test('rivers carve: big rivers cut deep, divides barely change, land stays land, deltas at big mouths only', () => {
  // a broad dome of an island, 2.5 km high in the middle, on a 1° grid
  const gr = M.makeGrid(360), z = new Float32Array(gr.N).fill(-3000);
  const c = S.vec([0, 0]);
  for (let k = 0; k < gr.N; k++) {
    const d = Math.acos(Math.max(-1, Math.min(1, gr.xyz[k * 3] * c[0] + gr.xyz[k * 3 + 1] * c[1] + gr.xyz[k * 3 + 2] * c[2]))) * 180 / Math.PI;
    if (d < 25) z[k] = 20 + 2500 * (1 - d / 25);
    else if (d < 28) z[k] = -100;                                     // a shelf round it
  }
  const z0 = Float32Array.from(z);
  const r = M.carve(gr, z, { seed: 3 });
  const cuts = [];
  for (let k = 0; k < gr.N; k++) if (z0[k] > 0) { cuts.push(r.cut[k]); assert.ok(z[k] > 0, 'land stays land'); assert.ok(z[k] <= z0[k] + r.laid[k] + 1e-3); }
  cuts.sort((a, b) => a - b);
  const median = cuts[cuts.length >> 1], top = cuts[Math.floor(cuts.length * 0.99)];
  assert.ok(top > 300 && top > 4 * median, `valleys ${top} m deep vs ${median} m typical`);
  assert.ok(r.eroded > 0 && r.delta > 0 && r.delta < r.eroded, `${r.delta} of ${r.eroded} km³ in deltas`);
  let coast = 0, built = 0;
  for (let k = 0; k < gr.N; k++) if (z0[k] === -100) { coast++; if (r.laid[k] > 0) built++; }
  assert.ok(built > 0 && built < coast * 0.3, `deltas on ${built} of ${coast} shelf cells: not the whole coast`);
  // the same input, the same valleys; more erosion, deeper
  const again = Float32Array.from(z0), more = Float32Array.from(z0);
  M.carve(gr, again, { seed: 3 });
  assert.deepEqual(again, z);
  const rm = M.carve(gr, more, { seed: 3, erosion: 3 });
  assert.ok(rm.eroded > 2 * r.eroded);
});

test('a built map is carved by its rivers unless told not to', () => {
  const w = G.makeWorld({ seed: 7, plates: 4 });
  const carved = M.build(w, { res: 180 }), plain = M.build(w, { res: 180, carve: false });
  assert.ok(carved.rivers && carved.rivers.eroded > 0 && carved.rivers.deepest > 100);
  assert.equal(plain.rivers, null);
  assert.ok(Math.abs(carved.land - plain.land) < 0.01, `land ${carved.land} vs ${plain.land}`);
});
