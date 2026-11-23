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

    // distance to the sea (for continentality)
    const toSea = M.distance(grid, Uint8Array.from(land, (l) => 1 - l)).d;

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
    // a tidally locked world keeps one face to its star: no seasons, a hot spot under the star. The
    // air carries heat round: a fast wind blowing east (superrotation) moves the hot spot east of the
    // point under the star, and the night side is not one even cold but coldest at its middle, milder
    // towards the day (heat carried over the terminator), so its ice edge is no straight line
    const locked = !!planet.locked, atmL = planet.pressure ?? 1;
    const hotShift = locked ? clamp(15 * Math.pow(Math.max(atmL, 0.01), 0.3), 4, 35) * (planet.retrograde ? -1 : 1) : 0;
    const sub = locked ? S2vec(0, (planet.subsolarLon ?? 0) + hotShift) : null;
    let fm = 0;
    const face = locked ? Float32Array.from({ length: N }, (_, k) => { const c = grid.xyz[k * 3] * sub[0] + grid.xyz[k * 3 + 1] * sub[1] + grid.xyz[k * 3 + 2] * sub[2]; return 0.6 * Math.sqrt(0.18 * Math.log1p(Math.exp(c / 0.18))) + 0.4 * (c + 1) / 2; }) : null;   // (no corner at the terminator)
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
        // the sea carries heat far (and the coasts share it); land interiors keep their own extremes
        const raw0 = Float32Array.from({ length: N }, (_, k) => Tg + dayNight * (face[k] - fm) * (land[k] ? 1 : 0.7));
        const wide = blurField(grid, raw0, Math.max(1, Math.round(1500 / (grid.dx * kmDeg))));
        for (let k = 0; k < N; k++) {
          const mix = land[k] ? 0.45 * Math.exp(-(toSea[k] * kmDeg) / 600) : 0.55;
          T[k] = raw0[k] * (1 - mix) + wide[k] * mix - (land[k] ? (lapse * belowTropo(zs[k])) / 1000 : 0);
        }
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

    // ── ocean currents, from the year's winds (see oceanCurrents) ──
    const windU = Float32Array.from(seasons.jan.u, (x, k) => (x + seasons.jul.u[k] + 2 * seasons.equ.u[k]) / 4);
    const windV = Float32Array.from(seasons.jan.v, (x, k) => (x + seasons.jul.v[k] + 2 * seasons.equ.v[k]) / 4);
    // the sea's own temperature over the year (before the currents move it), and where it freezes
    const sea0 = Float32Array.from(seasons.jan.T, (_, k) => (land[k] ? NaN : Math.max(-1.8, (seaRaw.jan[k] + seaRaw.jul[k] + 2 * seaRaw.equ[k]) / 4)));
    const frozen = Uint8Array.from(sea0, (_, k) => (!land[k] && Math.min(seaRaw.jan[k], seaRaw.jul[k], seaRaw.equ[k]) < -1.8 ? 1 : 0));
    const oc = oceanCurrents(grid, land, windU, windV, sea0, frozen, { spin: spin * (24 / Math.max(0.1, planet.rotation ?? 24)), kmDeg });
    const sst = oc.sst, cu = oc.u, cv = oc.v, upwell = oc.upwell;
    // currents warm and cool the sea, and the coasts the wind blows them onto
    const sstS = blurField(grid, sst, 1);
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
   * Wind-driven ocean currents (Stommel's model): the winds' stress on the sea, curling, drives a
   * circulation that the planet's spin turns into gyres. With the spin's effect growing toward the
   * poles (β), the return flow crowds against one side of each basin as a narrow, fast boundary
   * current: the western side on a prograde world (the Gulf Stream, the Kuroshio), the eastern on a
   * retrograde one, hardly at all on a slow one. Solved for a stream function ψ in each basin
   * (r∇²ψ + β ∂ψ/∂x = curl τ, ψ = 0 on the coasts), on a grid half as fine as the climate's.
   * Then the sea's temperature: each place gets something of the water upstream, warm water carried
   * poleward, cold equatorward; and upwelling, where the wind's Ekman transport pushes the surface
   * water away from a coast, and along the equator under the easterlies, brings cold water up.
   * grid: the climate's grid; land; windU, windV: the year's winds; sea0: the sea's own temperature
   * (°C, NaN on land); frozen: where it freezes over (the ice shields the sea from the wind).
   * opts.spin: the spin relative to Earth's, signed (negative: retrograde). Returns {u, v, sst, upwell}.
   */
  function oceanCurrents(grid, land, windU, windV, sea0, frozen, opts = {}) {
    const { W, H, lat } = grid, N = W * H, D2 = Math.PI / 180, spinR = opts.spin ?? 1;
    // land the currents go round: not specks of islands
    const solid = Uint8Array.from(land), seen = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      if (!land[k] || seen[k]) continue;
      const comp = [k]; seen[k] = 1;
      for (let s = 0; s < comp.length; s++) {
        const c = comp[s], j = Math.floor(c / W), i = c - j * W;
        for (const n of [j * W + ((i + 1) % W), j * W + ((i - 1 + W) % W), j > 0 ? c - W : -1, j + 1 < H ? c + W : -1]) if (n >= 0 && land[n] && !seen[n]) { seen[n] = 1; comp.push(n); }
      }
      if (comp.length < Math.max(12, N * 0.0006)) for (const c of comp) solid[c] = 0;
    }
    // the wind's stress (∝ |w| w), weaker on ice, scaled so its strong values are about 1
    const tx = new Float32Array(N), ty = new Float32Array(N), mags = [];
    for (let k = 0; k < N; k++) {
      if (land[k]) continue;
      const m = Math.hypot(windU[k], windV[k]), f = frozen[k] ? 0.3 : 1;
      tx[k] = m * windU[k] * f; ty[k] = m * windV[k] * f; mags.push(Math.hypot(tx[k], ty[k]));
    }
    mags.sort((a, b) => a - b);
    const t95 = mags.length ? mags[Math.floor(mags.length * 0.95)] || 1 : 1;
    for (let k = 0; k < N; k++) { tx[k] /= t95; ty[k] /= t95; }

    // ── the stream function, on a grid half as fine ──
    const w = Math.max(8, Math.floor(W / 2)), h = Math.max(4, Math.floor(H / 2)), n2 = w * h, dl = (2 * Math.PI) / w, dp = Math.PI / h;
    const lat2 = Float32Array.from({ length: h }, (_, j) => 90 - ((j + 0.5) * 180) / h);
    const wet = new Uint8Array(n2), Tx = new Float32Array(n2), Ty = new Float32Array(n2);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      let water = 0, sx = 0, sy = 0, n = 0;
      for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
        const k = Math.min(H - 1, j * 2 + b) * W + Math.min(W - 1, i * 2 + a);
        if (!solid[k]) water++;
        if (!land[k]) { sx += tx[k]; sy += ty[k]; n++; }
      }
      const q = j * w + i;
      wet[q] = water >= 2 && Math.abs(lat2[j]) < 84 ? 1 : 0;
      Tx[q] = n ? sx / n : 0; Ty[q] = n ? sy / n : 0;
    }
    const cosA = Float32Array.from(lat2, (la) => Math.max(0.1, Math.cos(la * D2)));
    const id = (i, j) => j * w + (((i % w) + w) % w);
    // the curl of the stress, on the sphere
    const F = new Float32Array(n2);
    for (let j = 1; j < h - 1; j++) for (let i = 0; i < w; i++) {
      const q = id(i, j);
      if (!wet[q]) continue;
      const dTy = (Ty[id(i + 1, j)] - Ty[id(i - 1, j)]) / (2 * dl);
      const dTx = (Tx[id(i, j - 1)] * cosA[j - 1] - Tx[id(i, j + 1)] * cosA[j + 1]) / (2 * dp);
      F[q] = (dTy - dTx) / cosA[j];
    }
    // friction sets the boundary current's width: about a cell and a half at 30° on an Earth-like spin
    const r = 1.125 * dl, psi = new Float32Array(n2);
    for (let it = 0; it < 900; it++) {
      let change = 0, big = 1e-9;
      for (let j = 1; j < h - 1; j++) {
        const beta = spinR * Math.cos(lat2[j] * D2), dx = dl * cosA[j], ax = r / (dx * dx), ay = r / (dp * dp), bx = beta / dx;
        // sweep from the side the information comes from (east when β > 0)
        for (let s = 0; s < w; s++) {
          const i = beta >= 0 ? w - 1 - s : s, q = j * w + i;
          if (!wet[q]) continue;
          const e = psi[id(i + 1, j)], wv = psi[id(i - 1, j)], nn = psi[q - w], ss = psi[q + w];
          const nv = beta >= 0
            ? (ax * (e + wv) + ay * (nn + ss) + bx * e - F[q]) / (2 * ax + 2 * ay + bx)
            : (ax * (e + wv) + ay * (nn + ss) - bx * wv - F[q]) / (2 * ax + 2 * ay - bx);
          const nv2 = psi[q] + 1.3 * (nv - psi[q]);
          change = Math.max(change, Math.abs(nv2 - psi[q])); big = Math.max(big, Math.abs(nv2));
          psi[q] = nv2;
        }
      }
      if (change < 1e-4 * big && it > 30) break;
    }

    // ── currents on the climate's grid: u = -∂ψ/∂y, v = ∂ψ/∂x, from ψ between the coarse cells ──
    const P = new Float32Array(N);
    for (let j = 0; j < H; j++) {
      const fj = clamp((j + 0.5) / 2 - 0.5, 0, h - 1), j0 = Math.floor(fj), j1 = Math.min(h - 1, j0 + 1), t = fj - j0;
      for (let i = 0; i < W; i++) {
        const fi = (i + 0.5) / 2 - 0.5, i0 = Math.floor(fi), s = fi - i0;
        P[j * W + i] = (psi[id(i0, j0)] * (1 - s) + psi[id(i0 + 1, j0)] * s) * (1 - t) + (psi[id(i0, j1)] * (1 - s) + psi[id(i0 + 1, j1)] * s) * t;
      }
    }
    const u = new Float32Array(N), v = new Float32Array(N), speeds = [];
    const dlF = (2 * Math.PI) / W, dpF = Math.PI / H, at = (i, j) => j * W + (((i % W) + W) % W);
    for (let j = 1; j < H - 1; j++) {
      const c = Math.max(0.1, Math.cos(lat[j] * D2));
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        if (land[k]) continue;
        u[k] = -(P[at(i, j - 1)] - P[at(i, j + 1)]) / (2 * dpF);
        v[k] = (P[at(i + 1, j)] - P[at(i - 1, j)]) / (2 * dlF * c);
        speeds.push(Math.hypot(u[k], v[k]));
      }
    }
    speeds.sort((a, b) => a - b);
    const s95 = speeds.length ? speeds[Math.floor(speeds.length * 0.95)] || 1 : 1;
    for (let k = 0; k < N; k++) { u[k] = clamp(u[k] / s95, -3, 3); v[k] = clamp(v[k] / s95, -3, 3); }

    // ── the sea's temperature: something of the water upstream ──
    const sst = new Float32Array(N);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i;
      if (land[k]) continue;
      // back along the flow some 2000 km (cells of a degree at most), the anomaly as strong as the flow
      let fi = i, fj = j, Tup = sea0[k], spSum = 0, n = 0;
      const cells = Math.round(18 * (W / 360));
      for (let s = 0; s < cells; s++) {
        const q = at(Math.round(fi), clamp(Math.round(fj), 0, H - 1)), sp = Math.hypot(u[q], v[q]);
        if (sp < 0.02) break;
        const c = Math.max(0.15, Math.cos(lat[clamp(Math.round(fj), 0, H - 1)] * D2));
        const ni = fi - (u[q] / sp) / c, nj = clamp(fj + v[q] / sp, 0, H - 1);
        const q2 = at(Math.round(ni), Math.round(nj));
        if (land[q2] || Number.isNaN(sea0[q2])) break;
        fi = ni; fj = nj; Tup = sea0[q2]; spSum += sp; n++;
      }
      // (a slow drift mixes away most of what it carries; a fast current keeps it)
      sst[k] = clamp(0.8 * (Tup - sea0[k]) * Math.pow(clamp((n ? spSum / n : 0) / 0.45, 0, 1), 1.5), -8, 8);
    }

    // ── upwelling: Ekman transport off a coast, and divergence along the equator ──
    const toLand = M.distance(grid, Uint8Array.from(land)).d, upwell = new Float32Array(N);
    for (let j = 1; j < H - 1; j++) {
      const la = lat[j], c = Math.max(0.1, Math.cos(la * D2)), fSign = Math.sign(la || 1e-9) * Math.sign(spinR), fWeight = smooth(Math.abs(la) / 4) * Math.min(1, Math.abs(spinR) * 2);
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        if (land[k] || frozen[k]) continue;
        let coast = 0;
        if (toLand[k] * (opts.kmDeg ?? 111) < 400) {
          // the way out to sea, and the surface water's drift: 90° to the right of the wind where f > 0
          const nx = (toLand[at(i + 1, j)] - toLand[at(i - 1, j)]) / (2 * c), ny = toLand[at(i, j - 1)] - toLand[at(i, j + 1)], nl = Math.hypot(nx, ny) || 1;
          const mx = fSign * ty[k], my = -fSign * tx[k];
          coast = Math.max(0, (mx * nx + my * ny) / nl) * Math.exp(-(toLand[k] * (opts.kmDeg ?? 111)) / 180) * fWeight;
        }
        const eq = Math.abs(la) < 8 ? Math.max(0, -Math.sign(spinR) * tx[k]) * (1 - Math.abs(la) / 8) * Math.min(1, Math.abs(spinR) * 2) : 0;
        upwell[k] = clamp(1.6 * coast + 0.8 * eq, 0, 1.5);
        sst[k] -= 2.5 * upwell[k];
      }
    }
    return { u, v, sst, upwell };
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
