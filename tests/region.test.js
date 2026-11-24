/* A region: a closer map that agrees with the world map it is cut from. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../js/supercontinent.js');
const M = require('../js/worldmap.js');
const K = require('../js/climate.js');
const B = require('../js/biomes.js');
const R = require('../js/region.js');

const EARTH = { tilt: 23.5, flux: 1, meanC: 15, gravity: 1, radiusKm: 6371, pressure: 1, cells: [[0, 30], [30, 60], [60, 90]] };
const map = M.build(G.makeWorld({ seed: 7, plates: 4 }), { res: 360, carve: false });
const clim = K.build(map, EARTH);
M.carveMap(map, { water: B.water(map, clim, { ...EARTH, seed: 7 }) });
const water = B.water(map, clim, { ...EARTH, seed: 7 });
// the mouth of the largest river away from the poles: land, sea and rivers in one window
const mouth = map.rivers.mouthList.filter((m) => m.from >= 0).map((m) => [map.grid.lat[Math.floor(m.from / map.W)], -180 + ((m.from % map.W) + 0.5) * (360 / map.W)]).find(([la]) => Math.abs(la) < 60);
const reg = R.build(map, water, { lat: mouth[0], lon: mouth[1], span: 1200, res: 256, seed: 7 });

test('the window: square in km, the right size, where it was asked for', () => {
  const fr = reg.frame;
  assert.equal(reg.z.length, 256 * 256);
  assert.ok(Math.abs(fr.pxKm - 1200 / 256) < 1e-9);
  assert.ok(Math.abs((fr.north + fr.south) / 2 - mouth[0]) < 1e-6);
  const k = R.pixelOf(reg, mouth[0], mouth[1]);
  assert.ok(Math.abs(k - (128 * 256 + 128)) <= 257, 'the centre pixel');
  assert.equal(R.pixelOf(reg, fr.north + 1, mouth[1]), -1);
});

test('it agrees with the world map: land where it has land, sea where it has sea', () => {
  let same = 0, n = 0, hiDiff = 0;
  for (let y = 0; y < reg.H; y += 4) for (let x = 0; x < reg.W; x += 4) {
    const [la, lo] = R.latLonOf(reg, x + 0.5, y + 0.5), zw = M.sample(map, la, lo), zr = reg.z[y * reg.W + x];
    if (Math.abs(zw) < 150) continue;                 // (the shore may move)
    n++; if ((zw > 0) === (zr > 0)) same++;
    if (zw > 0) hiDiff = Math.max(hiDiff, Math.abs(zr - zw));
  }
  assert.ok(same / n > 0.97, `land and sea agree at ${same} of ${n}`);
  assert.ok(hiDiff < 3000, `heights within the detail: ${hiDiff}`);
});

test('water runs downhill to the sea or out of the window, gathering on the way', () => {
  let bad = 0;
  for (let k = 0; k < reg.z.length; k++) {
    const r = reg.recv[k];
    if (reg.z[k] > 0 && r >= 0 && reg.z[r] > 0 && !reg.lake[k] && reg.flow[r] + 1e-6 < reg.flow[k] && !reg.lake[r]) bad++;
  }
  assert.ok(bad < reg.z.length * 0.002, `flow shrinking downstream at ${bad} pixels`);
  assert.ok(reg.rivers.length > 5, `${reg.rivers.length} rivers`);
  assert.ok(reg.stats.biggest && reg.stats.biggest.q > 100, 'a river of some size leaves the window');
  assert.ok(reg.inflows.every((f) => f.q > 0));
});

test('colder with height: a mountain window has colder biomes on its heights than in its valleys', () => {
  // the world map's highest ground away from the poles
  let best = -1; for (let k = 0; k < map.z.length; k++) if (Math.abs(map.grid.lat[Math.floor(k / map.W)]) < 50 && (best < 0 || map.z[k] > map.z[best])) best = k;
  const at = [map.grid.lat[Math.floor(best / map.W)], -180 + ((best % map.W) + 0.5) * (360 / map.W)];
  const mtn = R.build(map, water, { lat: at[0], lon: at[1], span: 600, res: 192, seed: 7 });
  const land = []; for (let k = 0; k < mtn.z.length; k++) if (mtn.z[k] > 0 && !mtn.lake[k]) land.push(k);
  land.sort((a, b) => mtn.z[a] - mtn.z[b]);
  const tenth = Math.floor(land.length / 10), cold = new Set([B.BI.ice, B.BI.tundra, B.BI.barren, B.BI.boreal]);
  const share = (ks) => ks.filter((k) => cold.has(mtn.biome[k])).length / ks.length;
  assert.ok(mtn.z[land[land.length - 1]] - mtn.z[land[0]] > 1500, 'a window with relief');
  assert.ok(share(land.slice(-tenth)) > share(land.slice(0, tenth)), `cold biomes: heights ${share(land.slice(-tenth))}, lowland ${share(land.slice(0, tenth))}`);
});

test('the same window twice: the same map (seeded)', () => {
  const again = R.build(map, water, { lat: mouth[0], lon: mouth[1], span: 1200, res: 256, seed: 7 });
  assert.deepEqual(again.z, reg.z);
  assert.equal(again.rivers.length, reg.rivers.length);
});

test('a close-up of the region agrees with it, and its big river runs through it', () => {
  // on the region's largest river, away from its edges
  let best = null;
  for (const rv of reg.rivers) rv.pts.forEach((p, i) => { if (p[0] > 60 && p[1] > 60 && p[0] < 196 && p[1] < 196 && (!best || rv.q[i] > best.q)) best = { q: rv.q[i], p }; });
  assert.ok(best, 'a river in the region');
  const [la, lo] = R.latLonOf(reg, best.p[0], best.p[1]);
  const cu = R.build(reg, null, { lat: la, lon: lo, span: 60, res: 192, seed: 8 });
  assert.ok(cu.frame.north <= reg.frame.north + 1e-9 && cu.frame.south >= reg.frame.south - 1e-9, 'inside the region');
  assert.ok(cu.frame.pxKm < reg.frame.pxKm / 10, `finer: ${cu.frame.pxKm} km a pixel`);
  let same = 0, n = 0;
  for (let y = 0; y < cu.H; y += 3) for (let x = 0; x < cu.W; x += 3) {
    const [a, b] = R.latLonOf(cu, x + 0.5, y + 0.5), kr = R.pixelOf(reg, a, b), zr = reg.z[kr], zc = cu.z[y * cu.W + x];
    // (not within two of the region's pixels of its coast: the close-up's coast is its own, more fractal)
    let shore = false;
    for (let dy = -2; dy <= 2 && !shore; dy++) for (let dx = -2; dx <= 2; dx++) { const q = kr + dy * reg.W + dx; if (q >= 0 && q < reg.z.length && (reg.z[q] > 0) !== (zr > 0)) { shore = true; break; } }
    if (shore) continue;
    n++; if ((zr > 0) === (zc > 0)) same++;
  }
  assert.ok(same / Math.max(1, n) > 0.97, `land and sea agree at ${same} of ${n}`);
  const big = Math.max(...cu.rivers.map((rv) => Math.max(...rv.q)));
  assert.ok(big > 0.5 * best.q, `its largest river ${big} m³/s, the region's there ${best.q}`);
});

test('a river on a flat plain meanders as rivers do: bends some 30 widths long, cut off into oxbow lakes', () => {
  const pts = [], q = [], slope = [];
  for (let i = 0; i < 900; i++) { pts.push([50 + i * 0.9, 300 + 15 * Math.sin(i / 140)]); q.push(2000); slope.push(5e-5); }
  const pxKm = 0.0586, m = R.meanders([{ pts, q, slope, join: false }], { pxKm, minFlow: 0.44, seed: 3 });
  const p = m.rivers[0].pts;
  let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  const sinuosity = L / 810;
  assert.ok(sinuosity > 1.5 && sinuosity < 4, `sinuosity ${sinuosity}`);
  assert.ok(m.oxbows.length >= 5, `${m.oxbows.length} oxbow lakes`);
  // bends: between turns of the smoothed curvature's sign
  const th = []; for (let i = 1; i < p.length; i++) th.push(Math.atan2(p[i][1] - p[i - 1][1], p[i][0] - p[i - 1][0]));
  const c = []; for (let i = 1; i < th.length; i++) { let d = th[i] - th[i - 1]; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); c.push(d); }
  const cs = c.map((_, i) => { let s = 0; for (let j = Math.max(0, i - 4); j <= Math.min(c.length - 1, i + 4); j++) s += c[j]; return s; });
  let turns = 0; for (let i = 1; i < cs.length; i++) if (Math.sign(cs[i]) !== Math.sign(cs[i - 1]) && Math.abs(cs[i]) > 0.01) turns++;
  const w = (2.7 * Math.sqrt(2000)) / 1000 / pxKm, perBend = (2 * L) / turns / w;
  assert.ok(perBend > 15 && perBend < 60, `a bend ${perBend} widths along the channel`);
  // and a steep one does not
  const steep = R.meanders([{ pts, q, slope: slope.map(() => 0.01), join: false }], { pxKm, minFlow: 0.44, seed: 3 });
  assert.equal(steep.oxbows.length, 0);
});

test('braided rivers: steep for their flow and laden (meltwater, dry land), not gentle lowland rivers or torrents', () => {
  const line = (slope) => ({ pts: Array.from({ length: 200 }, (_, i) => [10 + i, 50]), q: Array.from({ length: 200 }, () => 300), slope: Array.from({ length: 200 }, () => slope) });
  const cold = { climAt: () => ({ tw: 2, ai: 1.2 }), minFlow: 2 }, warm = { climAt: () => ({ tw: 22, ai: 1.2 }), minFlow: 2 };
  const mid = (b) => b[100];
  assert.ok(mid(R.braidiness(line(0.004), cold)) > 0.8, 'a meltwater river at 0.4 % braids');
  assert.ok(mid(R.braidiness(line(0.0003), warm)) < 0.1, 'a gentle lowland river does not');
  assert.ok(mid(R.braidiness(line(0.0012), cold)) > mid(R.braidiness(line(0.0012), warm)), 'meltwater braids sooner');
  assert.ok(mid(R.braidiness(line(0.1), cold)) < 0.1, 'a torrent does not');
  // drawn: a bed of gravel with several channels, where it is wide enough to see
  const rv = line(0.004), br = R.braided([{ pts: rv.pts, q: rv.q }], [rv], { ...cold, pxKm: 0.02, seed: 1 });
  assert.ok(br.length >= 1 && br[0].strands.length >= 3, `${br.length} braided reaches`);
  assert.equal(R.braided([{ pts: rv.pts, q: rv.q }], [rv], { ...cold, pxKm: 2, seed: 1 }).length, 0, 'too narrow to draw on a coarse map');
});
