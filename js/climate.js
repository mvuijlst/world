/*
 * Climate on the world map (Worldbuilder's Log 28-34, then climate zones): for two seasons, the
 * solstices, and the equinoxes, of a planet that need not be Earth (on a much tilted world the
 * equinoxes are the low latitudes' warm, wet season).
 *   - temperature (Log 33-34): sunlight by latitude and season (its star, orbit and tilt), tied to the
 *     planet's mean temperature; colder with height (a lapse rate that grows with gravity); land far
 *     from the sea has wider seasons; warm and cold currents warm and cool their coasts; sea ice;
 *   - pressure and winds (Log 29): belts from the planet's circulation cells (set by its day), shifted
 *     with the seasons, continents low in summer and high in winter; winds down the pressure
 *     gradient, turned by the planet's spin (right in the north on a prograde world);
 *   - ocean currents (Log 28): in each gyre, poleward and warm along a basin's western side, equatorward
 *     and cold along its eastern side; the subpolar gyres the other way round;
 *   - upwelling and coral reefs (Log 30): cold eastern-boundary coasts and the equator; reefs on warm
 *     shallows away from them;
 *   - precipitation (Log 31-32): water taken up from warm seas and carried along the winds, rained
 *     out in low-pressure belts, on windward slopes and as air cools; rain shadows behind mountains;
 *   - Köppen climate zones from all of that.
 * Worked out on a grid of at most 360 × 180 cells. Pure functions: runs in the page and in Node.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const C = node ? require('./calc.js') : root.WS.calc;
  const M = node ? require('./worldmap.js') : root.WS.worldmap;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

  /* Daily-mean sunlight (W/m²) at a latitude for the star's declination, with flux S0 at the top. */
  function insolation(latDeg, decDeg, S0) {
    const p = latDeg * D2R, d = decDeg * D2R, x = -Math.tan(p) * Math.tan(d);
    const h0 = x >= 1 ? 0 : x <= -1 ? Math.PI : Math.acos(x);
    return (S0 / Math.PI) * (h0 * Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.sin(h0));
  }

  /* The Köppen codes, and their colours on the Climate Zones step. */
  const ZONES = [
    ['Af', '#1f8a4c'], ['Am', '#2fa35d'], ['Aw', '#9ab83a'],
    ['BWh', '#e0a441'], ['BWk', '#c98f63'], ['BSh', '#d9b25a'], ['BSk', '#c4a77a'],
    ['Csa', '#c9b13c'], ['Csb', '#a8a93e'], ['Csc', '#a8a93e'], ['Cwa', '#8fbf55'], ['Cwb', '#5fa88a'], ['Cwc', '#5fa88a'], ['Cfa', '#7cc46a'], ['Cfb', '#3f9e7a'], ['Cfc', '#3a8a8a'],
    ['Dsa', '#7a7ec0'], ['Dsb', '#7a7ec0'], ['Dsc', '#5a5f8a'], ['Dsd', '#5a5f8a'], ['Dwa', '#5b7fc4'], ['Dwb', '#5b7fc4'], ['Dwc', '#4a5e9a'], ['Dwd', '#4a5e9a'],
    ['Dfa', '#4f86b8'], ['Dfb', '#4f86b8'], ['Dfc', '#3f6a9e'], ['Dfd', '#3f6a9e'], ['ET', '#8aa3a8'], ['EF', '#d8e4e6'],
  ];
  const ZI = Object.fromEntries(ZONES.map(([c], i) => [c, i + 1]));          // 0 = sea

  /* Köppen from the warm and cold season's temperature (°C) and precipitation (mm per half-year). */
  function koppen(Tw, Tc, Pw, Pc) {
    const Ta = (Tw + Tc) / 2, Pa = Pw + Pc;
    if (Tw < 10) return Tw < 0 ? 'EF' : 'ET';
    const summerShare = Pa > 0 ? Pw / Pa : 0.5;
    const th = 20 * Ta + (summerShare >= 0.7 ? 280 : summerShare <= 0.3 ? 0 : 140);
    if (Pa < th) return (Pa < th / 2 ? 'BW' : 'BS') + (Ta >= 18 ? 'h' : 'k');
    const mw = Pw / 6, mc = Pc / 6;                                          // a month in each season
    if (Tc >= 18) return mc >= 60 ? 'Af' : mc >= 100 - Pa / 25 ? 'Am' : 'Aw';
    const s = mw < 40 && mw < mc / 3 ? 's' : mc < mw / 10 ? 'w' : 'f';
    const t = Tw >= 22 ? 'a' : Tw >= 15 ? 'b' : Tc < -38 ? 'd' : 'c';
    return (Tc > -3 ? 'C' : 'D') + s + (Tc > -3 && t === 'd' ? 'c' : t);
  }

  /* The map's elevations on a coarser grid (block means), at most `W` cells round. */
  function coarse(map, W) {
    const f = Math.max(1, Math.round(map.W / W)), w = Math.floor(map.W / f), h = w / 2, z = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let s = 0, n = 0, land = 0;
      for (let b = 0; b < f; b++) for (let a = 0; a < f; a++) { const v = map.z[(j * f + b) * map.W + i * f + a]; s += v; n++; if (v > 0) land++; }
      // a cell is land if most of it is; its height that of its land (or its sea)
      z[j * w + i] = land * 2 > n ? Math.max(1, s / n) : Math.min(-1, s / n);
    }
    return { W: w, H: h, z };
  }

  /*
   * map: a built world map. planet: {tilt (°), rotation (h), retrograde, flux (Earth = 1), meanC (°C),
   * gravity (g), radiusKm, cells: [[lat0, lat1], ...]}. Returns the fields on a grid of W × H.
   */
  function build(map, planet = {}) {
    const g0 = coarse(map, Math.min(360, map.W)), { W, H, z } = g0, N = W * H;
    const grid = M.makeGrid(W), lat = grid.lat;
    const tilt = Math.abs(planet.tilt ?? 23.5) > 90 ? 180 - Math.abs(planet.tilt) : Math.abs(planet.tilt ?? 23.5);
    const spin = planet.retrograde ? -1 : 1, S0 = 1361 * (planet.flux ?? 1), Tg = planet.meanC ?? 15;
    const lapse = 6.5 * (planet.gravity ?? 1);                              // K per km, as g / cp
    // ...up to the tropopause (11 km on Earth, lower in stronger gravity), above which it stops cooling
    const tropo = 11000 / Math.max(0.05, planet.gravity ?? 1), belowTropo = (h) => clamp(h, 0, tropo);
    const R = planet.radiusKm ?? 6371, kmDeg = (Math.PI * R) / 180;
    const bands = (planet.cells && planet.cells.length ? planet.cells : [[0, 30], [30, 60], [60, 90]]).map(([a, b]) => [a, b]);
    const land = Uint8Array.from(z, (v) => (v > 0 ? 1 : 0));
    const idx = (i, j) => j * W + (((i % W) + W) % W);
    // climate follows the lie of the land, not every crag: heights smoothed over a cell or two
    const zs = blurField(grid, Float32Array.from(z, (v) => Math.max(0, v)), 1);

    // distance to the sea (for continentality), and how far each ocean cell is from land to its
    // west and to its east along its parallel (for the sides of ocean basins)
    const toSea = M.distance(grid, Uint8Array.from(land, (l) => 1 - l)).d;
    const westLand = new Float32Array(N).fill(1e9), eastLand = new Float32Array(N).fill(1e9);
    for (let j = 0; j < H; j++) {
      const dx = grid.dx * Math.max(0.05, grid.cosl[j]);
      for (const [dir, out] of [[1, westLand], [-1, eastLand]]) {
        let d = 1e9;
        for (let n = 0; n < 2 * W; n++) {
          const i = dir > 0 ? n % W : (W - 1 - (n % W)), k = j * W + i;
          d = land[k] ? 0 : d + dx;
          if (n >= W) out[k] = d;
        }
      }
    }

    // sunlight, and the year's mean, by latitude
    const decs = Array.from({ length: 12 }, (_, m) => tilt * Math.sin((2 * Math.PI * (m + 0.5)) / 12));
    const Qann = Float32Array.from(lat, (la) => decs.reduce((s, d) => s + insolation(la, d, S0), 0) / 12);
    let qm = 0, wm = 0; for (let j = 0; j < H; j++) { qm += Qann[j] * grid.cosl[j]; wm += grid.cosl[j]; } qm /= wm;
    // °C per W/m², fitted to Earth: land follows the sunlight closely; the sea, which carries heat
    // poleward, less so (28 °C at the equator, ~24 at 30°, ~8 at 60°, about freezing at the poles)
    // How much heat the air and sea carry poleward sets how steep that fall is: slow rotators (one
    // broad cell) and thick atmospheres even it out, fast rotators (many cells) and thin air less so
    const nCells = bands.length, atm = Math.max(0.01, planet.pressure ?? 1);
    const steep = ({ 1: 0.6, 3: 1, 5: 1.15, 7: 1.3 }[nCells] ?? 1) * clamp(1 / (1 + 0.3 * Math.log(atm)), 0.4, 1.8);
    const kT = (0.17 / Math.sqrt(planet.flux ?? 1)) * steep, kO = (0.12 / Math.sqrt(planet.flux ?? 1)) * steep;
    // the seasons: very large swings in sunlight are damped (snow and ice, the sea, melting) rather than
    // followed degree for degree
    const damp = (x) => 30 * Math.tanh(x / 30);
    // a tidally locked world keeps one face to its star: no seasons, a hot spot under the star
    const locked = !!planet.locked, sub = locked ? S2vec(0, planet.subsolarLon ?? 0) : null;
    let fm = 0;
    const face = locked ? Float32Array.from({ length: N }, (_, k) => { const c = grid.xyz[k * 3] * sub[0] + grid.xyz[k * 3 + 1] * sub[1] + grid.xyz[k * 3 + 2] * sub[2]; return Math.sqrt(Math.max(0, c)); }) : null;
    if (locked) { let wsum = 0; for (let k = 0; k < N; k++) { const wgt = grid.cosl[Math.floor(k / W)]; fm += face[k] * wgt; wsum += wgt; } fm /= wsum; }
    const dayNight = 70 * clamp(1 / (1 + 0.3 * Math.log(atm)), 0.3, 1.8);

    // the circulation's pressure pattern along latitude: low at the ITCZ, high at the next boundary...
    const edges = [0, ...bands.map((b) => b[1])];
    const zonalP = (la) => {
      const a = Math.abs(la);
      let k = 0; while (k < edges.length - 2 && a > edges[k + 1]) k++;
      const u = k + clamp((a - edges[k]) / Math.max(1, edges[k + 1] - edges[k]), 0, 1);
      return 1013 - 10 * Math.cos(Math.PI * u);
    };

    const seasons = {};
    // the two solstices and the equinoxes (both alike): on a much tilted world the low latitudes have
    // their warm, wet season at the equinoxes, when the sun is overhead
    // (the sea's temperature before it is held at freezing: how far below it a sea would be, for ice)
    const seaRaw = {};
    for (const [name, dec] of [['jan', -tilt], ['jul', tilt], ['equ', 0]]) {
      // ── temperature (before currents) ──
      const T = new Float32Array(N), Tzon = new Float32Array(H), raw = (seaRaw[name] = new Float32Array(N));
      if (locked) {
        for (let k = 0; k < N; k++) T[k] = Tg + dayNight * (face[k] - fm) * (land[k] ? 1 : 0.7) - (land[k] ? (lapse * belowTropo(zs[k])) / 1000 : 0);
        for (let k = 0; k < N; k++) if (!land[k]) { raw[k] = T[k]; T[k] = Math.max(-1.8, T[k]); }
      }
      for (let j = 0; j < H && !locked; j++) {
        const Qs = insolation(lat[j], dec, S0), base = Tg + kT * (Qann[j] - qm), swing = damp(kT * (Qs - Qann[j]));
        const seaR = Tg + 4 + kO * (Qann[j] - qm) + 0.2 * swing, seaT = Math.max(-1.8, seaR);
        Tzon[j] = seaT;
        for (let i = 0; i < W; i++) {
          const k = j * W + i;
          if (!land[k]) { T[k] = seaT; raw[k] = seaR; continue; }
          const cont = 1 - Math.exp(-(toSea[k] * kmDeg) / 900);            // continentality
          T[k] = base + (0.3 + 0.5 * cont) * swing - (lapse * belowTropo(zs[k])) / 1000;
        }
      }
      // ── pressure: zonal belts shifted with the sun, continents low when hot and high when cold ──
      const shift = 0.35 * dec, P = new Float32Array(N);
      const anom = new Float32Array(N);
      for (let k = 0; k < N; k++) if (land[k]) { const j = Math.floor(k / W); anom[k] = -0.35 * (T[k] + (lapse * belowTropo(z[k])) / 1000 - Tzon[j]); }
      const anomS = blurField(grid, anom, Math.round(8 / grid.dx));
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) P[j * W + i] = locked ? 1013 - 18 * (face[j * W + i] - fm) + anomS[j * W + i] : zonalP(lat[j] - shift) + anomS[j * W + i];
      // ── winds: down the pressure gradient, turned by the spin, less so near the equator ──
      const u = new Float32Array(N), v = new Float32Array(N);
      for (let j = 0; j < H; j++) {
        const dxm = 2 * grid.dx * Math.max(0.05, grid.cosl[j]), dym = 2 * (180 / H);
        // (a locked world turns once a year: hardly any Coriolis, the wind blows straight at the low)
        const hemi = lat[j] >= 0 ? 1 : -1, th = locked ? 0 : (65 * smooth(Math.abs(lat[j]) / 12)) * D2R * hemi * spin;
        for (let i = 0; i < W; i++) {
          const k = j * W + i;
          const gx = -(P[idx(i + 1, j)] - P[idx(i - 1, j)]) / dxm;
          const gy = -(P[idx(i, Math.max(0, j - 1))] - P[idx(i, Math.min(H - 1, j + 1))]) / dym;
          // clockwise by th in the north (prograde): with the low on the left
          u[k] = gx * Math.cos(th) + gy * Math.sin(th);
          v[k] = -gx * Math.sin(th) + gy * Math.cos(th);
        }
      }
      seasons[name] = { T, P, u, v };
    }
    const eqT = seasons.equ.T;

    // ── ocean currents: the sides of the gyres (from the annual winds' belts) ──
    const sst = new Float32Array(N), cu = new Float32Array(N), cv = new Float32Array(N), upwell = new Float32Array(N);
    const subG = edges[1] ?? 30, pol = edges[2] ?? 60;                      // subtropical gyre to the first high, subpolar beyond
    for (let j = 0; j < H; j++) {
      const a = Math.abs(lat[j]), hemi = lat[j] >= 0 ? 1 : -1;
      // inside the subtropical gyre (from the trades to the westerlies): +1; inside the subpolar gyre: -1
      const gyre = a < 4 ? 0 : a < subG + 0.6 * (pol - subG) ? smooth((a - 4) / 8) * (1 - smooth((a - (subG + 0.45 * (pol - subG))) / (0.15 * (pol - subG) + 1))) : a < pol + 8 ? -smooth((a - subG - 0.6 * (pol - subG)) / 6) : 0;
      for (let i = 0; i < W && !locked; i++) {
        const k = j * W + i;
        if (land[k]) continue;
        // with prograde spin the warm, poleward current runs along a basin's western side
        const wSide = spin > 0 ? westLand[k] : eastLand[k], eSide = spin > 0 ? eastLand[k] : westLand[k];
        const nearW = Math.exp(-(wSide * kmDeg) / 1200), nearE = Math.exp(-(eSide * kmDeg) / 1000);
        const pole = gyre * (nearW - nearE);                                   // + poleward, - equatorward
        cv[k] = hemi * pole;
        const ann = (seasons.jan.u[k] + seasons.jul.u[k]) / 2;
        cu[k] = Math.sign(ann) * Math.min(1, Math.abs(ann) * 4) * 0.6;
        sst[k] = 4 * gyre * nearW - (gyre > 0 ? 5 * gyre * nearE : -3 * gyre * nearE) - (a < 6 ? 2 * Math.exp(-(eSide * kmDeg) / 3000) * (1 - a / 6) : 0);
        // upwelling: cold eastern-boundary coasts of the subtropical gyre, and the equator
        upwell[k] = Math.max(0, gyre) * nearE * 1.2 + (a < 5 ? (1 - a / 5) * 0.6 : 0);
      }
    }
    // currents warm and cool the sea, and the coasts the wind blows them onto
    const sstS = blurField(grid, sst, 2);
    for (const s of Object.values(seasons)) {
      for (let k = 0; k < N; k++) {
        if (!land[k]) { s.T[k] = Math.max(-1.8, s.T[k] + sstS[k]); continue; }
        const near = Math.exp(-(toSea[k] * kmDeg) / 600);
        s.T[k] += near * coastAnomaly(k, s, sstS);
      }
    }
    function coastAnomaly(k, s) {                                               // the sea upwind's anomaly
      const j = Math.floor(k / W), i = k % W, uu = s.u[k], vv = s.v[k], l = Math.hypot(uu, vv) || 1;
      for (let st = 1; st < 12; st++) {
        const ii = Math.round(i - (uu / l) * st * 1.5 / Math.max(0.1, grid.cosl[j]) / grid.dx), jj = clamp(Math.round(j + (vv / l) * st * 1.5 / (180 / H)), 0, H - 1);
        const q = idx(ii, jj);
        if (!land[q]) return sstS[q];
      }
      return 0;
    }

    // ── precipitation: moisture from warm seas carried by the winds and rained out ──
    // (a year: a quarter round each solstice, and the two equinox quarters)
    const QUARTERS = { jan: 0.5, jul: 0.5, equ: 1 };
    let pSum = 0, wSum = 0;
    for (let k = 0; k < N; k++) wSum += grid.cosl[Math.floor(k / W)];
    for (const [name, s] of Object.entries(seasons)) {
      if (locked && name !== 'jan') continue;                                  // no seasons: all alike
      const Pr = new Float32Array(N);
      let Mo = new Float32Array(N), Mn = new Float32Array(N);
      const cap = (T) => 0.25 + Math.exp(0.065 * clamp(T, -40, 40));        // what the air can hold
      // the sea gives most; warm land some too (plants and soil: recycling)
      const evap = Float32Array.from(s.T, (T, k) => (land[k] ? 0.035 * clamp((T + 5) / 30, 0, 1.2) : 0.12 * Math.max(0, (T + 2) / 28) ** 1.5));
      for (let it = 0; it < 70; it++) {
        for (let j = 0; j < H; j++) {
          const cl = Math.max(0.05, grid.cosl[j]);
          for (let i = 0; i < W; i++) {
            const k = j * W + i, uu = s.u[k], vv = s.v[k], l = Math.hypot(uu, vv);
            const step = clamp(l * 6, 0.3, 1.4);                              // cells per step
            const fi = i - (l ? (uu / l) * step / cl : 0), fj = clamp(j + (l ? (vv / l) * step : 0), 0, H - 1);
            const i0 = Math.floor(fi), j0 = Math.floor(fj), ti = fi - i0, tj = fj - j0;
            const j1 = Math.min(H - 1, j0 + 1);
            let m = (Mo[idx(i0, j0)] * (1 - ti) + Mo[idx(i0 + 1, j0)] * ti) * (1 - tj) + (Mo[idx(i0, j1)] * (1 - ti) + Mo[idx(i0 + 1, j1)] * ti) * tj;
            m += evap[k];
            // rain: always a little, more where air rises (low pressure, windward slopes), less where it sinks
            const low = clamp((1013 - s.P[k]) / 10, -1, 1), up = land[k] ? (zs[k] - zAt(fi, fj)) / 1000 : 0;
            // ...and over warm land in summer, convection
            const conv = land[k] ? 0.05 * clamp((s.T[k] - 12) / 18, 0, 1) : 0;
            let r = 0.035 + conv + 0.06 * Math.max(0, low) - 0.025 * Math.max(0, -low) + (up > 0 ? 0.5 * up : 0.6 * up);
            r = clamp(r, 0.004, 0.6);
            let rain = r * m;
            const c = cap(s.T[k]);
            if (m - rain > c) rain = m - c;                                  // saturated: the rest falls
            Pr[k] += rain; Mn[k] = m - rain;
          }
        }
        [Mo, Mn] = [Mn, Mo];
      }
      s.Pr = blurField(grid, Pr, 1);
      const share = locked ? 2 : QUARTERS[name];
      for (let k = 0; k < N; k++) pSum += Pr[k] * grid.cosl[Math.floor(k / W)] * share;
    }
    if (locked) { seasons.jul.Pr = Float32Array.from(seasons.jan.Pr); seasons.equ.Pr = Float32Array.from(seasons.jan.Pr); }
    function zAt(fi, fj) { const i = Math.round(fi), j = clamp(Math.round(fj), 0, H - 1); return zs[idx(i, j)]; }
    // scale to millimetres: Earth's mean ~1000 mm a year, about 7 % more per degree warmer
    // (and with how much sea there is to evaporate: a dry world is a dry world)
    let seaShare = 0; { let a2 = 0; for (let k = 0; k < N; k++) { const wgt = grid.cosl[Math.floor(k / W)]; a2 += wgt; if (!land[k]) seaShare += wgt; } seaShare /= a2; }
    const meanYear = 1000 * clamp(1 + 0.07 * (Tg - 15), 0.05, 3) * clamp(seaShare / 0.71, 0.05, 1.3) ** 0.8, scale = meanYear / (pSum / wSum);
    // each season's Pr is at its rate for half a year (as the Köppen thresholds count it); the year's
    // total takes a quarter of each solstice's and half the equinoxes'
    for (const s of Object.values(seasons)) for (let k = 0; k < N; k++) s.Pr[k] *= scale;
    const rainYear = Float32Array.from(seasons.jan.Pr, (v, k) => (v + seasons.jul.Pr[k] + 2 * seasons.equ.Pr[k]) / 2);

    // ── reefs, fishing grounds, sea ice, and the climate zones ──
    const zone = new Uint8Array(N), reef = new Uint8Array(N), ice = new Uint8Array(N), fish = new Float32Array(N);
    const seaCold = new Float32Array(N).fill(NaN), wobble = iceWobble(planet.seed ?? 1);
    // how far each sea cell is from land, and the coldest season of the land round about
    const toLand = M.distance(grid, land).d;
    const coldL = Float32Array.from(land, (l, k) => (l ? Math.min(seasons.jan.T[k], seasons.jul.T[k], seasons.equ.T[k]) : 0));
    const rr = Math.max(1, Math.round(6 / grid.dx)), sumL = blurField(grid, coldL, rr), fracL = blurField(grid, Float32Array.from(land), rr);
    const landCold = Float32Array.from(sumL, (v, k) => (fracL[k] > 0.01 ? v / fracL[k] : 0));
    const J = seasons.jan, L = seasons.jul, E = seasons.equ, SS = [J, L, E];
    for (let k = 0; k < N; k++) {
      const Tw = Math.max(J.T[k], L.T[k], eqT[k]), Tc = Math.min(J.T[k], L.T[k], eqT[k]);
      if (land[k]) {
        // the warm and the cold season's rain, in proportion, adding up to the year's
        const ws = SS.reduce((a, s) => (s.T[k] > a.T[k] ? s : a)), cs = SS.reduce((a, s) => (s.T[k] < a.T[k] ? s : a));
        const pw0 = ws === cs ? 1 : ws.Pr[k], pc0 = ws === cs ? 1 : cs.Pr[k], f = rainYear[k] / Math.max(1e-9, pw0 + pc0);
        const Pw = pw0 + pc0 > 0 ? pw0 * f : rainYear[k] / 2, Pc = pw0 + pc0 > 0 ? pc0 * f : rainYear[k] / 2;
        zone[k] = ZI[koppen(Tw, Tc, Pw, Pc)] || 0;
      } else {
        // sea ice where the coldest season's sea would be below freezing, give or take the eddies and
        // wind that make a real ice edge wander
        seaCold[k] = Math.min(seaRaw.jan[k], seaRaw.jul[k], seaRaw.equ[k]) + sstS[k];
        // cold coasts: winter air off frozen land chills the sea near it (ice grows out from such shores)
        const near = Math.exp(-(toLand[k] * kmDeg) / 450);
        if (near > 0.02 && landCold[k] < seaCold[k]) seaCold[k] += 0.45 * near * (landCold[k] - seaCold[k]);
        if (seaCold[k] + wobble(grid.xyz[k * 3], grid.xyz[k * 3 + 1], grid.xyz[k * 3 + 2]) < -1.8) ice[k] = 1;
        const shallow = z[k] > -150, j = Math.floor(k / W);
        fish[k] = clamp(upwell[k] + (shallow ? 0.5 : 0) + (Math.abs(lat[j]) > 40 && Math.abs(lat[j]) < 65 ? 0.35 : 0), 0, 2);
        if (z[k] > -80 && Tc >= 20 && upwell[k] < 0.4) reef[k] = 1;
      }
    }
    const iceMap = iceOnMap({ W, H, seaCold }, map, planet.seed ?? 1);
    return { W, H, lat, z, land, seasons, equinoxT: eqT, rainYear, seaCold, iceMap, current: { u: cu, v: cv }, sst: sstS, upwell, fish, reef, ice, zone, zones: ZONES, grid };
  }

  /*
   * Winter sea ice on a map's own cells: the climate's coldest-season sea temperature (seaCold, on its
   * coarser grid), smoothly between its cells, with the same wandering edge. Uint8Array, map.W × map.H.
   */
  function iceOnMap(c, map, seed) {
    const { W, H } = map, gr = map.grid, N = W * H, cW = c.W, cH = c.H, sc = c.seaCold, out = new Uint8Array(N), wob = iceWobble(seed);
    const wrap = (q) => ((q % cW) + cW) % cW;
    for (let j = 0; j < H; j++) {
      const fj = clamp(((j + 0.5) / H) * cH - 0.5, 0, cH - 1), j0 = Math.floor(fj), j1 = Math.min(cH - 1, j0 + 1), tj = fj - j0;
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        if (map.z[k] > 0) continue;
        const fi = ((i + 0.5) / W) * cW - 0.5, i0 = Math.floor(fi), ti = fi - i0;
        let sw = 0, v = 0;
        for (const [q, wt] of [[j0 * cW + wrap(i0), (1 - ti) * (1 - tj)], [j0 * cW + wrap(i0 + 1), ti * (1 - tj)], [j1 * cW + wrap(i0), (1 - ti) * tj], [j1 * cW + wrap(i0 + 1), ti * tj]]) {
          if (Number.isNaN(sc[q])) continue;
          sw += wt; v += wt * sc[q];
        }
        // (a sea the coarser cells call land: the nearest sea round about)
        for (let r = 1; r <= 2 && sw <= 0; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const jj = Math.round(fj) + dj; if (jj < 0 || jj >= cH) continue; const q = jj * cW + wrap(Math.round(fi) + di); if (!Number.isNaN(sc[q])) { sw += 1; v += sc[q]; } }
        if (sw > 0 && v / sw + wob(gr.xyz[k * 3], gr.xyz[k * 3 + 1], gr.xyz[k * 3 + 2]) < -1.8) out[k] = 1;
      }
    }
    return out;
  }

  /* A sea-ice edge's wander (°C) at a point on the unit sphere: eddies a few hundred km across. */
  function iceWobble(seed) {
    const n = M.noise3(seed * 13 + 5);
    // large slow meanders, and a smaller fringe
    return (x, y, z) => 7 * n(x, y, z, 2.2, 3) + 1.2 * n(z, x, y, 9, 2);
  }

  const S2vec = (la, lo) => [Math.cos(la * D2R) * Math.cos(lo * D2R), Math.cos(la * D2R) * Math.sin(lo * D2R), Math.sin(la * D2R)];

  /* Box blur on the grid (longitude wraps). */
  function blurField(gr, f, r) {
    if (r < 1) return Float32Array.from(f);
    const { W, H } = gr, a = Float32Array.from(f), b = new Float32Array(f.length);
    for (let p = 0; p < 2; p++) {
      for (let j = 0; j < H; j++) {
        const rr = Math.min(W / 4, Math.round(r / Math.max(0.15, gr.cosl[j])));
        let s = 0; for (let i = -rr; i <= rr; i++) s += a[j * W + ((i + W) % W)];
        for (let i = 0; i < W; i++) { b[j * W + i] = s / (2 * rr + 1); s += a[j * W + ((i + rr + 1) % W)] - a[j * W + ((i - rr + W) % W)]; }
      }
      for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) { let s = 0, n = 0; for (let q = Math.max(0, j - r); q <= Math.min(H - 1, j + r); q++) { s += b[q * W + i]; n++; } a[j * W + i] = s / n; }
    }
    return a;
  }

  /* The planet's inputs from the app's world and derived values. */
  function planetOf(w, d) {
    const p = w.planet, pl = d.planet, st = d.star;
    // tidally locked when a day is (nearly) as long as the year
    const locked = p.rotation >= 0.95 * pl.yearEarthDays * 24;
    return {
      tilt: p.tilt, rotation: p.rotation, retrograde: p.tilt > 90, flux: st.luminosity / (p.a * p.a), pressure: p.pressure,
      meanC: pl.temperatureC, gravity: pl.gravity, radiusKm: pl.radiusKm, cells: (pl.cells && pl.cells.bands) || [],
      locked, subsolarLon: p.subsolarLon ?? 0, seed: w.plates.seed ?? 1,
    };
  }

  const api = { build, insolation, koppen, ZONES, planetOf, iceWobble, iceOnMap };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.climate = api; }
})(typeof window !== 'undefined' ? window : globalThis);
