/*
 * Fidelity: how far the map is caused rather than drawn. Pure measures over the map as the app
 * shows it (built, its climate, glaciers and rivers carving it: worldmap.js carveMap), its climate,
 * and its rivers and biomes (biomes.js). They build nothing. Runs in the page and in Node.
 *
 * Hard rules (must hold exactly):
 *   R1 no river runs uphill on the map's own heights (the rivers drawn, and the carving's channels);
 *   R2 every lake fills a closed hollow of the map's own heights, to its spill point or less;
 *   R3 water balances: runoff = discharge to the sea + lake evaporation, within 1 %;
 *   R4 rock balances: what is cut from the land = what is laid down + what goes out to the deep sea;
 *   R5 same inputs, same map, on every machine (tests);
 *   R6 land above 1500 m ÷ g^scaling lies in or beside a tectonic cause;
 *   R7 every random number is in the register below (tests scan the code).
 * Measures, with ranges at Earth settings: hypsometry, valleys, Hack's law, concavity, lakes,
 * inland drainage, rain shadows, and stability under a change of seed (two builds compared).
 *
 * Earth references: land hypsometry from "How High Is the World?" (Zenodo 23848930, 2026: AWS
 * terrain tiles from SRTM, GMTED2010 and ETOPO1), 27 % of land below 200 m and 11 % above 2000 m
 * (29 % and 6 % without Antarctica), mean 807 m; Pedersen et al. 2024 (EPSL 648, GEBCO 2023) for
 * the shape of the curve. Lakes 1.8 % of land (Messager et al. 2016, HydroLAKES, lakes ≥ 10 ha).
 * Endorheic basins about 20 % of land (Wang et al. 2018, Nature Geoscience). Hack's exponent about
 * 0.5-0.6 (Hack 1957; Rigon et al. 1996). Concavity 0.35-0.6 (Whipple & Tucker 1999; commonly
 * 0.4-0.6, Kirby & Whipple 2012).
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const M = node ? require('./worldmap.js') : root.WS.worldmap;
  const S = node ? require('./sphere.js') : root.WS.sphere;
  const D2R = Math.PI / 180;

  /* Target ranges at Earth settings ([lo, hi]; null: no target). Rules hold on any planet; the
     measures with `earth` only at Earth-like settings. */
  const TARGETS = {
    r1Uphill: [0, 0], r1Carve: [0, 0], r2Outside: [0, 0], r3Error: [0, 0.01], r4Error: [0, 0.01], rockLaid: [0.99, 1], r6Uncaused: [0, 0],
    landKept: [0.9, 1], landNoNoise: null, heightR2: null, step: null, roughDrawn: [0, 0], roughCarve: [0, 0],
    valleys: [0.9, 1], valleysCarve: [0.9, 1], riversAgree: [0.9, 1], bigRiversNear: [0.9, 1], mouthsKept: [10, 10],
    below200: [0.2, 0.35], above2000: [0.05, 0.15], rainShadow: [2, 10],
    hack: [0.5, 0.65], hackCarve: [0.5, 0.65], concavity: [0.35, 0.6], concavityCarve: [0.35, 0.6],
    lakes: [0.01, 0.05], endorheic: [0.05, 0.3], outputNoiseWorld: [0, 0], outputNoiseRegion: [0, 0],
    beltRank: [0.7, 1], beltNoiseR2: [0.85, 1], beltsAtCap: [0, 5], highestAllowed: [0, 1],
  };
  const EARTH_ONLY = ['below200', 'above2000', 'rainShadow', 'lakes', 'endorheic', 'hack', 'hackCarve', 'concavity', 'concavityCarve', 'beltsAtCap'];
  const inRange = (id, v) => { const t = TARGETS[id]; return !t || (v != null && v >= t[0] - 1e-12 && v <= t[1] + 1e-12); };

  /*
   * The register of random numbers (R7). Each line of code in js/ that draws a random number or
   * uses a noise field is listed here by a piece of its text, with what it stands for:
   *   source  where randomness enters (a generator, a seed)        input   a starting condition or
   *   seed    a new seed picked in the page                                a material property: allowed
   *   output  noise added to an output: breaks the rule, to be removed (counted by level: world
   *           = worldmap, climate, biomes; region = region.js, the Region, Close-up and Atlas maps)
   * `at: '*'` covers a whole file. NAMES are the noise functions a file calls by its own names.
   */
  const RANDOM = [
    { file: 'js/supercontinent.js', at: '*', kind: 'input', what: 'The plates’ history: the first supercontinent, plate motions, the timing of rifts, collisions, arcs, hotspots and LIPs; the spacing of the transform offsets along each rift (200-700 km).' },
    { file: 'js/generator.js', at: '*', kind: 'input', what: 'A random star system to start from.' },
    { file: 'js/orbits.js', at: '*', kind: 'input', what: 'Positions of the neighbouring stars.' },
    { file: 'js/steps/cosmos.js', at: 'Math.random() * 2e9', kind: 'seed', what: 'New galaxy seed.' },
    { file: 'js/steps/plates.js', at: 'seed: P().seed ?? ((Math.random() * 1e6) | 0)', kind: 'seed', what: 'First plates seed.' },
    { file: 'js/steps/plates.js', at: 'a.seed = (Math.random() * 1e6) | 0', kind: 'seed', what: 'New plates seed.' },
    // ── the world map (names: noise3, rng, r, nz, nA, nB, nC, fbm, warped, hashRng) ──
    { file: 'js/worldmap.js', at: 'a = Math.imul(a ^ str.charCodeAt(i), 16777619)', kind: 'source', what: 'Draws from a feature’s id.' },
    { file: 'js/worldmap.js', at: 'a = (a + 0x6d2b79f5)', kind: 'source', what: 'mulberry32 generator.' },
    { file: 'js/worldmap.js', at: 'function rng(seed)', kind: 'source', what: 'mulberry32 generator.' },
    { file: 'js/worldmap.js', at: 'function noise3(seed)', kind: 'source', what: 'Value noise on the sphere.' },
    { file: 'js/worldmap.js', at: 'const r = rng(seed), P = new Uint8Array(512)', kind: 'source', what: 'Value noise on the sphere.' },
    { file: 'js/worldmap.js', at: 'V[i] = r() * 2 - 1', kind: 'source', what: 'Value noise on the sphere.' },
    { file: 'js/worldmap.js', at: 'Math.floor(r() * (i + 1))', kind: 'source', what: 'Value noise on the sphere.' },
    { file: 'js/worldmap.js', at: 'nz = noise3(seed ^ 0x6d61)', kind: 'source', what: 'The map’s noise seed.' },
    { file: 'js/worldmap.js', at: 'hashRng(`p${f.id}`)', kind: 'input', what: 'Starting thickness of each piece of continental crust (a province).', bounds: '33-39 km' },
    { file: 'js/worldmap.js', at: 'const nS = noise3(seed ^ 0x5737)', kind: 'source', what: 'Seed of the land’s starting relief.' },
    { file: 'js/worldmap.js', at: 'H(RELIEF0_M) * nS(', kind: 'input', what: 'The land’s relief before the rivers began (a starting condition).', bounds: '±600 m × fbm (about ±200 m), less toward the sea but not below a 150 m scale, set before the sea level, ÷ g^scaling' },
    { file: 'js/worldmap.js', at: 'const fbm = (k, freq, oct) => nz(', kind: 'source', what: 'Fractal noise at a cell.' },
    { file: 'js/worldmap.js', at: 'const nA = noise3(seed ^ 0xa11)', kind: 'source', what: 'Domain warp.' },
    { file: 'js/worldmap.js', at: 'return nz(x + amt * nA(', kind: 'source', what: 'Domain-warped noise.' },
    { file: 'js/worldmap.js', at: '0.6 * lam * fbm(k, 5, 2)', kind: 'output', what: 'Parallel ridges in a belt.', bounds: '±0.6 × 260 km' },
    { file: 'js/worldmap.js', at: '0.35 + 1.4 * warped(k, 6, 4, 0.5)', kind: 'output', what: 'Shape of oceanic plateaus and flood basalts.', bounds: '×0-1' },
    { file: 'js/worldmap.js', at: '1 - Math.abs(warped(k, 9, 5, 0.15))', kind: 'output', what: 'Crests inside a belt.', bounds: '×0.4-1.2' },
    { file: 'js/worldmap.js', at: 'hills = H(180) * fbm(k, 14, 3)', kind: 'output', what: 'Abyssal hills.', bounds: '±180 m' },
    { file: 'js/worldmap.js', at: '300 * fbm(k, 2, 3)', kind: 'output', what: 'Depth of old sea floor.', bounds: '±300 m, −150 m' },
    { file: 'js/worldmap.js', at: '1600 * (fbm(k, 4, 2) + 1)', kind: 'output', what: 'Trench depth.', bounds: '2600-4200 m' },
    { file: 'js/worldmap.js', at: '0.3 * fbm(k, 16, 3) - 0.05', kind: 'output', what: 'Higher and lower stretches of an arc’s ridge.', bounds: '±0.3' },
    { file: 'js/worldmap.js', at: 'H(300) * fbm(k, 14, 2) * s', kind: 'output', what: 'Roughness of an arc’s ridge.', bounds: '±300 m' },
    { file: 'js/worldmap.js', at: 'r = hashRng(`${f.id}`)', kind: 'source', what: 'An arc’s volcanoes, from its id.' },
    { file: 'js/worldmap.js', at: 'let along = r() * geo(60)', kind: 'input', what: 'Where an arc’s first volcano rises.' },
    { file: 'js/worldmap.js', at: 'along += geo(55) + r() * geo(90)', kind: 'input', what: 'Spacing of an arc’s volcanoes.', bounds: '55-145 km' },
    { file: 'js/worldmap.js', at: 'const big = r() < 0.18', kind: 'output', what: 'Size of an arc volcano.', bounds: '10-65 km' },
    { file: 'js/worldmap.js', at: 'const top = big ? 300 + r() * 1800', kind: 'output', what: 'Height of an arc volcano.', bounds: '−1000 to +2100 m' },
    { file: 'js/worldmap.js', at: 'nz = noise3(((opts.seed ?? 1) ^ 0x1ce) >>> 0)', kind: 'source', what: 'Glacier noise seed.' },
    { file: 'js/worldmap.js', at: '(0.7 + 0.9 * (nz(gr.xyz[k * 3]', kind: 'output', what: 'Depth of glacial troughs (scoured hollows).', bounds: '×0.4-1.6' },
    // ── the climate (names: noise3, n, wobble, wob, iceWobble) ──
    { file: 'js/climate.js', at: 'function iceWobble(seed)', kind: 'source', what: 'Sea-ice edge noise.' },
    { file: 'js/climate.js', at: 'const n = M.noise3(seed * 13 + 5)', kind: 'source', what: 'Sea-ice edge noise.' },
    { file: 'js/climate.js', at: '7 * n(x, y, z, 2.2, 3)', kind: 'output', what: 'Sea-ice edge.', bounds: '±8 °C' },
    { file: 'js/climate.js', at: 'wobble = iceWobble(planet.seed ?? 1)', kind: 'source', what: 'Sea-ice edge noise.' },
    { file: 'js/climate.js', at: 'seaCold[k] + wobble(', kind: 'output', what: 'Sea-ice edge.', bounds: '±8 °C' },
    { file: 'js/climate.js', at: 'wob = iceWobble(seed)', kind: 'source', what: 'Sea-ice edge noise.' },
    { file: 'js/climate.js', at: 'v / sw + wob(', kind: 'output', what: 'Sea-ice edge.', bounds: '±8 °C' },
    // ── water, rivers and biomes (names: noise3, noise) ──
    { file: 'js/biomes.js', at: 'const noise = M.noise3(', kind: 'source', what: 'Water, rivers’ and biomes’ noise seed (in water and in build).' },
    { file: 'js/biomes.js', at: '0.8 * noise(x, y, zz, 9, 3)', kind: 'output', what: 'Temperature and rain on each cell, so biome edges wander; the rain then feeds the runoff that carves the map.', bounds: '±0.8 °C, ±12 % rain' },
    { file: 'js/biomes.js', at: '11, 2) > 0) biome[k] = BI.wetland', kind: 'output', what: 'Lake-shore wetlands.', bounds: 'half of them' },
    // ── Region, Close-up and Atlas (names: gradNoise, nc, ncw, n1, n2, nw, cw, nf, nb, nz, lump, soft, jit) ──
    { file: 'js/region.js', at: 'let h = s ^ Math.imul(xi, 0x8da6b343)', kind: 'source', what: 'Gradient noise.' },
    { file: 'js/region.js', at: 'h = Math.imul(h ^ (h >>> 13), 0x5bd1e995)', kind: 'source', what: 'Gradient noise.' },
    { file: 'js/region.js', at: 'function gradNoise(seed)', kind: 'source', what: 'Gradient noise.' },
    { file: 'js/region.js', at: 'nc = gradNoise(seed ^ 0xc0a57)', kind: 'source', what: 'Coast noise.' },
    { file: 'js/region.js', at: 'wx = wq * ncw(X / lam0', kind: 'output', what: 'Warp of the coast’s bends.', bounds: '±0.7 source cell' },
    { file: 'js/region.js', at: 'd += a * nc((X + wx) / lam', kind: 'output', what: 'The coastline below a world-map cell (fractal).', bounds: 'up to ~0.6 source cell' },
    { file: 'js/region.js', at: 'const n1 = gradNoise(seed ^ 0x5e61)', kind: 'source', what: 'Terrain detail noise.' },
    { file: 'js/region.js', at: 'wx = wq * nw(X / top', kind: 'output', what: 'Warp of the terrain detail.', bounds: '±0.35 source cell' },
    { file: 'js/region.js', at: 'n = n1(px, py, pz)', kind: 'output', what: 'Hills and swells below a world-map cell.', bounds: 'by relief' },
    { file: 'js/region.js', at: 'rr = 1 - Math.abs(n2(px + 5.3', kind: 'output', what: 'Ridged crests in mountains.', bounds: 'by relief' },
    { file: 'js/region.js', at: 'const cw = gradNoise(seed ^ 0xc11a)', kind: 'source', what: 'Climate lookup noise.' },
    { file: 'js/region.js', at: 'const fj = gfj(latOf(y)) + cA * (cw(', kind: 'output', what: 'Where each pixel reads the world’s climate (biome edges).', bounds: '±1 source cell' },
    { file: 'js/region.js', at: 'const fi = gfi(lonOf(x)) + cA * (cw(', kind: 'output', what: 'Where each pixel reads the world’s climate (biome edges).', bounds: '±1 source cell' },
    { file: 'js/region.js', at: 'nf = gradNoise(seed ^ 0xf1a7)', kind: 'source', what: 'Routing noise.' },
    { file: 'js/region.js', at: 'const lump = (k) =>', kind: 'output', what: 'Unevenness the water is routed over.', bounds: 'a few m' },
    { file: 'js/region.js', at: 'v + LUMP * lump(k)', kind: 'output', what: 'Unevenness the water is routed over.', bounds: 'a few m' },
    { file: 'js/region.js', at: 'v + 0.25 * ampK[k] * (nf(X, Y, Z)', kind: 'output', what: 'Slope roughness the valleys are routed over.', bounds: '±0.4 × local relief' },
    { file: 'js/region.js', at: 'const h = Math.imul(lab[k] + 7, 2654435761)', kind: 'output', what: 'How far each valley reaches inland.', bounds: '×0.6-1.7' },
    { file: 'js/region.js', at: 'const nb = gradNoise(seed ^ 0xb10e)', kind: 'source', what: 'Biome noise.' },
    { file: 'js/region.js', at: '0.6 * nb(xyz[k * 3] / 40', kind: 'output', what: 'Temperature for biomes.', bounds: '±0.6 °C' },
    { file: 'js/region.js', at: 'const jit = (k) =>', kind: 'output', what: 'River points off the pixel centres.', bounds: '±0.35 px' },
    { file: 'js/region.js', at: '[a, b] = jit(k)', kind: 'output', what: 'River points off the pixel centres.', bounds: '±0.35 px' },
    { file: 'js/region.js', at: 'nz = gradNoise((o.seed ^ 0x3e4d) | 0)', kind: 'source', what: 'Meander noise.' },
    { file: 'js/region.js', at: 'lam0 * (0.45 + 1.3 * smooth(0.5 + 0.8 * nz(', kind: 'output', what: 'Length of each meander bend.', bounds: '±40 %' },
    { file: 'js/region.js', at: 'const swing = 0.1 + 0.9 * smooth(0.5 + 1.1 * nz(', kind: 'output', what: 'How far each stretch swings.', bounds: '×0.1-1' },
    { file: 'js/region.js', at: 'ends * nz(u / (3 * lam0)', kind: 'output', what: 'Wander of the meander belt.', bounds: '±0.25 bend' },
    { file: 'js/region.js', at: 'nz = gradNoise((o.seed ^ 0xb4a1d) | 0)', kind: 'source', what: 'Braid noise.' },
    { file: 'js/region.js', at: '(0.85 + 0.3 * (0.5 + 0.5 * nz(l / (4 * bed)', kind: 'output', what: 'Width of a braided bed.', bounds: '±15 %' },
    { file: 'js/region.js', at: 'clamp(1.5 * nz(L[k] / (0.8 * bed)', kind: 'output', what: 'Courses of braided strands.', bounds: '±0.45 bed' },
    { file: 'js/region.js', at: 'j = 0.5 * ws * freeAt(u) * nz(', kind: 'output', what: 'Start of a migrating channel.', bounds: '±0.5 width' },
    { file: 'js/region.js', at: 'const soft = (x, y) =>', kind: 'input', what: 'How readily the banks give way (patches about a bend across): a material property.', bounds: '×0.25-1.75' },
    { file: 'js/region.js', at: 'sCache[i] = soft(X[i], Y[i])', kind: 'input', what: 'How readily the banks give way.' },
    { file: 'js/region.js', at: 'rCache[i] = 0.12 * nz(', kind: 'output', what: 'Push from the banks’ roughness on a migrating channel.', bounds: '±0.12' },
  ];
  // Material properties the model needs and no world gives: fixed values, assumed (no random number;
  // each `at` is the line that sets it). A world unlike Earth may differ in them; nothing yet lets it say so.
  const MATERIAL = [
    { file: 'js/worldmap.js', at: 'const GRAIN_MM = 0.25;', what: 'Size of the grains rivers carry and lay (the deposition coefficient G, through their settling speed).', value: '0.25 mm, fine to medium sand', source: 'assumed' },
    { file: 'js/worldmap.js', at: 'const G_EARTH = 1, T_EARTH = 15;', what: 'Earth rivers’ deposition coefficient G, and the water temperature it holds at; a world’s G is this times its grains’ settling speed against Earth’s. The share of grains riding near the bed (d*) is taken as on Earth.', value: 'G 1 at 15 °C', source: 'Guerit et al. 2019 (1-2), as Braun 2021 reports it' },
  ];
  const NAMES = {
    'js/worldmap.js': ['nz', 'nA', 'nB', 'nC', 'nS', 'fbm', 'warped', 'hashRng', 'r'], 'js/climate.js': ['n', 'wobble', 'wob', 'iceWobble'], 'js/biomes.js': ['noise'],
    'js/region.js': ['gradNoise', 'nc', 'ncw', 'n1', 'n2', 'nw', 'cw', 'nf', 'nb', 'nz', 'lump', 'soft', 'jit'],
  };
  const NOT_SCANNED = ['js/fidelity.js'];                                    // (this register)
  const LEVEL = (file) => (file === 'js/region.js' ? 'region' : 'world');

  /* R7: files {path: text} → lines that draw randomness but are not registered, entries that match
     nothing (stale), and the output-noise entries still live, by level. */
  function scan(files) {
    const unregistered = [], used = new Set();
    for (const [file, text] of Object.entries(files)) {
      if (NOT_SCANNED.includes(file)) continue;
      const entries = RANDOM.filter((e) => e.file === file);
      if (entries.some((e) => e.at === '*')) { entries.forEach((e) => used.add(e)); continue; }
      const names = ['noise3', 'rng', ...(NAMES[file] || [])];
      const re = new RegExp(`\\b(?:${names.join('|')})\\s*\\(|Math\\.random|Math\\.imul`);
      const lines = text.split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!re.test(line)) return;
        const two = `${line}\n${lines[i + 1] ?? ''}`;                         // (an entry may name the line after, to tell twins apart)
        const hit = entries.filter((e) => (e.at.includes('\n') ? two.includes(e.at) : line.includes(e.at)));
        if (!hit.length) unregistered.push({ file, line: i + 1, text: line.trim().slice(0, 120) });
        hit.forEach((e) => used.add(e));
      });
    }
    const scanned = new Set(Object.keys(files));
    const stale = RANDOM.filter((e) => scanned.has(e.file) && !used.has(e));
    // (one effect may take several lines: counted once, by what it does)
    const outputs = [], seen = new Set();
    for (const e of RANDOM) if (e.kind === 'output' && used.has(e) && !seen.has(e.file + e.what)) { seen.add(e.file + e.what); outputs.push(e); }
    return { unregistered, stale, outputs, outputNoiseWorld: outputs.filter((e) => LEVEL(e.file) === 'world').length, outputNoiseRegion: outputs.filter((e) => LEVEL(e.file) === 'region').length };
  }

  // ── helpers ──
  const kmDegOf = (map) => (Math.PI * (map.planet?.radiusKm ?? 6371)) / 180;
  const factorOf = (map) => map.planet?.factor ?? 1;
  const weight = (map, k) => map.grid.cosl[Math.floor(k / map.W)];
  const cellArea = (map, k) => (map.grid.dx * kmDegOf(map)) ** 2 * Math.max(0.02, weight(map, k));   // km², as the carving counts it
  function cellKm(map, a, b) {
    const { W, grid: gr } = map, ja = Math.floor(a / W), jb = Math.floor(b / W);
    const di = Math.min(Math.abs((a % W) - (b % W)), W - Math.abs((a % W) - (b % W)));
    return Math.hypot(di * gr.dx * gr.cosl[ja], (ja - jb) * gr.dx) * kmDegOf(map);
  }
  const zAt = (map, la, lo) => map.z[M.cellOf(map.grid, la, lo)];
  /* Least squares of y on x: slope, and R². */
  function fit(xs, ys) {
    const n = xs.length; if (n < 3) return { slope: null, r2: null, n };
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; syy += ys[i] * ys[i]; }
    const cxx = sxx - sx * sx / n, cxy = sxy - sx * sy / n, cyy = syy - sy * sy / n;
    return { slope: cxy / cxx, r2: (cxy * cxy) / (cxx * cyy), n };
  }
  function heap(key) {
    const a = [];
    return {
      get size() { return a.length; },
      push(k) { a.push(k); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (key[a[p]] <= key[k]) break; a[i] = a[p]; i = p; } a[i] = k; },
      pop() { const top = a[0], last = a.pop(); if (a.length) { let i = 0; const n = a.length; for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && key[a[c + 1]] < key[a[c]]) c++; if (key[a[c]] >= key[last]) break; a[i] = a[c]; i = c; } a[i] = last; } return top; },
    };
  }
  function neighbours(map, k, f) {
    const { W, H } = map, j = Math.floor(k / W), i = k - j * W;
    for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= H) continue; for (let di = -1; di <= 1; di++) if (di || dj) f(jj * W + ((i + di + W) % W)); }
  }

  // ── hard rules ──
  /* R1: drawn river segments that climb on the map's own heights (more than 2 m), and the total climb
     against the total descent. On a fresh lake the water's height is its surface, the level of its
     outlet, not its bed (a river leaving a lake leaves at that level); a salt lake stands below its
     rim, on its bed. */
  function uphill(map, bio, fill) {
    let up = 0, seg = 0, climb = 0, drop = 0;
    const at = (p) => { const k = M.cellOf(map.grid, p[0], p[1]); return bio.lake && bio.lake[k] === 1 && fill ? Math.max(map.z[k], fill[k]) : map.z[k]; };
    for (const rv of bio.rivers) for (let i = 1; i < rv.pts.length; i++) {
      const a = at(rv.pts[i - 1]), b = at(rv.pts[i]);
      if (!(a > 0 && b > 0)) continue;
      seg++;
      if (b > a + 2) { up++; climb += b - a; } else drop += Math.max(0, a - b);
    }
    return { share: seg ? up / seg : 0, segments: seg, climb: drop ? climb / drop : 0 };
  }
  /* The map's own heights with every closed hollow filled to its spill point (priority flood from
     the sea; a world with no sea from its lowest cell). */
  function filled(map) {
    const { z } = map, N = z.length, fill = new Float64Array(N), done = new Uint8Array(N), q = heap(fill);
    for (let k = 0; k < N; k++) if (!(z[k] > 0)) { done[k] = 1; fill[k] = z[k]; q.push(k); }
    if (!q.size) { let lo = 0; for (let k = 1; k < N; k++) if (z[k] < z[lo]) lo = k; done[lo] = 1; fill[lo] = z[lo]; q.push(lo); }
    while (q.size) {
      const c = q.pop();
      neighbours(map, c, (n) => { if (done[n]) return; done[n] = 1; fill[n] = Math.max(z[n], fill[c]); q.push(n); });
    }
    return fill;
  }
  const inHollow = (map, fill, k) => fill[k] - map.z[k] > 0.5;
  /* R1 for the carving: of the cells its rivers run through (discharge ≥ minFlow, m³/s), the share
     whose next cell down is higher on the map (more than 2 m), outside closed hollows (where water
     may pond and spill). */
  function carveUphill(map, fill = filled(map), minFlow = 600) {
    const rv = map.rivers; if (!rv) return { share: null, n: 0 };
    let n = 0, up = 0;
    for (let k = 0; k < map.z.length; k++) {
      const r = rv.recv[k];
      if (!(map.z[k] > 0) || rv.discharge[k] < minFlow || r < 0 || !(map.z[r] > 0) || inHollow(map, fill, k)) continue;
      n++; if (map.z[r] > map.z[k] + 2) up++;
    }
    return { share: n ? up / n : 0, n };
  }
  /* R2: the share of lake area that is not in a closed hollow of the map's own heights. */
  function lakesInHollows(map, bio, fill = filled(map)) {
    let all = 0, out = 0;
    for (let k = 0; k < map.z.length; k++) if (bio.lake[k]) { const w = weight(map, k); all += w; if (!inHollow(map, fill, k)) out += w; }
    return { share: all ? out / all : 0, lakeArea: all };
  }
  /* R3: runoff (m³/s) against what reaches the sea and what lakes evaporate. */
  function waterBalance(map, bio) {
    const { z } = map, N = z.length, kd = kmDegOf(map), gr = map.grid, YEAR_S = 3.156e7;
    let runoff = 0, toSea = 0;
    for (let k = 0; k < N; k++) {
      if (!(z[k] > 0)) continue;
      runoff += (bio.runoff[k] / 1000) * (gr.dx * kd) ** 2 * weight(map, k) * 1e6 / YEAR_S;
      const r = bio.recv[k];
      if (!bio.terminal[k] && (r < 0 || !(z[r] > 0))) toSea += bio.flow[k];
    }
    const lakes = bio.evaporated ?? 0;
    return { runoff, toSea, lakes, error: runoff > 0 ? Math.abs(runoff - toSea - lakes) / runoff : 0 };
  }
  /*
   * R4: rock. before: the heights before glaciers and rivers carved them; carved: just after (before
   * any brush strokes). What left the land and the sea floor (km³) against what was laid down on them
   * plus what the carving's book sends out past its deltas to the deep sea. null when nothing carved.
   * Also the glaciers' share of the cutting (their rock is not carried anywhere).
   */
  function rockBalance(map, before, carved) {
    if (!before || !carved || !(map.rivers || map.glaciers)) return { error: null };
    let removed = 0, added = 0, glacier = 0;
    for (let k = 0; k < before.length; k++) {
      const d = (carved[k] - before[k]) * cellArea(map, k) / 1000;
      if (d < 0) removed -= d; else added += d;
      if (map.glaciers) glacier += Math.max(0, map.glaciers.cut[k]) * cellArea(map, k) / 1000;
    }
    // (the carving's book: rock cut by rivers, glaciers and the tide in estuaries, less what it laid)
    const rv = map.rivers, toDeep = !rv ? 0 : rv.toDeep != null ? rv.toDeep : Math.max(0, rv.eroded - rv.basins - rv.delta);
    return { error: removed > 0 ? Math.abs(removed - added - toDeep) / removed : 0, removed, added, toDeep, glacier, eroded: rv ? rv.eroded : 0 };
  }
  /* Of the rock the carving cut (rivers, glaciers, estuaries' scour), the share laid somewhere on the
     map, and how it divides: [basins, moraines, deltas, out to the deep sea]; null when nothing cut. */
  function rockLaid(map) {
    const rv = map.rivers;
    if (!rv || rv.toDeep == null) return { share: null, parts: null, toDeep: null };
    const cut = rv.eroded + (rv.glacial || 0) + (rv.scour || 0);
    if (!(cut > 0)) return { share: null, parts: null, toDeep: rv.toDeep };
    // (laid on the plains as the rivers went, in basins, as moraines, in deltas, on the shelf, slope and fans)
    const laid = (rv.plains || 0) + rv.basins + (rv.moraine || 0) + rv.delta + (rv.shelf || 0);
    const parts = [rv.plains || 0, rv.basins, rv.moraine || 0, rv.delta + (rv.shelf || 0), Math.max(0, rv.toDeep)].map((v) => v / cut);
    return { share: laid / cut, parts, toDeep: rv.toDeep };
  }
  /* R6: the share of land above 1500 m ÷ g^scaling that is more than 300 km (÷ g^scaling) from
     anything that raised it (a belt, plateau, igneous province, hotspot, arc, or the brush). */
  function uncaused(map) {
    if (!map.cause) return { share: null, area: 0 };
    const f = factorOf(map), high = 1500 / f, beside = (300 / f) / kmDegOf(map);
    const d = M.distance(map.grid, map.cause).d;
    let all = 0, out = 0;
    for (let k = 0; k < map.z.length; k++) if (map.z[k] > high) { const w = weight(map, k); all += w; if (d[k] > beside) out += w; }
    return { share: all ? out / all : 0, area: all };
  }

  // ── measures of one build ──
  /* Land below 200 m and above 2000 m (÷ g^scaling), mean land height, by area. */
  function hypsometry(map) {
    const f = factorOf(map); let land = 0, low = 0, high = 0, mean = 0;
    for (let k = 0; k < map.z.length; k++) { const v = map.z[k]; if (!(v > 0)) continue; const w = weight(map, k); land += w; mean += w * v; if (v < 200 / f) low += w; if (v > 2000 / f) high += w; }
    return { below200: land ? low / land : 0, above2000: land ? high / land : 0, mean: land ? mean / land : 0 };
  }
  /* Mean height difference between land cells side by side (east-west). */
  function step(map) {
    const { z, W } = map; let s = 0, n = 0;
    for (let k = 0; k < z.length; k++) { const i = k % W, e = k - i + ((i + 1) % W); if (z[k] > 0 && z[e] > 0) { s += Math.abs(z[k] - z[e]); n++; } }
    return n ? s / n : 0;
  }
  /* Is a cell lower than the ground two cells to either side, across a direction (dla, dlo in degrees)? */
  function lowerThanSides(map, la, lo, dla, dlo) {
    const cl = Math.max(0.2, Math.cos(la * D2R)), ex = dlo * Math.cos(la * D2R), l = Math.hypot(dla, ex);
    if (l < 1e-9) return null;
    const s = 2 * map.grid.dx, pla = (-ex / l) * s, plo = ((dla / l) * s) / cl;
    const b = zAt(map, la, lo), L = zAt(map, la + pla, lo + plo), R = zAt(map, la - pla, lo - plo);
    return L > 0 && R > 0 ? b - (L + R) / 2 < -5 : null;
  }
  /* Valleys: where a drawn river is lower than the ground two cells to either side, across its course. */
  function valleys(map, bio) {
    let n = 0, lower = 0;
    for (const rv of bio.rivers) for (let i = 1; i < rv.pts.length; i++) {
      const [la, lo] = rv.pts[i], [la0, lo0] = rv.pts[i - 1];
      if (!(zAt(map, la0, lo0) > 0 && zAt(map, la, lo) > 0)) continue;
      const v = lowerThanSides(map, la, lo, la - la0, lo - lo0);
      if (v != null) { n++; if (v) lower++; }
    }
    return n ? lower / n : 0;
  }
  const llOf = (map, k) => [map.grid.lat[Math.floor(k / map.W)], -180 + ((k % map.W) + 0.5) * map.grid.dx];
  /* The same for the carving's own channels (discharge ≥ minFlow), across the way each drains. */
  function valleysCarve(map, minFlow = 600) {
    const rv = map.rivers; if (!rv) return null;
    let n = 0, lower = 0;
    for (let k = 0; k < map.z.length; k++) {
      const r = rv.recv[k];
      if (!(map.z[k] > 0) || rv.discharge[k] < minFlow || r < 0 || !(map.z[r] > 0)) continue;
      const a = llOf(map, k), b = llOf(map, r); let dlo = b[1] - a[1]; dlo -= 360 * Math.round(dlo / 360);
      const v = lowerThanSides(map, a[0], a[1], b[0] - a[0], dlo);
      if (v != null) { n++; if (v) lower++; }
    }
    return n ? lower / n : 0;
  }
  /* Drawn rivers (cells with flow ≥ minFlow) within `cells` cells of a channel the carving cut. */
  function riversAgree(map, bio, minFlow = 600, cells = 1) {
    const rv = map.rivers; if (!rv) return null;
    const { z, W, H } = map, near = new Uint8Array(z.length);
    for (let k = 0; k < z.length; k++) if (z[k] > 0 && rv.discharge[k] >= minFlow) {
      const j = Math.floor(k / W), i = k % W;
      for (let dj = -cells; dj <= cells; dj++) { const jj = j + dj; if (jj < 0 || jj >= H) continue; for (let di = -cells; di <= cells; di++) near[jj * W + ((i + di + W) % W)] = 1; }
    }
    let n = 0, hit = 0;
    for (let k = 0; k < z.length; k++) if (z[k] > 0 && !bio.lake[k] && bio.flow[k] >= minFlow) { n++; if (near[k]) hit++; }
    return n ? hit / n : 1;
  }
  /* Down a routing (recv: where each cell drains; stop: cells that end a basin): drained area (km²)
     and the longest path down to each cell (km). */
  function network(map, recv, stop) {
    const { z } = map, N = z.length, kd = kmDegOf(map), gr = map.grid;
    const A = new Float64Array(N), L = new Float64Array(N), donors = new Int32Array(N), down = new Int32Array(N).fill(-1);
    for (let k = 0; k < N; k++) {
      if (!(z[k] > 0)) continue;
      A[k] = (gr.dx * kd) ** 2 * weight(map, k);
      const r = recv[k];
      if (r >= 0 && z[r] > 0 && !(stop && stop[k])) { down[k] = r; donors[r]++; }
    }
    const stack = [];
    for (let k = 0; k < N; k++) if (z[k] > 0 && !donors[k]) stack.push(k);
    while (stack.length) {
      const k = stack.pop(), r = down[k];
      if (r < 0) continue;
      A[r] += A[k]; L[r] = Math.max(L[r], L[k] + cellKm(map, k, r));
      if (--donors[r] === 0) stack.push(r);
    }
    return { A, L, down, minA: 10 * (gr.dx * kd) ** 2 };
  }
  /* Hack's law, L ∝ A^h, over cells draining at least ten cells (lake cells left out). */
  function hack(map, net, lake) {
    const xs = [], ys = [];
    for (let k = 0; k < map.z.length; k++) if (net.A[k] >= net.minA && net.L[k] > 0 && !(lake && lake[k])) { xs.push(Math.log10(net.A[k])); ys.push(Math.log10(net.L[k])); }
    const r = fit(xs, ys);
    return { h: r.slope, r2: r.r2, n: r.n };
  }
  /* Channel slope against drained area, S ∝ A^-θ, on the map's own heights; cells whose next step
     down is not lower are left out (and counted). */
  function concavity(map, net, lake) {
    const xs = [], ys = []; let flat = 0, all = 0;
    for (let k = 0; k < map.z.length; k++) {
      const r = net.down[k];
      if (r < 0 || net.A[k] < net.minA || (lake && (lake[k] || lake[r]))) continue;
      all++;
      const s = (map.z[k] - map.z[r]) / (cellKm(map, k, r) * 1000);
      if (!(s > 0)) { flat++; continue; }
      xs.push(Math.log10(net.A[k])); ys.push(Math.log10(s));
    }
    const r = fit(xs, ys);
    return { theta: r.slope == null ? null : -r.slope, r2: r.r2, n: r.n, notDown: all ? flat / all : 0 };
  }
  /* Rain shadows: July rain three climate cells upwind of ground above 1800 m (÷ g^scaling) over the
     rain three cells downwind; the median over all such crossings. */
  function rainShadow(clim, factor = 1) {
    const c = clim, s = c.seasons.jul, ratios = [];
    for (let j = 3; j < c.H - 3; j++) for (let i = 0; i < c.W; i++) {
      const k = j * c.W + i; if (!c.land[k] || c.z[k] < 1800 / factor) continue;
      const l = Math.hypot(s.u[k], s.v[k]); if (l < 1e-6) continue;
      const cl = Math.max(0.1, Math.cos(c.lat[j] * D2R));
      const at = (d) => { const ii = Math.round(i + (d * (s.u[k] / l)) / cl), jj = Math.round(j - d * (s.v[k] / l)); if (jj < 0 || jj >= c.H) return -1; return jj * c.W + (((ii % c.W) + c.W) % c.W); };
      const uw = at(-3), dw = at(3); if (uw < 0 || dw < 0 || !c.land[uw] || !c.land[dw]) continue;
      ratios.push(s.Pr[uw] / Math.max(1, s.Pr[dw]));
    }
    ratios.sort((p, q) => p - q);
    return { median: ratios.length ? ratios[ratios.length >> 1] : null, n: ratios.length };
  }

  // ── mountain belts (worldmap.js: what the plates fed each, js/crust.js) ──
  /* Spearman's rank correlation of two lists (null under 3). */
  function spearman(x, y) {
    const n = x.length;
    if (n < 3) return null;
    const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(n); idx.forEach(([, i], k) => { r[i] = k; }); return r; };
    const rx = rank(x), ry = rank(y), mx = (n - 1) / 2;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - mx); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - mx) ** 2; }
    return sxy / Math.sqrt(sxx * syy);
  }
  /* Each belt the map drew: its height on the finished map (the 90th percentile of the land where it is
     the highest belt), the crust the plates fed it (km² in cross-section: shortening × crust kept), whether
     it is young (still rising, or stopped within 50 Myr of the map's age) and at the height cap. */
  function beltHeights(map) {
    if (!map.belts || !map.beltOf) return [];
    const hs = map.belts.map(() => []);
    for (let k = 0; k < map.z.length; k++) { const b = map.beltOf[k]; if (b >= 0 && map.z[k] > 0) hs[b].push(map.z[k]); }
    const age = map.age ?? 0;
    return map.belts.map((b, i) => {
      const a = hs[i].sort((x, y) => x - y);
      return { id: b.id, type: b.type, fed: b.fed, height: a.length ? a[Math.floor(0.9 * (a.length - 1))] : null, young: b.rising || (b.active ?? 0) - age <= 50, atCap: b.atCap };
    });
  }
  /* Rank correlation of belt height on the finished map with the crust the plates fed it, young belts. */
  function beltRank(map) {
    const bs = beltHeights(map).filter((b) => b.young && b.height != null && b.fed > 0);
    return { rho: spearman(bs.map((b) => b.fed), bs.map((b) => b.height)), n: bs.length };
  }
  /* How much of the belts' height in one build the other explains (R², land in both where a belt itself
     stands at least 1000 m ÷ g^scaling: where the belt, not the ground under it, makes the height). */
  function beltR2(a, b) {
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    const tall = 1000 / factorOf(a);
    for (let k = 0; k < a.z.length; k++) if (a.beltH && a.beltH[k] >= tall && a.z[k] > 0 && b.z[k] > 0) { const x = b.z[k], y = a.z[k], w = weight(a, k); n += w; sx += w * x; sy += w * y; sxx += w * x * x; syy += w * y * y; sxy += w * x * y; }
    if (!n) return null;
    const r = (sxy / n - (sx / n) * (sy / n)) / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2));
    return r * r;
  }
  /* The map's highest point as a share of what the planet's gravity allows (Everest's 8850 m ÷ g^scaling). */
  const highestAllowed = (map) => (map.highest ? map.highest.m / (8850 / factorOf(map)) : null);

  // ── comparing two builds ──
  /* Land in both against land in either (area), and the share of the globe that changed. */
  function landOverlap(a, b) {
    let both = 0, either = 0, flip = 0, all = 0;
    for (let k = 0; k < a.z.length; k++) { const x = a.z[k] > 0, y = b.z[k] > 0, w = weight(a, k); all += w; if (x && y) both += w; if (x || y) either += w; if (x !== y) flip += w; }
    return { iou: either ? both / either : 1, flip: flip / all };
  }
  /* How much of the land height of one build the other explains (R², area-weighted, land in both). */
  function heightR2(a, b) {
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (let k = 0; k < a.z.length; k++) if (a.z[k] > 0 && b.z[k] > 0) { const x = b.z[k], y = a.z[k], w = weight(a, k); n += w; sx += w * x; sy += w * y; sxx += w * x * x; syy += w * y * y; sxy += w * x * y; }
    const r = (sxy / n - (sx / n) * (sy / n)) / Math.sqrt((sxx / n - (sx / n) ** 2) * (syy / n - (sy / n) ** 2));
    return r * r;
  }
  /* River cells of at least minFlow (m³/s) in one routing within `cells` cells of such a river in the other. */
  function riversNear(map, bioA, bioB, minFlow = 5000, cells = 2) {
    const { z, W, H } = map, N = z.length, near = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (z[k] > 0 && bioB.flow[k] >= minFlow) {
      const j = Math.floor(k / W), i = k % W;
      for (let dj = -cells; dj <= cells; dj++) { const jj = j + dj; if (jj < 0 || jj >= H) continue; for (let di = -cells; di <= cells; di++) near[jj * W + ((i + di + W) % W)] = 1; }
    }
    let n = 0, hit = 0;
    for (let k = 0; k < N; k++) if (z[k] > 0 && bioA.flow[k] >= minFlow) { n++; if (near[k]) hit++; }
    return n ? hit / n : 1;
  }
  /* Of the `count` largest river mouths, how many have one within 300 km with a third of its flow in the other. */
  function mouthsKept(map, bioA, bioB, count = 10, km = 300) {
    const mouths = (b) => b.rivers.map((rv) => ({ p: rv.pts[rv.pts.length - 1], q: rv.q[rv.q.length - 1] })).filter((m) => !(zAt(map, ...m.p) > 0)).sort((x, y) => y.q - x.q);
    const a = mouths(bioA).slice(0, count), b = mouths(bioB), deg = km / kmDegOf(map);
    return a.filter((m) => b.some((o) => o.q > m.q / 3 && S.distance(m.p, o.p) < deg)).length;
  }

  /* Everything measured on one finished map, its climate and its rivers (clim, bio may be null);
     before and carved: its heights before and just after carving (for R4). */
  function measure(map, clim, bio, before, carved) {
    const out = {}, fill = filled(map), hy = hypsometry(map), r4 = rockBalance(map, before, carved);
    Object.assign(out, {
      below200: hy.below200, above2000: hy.above2000, meanLand: hy.mean, step: step(map), r6Uncaused: uncaused(map).share,
      r4Error: r4.error, r4Removed: r4.removed ?? null, r4Glacier: r4.removed ? r4.glacier / r4.removed : null,
      rockLaid: rockLaid(map).share, rockParts: rockLaid(map).parts, toDeep: rockLaid(map).toDeep,
      r1Carve: carveUphill(map, fill).share, valleysCarve: valleysCarve(map), roughCarve: map.rivers ? 2 * (map.carving?.rough ?? 0) : null,
    });
    if (map.belts) {
      const br = beltRank(map);
      Object.assign(out, { beltRank: br.rho, beltsYoung: br.n, beltsAtCap: map.belts.filter((b) => b.atCap).length, beltsDrawn: map.belts.length, highestAllowed: highestAllowed(map) });
    }
    if (map.rivers) {
      const netC = network(map, map.rivers.recv, null), hc = hack(map, netC, null), cc = concavity(map, netC, null);
      Object.assign(out, { hackCarve: hc.h, concavityCarve: cc.theta, deltas: map.rivers.mouthList.filter((m) => /delta/.test(m.kind)).length, estuaries: map.rivers.mouthList.filter((m) => m.kind === 'estuary').length });
    }
    if (clim) out.rainShadow = rainShadow(clim, factorOf(map)).median;
    if (bio) {
      const up = uphill(map, bio, fill), net = network(map, bio.recv, bio.terminal), hk = hack(map, net, bio.lake), cc = concavity(map, net, bio.lake);
      Object.assign(out, {
        r1Uphill: up.share, r1Climb: up.climb, r1Segments: up.segments, r2Outside: lakesInHollows(map, bio, fill).share, r3Error: waterBalance(map, bio).error,
        roughDrawn: 2 * (bio.rough ?? 0), valleys: valleys(map, bio), riversAgree: riversAgree(map, bio), hack: hk.h, concavity: cc.theta, concavityNotDown: cc.notDown,
        lakes: bio.stats.lakeShare, endorheic: bio.stats.endorheic,
      });
    }
    return out;
  }

  /* The hard rules that can be checked on the page, as short lines: [{id, ok, text}]. */
  function rules(map, bio) {
    const pc = (x) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)} %`, out = [], fill = filled(map);
    if (bio) {
      const up = uphill(map, bio, fill), r2 = lakesInHollows(map, bio, fill), r3 = waterBalance(map, bio);
      out.push({ id: 'R1', ok: up.share === 0, text: !up.segments ? 'R1 · No rivers.' : up.share === 0 ? 'R1 · Rivers run downhill.' : `R1 · ${pc(up.share)} of river stretches run uphill.` });
      out.push({ id: 'R2', ok: r2.share === 0, text: !r2.lakeArea ? 'R2 · No lakes.' : r2.share === 0 ? 'R2 · Lakes lie in hollows.' : `R2 · ${pc(r2.share)} of lake area is not in a hollow.` });
      out.push({ id: 'R3', ok: r3.error <= 0.01, text: `R3 · Water balances${r3.error <= 0.01 ? '' : ` to ${pc(r3.error)} only`}.` });
    }
    const r6 = uncaused(map);
    if (r6.share != null) out.push({ id: 'R6', ok: r6.share === 0, text: r6.share === 0 ? 'R6 · High ground has a tectonic cause.' : `R6 · ${pc(r6.share)} of high ground has no tectonic cause.` });
    return out;
  }

  const api = { TARGETS, EARTH_ONLY, RANDOM, MATERIAL, inRange, scan, filled, uphill, carveUphill, lakesInHollows, waterBalance, rockBalance, rockLaid, uncaused, hypsometry, step, valleys, valleysCarve, riversAgree, network, hack, concavity, rainShadow, landOverlap, heightR2, riversNear, mouthsKept, measure, rules, fit, spearman, beltHeights, beltRank, beltR2, highestAllowed };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.fidelity = api; }
})(typeof window !== 'undefined' ? window : globalThis);
