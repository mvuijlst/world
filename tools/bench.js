/*
 * Timings of each stage of the World map's pipeline, as the app runs it (js/mapworker.js, buildMap in
 * js/steps/worldmap.js): the land, its climate, the water, glaciers and rivers carving it, rivers and
 * biomes; and a Region (800 km, 1024 px) cut from the 720 map. In Node, one thread.
 *   node tools/bench.js [seeds...]          (7 and 21 by default)
 */
const B = require('../js/biomes.js');
const R = require('../js/region.js');
const T = require('./fidelity.js');

const seeds = process.argv.slice(2).map(Number).filter(Number.isFinite);
const ms = (x) => `${Math.round(x)}`.padStart(7);
console.log('seed   res   world     map  climate   water    carve  biomes    total   (ms)');
for (const seed of seeds.length ? seeds : [7, 21]) {
  const t0 = process.hrtime.bigint(), w = T.seedWorld(seed), tw = Number(process.hrtime.bigint() - t0) / 1e6;
  let at720 = null;
  for (const res of [360, 720, 1440]) {
    const p = T.pipeline(w, { res }), t = p.t, total = t.map + t.climate + (t.water || 0) + (t.carve || 0) + t.biomes;
    console.log(`${String(seed).padEnd(5)} ${String(res).padStart(4)} ${ms(res === 360 ? tw : 0).replace(/^ +0$/, '      ·')} ${ms(t.map)} ${ms(t.climate)} ${ms(t.water)} ${ms(t.carve)} ${ms(t.biomes)} ${ms(total)}`);
    if (res === 720) at720 = p;
  }
  // a Region from the 720 map, round its highest point (the Atlas's detail, built in a worker in the app)
  const m = at720.map, water = B.water(m, at720.clim, B.planetOf(w, at720.d));
  const src = { W: m.W, H: m.H, z: m.z, planet: m.planet, rivers: m.rivers ? { recv: m.rivers.recv, discharge: m.rivers.discharge } : null, glaciers: m.glaciers ? { ice: m.glaciers.ice } : null };
  const r0 = process.hrtime.bigint();
  R.build(src, water, { lat: m.highest.at[0], lon: m.highest.at[1], span: 800, res: 1024, seed: w.plates.seed, erosion: 1 });
  console.log(`${String(seed).padEnd(5)} region 800 km × 1024 px from the 720 map: ${Math.round(Number(process.hrtime.bigint() - r0) / 1e6)} ms`);
}
