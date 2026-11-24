/*
 * The fidelity table: hard rules and measures (js/fidelity.js) on the map as the app shows it, built
 * as buildMap in js/steps/worldmap.js and js/mapworker.js build it (the land, its climate, glaciers
 * and rivers carving it with that climate's water, the brush strokes), then its rivers and biomes.
 *   node tools/fidelity.js                      seeds 7, 21, 99 (Earth settings) and the example worlds, at 720 cells
 *   node tools/fidelity.js --ten                ten seeds, no examples
 *   node tools/fidelity.js 5 8 --res 360        any seeds, any detail
 *   node tools/fidelity.js --examples           the example worlds only
 */
const fs = require('fs'), path = require('path'), Module = require('module');
const ROOT = path.join(__dirname, '..');
const C = require('../js/calc.js');
const D = require('../js/data.js');
const G = require('../js/supercontinent.js');
const M = require('../js/worldmap.js');
const K = require('../js/climate.js');
const B = require('../js/biomes.js');
const F = require('../js/fidelity.js');

const WET = 0.0061;                                                       // atm: below it no liquid water
const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };

/* The map builder with every noise field in worldmap.js switched off (the same code otherwise). */
let noiseFreeM = null;
function noiseFree() {
  if (noiseFreeM) return noiseFreeM;
  const file = path.join(ROOT, 'js/worldmap.js');
  const src = fs.readFileSync(file, 'utf8').replace('function noise3(seed) {', 'function noise3(seed) { return () => 0;');
  const m = new Module(file); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file)); m._compile(src, file);
  return (noiseFreeM = m.exports);
}

/* The js/ sources, for the register of random numbers (R7). */
function sources() {
  const out = {};
  for (const dir of ['js', 'js/steps']) for (const f of fs.readdirSync(path.join(ROOT, dir))) if (f.endsWith('.js')) out[`${dir}/${f}`] = fs.readFileSync(path.join(ROOT, dir, f), 'utf8');
  return out;
}

/* An Earth-default world (the app's new-world template) with plates made as the Plates step makes them. */
function seedWorld(seed) {
  const w = D.defaultWorld(`seed ${seed}`), d = C.computeAll(w);
  const P = G.makeWorld({ seed, plates: 4, crust: 0.33, start: w.plates.start, maxSpeed: 4, radiusKm: d.planet.radiusKm, gravity: d.planet.gravity, scaling: w.tectonics.scaling });
  Object.assign(w.plates, { plates: P.plates, features: P.features, nextPlate: P.nextPlate, seed: P.seed, step: P.step });
  return w;
}
const exampleWorld = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const EXAMPLES = () => fs.readdirSync(path.join(ROOT, 'examples')).filter((f) => f.endsWith('.worldsmith.json')).map((f) => path.join(ROOT, 'examples', f));

/* As settingsOf and tidesOf in js/steps/worldmap.js. */
function settingsOf(w, d, res) {
  const tides = M.planetTides({ moonMass: w.moon.enabled ? w.moon.mass : 0, moonKm: w.moon.a, starMass: w.star.mass, au: w.planet.a, locked: w.planet.rotation >= 0.95 * d.planet.yearEarthDays * 24, radiusKm: d.planet.radiusKm, gravity: d.planet.gravity });
  return {
    res: res || w.map.res || 720, land: (w.map.land ?? w.population.land) / 100, shelf: w.map.shelf, relief: w.map.relief, seed: w.plates.seed,
    gravity: d.planet.gravity, scaling: w.tectonics.scaling, radiusKm: d.planet.radiusKm, ridgeDepth: w.tectonics.ridgeDepth,
    erosion: w.map.erosion ?? 1, cells: d.planet.cells.count, tides, carve: w.map.carve !== false && w.planet.pressure >= WET,
  };
}

/*
 * The app's pipeline (buildMap), timed by stage, keeping the heights before and just after carving
 * (the strokes go on afterwards, as carveMap puts them). opts: res, mapSeed (the map's noise seed
 * instead of the plates'), bioSeed (the rivers' noise seed), Mod (another worldmap module).
 */
function pipeline(w, opts = {}) {
  const Mod = opts.Mod || M, d = C.computeAll(w), s = settingsOf(w, d, opts.res), t = {};
  if (opts.mapSeed != null) s.seed = opts.mapSeed;
  const time = (key, f) => { const t0 = process.hrtime.bigint(), v = f(); t[key] = Number(process.hrtime.bigint() - t0) / 1e6; return v; };
  const pl = K.planetOf(w, d), bpl = { ...B.planetOf(w, d), ...(opts.bioSeed != null ? { seed: opts.bioSeed } : {}) };
  const map = time('map', () => Mod.build(w.plates, { ...s, carve: false, strokes: s.carve ? [] : w.map.strokes }));
  const clim = time('climate', () => K.build(map, pl));
  let before = null, carved = null;
  if (s.carve) {
    const water = time('water', () => B.water(map, clim, B.planetOf(w, d)));
    before = Float32Array.from(map.z);
    time('carve', () => Mod.carveMap(map, { water, strokes: [], iceAge: w.map.iceAge ?? 6 }));
    carved = Float32Array.from(map.z);
    for (const st of w.map.strokes) Mod.stamp(map.grid, [st.lat, st.lon], st.r, (k, dd) => { map.z[k] += st.dz * smooth(1 - dd / st.r); if (map.cause) map.cause[k] |= 32; });
  }
  const bio = time('biomes', () => B.build(map, clim, bpl));
  return { w, d, map, clim, bio, before, carved, t, carve: s.carve };
}

/* Every measure for a world; with `compare`, the builds it is compared with too. */
function run(w, res = 720, compare = true) {
  const p = pipeline(w, { res });
  const out = { name: w.name, land: p.map.land, carve: p.carve, gravity: p.d.planet.gravity, pressure: w.planet.pressure, ...F.measure(p.map, p.clim, p.bio, p.before, p.carved) };
  if (compare) {
    const other = pipeline(w, { res, mapSeed: (w.plates.seed ?? 1) + 1000 }).map;       // only the map's noise seed differs
    const flat = pipeline(w, { res, Mod: noiseFree() }).map;                          // the map's noise off
    const bio2 = B.build(p.map, p.clim, { ...B.planetOf(w, p.d), seed: (w.plates.seed ?? 1) + 1 });   // only the rivers' noise differs
    const ov = F.landOverlap(p.map, other);
    Object.assign(out, {
      landKept: ov.iou, flip: ov.flip, landNoNoise: F.landOverlap(p.map, flat).iou, heightR2: F.heightR2(p.map, flat),
      bigRiversNear: F.riversNear(p.map, p.bio, bio2, 5000, 2), mouthsKept: F.mouthsKept(p.map, p.bio, bio2),
    });
  }
  return out;
}

const pc = (x) => (x == null ? '—' : `${(x * 100).toFixed(1)} %`);
const n2 = (x) => (x == null ? '—' : x.toFixed(2));
const int = (x) => (x == null ? '—' : x.toFixed(0));
const ROWS = [
  ['R1', 'Drawn river segments running uphill', 'r1Uphill', pc],
  ['', '  their climb, against the descent', 'r1Climb', pc],
  ['R1', 'Carved channels (≥ 600 m³/s) whose next cell is higher', 'r1Carve', pc],
  ['R2', 'Lake area not in a hollow of the map', 'r2Outside', pc],
  ['R3', 'Water balance error (drawn rivers)', 'r3Error', pc],
  ['R4', 'Rock balance error (carving and glaciers)', 'r4Error', pc],
  ['', '  glaciers’ share of the rock cut (carried nowhere)', 'r4Glacier', pc],
  ['R6', 'High land with no tectonic cause near', 'r6Uncaused', pc],
  ['', 'Land kept when only the map’s noise seed changes', 'landKept', pc],
  ['', '  share of the globe that flips', 'flip', pc],
  ['', 'Land overlap with the map’s noise off', 'landNoNoise', pc],
  ['', 'Land height explained by the noise-free build (R²)', 'heightR2', n2],
  ['', 'Neighbouring land cells differ by (m)', 'step', int],
  ['', 'Noise under the drawn rivers’ routing, up to (m)', 'roughDrawn', int],
  ['', 'Noise under the carving’s routing, up to (m)', 'roughCarve', int],
  ['', 'Drawn river bed below the ground 2 cells either side', 'valleys', pc],
  ['', 'Carved channel below the ground 2 cells either side', 'valleysCarve', pc],
  ['', 'Drawn rivers within a cell of a carved channel', 'riversAgree', pc],
  ['', 'Big rivers (≥ 5000 m³/s) kept within 110 km, rivers’ seed changed', 'bigRiversNear', pc],
  ['', 'Largest 10 mouths that keep their place', 'mouthsKept', (x) => (x == null ? '—' : String(x))],
  ['', 'Deltas / estuaries the carving built', 'deltas', (x, r) => (x == null ? '—' : `${x} / ${r.estuaries}`)],
  ['', 'Land below 200 m', 'below200', pc],
  ['', 'Land above 2000 m', 'above2000', pc],
  ['', 'Rain upwind / downwind of ground above 1800 m', 'rainShadow', n2],
  ['', 'Hack’s exponent, drawn rivers', 'hack', n2],
  ['', 'Hack’s exponent, carving', 'hackCarve', n2],
  ['', 'Concavity, drawn rivers (slope ∝ area^−θ)', 'concavity', n2],
  ['', '  their steps not downhill (left out)', 'concavityNotDown', pc],
  ['', 'Concavity, carving', 'concavityCarve', n2],
  ['', 'Lakes, share of land', 'lakes', pc],
  ['', 'Land draining inland', 'endorheic', pc],
  ['R7', 'Noise terms added to outputs: world map, climate, rivers', 'outputNoiseWorld', int],
  ['R7', 'Noise terms added to outputs: Region, Close-up, Atlas', 'outputNoiseRegion', int],
];
const target = (id, f) => { const t = F.TARGETS[id]; if (!t) return ''; return t[0] === t[1] ? f(t[0], {}) : `${f(t[0], {})} – ${f(t[1], {})}`; };

/* A table of rows by measure, columns by world. earthLike: which columns the Earth ranges apply to. */
function print(results, scan, earthLike) {
  const cols = results.map((r) => r.name), rows = [];
  for (const [rule, label, id, f] of ROWS) {
    const vals = results.map((r) => (id.startsWith('outputNoise') ? scan[id] : r[id]));
    const judged = vals.filter((v, i) => v != null && (!F.EARTH_ONLY.includes(id) || earthLike[i]));
    const ok = judged.every((v) => F.inRange(id, v));
    rows.push([rule, label, ...vals.map((v, i) => f(v, results[i])), target(id, f) + (F.EARTH_ONLY.includes(id) && F.TARGETS[id] ? ' (Earth)' : ''), F.TARGETS[id] && judged.length ? (ok ? 'ok' : 'FAIL') : '']);
  }
  const head = ['', 'Measure', ...cols, 'Target', ''];
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => (i === 1 ? String(c).padEnd(w[i]) : String(c).padStart(w[i]))).join('  ');
  console.log(line(head)); console.log(w.map((x) => '─'.repeat(x)).join('  '));
  rows.forEach((r) => console.log(line(r)));
}

if (require.main === module) {
  const args = process.argv.slice(2), ri = args.indexOf('--res'), res = ri >= 0 ? Number(args[ri + 1]) : 720;
  let seeds = args.filter((a, i) => /^\d+$/.test(a) && args[i - 1] !== '--res').map(Number);
  if (args.includes('--ten')) seeds = [7, 21, 99, 3, 11, 42, 58, 123, 256, 777];
  const onlyEx = args.includes('--examples');
  if (!seeds.length && !onlyEx) seeds = [7, 21, 99];
  const withEx = onlyEx || (!args.includes('--ten') && !args.some((a) => /^\d+$/.test(a)));
  const scan = F.scan(sources());
  const timed = (label, f) => { const t0 = Date.now(), v = f(); process.stderr.write(`${label}: ${((Date.now() - t0) / 1000).toFixed(1)} s\n`); return v; };
  if (seeds.length) {
    const results = seeds.map((s) => timed(`seed ${s}`, () => ({ ...run(seedWorld(s), res), name: `seed ${s}` })));
    console.log(`\nSeeds, Earth settings (the app's new-world template), ${res} cells\n`);
    print(results, scan, results.map(() => true));
  }
  if (withEx) {
    const results = EXAMPLES().map((f) => timed(path.basename(f), () => ({ ...run(exampleWorld(f), res, false), name: path.basename(f, '.worldsmith.json') })));
    console.log(`\nExample worlds, their own settings, ${res} cells (Earth ranges not judged on them)\n`);
    const extra = results.map((r) => `${r.name}: ${r.gravity.toFixed(2)} g, ${r.pressure} atm, land ${(r.land * 100).toFixed(0)} %${r.carve ? '' : ', not carved (no liquid water)'}`);
    print(results, scan, results.map(() => false));
    console.log(`\n${extra.join('\n')}`);
  }
  console.log(`\nR7: ${scan.unregistered.length} random numbers outside the register, ${scan.stale.length} stale entries. Noise added to outputs:`);
  for (const lvl of ['world', 'region']) {
    console.log(`  ${lvl === 'world' ? 'World map, climate, rivers' : 'Region, Close-up, Atlas'}:`);
    for (const e of scan.outputs.filter((x) => (x.file === 'js/region.js') === (lvl === 'region'))) console.log(`    ${e.file.replace('js/', '').padEnd(12)} ${e.what}${e.bounds ? ` (${e.bounds})` : ''}`);
  }
  scan.unregistered.forEach((u) => console.log(`  unregistered ${u.file}:${u.line}  ${u.text}`));
  scan.stale.forEach((e) => console.log(`  stale ${e.file}  ${e.at}`));
}

module.exports = { run, pipeline, seedWorld, exampleWorld, EXAMPLES, noiseFree, sources, settingsOf };
