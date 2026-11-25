/* The map viewer's pure parts: ramps, levels, a layer cut at the coast, the CPU's colours. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/globe.js');

test('the ramp tables follow the SEA and LAND stops', () => {
  const t = G.rampTable(G.LAND);
  assert.equal(t.max, 8000);
  assert.deepEqual([...t.data.slice(0, 3)], G.LAND[0][1]);
  assert.deepEqual([...t.data.slice((t.n - 1) * 4, (t.n - 1) * 4 + 3)], [255, 255, 255]);
  const mid = Math.round((1000 / 8000) * (t.n - 1)) * 4, want = G.ramp(G.LAND, ((mid / 4) / (t.n - 1)) * 8000);
  assert.deepEqual([...t.data.slice(mid, mid + 3)], want.map((v) => Math.round(v)));
});

test('levels halve, wrap east-west, and keep the mean', () => {
  const W = 64, H = 32, z = new Float32Array(W * H);
  for (let k = 0; k < z.length; k++) z[k] = (k % W) * 10 - (k / W) * 3;
  const L = G.mipChain(z, W, H, true);
  assert.deepEqual(L.map((l) => [l.w, l.h]), [[64, 32], [32, 16], [16, 8]]);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  for (const l of L) assert.ok(Math.abs(mean(l.data) - mean(z)) < 1e-3);
  assert.equal(L[0].data, z, 'level 0 is the grid itself');
});

test('a layer cut at the coast: each side carries its own colours one texel over', () => {
  const W = 4, H = 1, z = [100, 100, -100, -100], data = new Uint8Array([10, 0, 0, 255, 10, 0, 0, 255, 0, 0, 200, 255, 0, 0, 200, 255]);
  const { land, sea } = G.splitLayer(data, W, H, z);
  assert.deepEqual([...land.slice(8, 12)], [10, 0, 0, 255], 'the sea next to land reads as land in the land half');
  assert.deepEqual([...sea.slice(4, 8)], [0, 0, 200, 255], 'and the land next to sea as sea in the sea half');
  assert.deepEqual([...land.slice(0, 4)], [10, 0, 0, 255]);
  // (wraps: the last sea texel is next to the first land one)
  assert.deepEqual([...land.slice(12, 16)], [10, 0, 0, 255]);
  // no heights of that size: the layer as it is
  assert.equal(G.splitLayer(data, W, H, null).land, data);
});

test('the CPU colours: ramps, a layer over them, light from the north-west, a mask on top', () => {
  const W = 8, H = 4, z = new Float32Array(W * H).fill(-4000);
  z[1 * W + 3] = 500; z[1 * W + 4] = 3000;
  const ramps = { land: G.rampTable(G.LAND), sea: G.rampTable(G.SEA) };
  const src = { W, H, z, factor: 1, wrap: true, cellM: [5e4, 5e4] };
  const plain = G.colourImage(src, { shade: false }, ramps);
  const deep = G.ramp(G.SEA, 4000).map(Math.round);
  plain.slice(0, 3).forEach((v, q) => assert.ok(Math.abs(v - deep[q]) <= 3));
  // lit from the north-west: ground rising to the east faces the light, falling to the east faces away
  const lit = G.colourImage({ ...src, out: null }, { shade: true }, ramps), k = (1 * W + 3) * 4;
  assert.ok(lit[k] > plain[k], 'rising to the east: brighter');
  assert.ok(lit[k + 4] < plain[k + 4], 'falling to the east: darker');
  const layer = new Uint8Array(W * H * 4); layer.set([255, 0, 0, 255], k);
  const lay = G.colourImage({ ...src, out: null }, { shade: false }, ramps, layer);
  assert.deepEqual([...lay.slice(k, k + 3)], [255, 0, 0]);
  const mask = new Uint8Array(W * H * 4); mask.set([0, 255, 0, 255], 0);
  const m = G.colourImage({ ...src, out: null }, { shade: false }, ramps, null, mask);
  assert.deepEqual([...m.slice(0, 3)], [0, 255, 0]);
});
