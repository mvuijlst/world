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
  // the mountains: the tallest belt (the highest point of an Earth map can be its interiors, Phase C)
  const tallest = (map) => Math.max(...map.belts.map((b) => b.crest));
  // (widths change with gravity too, so the heights are not exactly in proportion)
  assert.ok(Math.abs(tallest(earth) / tallest(heavy) - 2.25) < 0.8, `1.5 g: belts ${tallest(earth) / tallest(heavy)} times lower (2.25 expected)`);
  // (under less gravity a belt can stand higher, but only as high as the crust it was fed: not twice)
  assert.ok(tallest(light) > tallest(earth) && ratio(light, earth) > 1, `0.5 g, scaling 1: belts ${tallest(light) / tallest(earth)}, highest point ${ratio(light, earth)} times higher`);
  assert.ok(heavy.highest.m < earth.highest.m, 'and the highest point lower');
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
    // (with the relief the land had before the rivers, the size of a map's: rolls of some ±270 m)
    const la = Math.asin(c[2] * 0 + gr.xyz[k * 3 + 2]) * 180 / Math.PI, lo = Math.atan2(gr.xyz[k * 3 + 1], gr.xyz[k * 3]) * 180 / Math.PI;
    if (d < 25) z[k] = 20 + 2500 * (1 - d / 25) + (1 - d / 25) * (170 * Math.sin(la * 0.41) * Math.cos(lo * 0.37) + 100 * Math.sin((la + 2 * lo) * 0.83));
    else if (d < 28) z[k] = -100;                                     // a shelf round it
  }
  const z0 = Float32Array.from(z);
  const r = M.carve(gr, z, { seed: 3 });
  const cuts = [];
  for (let k = 0; k < gr.N; k++) if (z0[k] > 0) { cuts.push(r.cut[k]); assert.ok(z[k] > 0, 'land stays land'); assert.ok(z[k] <= z0[k] + r.laid[k] + 1e-3); }
  cuts.sort((a, b) => a - b);
  const median = cuts[cuts.length >> 1], top = cuts[Math.floor(cuts.length * 0.99)];
  // (3.5×: since the water follows the true fall of the land (D8-LTD), a smooth dome no longer gathers it
  // along the grid's lines into a few deep gorges; it was 4× with that artefact)
  assert.ok(top > 300 && top > 3.5 * median, `valleys ${top} m deep vs ${median} m typical`);
  assert.ok(r.eroded > 0 && r.delta > 0 && r.delta < r.eroded, `${r.delta} of ${r.eroded} km³ in deltas`);
  let coast = 0, built = 0;
  // (the rock builds the shelf out all round; new land, deltas, only where the big rivers reach it)
  for (let k = 0; k < gr.N; k++) if (z0[k] === -100) { coast++; if (z[k] > 0) built++; }
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

test('tides: from the moon, star, size and gravity; small tides build deltas, large ones scour estuaries', () => {
  assert.ok(Math.abs(M.planetTides({ moonMass: 1, moonKm: 384400, starMass: 1, au: 1 }) - 1) < 1e-9, 'Earth: 1');
  assert.ok(Math.abs(M.planetTides({ moonMass: 0, starMass: 1, au: 1 }) - 0.46 / 1.46) < 1e-9, 'no moon: the Sun alone');
  assert.ok(Math.abs(M.planetTides({ moonMass: 1, moonKm: 192200 }) - 8.46 / 1.46) < 1e-9, 'a moon at half the distance: eight times the lunar tide');
  assert.ok(M.planetTides({ moonMass: 1, gravity: 2 }) < 0.51, 'twice the gravity: half the tide');
  // the dome island from above, with its shelf: a wide shelf gets more tide than the open ocean
  const gr = M.makeGrid(360), base = new Float32Array(gr.N).fill(-3000), c = S.vec([0, 0]);
  for (let k = 0; k < gr.N; k++) {
    const d = Math.acos(Math.max(-1, Math.min(1, gr.xyz[k * 3] * c[0] + gr.xyz[k * 3 + 1] * c[1] + gr.xyz[k * 3 + 2] * c[2]))) * 180 / Math.PI;
    if (d < 25) base[k] = 20 + 2500 * (1 - d / 25); else if (d < 30) base[k] = -60;
  }
  const t1 = M.tidalRange(gr, base, 1);
  const shelfK = base.findIndex((v) => v === -60), oceanK = base.findIndex((v) => v === -3000);
  assert.ok(t1[shelfK] > t1[oceanK] && t1[oceanK] === 0.5, `shelf ${t1[shelfK]} m, ocean ${t1[oceanK]} m`);
  const run = (tideX, gravity = 1) => { const z = Float32Array.from(base); const r = M.carve(gr, z, { seed: 3, gravity, tides: M.tidalRange(gr, base, tideX) }); return { z, r }; };
  const small = run(0.3), large = run(5);
  const kinds = (r) => r.mouthList.map((m) => m.kind);
  assert.ok(kinds(small.r).includes('delta') && !kinds(small.r).includes('estuary'), kinds(small.r).join());
  assert.ok(kinds(large.r).includes('estuary') && !kinds(large.r).includes('delta'), kinds(large.r).join());
  assert.ok(small.r.deltaArea > 0 && large.r.deltaArea === 0 && large.r.estuaryArea > 0);
  const est = large.r.mouthList.find((m) => m.kind === 'estuary');
  assert.ok(large.z[est.from] < 0, 'the river’s last cell is now an arm of the sea');
  // stronger gravity: the water cuts harder (√g), but its grains settle faster, so its rivers lay more
  // of what they carry (G); the same relief still loses more rock
  const heavy = run(0.3, 2);
  assert.ok(heavy.r.eroded > small.r.eroded, `${heavy.r.eroded} vs ${small.r.eroded}`);
  assert.ok(heavy.r.carving.G > 1.5 * small.r.carving.G, `G ${heavy.r.carving.G} vs ${small.r.carving.G}`);
  // what a closer map would need: the drainage and the water through it
  const from = small.r.mouthList[0].from;
  assert.ok(small.r.recv[from] >= 0 && small.z[small.r.recv[from]] <= 3, 'the mouth’s land cell drains to the sea');
  assert.ok(small.r.discharge[from] > 100 && Math.abs(small.r.mouthList[0].discharge - small.r.discharge[from]) < 1e-6 * small.r.discharge[from] + 1e-3);
});

test('glaciers: troughs where it is cold and snowy, fjords only where the sea reaches, none where it is warm', () => {
  // a mountain island at 65° N on a 1° grid, 2.5 km high, a shelf round it
  const gr = M.makeGrid(360), base = new Float32Array(gr.N).fill(-3000), c = S.vec([65, 0]);
  const dist = (k) => Math.acos(Math.max(-1, Math.min(1, gr.xyz[k * 3] * c[0] + gr.xyz[k * 3 + 1] * c[1] + gr.xyz[k * 3 + 2] * c[2]))) * 180 / Math.PI;
  for (let k = 0; k < gr.N; k++) { const d = dist(k); if (d < 8) base[k] = 30 + 2500 * (1 - d / 8); else if (d < 10) base[k] = -100; }
  const water = (tw, p) => ({ Tw: new Float32Array(gr.N).fill(tw), P: new Float32Array(gr.N).fill(p) });
  const cold = Float32Array.from(base), r = M.glaciate(gr, cold, { water: water(4, 1200), iceAge: 6, seed: 2 });
  assert.ok(r.area > 0 && r.deepest > 300, `glaciated ${r.area} km², troughs ${r.deepest} m`);
  assert.ok(r.fjords > 0, 'the ice cut below the sea at the coast');
  // every cell that went below the sea is joined to it through other such cells
  const sea = (k) => cold[k] <= 0;
  const seen = new Uint8Array(gr.N), stack = [];
  for (let k = 0; k < gr.N; k++) if (base[k] <= 0) { seen[k] = 1; stack.push(k); }
  while (stack.length) {
    const k = stack.pop(), j = Math.floor(k / gr.W), i = k % gr.W;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj; if (jj < 0 || jj >= gr.H) continue; const q = jj * gr.W + ((i + di + gr.W) % gr.W); if (!seen[q] && sea(q)) { seen[q] = 1; stack.push(q); } }
  }
  for (let k = 0; k < gr.N; k++) if (sea(k)) assert.ok(seen[k], 'no inland sea');
  // warm, no ice ages: no ice; cold but a polar desert: ice that barely erodes
  const warm = Float32Array.from(base), rw = M.glaciate(gr, warm, { water: water(18, 1200), iceAge: 0, seed: 2 });
  assert.equal(rw.area, 0); assert.deepEqual(warm, base);
  const dry = Float32Array.from(base), rd = M.glaciate(gr, dry, { water: water(-5, 30), iceAge: 6, seed: 2 });
  // (a third of it before the ice followed the true fall of the land, D8-LTD, rather than the grid's lines)
  assert.ok(rd.area > 0 && rd.deepest < r.deepest / 2.5, `polar desert ice cuts ${rd.deepest} m vs ${r.deepest} m`);
});

test('the land stands on its crust: wide plains on a rifted margin, narrow on an active one, basins along a failed rift, the share of land asked for', () => {
  // one continent, 30° round: its west coast faces a trench (an active margin), its east coast is rifted
  const trench = Array.from({ length: 13 }, (_, i) => [-30 + 5 * i, -33]);
  const P = { start: 1000, plates: [{ id: 1, rotations: [] }], features: [
    { id: 'c', kind: 'crust', plateId: 1, coords: cap(0, 0, 30) },
    { id: 'z', kind: 'subduction', plateId: 1, coords: trench, side: 'left', begin: 900 },
    { id: 'f', kind: 'failed', plateId: 1, coords: [[-15, 5], [15, 5]], begin: 20 },
  ] };
  const map = M.build(P, { res: 360, land: 0.05, carve: false });
  assert.ok(Math.abs(map.land - 0.05) < 0.003, `land ${map.land}`);
  const zAt = (lat, lon) => map.z[M.cellOf(map.grid, lat, lon)];
  // how far in from the coast the land reaches 90 % of the interior's height, along the equator
  const inland = Math.max(zAt(20, -10), zAt(-20, -10));
  const plain = (from, step) => { let lon = from; while (zAt(0, lon) <= 0) lon += step; const coast = lon; while (zAt(0, lon) < 0.9 * inland && Math.abs(lon) < 29) lon += step; return Math.abs(lon - coast); };
  const west = plain(-31, 0.5), east = plain(31, -0.5);
  assert.ok(east > 1.5 * west, `plain ${east}° wide on the rifted east coast, ${west}° on the active west`);
  // the failed rift, 20 Myr old: a basin along it, below the plain either side (an old one is filled)
  assert.ok(zAt(0, 5) < zAt(0, -10) - 100 && zAt(0, 5) < zAt(0, 18) - 100, `rift ${zAt(0, 5)} m, either side ${zAt(0, -10)} and ${zAt(0, 18)} m`);
});
