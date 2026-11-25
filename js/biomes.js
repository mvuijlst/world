/*
 * Rivers, lakes and biomes on the world map, from its heights and its climate.
 *   - water: what rain and snow leave after evaporation (a Budyko curve on the climate's rain and a
 *     potential evaporation from its temperatures); none where water cannot be liquid (too thin an
 *     atmosphere, or hotter than boiling at that pressure), none from ice sheets;
 *   - drainage: the one the map was carved with (worldmap.js hydrology: every land cell drains the
 *     lowest way out over the map's own heights), so the rivers drawn lie in the valleys they cut;
 *   - lakes: a hollow that gathers more water than its surface can evaporate fills and spills, a
 *     fresh lake; one that cannot ends in a salt lake and its rivers never reach the sea (an
 *     endorheic basin);
 *   - rivers: where the flow is large enough (in m³/s, so the same on any planet), drawn as lines;
 *   - biomes: from the warm and cold season, the year's rain against what could evaporate, and the
 *     height (colder up high), on the map's own cells.
 * Pure functions: runs in the page and in Node.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const M = node ? require('./worldmap.js') : root.WS.worldmap;
  const D2R = Math.PI / 180;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const YEAR_S = 3.156e7;

  /* The biomes, in the order of their codes (0 = sea), with their colours. */
  const BIOMES = [
    ['ice', 'Ice sheet', '#e6edf0'],
    ['barren', 'Barren rock', '#9b8f85'],
    ['tundra', 'Tundra', '#a3ab92'],
    ['boreal', 'Boreal forest', '#41694f'],
    ['temperate', 'Temperate forest', '#55894a'],
    ['temprain', 'Temperate rainforest', '#2f6a57'],
    ['medit', 'Mediterranean scrub', '#a3a058'],
    ['grass', 'Grassland & steppe', '#bdb874'],
    ['colddesert', 'Cold desert', '#c4b08e'],
    ['hotdesert', 'Hot desert', '#e3c78d'],
    ['savanna', 'Savanna', '#c7b552'],
    ['tropdry', 'Tropical dry forest', '#86a040'],
    ['rainforest', 'Tropical rainforest', '#1f6a36'],
    ['wetland', 'Wetland', '#5e8f80'],
  ];
  const BI = Object.fromEntries(BIOMES.map(([id], i) => [id, i + 1]));

  /* Water that could evaporate in a year (mm) at a season's temperature (°C), roughly as on Earth. */
  const pet = (T) => (T > 0 ? 1600 * Math.pow(T / 27, 1.3) : 0);
  /* Evaporation from rain P with potential evaporation E (Fu's form of the Budyko curve). */
  const budyko = (P, E) => { if (P <= 0) return 0; const f = E / P, w = 2.6; return P * (1 + f - Math.pow(1 + Math.pow(f, w), 1 / w)); };
  /* Boiling point (°C) at a pressure in atm. */
  const boiling = (atm) => 1 / (1 / 373.15 - (8.314 / 40660) * Math.log(Math.max(1e-6, atm))) - 273.15;

  /*
   * The biome (its code, 1-based into BIOMES) of land with this warm, cold and mean season (°C), the
   * year's rain and potential evaporation (mm), the rain in the warm season (mm), whether water can be
   * liquid, and the boiling point (°C).
   */
  function classify(tw, tc, ta, p, pe, pw, liquid = true, tBoil = 100) {
    const ai = p / Math.max(1, pe), summerDry = p > 0 && pw / p < 0.3;
    let b;
    if (!liquid || ta >= Math.min(tBoil, 60)) b = tw < 0 && p > 20 ? 'ice' : 'barren';
    else if (tw < 0) b = 'ice';
    else if (tw < 10) b = p < 60 ? 'barren' : 'tundra';
    else if (ai < 0.2) b = ta >= 18 ? 'hotdesert' : 'colddesert';
    else if (tc >= 18) b = ai < 0.5 ? 'savanna' : ai < 1.0 ? 'tropdry' : 'rainforest';
    else if (tc < -3 && (tw < 17 || ta < 2)) b = ai < 0.45 ? 'grass' : 'boreal';
    else if (summerDry && tc > -3 && ai < 1.2) b = 'medit';
    else if (ai < 0.5) b = 'grass';
    else if (tc > 0 && p > 1800 && ai > 1.8) b = 'temprain';
    else b = 'temperate';
    return BI[b];
  }

  /*
   * map: a built world map. clim: its climate (climate.js build). planet: {pressure (atm), seed,
   * radiusKm, gravity}. opts: minFlow (m³/s for a river line, 600), minCells (cells it drains, 8).
   */
  /*
   * The climate on the map's own cells, and the water each land cell sheds a year after evaporation
   * (mm): what the rivers carry, and what carves the map. map: a built world map; clim: its climate;
   * planet: {pressure (atm), seed, radiusKm, gravity}. Returns per-cell arrays (land cells only):
   * runoff, P (rain), PET (what could evaporate), Tw, Tc, Ta (warm, cold, mean °C), Pw (warm-season
   * rain), and land, area (km²), liquid, seaIce.
   */
  function water(map, clim, planet = {}) {
    const { W, H, z } = map, gr = map.grid, N = W * H;
    const R = planet.radiusKm ?? map.planet?.radiusKm ?? 6371, kmDeg = (Math.PI * R) / 180;
    const lapse = 6.5 * (planet.gravity ?? map.planet?.gravity ?? 1);
    const atm = planet.pressure ?? 1, liquid = atm >= 0.0061, tBoil = boiling(atm);
    const land = Uint8Array.from(z, (v) => (v > 0 ? 1 : 0));
    const area = Float32Array.from({ length: N }, (_, k) => (gr.dx * kmDeg) ** 2 * gr.cosl[Math.floor(k / W)]);   // km²
    const noise = M.noise3((planet.seed ?? 1) * 7 + 3);

    // ── the climate on the map's own cells (bilinear), corrected for height within a climate cell ──
    const cW = clim.W, cH = clim.H, J = clim.seasons.jan, L = clim.seasons.jul, Eq = clim.seasons.equ || { T: Float32Array.from(J.T, (t, q) => (t + L.T[q]) / 2), Pr: Float32Array.from(J.Pr, (v, q) => (v + L.Pr[q]) / 2) }, E = Eq.T;
    const Tw = new Float32Array(N), Tc = new Float32Array(N), Ta = new Float32Array(N), P = new Float32Array(N), Pw = new Float32Array(N), PETs = new Float32Array(N);
    const cz = clim.z;
    for (let j = 0; j < H; j++) {
      const fj = clamp(((j + 0.5) / H) * cH - 0.5, 0, cH - 1), j0 = Math.floor(fj), j1 = Math.min(cH - 1, j0 + 1), tj = fj - j0;
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        if (!land[k]) continue;
        const fi = ((i + 0.5) / W) * cW - 0.5, i0 = Math.floor(fi), ti = fi - i0;
        const a0 = j0 * cW + ((i0 % cW) + cW) % cW, a1 = j0 * cW + (((i0 + 1) % cW) + cW) % cW, b0 = j1 * cW + ((i0 % cW) + cW) % cW, b1 = j1 * cW + (((i0 + 1) % cW) + cW) % cW;
        // take only land neighbours where there are some (the sea's mild climate stays at sea)
        const ws = [[a0, (1 - ti) * (1 - tj)], [a1, ti * (1 - tj)], [b0, (1 - ti) * tj], [b1, ti * tj]];
        const anyLand = ws.some(([q]) => clim.land[q]);
        let sw = 0, tj2 = 0, tl2 = 0, te2 = 0, pj = 0, pl2 = 0, pe = 0, zc = 0;
        for (const [q, wt] of ws) {
          if (anyLand && !clim.land[q]) continue;
          sw += wt; tj2 += wt * J.T[q]; tl2 += wt * L.T[q]; te2 += wt * E[q]; pj += wt * J.Pr[q]; pl2 += wt * L.Pr[q]; pe += wt * Eq.Pr[q]; zc += wt * Math.max(0, cz[q]);
        }
        if (sw <= 0) { const q = a0; sw = 1; tj2 = J.T[q]; tl2 = L.T[q]; te2 = E[q]; pj = J.Pr[q]; pl2 = L.Pr[q]; pe = Eq.Pr[q]; zc = Math.max(0, cz[q]); }
        tj2 /= sw; tl2 /= sw; te2 /= sw; pj /= sw; pl2 /= sw; pe /= sw; zc /= sw;
        const tropo = 11000 / Math.max(0.05, planet.gravity ?? map.planet?.gravity ?? 1);
        const dT = (-lapse * (Math.min(z[k], tropo) - Math.min(zc, tropo))) / 1000;
        const x = gr.xyz[k * 3], y = gr.xyz[k * 3 + 1], zz = gr.xyz[k * 3 + 2];
        // a little noise so that biome edges wander as they do, rather than follow the climate's contours
        const nT = 0.8 * noise(x, y, zz, 9, 3), nP = 1 + 0.12 * noise(zz, x, y, 7, 3);
        const tj3 = tj2 + dT + nT, tl3 = tl2 + dT + nT, te3 = te2 + dT + nT;
        // the warm and cold season from the solstices and the equinoxes; the year's mean and evaporation
        // from its four quarters (the equinoxes counted twice)
        Tw[k] = Math.max(tj3, tl3, te3); Tc[k] = Math.min(tj3, tl3, te3); Ta[k] = (tj3 + tl3 + 2 * te3) / 4;
        PETs[k] = (pet(tj3) + pet(tl3) + 2 * pet(te3)) / 4;
        // the year's rain (a quarter round each solstice, half at the equinoxes), and the share of it that
        // falls in the warm season rather than the cold one (for dry summers)
        P[k] = Math.max(0, ((pj + pl2 + 2 * pe) / 2) * nP);
        const sea3 = [[tj3, pj], [tl3, pl2], [te3, pe]], wm = sea3.reduce((a, b) => (b[0] > a[0] ? b : a)), cd = sea3.reduce((a, b) => (b[0] < a[0] ? b : a));
        Pw[k] = wm === cd || wm[1] + cd[1] <= 0 ? P[k] / 2 : (P[k] * wm[1]) / (wm[1] + cd[1]);
      }
    }

    // winter sea ice on the map's own cells (worked out with the climate)
    const seaIce = clim.iceMap && clim.iceMap.length === N ? clim.iceMap : new Uint8Array(N);

    // ── water left after evaporation (mm a year) ──
    const runoff = new Float32Array(N), PET = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (!land[k]) continue;
      PET[k] = PETs[k];
      const ice = Tw[k] < 0, boil = Ta[k] >= tBoil;
      if (!liquid || ice || boil) continue;
      runoff[k] = Math.max(0, P[k] - budyko(P[k], PET[k]));
    }
    return { runoff, P, PET, Tw, Tc, Ta, Pw, land, area, liquid, seaIce, tBoil };
  }

  function build(map, clim, planet = {}, opts = {}) {
    const { W, H, z } = map, gr = map.grid, N = W * H;
    const R = planet.radiusKm ?? map.planet?.radiusKm ?? 6371, kmDeg = (Math.PI * R) / 180;
    const minFlow = opts.minFlow ?? 600, minCells = opts.minCells ?? 8;
    const noise = M.noise3((planet.seed ?? 1) * 7 + 3);
    const wt = water(map, clim, planet), { P, PET, Tw, Tc, Ta, Pw, land, area, liquid, seaIce, tBoil } = wt;

    // ── the water: the drainage the carving left (worldmap.js carve: where each cell drains over the
    // map's own heights, what flows, lakes fresh and salt) when it carved with this climate's water;
    // otherwise the same, worked out here over the map's heights ──
    const rv = map.rivers, carved = rv && rv.rain === 'climate' && rv.lake && rv.runoff && rv.recv.length === N;
    const hy = carved
      ? { recv: rv.recv, flow: rv.discharge, cellsUp: rv.cellsUp, lake: rv.lake, terminal: rv.terminal, evaporated: rv.evaporated, lakes: rv.lakes, saltLakes: rv.saltLakes, order: Int32Array.from(M.upstreamFirst(rv.recv, land)).reverse() }
      : M.hydrology(gr, z, { runoff: wt.runoff, P, PET, liquid, radiusKm: R });
    // (the runoff those rivers carry: the carving's, worked out from the climate before it carved)
    const runoff = carved ? rv.runoff : wt.runoff;
    const { recv, flow, cellsUp, terminal, evaporated } = hy, lakeOf = hy.lake, order = hy.order, no = order.length;
    const nb = (k, f) => {
      const j = Math.floor(k / W), i = k - j * W;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= H) continue;
        for (let di = -1; di <= 1; di++) { if (!di && !dj) continue; f(jj * W + ((i + di + W) % W), di && dj ? 1.4142 : 1); }
      }
    };

    // ── biomes ──
    const biome = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      if (!land[k]) continue;
      if (lakeOf[k]) { biome[k] = 0; continue; }
      biome[k] = classify(Tw[k], Tc[k], Ta[k], P[k], PET[k], Pw[k], liquid, tBoil);
    }
    // wetlands: big rivers over low, flat, wet ground, and the shores of fresh lakes
    for (let k = 0; k < N; k++) {
      if (!land[k] || lakeOf[k] || !biome[k]) continue;
      const id = BIOMES[biome[k] - 1][0];
      if (id === 'ice' || id === 'barren' || id === 'hotdesert' || id === 'colddesert') continue;
      const wet = P[k] / Math.max(1, PET[k]);
      if (z[k] < 120 && flow[k] > 2000 && wet > 0.6) biome[k] = BI.wetland;
      else if (wet > 0.9 && z[k] < 400) { let shore = false; nb(k, (n) => { if (lakeOf[n] === 1) shore = true; }); if (shore && noise(gr.xyz[k * 3 + 2], gr.xyz[k * 3], gr.xyz[k * 3 + 1], 11, 2) > 0) biome[k] = BI.wetland; }
    }

    // ── rivers as lines: from each source down to the sea, a salt lake, or the river it joins ──
    // (not drawn on lakes, nor under ice sheets)
    const hid = (k) => lakeOf[k] || biome[k] === BI.ice;
    const isRiver = (k) => land[k] && flow[k] >= minFlow && cellsUp[k] >= minCells && !hid(k);
    const kids = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (isRiver(k) && recv[k] >= 0) kids[recv[k]]++;
    const seen = new Uint8Array(N), rivers = [];
    const ll = (k) => [gr.lat[Math.floor(k / W)], -180 + ((k % W) + 0.5) * gr.dx];
    // (each river through its cells' centres; the corners are rounded below, and the line stays in the
    // cells the water runs through)
    const llj = ll;
    for (let s = 0; s < N; s++) {
      if (!isRiver(s) || kids[s]) continue;
      let cur = s, line = [], qs = [];
      const flush = () => { if (line.length > 1) rivers.push({ pts: line, q: qs }); line = []; qs = []; };
      while (cur >= 0) {
        if (hid(cur)) { if (line.length) { line.push(llj(cur)); qs.push(flow[cur]); } flush(); }
        else {
          if (!line.length && seen[cur] === 2) break;
          const p = llj(cur);
          if (line.length && Math.abs(p[1] - line[line.length - 1][1]) > 180) flush();
          line.push(p); qs.push(flow[cur]);
        }
        if (seen[cur]) { break; }
        seen[cur] = 2;
        if (terminal[cur]) break;
        const r = recv[cur];
        if (r < 0 || !land[r]) { if (r >= 0) { line.push(ll(r)); qs.push(flow[cur]); } break; }
        // leaving a lake or the ice: start again from its edge
        if (hid(cur) && !hid(r)) { line = [llj(cur)]; qs = [flow[cur]]; }
        cur = r;
      }
      flush();
    }
    // smooth each line with its longitudes unwrapped, then cut it where it crosses the date line
    const smoothed = [];
    for (const rv of rivers) {
      const u = rv.pts.map((p) => p.slice());
      for (let i = 1; i < u.length; i++) { while (u[i][1] - u[i - 1][1] > 180) u[i][1] -= 360; while (u[i][1] - u[i - 1][1] < -180) u[i][1] += 360; }
      const pts = chaikin(chaikin(u)).map(([a, o]) => [a, ((o + 540) % 360) - 180]), q = resample(rv.q, pts.length);
      let from = 0;
      for (let i = 1; i <= pts.length; i++) {
        if (i === pts.length || Math.abs(pts[i][1] - pts[i - 1][1]) > 180) { if (i - from > 1) smoothed.push({ pts: pts.slice(from, i), q: q.slice(from, i) }); from = i; }
      }
    }
    rivers.length = 0; rivers.push(...smoothed);

    // ── the longest river: the main stem up from the mouth with the most water ──
    const up = new Int32Array(N).fill(-1);
    for (let k = 0; k < N; k++) { const r = recv[k]; if (land[k] && r >= 0 && land[r] && !terminal[k] && (up[r] < 0 || flow[k] > flow[up[r]])) up[r] = k; }
    const stem = (m) => { let len = 0, c = m; while (c >= 0 && up[c] >= 0 && flow[c] >= minFlow) { const n = up[c]; len += cellKm(c, n); c = n; } return len; };
    function cellKm(a, b) { const ja = Math.floor(a / W), jb = Math.floor(b / W), di = Math.min(Math.abs((a % W) - (b % W)), W - Math.abs((a % W) - (b % W))); return Math.hypot(di * gr.dx * gr.cosl[ja], (ja - jb) * gr.dx) * kmDeg; }
    let longest = { km: 0, at: null, flow: 0 };
    const mouths = [];
    for (let k = 0; k < N; k++) if (land[k] && flow[k] >= minFlow && cellsUp[k] >= minCells && (recv[k] < 0 || !land[recv[k]] || terminal[k])) mouths.push(k);
    mouths.sort((a, b) => flow[b] - flow[a]);
    for (const m of mouths.slice(0, 40)) { const km = stem(m); if (km > longest.km) longest = { km, at: ll(m), flow: flow[m] }; }

    // ── figures ──
    let landA = 0, endA = 0, lakeA = 0, saltA = 0;
    const share = new Float64Array(BIOMES.length + 1);
    // which land drains to the sea: walk each cell down
    const toSea = new Int8Array(N);                                          // 1 sea, -1 inland
    for (let o = 0; o < no; o++) { const k = order[o], r = recv[k]; toSea[k] = terminal[k] ? -1 : r < 0 || !land[r] ? 1 : toSea[r]; }
    for (let k = 0; k < N; k++) {
      if (!land[k]) continue;
      const a = area[k]; landA += a;
      if (toSea[k] < 0) endA += a;
      if (lakeOf[k]) { lakeA += a; if (lakeOf[k] === 2) saltA += a; }
      share[biome[k]] += a;
    }
    let wet = false; for (let k = 0; k < N && !wet; k++) if (runoff[k] > 0) wet = true;
    const lakes = hy.lakes, salt = hy.saltLakes;
    return {
      W, H, grid: gr, biome, biomes: BIOMES, lake: lakeOf, seaIce, flow: Float32Array.from(flow), runoff, rivers, minFlow,
      inland: Uint8Array.from(toSea, (v) => (v < 0 ? 1 : 0)),
      recv, terminal, rough: 0, evaporated,                                  // (for the fidelity rules, js/fidelity.js)
      liquid: liquid && tBoil > -50,
      stats: {
        landKm2: landA, lakes, saltLakes: salt, lakeShare: lakeA / Math.max(1, landA), saltShare: saltA / Math.max(1, landA),
        endorheic: wet ? endA / Math.max(1, landA) : null, longest, mouths: mouths.length, biggest: mouths.length ? { flow: flow[mouths[0]], at: ll(mouths[0]) } : null,
        biomeShare: Array.from(share.slice(1), (v) => v / Math.max(1, landA)),
      },
    };
  }

  /* Corner-cutting: smoother lines from the grid's steps. */
  function chaikin(p) {
    if (p.length < 3) return p;
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    out.push(p[p.length - 1]);
    return out;
  }
  const resample = (q, n) => Array.from({ length: n }, (_, i) => q[Math.min(q.length - 1, Math.round((i / Math.max(1, n - 1)) * (q.length - 1)))]);

  /*
   * Land use for the Population step, from the biomes: the land's share of the surface; the
   * uninhabitable share of the land (ice, barren rock, deserts, and land high enough to be hard to
   * live on, 4 km at 1 g); how much of the habitable land can feed people; and the landmasses of at
   * least 1 % of the land (continents), largest first.
   */
  const FERTILE = { tundra: 0.05, boreal: 0.15, temperate: 0.8, temprain: 0.4, medit: 0.6, grass: 0.8, savanna: 0.55, tropdry: 0.6, rainforest: 0.3, wetland: 0.35 };
  function landUse(bio, map) {
    const { W, H } = bio, gr = map.grid, z = map.z, N = W * H, high = 4000 / (map.planet?.gravity ?? 1);
    let all = 0, land = 0, bad = 0, hab = 0, good = 0;
    for (let k = 0; k < N; k++) {
      const a = gr.cosl[Math.floor(k / W)]; all += a;
      if (!(z[k] > 0)) continue;
      land += a;
      if (bio.lake[k]) continue;
      const id = BIOMES[bio.biome[k] - 1]?.[0];
      if (!id || id === 'ice' || id === 'barren' || id === 'hotdesert' || id === 'colddesert' || z[k] > high) { bad += a; continue; }
      hab += a; good += a * (FERTILE[id] ?? 0);
    }
    // landmasses: connected land (8 neighbours, longitude wraps)
    const seen = new Uint8Array(N), masses = [];
    for (let k = 0; k < N; k++) {
      if (seen[k] || !(z[k] > 0)) continue;
      let a = 0; const st = [k]; seen[k] = 1;
      while (st.length) {
        const c = st.pop(), j = Math.floor(c / W), i = c - j * W; a += gr.cosl[j];
        for (let dj = -1; dj <= 1; dj++) { const jj = j + dj; if (jj < 0 || jj >= H) continue; for (let di = -1; di <= 1; di++) { const n = jj * W + ((i + di + W) % W); if (!seen[n] && z[n] > 0) { seen[n] = 1; st.push(n); } } }
      }
      masses.push(a);
    }
    masses.sort((a, b) => b - a);
    const continents = masses.filter((a) => a >= 0.01 * land).map((a) => a / land);
    return {
      land: (100 * land) / all,
      uninhabitable: land ? (100 * bad) / land : 0,
      productive: hab ? (100 * good) / hab : 0,
      continents,
    };
  }

  /* The planet's inputs for this from the app's world and derived values. */
  const planetOf = (w, d) => ({ pressure: w.planet.pressure, seed: w.plates.seed ?? 1, radiusKm: d.planet.radiusKm, gravity: d.planet.gravity });

  const api = { build, water, classify, BIOMES, BI, planetOf, pet, budyko, boiling, landUse };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.biomes = api; }
})(typeof window !== 'undefined' ? window : globalThis);
