/* The drawing kit: traced outlines, SVG layers and the ZIP. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../js/drawkit.js');
const G = require('../js/supercontinent.js');
const M = require('../js/worldmap.js');
const C = require('../js/climate.js');
const B = require('../js/biomes.js');

test('contours: a closed ring round an island, lines joined across the date line', () => {
  const W = 40, H = 20, disc = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) disc[j * W + i] = 6 - Math.hypot(i - 20, j - 10);
  const rings = K.contours(disc, W, H, 0);
  assert.equal(rings.length, 1);
  const r = rings[0];
  assert.deepEqual(r[0], r[r.length - 1], 'closed');
  for (const [x, y] of r) assert.ok(Math.abs(Math.hypot(x - 20.5, y - 10.5) - 6) < 0.6, 'on the shore');
  // an island across the map's edge is still one ring
  const edge = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) edge[j * W + i] = 5 - Math.hypot(Math.min(i, W - i), j - 10);
  assert.equal(K.contours(edge, W, H, 0).length, 1);
});

test('the kit for a world: coast, lakes and rivers as SVG, in map pixels', () => {
  const w = G.makeWorld({ seed: 7, plates: 4 }), map = M.build(w, { res: 360 });
  const pl = { tilt: 23.5, flux: 1, meanC: 15, gravity: 1, radiusKm: 6371, pressure: 1, cells: [[0, 30], [30, 60], [60, 90]], rotation: 24 };
  const clim = C.build(map, pl), bio = B.build(map, clim, pl), s = K.svgs(map, bio, { circles: [23.5, 66.5] });
  assert.ok(s.counts.coast > 5 && s.counts.rivers > 10, JSON.stringify(s.counts));
  for (const doc of [s.coastline, s.rivers, s.drawing]) {
    assert.match(doc, new RegExp(`viewBox="0 0 ${map.W} ${map.H}"`));
    // every coordinate on the map
    for (const m of doc.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) { const x = +m[1], y = +m[2]; assert.ok(x >= 0 && x <= map.W && y >= 0 && y <= map.H, `${x}, ${y}`); }
  }
  assert.match(s.drawing, /inkscape:label="Coast"/);
  assert.match(s.drawing, /inkscape:label="Rivers"/);
  // the coast is where land meets sea: every traced point lies between a land and a sea cell
  const { coast } = K.outlines(map, null);
  let ok = 0, n = 0;
  for (const p of coast) for (const [x, y] of p.filter((_, i) => i % 7 === 0)) {
    const i = Math.floor(x), j = Math.min(map.H - 1, Math.floor(y)), near = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = j + dj; if (jj >= 0 && jj < map.H) near.push(map.z[jj * map.W + (((i + di) % map.W) + map.W) % map.W] > 0); }
    n++; if (near.includes(true) && near.includes(false)) ok++;
  }
  assert.ok(ok / n > 0.97, `${ok}/${n} on the shore`);
  // and no line jumps across the map (where it crosses the date line it is cut, not drawn across)
  for (const p of coast) for (let i = 1; i < p.length; i++) assert.ok(Math.abs(p[i][0] - p[i - 1][0]) < 2, `a step of ${p[i][0] - p[i - 1][0]}`);
});

test('zip: stored files with names and CRCs a reader accepts', () => {
  const enc = new TextEncoder(), data = enc.encode('hello world');
  const z = K.zip([{ name: 'kit/a.txt', data }]);
  const dv = new DataView(z.buffer);
  assert.equal(dv.getUint32(0, true), 0x04034b50);
  assert.equal(dv.getUint32(14, true), K.crc32(data));
  assert.equal(new TextDecoder().decode(z.subarray(30, 30 + 9)), 'kit/a.txt');
  assert.equal(K.crc32(enc.encode('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
  const end = z.length - 22;
  assert.equal(dv.getUint32(end, true), 0x06054b50);
  assert.equal(dv.getUint16(end + 10, true), 1);
});
