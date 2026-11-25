/*
 * The world map: the present-day surface built from the plates' history (Worldbuilder's Log 20-26).
 *
 * An equirectangular raster (W × W/2 cells) of elevation in metres, with which plate each cell is on
 * and the plate boundaries between them:
 *   - plates and their boundaries (Log 20, topologies): continental crust and the ocean floor each
 *     plate made; what is left goes to the nearest plate. Boundaries are convergent near an active
 *     subduction zone, divergent on a young ridge, otherwise transform;
 *   - continents and shelves (Log 23): the crust rises gently inland; its rim is flooded shelf, wide
 *     on passive margins, narrow on active ones; sea level is set so land covers the share asked for;
 *   - land topography (Log 24): mountain belts from what their plates did (js/crust.js: the crust
 *     fed to each as the plates closed, worn by erosion, standing on what is left), large igneous
 *     provinces as plateaus;
 *   - islands (Log 22): island arcs, and hotspot volcanoes that sink into seamounts as they age;
 *   - sea topography (Log 26): depth from the ocean floor's age (ridges shallow, old floor deep),
 *     continental slopes, trenches off subduction zones, oceanic plateaus.
 * Then any brush strokes. Pure functions: runs in the page and in Node.
 *
 * Not only Earth: like the Tectonics step, heights and widths are divided by g^scaling (gravity in
 * Earth g; scaling 1-2, 2 by default), widths are set in km and turned into degrees by the planet's
 * radius, and the sea floor follows the world's own ridge depth and depth curve. (Mountain belts follow
 * from their crust instead: the most it holds up, and the relief rock keeps, ÷ g^scaling.)
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const S = node ? require('./sphere.js') : root.WS.sphere;
  const Q = node ? require('./rotation.js') : root.WS.rotation;
  const G = node ? require('./supercontinent.js') : root.WS.supercontinent;
  const C = node ? require('./calc.js') : root.WS.calc;
  const CR = node ? require('./crust.js') : root.WS.crust;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const OCEAN_LIFE = 200;                                    // older ocean floor has been subducted
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  /* A seeded random sequence from a string (a feature's id): the same feature, the same draws. */
  const hashRng = (str) => {
    let a = 2166136261;
    for (let i = 0; i < str.length; i++) a = Math.imul(a ^ str.charCodeAt(i), 16777619) >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  };

  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  // ── the grid ──
  function makeGrid(W) {
    const H = W / 2, N = W * H, lat = new Float32Array(H), cosl = new Float32Array(H), xyz = new Float32Array(N * 3);
    for (let j = 0; j < H; j++) { lat[j] = 90 - ((j + 0.5) * 180) / H; cosl[j] = Math.cos(lat[j] * D2R); }
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const lo = (-180 + ((i + 0.5) * 360) / W) * D2R, la = lat[j] * D2R, k = (j * W + i) * 3;
      xyz[k] = Math.cos(la) * Math.cos(lo); xyz[k + 1] = Math.cos(la) * Math.sin(lo); xyz[k + 2] = Math.sin(la);
    }
    return { W, H, N, lat, cosl, xyz, dx: 360 / W };
  }
  const lonOf = (gr, i) => -180 + ((i + 0.5) * 360) / gr.W;
  const cellOf = (gr, la, lo) => {
    const j = clamp(Math.floor(((90 - la) / 180) * gr.H), 0, gr.H - 1);
    const i = ((Math.floor(((lo + 180) / 360) * gr.W) % gr.W) + gr.W) % gr.W;
    return j * gr.W + i;
  };

  /*
   * Fill a polygon ([lat, lon] ring) on the grid, calling visit(index) for each cell inside. Edges are
   * densified to 1° so great circles stay close; longitudes are unwrapped so the dateline is no
   * matter, and a ring that winds round a pole is closed over that pole.
   */
  function fillPolygon(gr, ring, visit) {
    if (ring.length < 3) return;
    const pts = S.densify(ring, true, 1);
    const ll = [[pts[0][0], pts[0][1]]];
    for (let k = 1; k < pts.length; k++) {
      let d = pts[k][1] - pts[k - 1][1];
      d -= 360 * Math.round(d / 360);
      ll.push([pts[k][0], ll[k - 1][1] + d]);
    }
    let close = pts[0][1] - pts[pts.length - 1][1];
    close -= 360 * Math.round(close / 360);
    const wind = ll[ll.length - 1][1] + close - ll[0][1];
    if (Math.abs(wind) > 180) {                                 // round a pole: close over it
      const pole = ll.reduce((s, p) => s + p[0], 0) >= 0 ? 90 : -90;
      const endLon = ll[ll.length - 1][1] + close;
      ll.push([ll[ll.length - 1][0], endLon], [pole, endLon], [pole, ll[0][1]]);
    }
    const rows = new Map();
    for (let k = 0; k < ll.length; k++) {
      const a = ll[k], b = ll[(k + 1) % ll.length];
      if (a[0] === b[0]) continue;
      const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]);
      const j0 = Math.max(0, Math.ceil(((90 - hi) / 180) * gr.H - 0.5)), j1 = Math.min(gr.H - 1, Math.floor(((90 - lo) / 180) * gr.H - 0.5));
      for (let j = j0; j <= j1; j++) {
        const la = gr.lat[j];
        if (la < lo || la >= hi) continue;
        const x = a[1] + ((la - a[0]) * (b[1] - a[1])) / (b[0] - a[0]);
        if (!rows.has(j)) rows.set(j, []);
        rows.get(j).push(x);
      }
    }
    for (const [j, xs] of rows) {
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.ceil((xs[k] + 180) / gr.dx - 0.5), i1 = Math.floor((xs[k + 1] + 180) / gr.dx - 0.5);
        for (let i = i0; i <= i1 && i - i0 < gr.W; i++) visit(j * gr.W + (((i % gr.W) + gr.W) % gr.W));
      }
    }
  }

  /* Cells within `rad` degrees of a point: visit(index, distanceDeg). */
  function stamp(gr, at, rad, visit) {
    const v = S.vec(at), jc = clamp(Math.floor(((90 - at[0]) / 180) * gr.H), 0, gr.H - 1);
    const dj = Math.ceil((rad / 180) * gr.H) + 1;
    const cosr = Math.cos(rad * D2R);
    for (let j = Math.max(0, jc - dj); j <= Math.min(gr.H - 1, jc + dj); j++) {
      const span = gr.cosl[j] < 0.02 ? gr.W : Math.min(gr.W, Math.ceil(rad / (gr.dx * gr.cosl[j])) + 2);
      const ic = Math.floor(((at[1] + 180) / 360) * gr.W);
      for (let di = -span; di <= span; di++) {
        if (span === gr.W && di >= gr.W / 2) break;
        const i = (((ic + di) % gr.W) + gr.W) % gr.W, k = j * gr.W + i, x = gr.xyz[k * 3] * v[0] + gr.xyz[k * 3 + 1] * v[1] + gr.xyz[k * 3 + 2] * v[2];
        if (x >= cosr) visit(k, Math.acos(Math.min(1, x)) * R2D);
      }
    }
  }

  /*
   * Distance in degrees from every cell to the nearest cell where seed[k] is true (and, if `label`
   * is given, that cell's label carried along): a chamfer pass over the grid, wrapping in longitude.
   */
  function distance(gr, seed, label) {
    const { W, H, N } = gr, d = new Float32Array(N).fill(1e9), lab = label ? Int32Array.from(label) : null;
    for (let k = 0; k < N; k++) if (seed[k]) d[k] = 0;
    const dy = 180 / H;
    const relax = (k, n, cost) => { const c = d[n] + cost; if (c < d[k]) { d[k] = c; if (lab) lab[k] = lab[n]; } };
    for (let it = 0; it < 3; it++) {
      for (let j = 0; j < H; j++) {
        const dxj = gr.dx * Math.max(0.05, gr.cosl[j]), diag = Math.hypot(dxj, dy);
        for (let i = 0; i < W; i++) {
          const k = j * W + i, l = j * W + ((i + W - 1) % W);
          relax(k, l, dxj);
          if (j > 0) { relax(k, k - W, dy); relax(k, (j - 1) * W + ((i + W - 1) % W), diag); relax(k, (j - 1) * W + ((i + 1) % W), diag); }
        }
        for (let i = W - 1; i >= 0; i--) relax(j * W + i, j * W + ((i + 1) % W), dxj);
      }
      for (let j = H - 1; j >= 0; j--) {
        const dxj = gr.dx * Math.max(0.05, gr.cosl[j]), diag = Math.hypot(dxj, dy);
        for (let i = W - 1; i >= 0; i--) {
          const k = j * W + i;
          relax(k, j * W + ((i + 1) % W), dxj);
          if (j < H - 1) { relax(k, k + W, dy); relax(k, (j + 1) * W + ((i + 1) % W), diag); relax(k, (j + 1) * W + ((i + W - 1) % W), diag); }
        }
        for (let i = 0; i < W; i++) relax(j * W + i, j * W + ((i + W - 1) % W), dxj);
      }
    }
    return { d, label: lab };
  }

  /* Blur a field (box blur, `passes` times, radius r cells; longitude scaled by latitude). */
  function blur(gr, f, r, passes = 3) {
    const { W, H } = gr;
    let a = Float32Array.from(f), b = new Float32Array(f.length);
    for (let p = 0; p < passes; p++) {
      for (let j = 0; j < H; j++) {
        const rr = Math.min(W / 4, Math.round(r / Math.max(0.1, gr.cosl[j])));
        let s = 0;
        for (let i = -rr; i <= rr; i++) s += a[j * W + ((i + W) % W)];
        for (let i = 0; i < W; i++) {
          b[j * W + i] = s / (2 * rr + 1);
          s += a[j * W + ((i + rr + 1) % W)] - a[j * W + ((i - rr + W) % W)];
        }
      }
      for (let i = 0; i < W; i++) for (let j = 0; j < H; j++) {
        let s = 0, n = 0;
        for (let q = Math.max(0, j - r); q <= Math.min(H - 1, j + r); q++) { s += b[q * W + i]; n++; }
        a[j * W + i] = s / n;
      }
    }
    return a;
  }

  /* Smooth value noise in 3-D (on the sphere), fractal: values about -1..1. */
  function noise3(seed) {
    const r = rng(seed), P = new Uint8Array(512), V = new Float32Array(256);
    for (let i = 0; i < 256; i++) { P[i] = i; V[i] = r() * 2 - 1; }
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
    for (let i = 0; i < 256; i++) P[i + 256] = P[i];
    const h = (x, y, z) => V[P[P[P[x & 255] + (y & 255)] + (z & 255)]];
    const vn = (x, y, z) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
        l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
    };
    return (x, y, z, freq = 2, oct = 5) => { let s = 0, a = 0.5, f = freq; for (let o = 0; o < oct; o++) { s += a * vn(x * f + 17.3 * o, y * f, z * f); a *= 0.5; f *= 2; } return s * 1.6; };
  }

  /* Hypsometric land share of a field above a level (area-weighted). */
  function shareAbove(gr, z, level) {
    let land = 0, all = 0;
    for (let j = 0; j < gr.H; j++) { const w = gr.cosl[j]; for (let i = 0; i < gr.W; i++) { all += w; if (z[j * gr.W + i] > level) land += w; } }
    return land / all;
  }

  /* A min-heap of cell indices keyed by an array of values. */
  function heap(key) {
    const a = [];
    return {
      get size() { return a.length; },
      push(k) { let i = a.length; a.push(k); while (i > 0) { const p = (i - 1) >> 1; if (key[a[p]] <= key[k]) break; a[i] = a[p]; i = p; } a[i] = k; },
      pop() {
        const top = a[0], last = a.pop(), n = a.length;
        if (n) {
          let i = 0;
          for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && key[a[c + 1]] < key[a[c]]) c++; if (key[a[c]] >= key[last]) break; a[i] = a[c]; i = c; }
          a[i] = last;
        }
        return top;
      },
    };
  }

  /*
   * The tidal range (m) on the sea: tideX is the planet's tide against Earth's (its moon and star, its
   * size and gravity); about 1 m of that on a coast with a narrow shelf, up to 4 m where the shelf
   * is wide (the tide piles up over shallow water: the North Sea, Patagonia), half of it on the
   * open ocean. Bays that resonate (Fundy) are finer than the map.
   */
  /*
   * A planet's tides against Earth's: the equilibrium tide, G·M·R² / (g·a³), from its moon (mass in
   * Moon masses, distance in km; none if moonMass is 0) and its star (mass in suns, distance in AU;
   * none felt if the planet is tidally locked to it), for its radius (km) and gravity (g).
   * Earth: 1 (the Moon 1, the Sun 0.46 of that).
   */
  function planetTides(o = {}) {
    const R = (o.radiusKm ?? 6371) / 6371;
    const moon = o.moonMass ? o.moonMass / ((o.moonKm ?? 384400) / 384400) ** 3 : 0;
    const sun = o.locked ? 0 : (0.46 * (o.starMass ?? 1)) / (o.au ?? 1) ** 3;
    return ((moon + sun) / 1.46) * (R * R) / Math.max(0.05, o.gravity ?? 1);
  }

  function tidalRange(gr, z, tideX = 1, radiusKm = 6371, factor = 1) {
    // (the shelf edge, 200 m on Earth, is shallower under stronger gravity, as every depth is: ÷ factor)
    const kmDeg = (Math.PI * radiusKm) / 180, deep = Uint8Array.from(z, (v) => (v < -200 / factor ? 1 : 0));
    const d = distance(gr, deep).d, out = new Float32Array(gr.N);
    for (let k = 0; k < gr.N; k++) if (z[k] <= 0) out[k] = deep[k] ? 0.5 * tideX : tideX * (1 + 3 * smooth((d[k] * kmDeg) / 500));
    return out;
  }

  /* The eight neighbours of a cell (wrapping in longitude), with their offsets and the cell's row. */
  const neighbours = (gr, k, f) => {
    const { W, H } = gr, j = Math.floor(k / W), i = k - j * W;
    for (let dj = -1; dj <= 1; dj++) {
      const jj = j + dj; if (jj < 0 || jj >= H) continue;
      for (let di = -1; di <= 1; di++) if (di || dj) f(jj * W + ((i + di + W) % W), di, dj, j);
    }
  };
  /*
   * Where the water (or ice) goes: flood the land up from the coast (a priority flood over zr, the
   * heights with a little unevenness), so every land cell drains to the lowest way out. Returns recv
   * (the cell each drains to), dist (km to it), fill and spill (the level water must rise to over zr
   * and over z, to get out), and the land cells in order, downstream first (order, no of them).
   */
  function drain(gr, z, land, zr, kmDeg) {
    const N = gr.N, fill = new Float64Array(N), recv = new Int32Array(N).fill(-1), dist = new Float32Array(N), done = new Uint8Array(N), order = new Int32Array(N);
    const spill = new Float32Array(N);
    let no = 0;
    const q = heap(fill);
    for (let k = 0; k < N; k++) if (!land[k]) { done[k] = 1; let coast = false; neighbours(gr, k, (n) => { if (land[n]) coast = true; }); if (coast) { fill[k] = 0; q.push(k); } }
    if (!q.size) return { fill, recv, dist, spill, order, no: 0 };
    while (q.size) {
      const c = q.pop();
      if (land[c]) order[no++] = c;
      neighbours(gr, c, (n, di, dj, j) => {
        if (done[n]) return;
        done[n] = 1; fill[n] = Math.max(zr[n], fill[c] + 1e-3); recv[n] = c; dist[n] = gr.dx * kmDeg * Math.hypot(di * Math.max(0.02, gr.cosl[j]), dj); q.push(n);
        spill[n] = Math.max(z[n], land[c] ? spill[c] : 0);
      });
    }
    return { fill, recv, dist, spill, order, no, surface: zr };
  }

  /*
   * Which way each cell drains, by D8-LTD (Orlandini, Moretti, Franchini, Aldighieri and Testa 2003,
   * Water Resources Research 39(6) 1144). On the eight triangular facets round a cell (Tarboton 1997)
   * the steepest way down is found; of the two grid directions bounding that facet, the one is taken
   * that keeps the transversal deviation from the true direction, summed down the path, the smaller
   * (eqs. 1-4, λ = 1: full memory, as the paper advocates). Cells go from the highest down; where
   * paths meet, the path draining the most area carries its deviation on. So water follows the true
   * fall of the land, not the grid's eight directions. Real distances on the sphere: a cell is
   * narrower east-west by the cosine of its latitude.
   * e: the surface, its pits and flats already raised to drain; recv: changed in place, except where
   * keep[k] (flats, lakes), whose way is followed as it is; kmDeg: km per degree. Returns recv.
   */
  // the facets [cardinal (di, dj), diagonal (di, dj)], j counting southward (Table 1's eight facets)
  const FACETS = [[[-1, 0], [-1, 1]], [[-1, 0], [-1, -1]], [[0, -1], [-1, -1]], [[0, -1], [1, -1]], [[1, 0], [1, -1]], [[1, 0], [1, 1]], [[0, 1], [1, 1]], [[0, 1], [-1, 1]]]
    // (σ = +1 where the diagonal lies counterclockwise of the cardinal, east and north up; -1 otherwise)
    .map(([c, d]) => [c, d, Math.sign(c[0] * -d[1] - -c[1] * d[0])]);
  function steer(gr, e, land, recv, keep, kmDeg) {
    const { W, H, N } = gr, dNS = gr.dx * kmDeg, dEW = (j) => gr.dx * kmDeg * Math.max(0.02, gr.cosl[j]);
    const cells = [];
    for (let k = 0; k < N; k++) if (land[k]) cells.push(k);
    cells.sort((a, b) => e[b] - e[a]);
    // area drained, and the deviation (km) carried down the largest path into each cell
    const A = new Float64Array(N), dev = new Float64Array(N), devA = new Float64Array(N);
    for (const c of cells) {
      const j = Math.floor(c / W), i = c - j * W, e0 = e[c];
      A[c] += dNS * dEW(j);
      let out = 0;
      if (!keep || !keep[c]) {
        let best = null, bs = 0;
        for (const [[ci, cj], [di, dj], sg] of FACETS) {
          const jc = j + cj, jd = j + dj;
          if (jc < 0 || jc >= H || jd < 0 || jd >= H) continue;
          const p1 = jc * W + ((i + ci + W) % W), p2 = jd * W + ((i + di + W) % W);
          const d1 = cj ? dNS : dEW(j), d2 = cj ? dEW(jc) : dNS, rmax = Math.atan2(d2, d1);
          const s1 = (e0 - e[p1]) / d1, s2 = (e[p1] - e[p2]) / d2;
          let r = Math.atan2(s2, s1), s;
          if (r < 0) { r = 0; s = s1; } else if (r > rmax) { r = rmax; s = (e0 - e[p2]) / Math.hypot(d1, d2); } else s = Math.hypot(s1, s2);
          if (s > bs) { bs = s; best = { p1, p2, sg, d1, d2, r, rmax }; }
        }
        if (best) {
          // the cumulative transversal deviations of the two choices (eqs. 1, 2), and the smaller (eqs. 3, 4)
          const { p1, p2, sg, d1, d2, r, rmax } = best, up = dev[c];
          const a = sg * d1 * Math.sin(r) + up, b = -sg * Math.hypot(d1, d2) * Math.sin(rmax - r) + up;
          let p = Math.abs(a) <= Math.abs(b) ? p1 : p2, v = p === p1 ? a : b;
          if (!(e[p] < e0)) { p = p === p1 ? p2 : p1; v = p === p1 ? a : b; }        // (only ever downhill)
          if (e[p] < e0) { recv[c] = p; out = v; }
        }
      }
      const r = recv[c];
      if (r >= 0 && land[r]) { A[r] += A[c]; if (A[c] > devA[r]) { devA[r] = A[c]; dev[r] = out; } }
    }
    return recv;
  }

  /*
   * A flood's drainage (drain) turned to the true fall of its surface (steer: D8-LTD), outside the
   * hollows it filled (there the flood's way is kept): with the distance to each cell's receiver, the
   * spill level along the way, and the order, downstream first.
   */
  function settle(gr, z, land, d, kmDeg) {
    const { W, N } = gr, { fill, recv } = d;
    const keep = Uint8Array.from(fill, (f, k) => (land[k] && f - (d.surface ? d.surface[k] : z[k]) > 1e-3 ? 1 : 0));
    steer(gr, fill, land, recv, keep, kmDeg);
    const order = Int32Array.from(upstreamFirst(recv, land)).reverse(), dist = new Float32Array(N), spill = new Float32Array(N);
    for (const k of order) {
      const r = recv[k], j = Math.floor(k / W), di = r >= 0 ? Math.min(Math.abs((k % W) - (r % W)), W - Math.abs((k % W) - (r % W))) : 0, dj = r >= 0 ? Math.floor(r / W) - j : 0;
      dist[k] = gr.dx * kmDeg * Math.hypot(di * Math.max(0.02, gr.cosl[j]), dj);
      spill[k] = Math.max(z[k], r >= 0 && land[r] ? spill[r] : 0);
    }
    return { fill, recv, dist, spill, order, no: order.length };
  }

  /* Land cells in an order where each comes before the cell it drains to (upstream first). */
  function upstreamFirst(recv, land) {
    const N = recv.length, indeg = new Int32Array(N), out = new Int32Array(N), stack = [];
    let n = 0;
    for (let k = 0; k < N; k++) { const r = recv[k]; if (land[k] && r >= 0 && land[r]) indeg[r]++; }
    for (let k = 0; k < N; k++) if (land[k] && !indeg[k]) stack.push(k);
    while (stack.length) { const k = stack.pop(); out[n++] = k; const r = recv[k]; if (r >= 0 && land[r] && --indeg[r] === 0) stack.push(r); }
    return out.subarray(0, n);
  }

  /*
   * Where the water goes over the map's own heights, and what it does there: the one drainage that
   * the carving finishes with and the Rivers step draws. Every land cell drains the lowest way out
   * (a priority flood from the sea, or from the lowest cell of a world without one). A hollow deeper
   * than `deep` m is a lake if water reaches it: fresh if more flows in than its surface can
   * evaporate (it fills to its spill point and flows on from its outlet), salt if not (only its lowest
   * part stays wet, and water on its floor runs down to it). Shallower hollows the water crosses.
   * gr, z; o: runoff (mm a year per cell), P and PET (mm; what a lake evaporates: 1.2·PET − P), liquid
   * (false: no lakes, nothing flows), radiusKm, deep (2). Returns recv (where each land cell drains;
   * -1 at a basin's floor or the sea), flow (m³/s), cellsUp, lake (1 fresh, 2 salt), terminal (where
   * water ends inland), evaporated (m³/s, from lakes and basin floors), fill (the level water would
   * stand at), comp (the hollow each cell is in, or -1), comps [{cells, depth, kind: fresh | salt |
   * dry}], order (land cells, downstream first), lakes, saltLakes.
   */
  function hydrology(gr, z, o = {}) {
    const { W, N } = gr, kmDeg = (Math.PI * (o.radiusKm ?? 6371)) / 180, DEEP = o.deep ?? 2, YEAR_S = 3.156e7;
    const land = Uint8Array.from(z, (v) => (v > 0 ? 1 : 0)), area = new Float64Array(N);
    for (let k = 0; k < N; k++) area[k] = (gr.dx * kmDeg) ** 2 * gr.cosl[Math.floor(k / W)];
    const toM3s = (mm, km2) => ((mm / 1000) * km2 * 1e6) / YEAR_S;
    // the flood (a tiny rise over flats, so even a flat drains one way)
    const fill = new Float64Array(N), recv = new Int32Array(N).fill(-1), done = new Uint8Array(N), pos = new Int32Array(N).fill(-1);
    const q = heap(fill);
    for (let k = 0; k < N; k++) if (!land[k]) { done[k] = 1; fill[k] = z[k]; let coast = false; neighbours(gr, k, (n) => { if (land[n]) coast = true; }); if (coast) { fill[k] = 0; q.push(k); } }
    if (!q.size) { let lo = 0; for (let k = 1; k < N; k++) if (z[k] < z[lo]) lo = k; land[lo] = 0; done[lo] = 1; fill[lo] = z[lo]; q.push(lo); }
    let np = 0;
    while (q.size) {
      const c = q.pop();
      if (land[c]) pos[c] = np++;
      neighbours(gr, c, (n) => { if (done[n]) return; done[n] = 1; fill[n] = Math.max(z[n], fill[c] + 1e-7); recv[n] = c; q.push(n); });
    }
    // the way down over that surface: by the true fall of the land (steer: D8-LTD); across a flat (no
    // neighbour a centimetre lower: silted ground, a shallow hollow filled over) towards the flat's way
    // out and away from the higher ground round it, as water finds its way over a plain (Garbrecht &
    // Martz 1997; Barnes et al. 2014), rather than in the flood's straight lines
    const flood = Int32Array.from(recv), landN = land.reduce((a, v) => a + v, 0);
    {
      const TOL = 0.01, flat = new Uint8Array(N), lakeBed = (k) => land[k] && fill[k] - z[k] > DEEP;   // (lakes: below)
      const slope = (k, n, di, dj, j) => (fill[k] - fill[n]) / Math.hypot(di * Math.max(0.02, gr.cosl[j]), dj);
      for (let k = 0; k < N; k++) {
        if (!land[k] || lakeBed(k)) continue;
        let best = -1, bs = 0, drop = 0;
        neighbours(gr, k, (n, di, dj, j) => { const s = slope(k, n, di, dj, j); if (s > bs) { bs = s; best = n; } drop = Math.max(drop, fill[k] - fill[n]); });
        if (drop > TOL) recv[k] = best; else flat[k] = 1;
      }
      const low = new Int32Array(N).fill(-1), dLow = new Int32Array(N).fill(-1), dHigh = new Int32Array(N).fill(-1), id = new Int32Array(N).fill(-1);
      for (let k = 0; k < N; k++) {
        if (!flat[k] || id[k] >= 0) continue;
        const cells = [k]; id[k] = k;
        for (let s = 0; s < cells.length; s++) neighbours(gr, cells[s], (n) => { if (flat[n] && id[n] < 0 && Math.abs(fill[n] - fill[k]) < TOL) { id[n] = k; cells.push(n); } });
        // its ways out (beside ground lower than it that drains on), and its edges against higher ground
        const lows = [], highs = [];
        for (const c of cells) {
          let out = -1, hi = false;
          neighbours(gr, c, (n) => { if (id[n] === k) return; if (fill[n] < fill[c] && (!land[n] || !(flat[n] || lakeBed(n))) && (out < 0 || fill[n] < fill[out])) out = n; if (fill[n] > fill[c] + TOL) hi = true; });
          if (out >= 0) { low[c] = out; dLow[c] = 0; lows.push(c); }
          if (hi) { dHigh[c] = 0; highs.push(c); }
        }
        if (!lows.length) { for (const c of cells) recv[c] = flood[c]; continue; }   // (none: as the flood went)
        const bfs = (front, d) => { for (let s = 0; s < front.length; s++) neighbours(gr, front[s], (n) => { if (id[n] === k && d[n] < 0) { d[n] = d[front[s]] + 1; front.push(n); } }); };
        bfs(lows.slice(), dLow); bfs(highs.slice(), dHigh);
        let far = 0; for (const c of cells) if (dHigh[c] > far) far = dHigh[c];
        const g = (c) => 2 * dLow[c] + (highs.length && dHigh[c] >= 0 ? far - dHigh[c] : 0);
        for (const c of cells) {
          if (low[c] >= 0) { recv[c] = low[c]; continue; }
          let best = -1, bg = g(c), bl = dLow[c];
          neighbours(gr, c, (n) => { if (id[n] !== k) return; const gn = g(n); if (gn < bg || (gn === bg && dLow[n] < bl)) { bg = gn; bl = dLow[n]; best = n; } });
          if (best < 0) neighbours(gr, c, (n) => { if (id[n] === k && dLow[n] < bl) { bl = dLow[n]; best = n; } });
          recv[c] = best >= 0 ? best : flood[c];
        }
      }
      const keep = Uint8Array.from(flat, (v, k) => (v || lakeBed(k) ? 1 : 0));
      steer(gr, fill, land, recv, keep, kmDeg);
    }
    // hollows deeper than DEEP, as connected pieces; each drains (if it overflows) by its first-flooded cell
    const comp = new Int32Array(N).fill(-1), comps = [];
    for (let k = 0; k < N; k++) {
      if (!land[k] || comp[k] >= 0 || !(fill[k] - z[k] > DEEP)) continue;
      const id = comps.length, cells = [k]; comp[k] = id;
      for (let s = 0; s < cells.length; s++) neighbours(gr, cells[s], (n) => { if (land[n] && comp[n] < 0 && fill[n] - z[n] > DEEP) { comp[n] = id; cells.push(n); } });
      let depth = 0, out = cells[0], a = 0;
      for (const c of cells) { depth = Math.max(depth, fill[c] - z[c]); if (pos[c] < pos[out]) out = c; a += area[c]; }
      // (within it, every cell drains towards that outlet: the lake is level, its water leaves there,
      // the way the flood came in)
      const seen = new Set([out]), front = [out], tree = [[out, flood[out]]];
      for (let s = 0; s < front.length; s++) neighbours(gr, front[s], (n) => { if (comp[n] === id && !seen.has(n)) { seen.add(n); tree.push([n, front[s]]); front.push(n); } });
      for (const [n, r] of tree) recv[n] = r;
      let loss = 0;
      if (o.liquid !== false && o.PET) for (const c of cells) loss += toM3s(Math.max(0, 1.2 * o.PET[c] - (o.P ? o.P[c] : 0)), area[c]);
      comps.push({ cells, depth, outlet: out, area: a, loss, kind: 'fresh', tree });
    }
    // (should any of that loop back on itself, the flood's own way is kept)
    if (upstreamFirst(recv, land).length < landN) { recv.set(flood); for (const cp of comps) for (const [n, r] of cp.tree) recv[n] = r; }
    // the water, upstream first; at each hollow's outlet, what its lake evaporates
    const flow = new Float64Array(N), cellsUp = new Int32Array(N), lake = new Int8Array(N), terminal = new Uint8Array(N);
    const runoff = o.runoff, wetOK = o.liquid !== false;
    for (let k = 0; k < N; k++) if (land[k]) { flow[k] = wetOK && runoff ? toM3s(runoff[k], area[k]) : 0; cellsUp[k] = 1; }
    let evaporated = 0;
    for (const k of upstreamFirst(recv, land)) {
      const c = comp[k];
      if (c >= 0 && comps[c].outlet === k) {
        const cp = comps[c];
        if (flow[k] <= 0) { cp.kind = 'dry'; continue; }
        if (flow[k] - cp.loss <= 0) { cp.kind = 'salt'; cp.share = cp.loss > 0 ? flow[k] / cp.loss : 0; continue; }
        flow[k] -= cp.loss; evaporated += cp.loss;
      }
      const r = recv[k];
      if (r >= 0 && land[r]) { flow[r] += flow[k]; cellsUp[r] += cellsUp[k]; }
    }
    // a basin that does not overflow: water on its floor runs down (steepest) to its lowest places,
    // where it evaporates; a salt lake covers the lowest part it can keep wet
    const closed = comps.filter((cp) => cp.kind !== 'fresh');
    if (closed.length) {
      const inflow = new Map();
      for (let k = 0; k < N; k++) { const r = recv[k]; if (land[k] && r >= 0 && comp[r] >= 0 && comp[k] !== comp[r] && comps[comp[r]].kind !== 'fresh') inflow.set(k, r); }
      for (const cp of closed) {
        const id = comp[cp.cells[0]];
        for (const c of cp.cells) {
          let best = -1, bs = 0;
          const j = Math.floor(c / W);
          neighbours(gr, c, (n, di, dj) => { if (comp[n] !== id || z[n] >= z[c]) return; const s = (z[c] - z[n]) / Math.hypot(di * Math.max(0.02, gr.cosl[j]), dj); if (s > bs) { bs = s; best = n; } });
          recv[c] = best;
          if (best < 0) terminal[c] = 1;
          flow[c] = wetOK && runoff ? toM3s(runoff[c], area[c]) : 0; cellsUp[c] = 1;
        }
      }
      for (const [k, r] of inflow) { flow[r] += flow[k]; cellsUp[r] += cellsUp[k]; }
      for (const cp of closed) {
        const cells = cp.cells.slice().sort((a, b) => z[b] - z[a]);              // (downhill is downstream)
        for (const c of cells) { const r = recv[c]; if (r >= 0) { flow[r] += flow[c]; cellsUp[r] += cellsUp[c]; } else evaporated += flow[c]; }
        if (cp.kind === 'salt') {
          let a = 0; const want = cp.area * Math.min(1, cp.share);
          for (const c of cells.reverse()) { if (a >= want) break; lake[c] = 2; a += area[c]; }
        }
      }
    }
    for (const cp of comps) if (cp.kind === 'fresh') for (const c of cp.cells) lake[c] = 1;
    const up = upstreamFirst(recv, land), order = Int32Array.from(up).reverse();
    return {
      recv, flow, cellsUp, lake, terminal, evaporated, fill, comp, comps, order,
      lakes: comps.filter((cp) => cp.kind !== 'dry').length, saltLakes: comps.filter((cp) => cp.kind === 'salt').length,
    };
  }

  /*
   * Glaciers: where ice lies now, or lay in the ice ages, and what it carved. Ice forms where summers
   * are cold: the warmest season below freezing now, or below the ice ages' cooling (iceAge, °C, more
   * towards the poles) with snow enough to feed it. It flows downhill as water does, but erodes where
   * it slides fast, fed by heavy snow (wet coastal ranges: Norway, Patagonia, Alaska), and barely
   * where it is frozen to its bed (polar deserts). It cuts troughs wider than a river's, deepest where
   * most ice gathers; it can dig below the cell it drains to (a basin: a lake, once the ice is gone),
   * and at the coast below the sea: a fjord. Inland it stays above the sea.
   * gr, z (changed in place); opts: water {Tw (warmest season °C), P (mm a year)}, iceAge (°C, 6),
   * erosion (1), gravity (1), radiusKm, seed, k (strength). Returns {ice (0-1 per cell: how glaciated),
   * cut (m), area (km² glaciated), fjords (km² of land become sea), deepest (m)}.
   */
  function glaciate(gr, z, opts = {}) {
    const { W, N } = gr, kmDeg = (Math.PI * (opts.radiusKm ?? 6371)) / 180, wt = opts.water;
    const ice = new Float32Array(N), cut = new Float32Array(N);
    if (!wt) return { ice, cut, area: 0, fjords: 0, deepest: 0 };
    const E = Math.max(0, opts.erosion ?? 1), g = Math.max(0.05, opts.gravity ?? 1), dT = Math.max(0, opts.iceAge ?? 6);
    const land = Uint8Array.from(z, (v) => (v > 0 ? 1 : 0)), area = new Float32Array(N), wI = new Float32Array(N);
    let glaciated = 0;
    for (let k = 0; k < N; k++) {
      if (!land[k]) continue;
      const j = Math.floor(k / W), s = Math.sin(gr.lat[j] * D2R);
      area[k] = (gr.dx * kmDeg) ** 2 * Math.max(0.02, gr.cosl[j]);
      const now = smooth(-wt.Tw[k] / 3) * smooth(wt.P[k] / 20);
      const past = smooth((dT * (0.6 + 1.4 * s * s) - wt.Tw[k]) / 4) * smooth((wt.P[k] - 50) / 300);
      ice[k] = Math.max(now, past);
      // what slides: the snow that feeds it (little in a polar desert, much on a wet range)
      wI[k] = area[k] * ice[k] * clamp(wt.P[k] / 500, 0.03, 3);
      if (ice[k] > 0.5) glaciated += area[k];
    }
    if (!glaciated) return { ice, cut, area: 0, fjords: 0, deepest: 0 };
    const { recv, order, no } = settle(gr, z, land, drain(gr, z, land, z, kmDeg), kmDeg);
    const Ai = Float64Array.from(wI);
    for (let o = no - 1; o >= 0; o--) { const k = order[o], r = recv[k]; if (r >= 0 && land[r]) Ai[r] += Ai[k]; }
    // troughs: deepest along the main ice streams, wide (a U, not a V), the floor uneven (scoured hollows)
    const nz = noise3(((opts.seed ?? 1) ^ 0x1ce) >>> 0), C = (opts.k ?? 400) * E * Math.sqrt(g);
    for (let k = 0; k < N; k++) if (land[k] && ice[k] > 0.05) cut[k] = C * ice[k] * Math.pow(Ai[k] / 1e4, 0.4) * (0.7 + 0.9 * (nz(gr.xyz[k * 3], gr.xyz[k * 3 + 1], gr.xyz[k * 3 + 2], 12, 3) + 0.35));
    const wide = Float32Array.from(cut);
    for (let k = 0; k < N; k++) {
      if (!land[k]) continue;
      let s = 0, n = 0; neighbours(gr, k, (q) => { if (land[q]) { s += cut[q]; n++; } });
      if (n) wide[k] = Math.max(cut[k], (0.7 * s) / n);
    }
    // downstream first: below the sea only where a main ice stream cuts through high ground to it (a
    // fjord); low ground under the ice is scoured into hollows (lakes) but stays land; inland, a basin
    const z0 = Float32Array.from(z), high = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (land[k]) { let m = z0[k]; neighbours(gr, k, (q) => { if (z0[q] > m) m = z0[q]; }); high[k] = z0[k] > 250 || m > 500 ? 1 : 0; }
    let fjords = 0;
    for (let o = 0; o < no; o++) {
      const k = order[o], r = recv[k], c = Math.min(wide[k], 2000);
      if (c <= 0) continue;
      const open = (r < 0 || !land[r] || z[r] <= 0) && high[k] && Ai[k] > 2e4;
      const h = z[k] - c;
      // (where it cannot reach the sea: at most 60 % of the ground's height, and never below 2 m)
      const nh = open ? Math.max(h, -0.8 * c) : Math.max(h, 0.4 * z0[k], Math.min(z0[k], 2));
      if (nh <= 0 && z[k] > 0) fjords += area[k];
      cut[k] = z[k] - nh; z[k] = nh;
    }
    let deepest = 0; for (let k = 0; k < N; k++) if (cut[k] > deepest) deepest = cut[k];
    return { ice, cut, area: glaciated, fjords, deepest };
  }

  /*
   * Rivers carving the land, and what they carry away (the stream-power law, solved implicitly as in
   * Braun & Willett 2013, so a few long steps stay stable):
   *  - the water: every land cell drains to the lowest way out, found by flooding the land up from the
   *    sea (with a little unevenness, so streams gather into valleys, as on the Rivers step); the rain
   *    it gathers is the area upstream, weighted by how wet each cell is;
   *  - the cutting: a cell is lowered towards the cell it drains to by F = K·√(wet area)/distance,
   *    h ← (h + F·h_below) / (1 + F), downstream first, so big rivers cut down nearly to the sea
   *    and headwaters and divides barely change; never below the cell below, never below the sea;
   *  - the rock: what is cut goes downstream; hollows it reaches fill up with it (basin floors), and
   *    what reaches the sea builds deltas on the shelf in front of the mouth, up to a few metres above
   *    the sea; what the shelf cannot hold goes to the deep sea.
   * gr: the grid; z: heights (changed in place: the water is routed over them as they are, their relief
   * from before the rivers in them). opts: radiusKm, erosion (× Earth's, 1), seed, steps (3), k (strength,
   * 0.8), factor (g^scaling: a hollow is a basin when deeper than 5 m ÷ it), and the water: either water =
   * {runoff, P, PET} (mm a year per cell, from the climate: biomes.js water), when a basin spills only
   * if more flows in than its lake could evaporate, or else wet(lat) (rain by latitude, 1 on average),
   * when a basin spills only in a wet belt; gravity (g, 1: rivers cut as √g, deltas settle sooner);
   * tides (tidal range on the sea, m per cell: tidalRange) for what the mouths build.
   * Returns {cut, laid} (m, per cell), the volumes (km³), the deltas' and estuaries' area (km²), the
   * mouths [{cell, from (the land cell), discharge (m³/s), sediment (km³), tide (m), kind: delta,
   * tidal delta, estuary, or river}], and the drainage: recv (where each land cell drains; sea or -1)
   * and discharge (m³/s per cell).
   */
  function carve(gr, z, opts = {}) {
    const { W, H, N } = gr, R = opts.radiusKm ?? 6371, kmDeg = (Math.PI * R) / 180;
    const E = Math.max(0, opts.erosion ?? 1), wet = opts.wet || (() => 1), steps = Math.max(1, opts.steps ?? 3);
    // F = K·(A / 10⁴ km²)^0.6 · (100 km / distance): calibrated by eye and in the tests
    // the water's power to cut grows with gravity (stream power ρ·g·Q·S), but so does the weight of the
    // grains it must lift (the threshold to move them): the net effect grows as √g
    const g = Math.max(0.05, opts.gravity ?? 1);
    const K = ((opts.k ?? 0.8) * E * Math.sqrt(g)) / steps, mExp = 0.6;
    const land = Uint8Array.from(z, (v) => (v > 0 ? 1 : 0));
    const cut = new Float32Array(N), laid = new Float32Array(N);
    const area = new Float32Array(N), wA = new Float32Array(N);
    // the water each cell sheds, as a share of an Earth-like land's (300 mm a year); a little even in
    // deserts (flash floods), and no more than a very wet land's (1500 mm: what falls on a 55 km cell
    // runs off its slopes, not all down one gorge); and what a lake there could evaporate, likewise
    const wt = opts.water, RUN = 300;
    const evap = wt ? Float32Array.from(wt.PET, (e, k) => Math.max(0, 1.2 * e - wt.P[k]) / RUN) : null;
    for (let k = 0; k < N; k++) { const j = Math.floor(k / W); area[k] = (gr.dx * kmDeg) ** 2 * Math.max(0.02, gr.cosl[j]); wA[k] = area[k] * (wt ? clamp(wt.runoff[k], 30, 1500) / RUN : wet(gr.lat[j])); }
    const zr = Float32Array.from(z);
    const nb = (k, f) => {
      const j = Math.floor(k / W), i = k - j * W;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= H) continue;
        for (let di = -1; di <= 1; di++) if (di || dj) f(jj * W + ((i + di + W) % W), di, dj, j);
      }
    };

    // where the water goes: flood the land up from the coast
    const { fill, recv, dist, spill, order, no } = settle(gr, z, land, drain(gr, z, land, zr, kmDeg), kmDeg);
    if (!no) return { cut, laid, mouths: 0, mouthList: [], eroded: 0, glacial: 0, scour: 0, basins: 0, moraine: 0, delta: 0, overflow: 0, toDeep: 0, deltaArea: 0, estuaryArea: 0, deepest: 0, recv, discharge: new Float32Array(N) };
    // basins: hollows in the land (deeper than 5 m ÷ g^scaling: the heights are the ground itself, no
    // unevenness added for the routing, so every hollow is real). Whether one overflows depends on its rain against
    // what its lake can evaporate: in a dry belt its water stays (an endorheic basin, its rim uncut), in
    // a wet one it spills over the rim and on to the sea (and the river cuts the rim down)
    const zb = Float32Array.from(z), basinMin = 5 / (opts.factor ?? 1), inBasin = (k) => spill[k] - zb[k] > basinMin;   // (before any cutting)
    const passes = (k) => smooth((wet(gr.lat[Math.floor(k / W)]) - 0.8) / 0.6);
    const out = new Float32Array(N).fill(1);                              // the share a cell passes on
    // each basin's way out (its last cell), and what a lake filling it could evaporate
    const exitOf = new Int32Array(N).fill(-1), cap = new Float64Array(N);
    for (let o = 0; o < no; o++) {
      const k = order[o], r = recv[k];
      if (!inBasin(k)) continue;
      exitOf[k] = land[r] && inBasin(r) ? exitOf[r] : k;
      if (evap) cap[exitOf[k]] += area[k] * evap[k];
    }
    // the rain gathered on the way down (upstream cells first); a basin passes on what its lake cannot
    // evaporate (from the climate) or, by latitude, all of it in a wet belt and none in a dry one
    // (A in km² of Earth-like runoff: what sets how hard the water cuts)
    const A = Float64Array.from(wA);
    for (let o = no - 1; o >= 0; o--) {
      const k = order[o], r = recv[k];
      if (exitOf[k] === k) out[k] = evap ? (A[k] > 0 ? clamp(1 - cap[k] / A[k], 0, 1) : 0) : passes(k);
      if (r < 0) continue;
      if (land[r]) A[r] += A[k] * out[k];
    }

    // the cutting, downstream first; hollows (a cell whose way out is higher) are left alone
    const z0 = Float32Array.from(z);
    for (let s = 0; s < steps; s++) {
      for (let o = 0; o < no; o++) {
        const k = order[o], r = recv[k], hr = land[r] ? z[r] : 0;
        if (hr >= z[k]) continue;
        const F = (K * Math.pow(A[k] / 1e4, mExp) * 100) / Math.max(1e-3, dist[k]);
        z[k] = Math.max(hr, (z[k] + F * hr) / (1 + F));
      }
    }
    // valleys have sides: the ground beside a deep channel slopes down to it (half its depth, a cell
    // either side); land stays land
    for (let k = 0; k < N; k++) if (land[k]) cut[k] = z0[k] - z[k];
    const side = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (!land[k]) continue;
      let s = 0, n = 0; nb(k, (q) => { if (land[q]) { s += cut[q]; n++; } });
      side[k] = n ? (0.5 * s) / n : 0;
    }
    for (let k = 0; k < N; k++) if (land[k] && side[k] > cut[k]) { cut[k] = side[k]; z[k] = Math.max(z0[k] - cut[k], Math.min(z0[k], 1)); cut[k] = z0[k] - z[k]; }

    // ── from here on one surface: the water's way over the carved heights themselves (hydrology: no
    // unevenness added), which is the drainage the map keeps and the Rivers step draws ──
    const factor = opts.factor ?? 1, runoff = wt ? wt.runoff : Float32Array.from({ length: N }, (_, k) => (land[k] ? RUN * wet(gr.lat[Math.floor(k / W)]) : 0));
    const hydIn = { runoff, P: wt ? wt.P : runoff, PET: wt ? wt.PET : null, liquid: !wt || wt.liquid !== false, radiusKm: R };
    const hy = hydrology(gr, z, hydIn), up = upstreamFirst(hy.recv, land);

    // the rock goes downstream, as the water does: the rivers' own cutting, and what the glaciers cut
    // (opts.load, m per cell: carried off by their meltwater). A shallow hollow on the way silts up;
    // a deep one fills halfway at most (it stays a lake); where a glacier ended, it leaves a moraine;
    // a basin that never overflows keeps all that reaches it; the rest reaches the sea
    const Qs = new Float64Array(N), mouths = new Map(), load = opts.load, ice = opts.ice, kept = new Float64Array(hy.comps.length);
    const moraineH = 30 / factor, km3 = (k, m) => (m * area[k]) / 1000;
    let eroded = 0, glacial = 0, basins = 0, moraine = 0, scour = 0, overflow = 0;
    // (what the ice cut where the sea now is, a fjord, the tide takes out)
    if (load) for (let k = 0; k < N; k++) if (!land[k] && load[k] > 0) glacial += km3(k, load[k]);
    for (const k of up) {
      eroded += km3(k, cut[k]); Qs[k] += km3(k, cut[k]);
      if (load && load[k] > 0) { glacial += km3(k, load[k]); Qs[k] += km3(k, load[k]); }
      // (a hollow that holds a lake, or never overflows, stays one: half full at most)
      const c = hy.comp[k], hol = hy.fill[k] - z[k], keeps = c >= 0 && (hy.comps[c].depth > basinMin || hy.comps[c].kind !== 'fresh');
      let room = hol > 0.5 ? (keeps ? 0.5 * hol : hol) : 0, isMoraine = false;
      if (ice && ice[k] < 0.3) { let fed = false; nb(k, (n) => { if (hy.recv[n] === k && ice[n] >= 0.5) fed = true; }); if (fed && moraineH > room) { room = moraineH; isMoraine = true; } }
      if (room > 0 && Qs[k] > 0) {
        const d = Math.min(room, (Qs[k] * 1000) / area[k]);
        z[k] += d; laid[k] += d; Qs[k] -= km3(k, d);
        if (isMoraine) moraine += km3(k, d); else basins += km3(k, d);
      }
      if (hy.terminal[k]) { kept[c] += Qs[k]; continue; }
      const r = hy.recv[k];
      if (r >= 0 && land[r]) Qs[r] += Qs[k]; else mouths.set(r, (mouths.get(r) || 0) + Qs[k]);
    }
    // a closed basin's floor rises with what it kept, from its lowest ground up, halfway to its rim:
    // it stays a basin; anything more spills out with the next flood and goes to the sea
    hy.comps.forEach((cp, c) => {
      let left = kept[c];
      if (!(left > 0)) return;
      const cells = cp.cells.slice().sort((a, b) => z[a] - z[b]);
      for (const share of [0.5]) for (const k of cells) {
        if (!(left > 0)) break;
        const room = z0[k] + share * (hy.fill[k] - z0[k]) - z[k];
        if (room <= 0) continue;
        const d = Math.min(room, (left * 1000) / area[k]);
        z[k] += d; laid[k] += d; left -= km3(k, d); basins += km3(k, d);
      }
      if (left > 0) overflow += left;
    });
    // where each mouth's river comes from, and the main stream into each cell (for estuaries)
    const mainIn = new Int32Array(N).fill(-1), mouthFrom = new Map();
    for (const k of up) {
      const r = hy.recv[k];
      if (r >= 0 && land[r]) { if (mainIn[r] < 0 || hy.flow[k] > hy.flow[mainIn[r]]) mainIn[r] = k; }
      else if (r >= 0 && !hy.terminal[k] && (!mouthFrom.has(r) || hy.flow[k] > hy.flow[mouthFrom.get(r)])) mouthFrom.set(r, k);
    }

    // the mouths, the biggest first. What the tide does there (its range, m: opts.tides) decides
    // what the river builds (as Galloway's deltas): where the tide is small (under ~2 m) the load
    // stays and builds a delta, a fan of new land a few metres above the sea; where it is large it
    // sweeps the load out over the shelf (tidal bars, under water) and scours the river's lower
    // course into a funnel-shaped estuary, deeper and longer the larger the tide. Under stronger
    // gravity the load settles sooner: a delta is smaller and thicker. Small rivers' loads, and what
    // a delta cannot hold, go out over the shelf and down the slope.
    const tides = opts.tides, cellKm = gr.dx * kmDeg;
    let deltaArea = 0, delta = 0, estuaryArea = 0;
    const shelf = -250 / factor, cellA = cellKm * cellKm, mouthList = [];
    const big = [...mouths].filter(([m]) => m >= 0).sort((a, b) => b[1] - a[1]), biggest = big.length ? big[0][1] : 0;
    for (const [m, vol] of big) {
      const kl = mouthFrom.has(m) ? mouthFrom.get(m) : -1, tr = tides ? tides[m] : 1.5;
      const info = { cell: m, from: kl, sediment: vol, discharge: kl >= 0 ? hy.flow[kl] : 0, tide: tr, kind: 'river' };
      if (vol < biggest * 0.08) { if (info.discharge > 1000) mouthList.push(info); continue; }
      const tideShare = clamp(1 - (tr - 2) / 4, 0.1, 1);                   // what stays at the mouth
      // an estuary up the river's lower course
      if (tr > 3 && kl >= 0) {
        // a funnel up the river's lower course: widest at the mouth (wider the larger the tide), narrowing
        // to the river; low ground within it goes under the sea, deeper along the channel; the tide
        // carries what it scours out to sea
        const n = clamp(Math.round(((tr - 2) * 20) / cellKm), 1, 8), mouthW = clamp(20 * (tr - 1), 30, 160);   // km
        let k = kl;
        for (let i = 0; i < n && k >= 0 && land[k]; i++) {
          const f = 1 - i / n, depth = (4 + 2.5 * tr) * (0.3 + 0.7 * f), rad = (mouthW * f ** 1.5 + 8) / kmDeg;
          const at = S.latLon([gr.xyz[k * 3], gr.xyz[k * 3 + 1], gr.xyz[k * 3 + 2]]);
          stamp(gr, at, Math.max(rad, gr.dx * 0.55), (q, dd) => {
            if (!land[q] || z[q] <= -1 || z[q] > 60 + 12 * tr) return;
            const lower = -1 - (depth - 1) * Math.max(0, 1 - dd / Math.max(rad, gr.dx * 0.55));
            if (lower < z[q]) { if (z[q] > 0) estuaryArea += area[q]; cut[q] += z[q] - lower; scour += km3(q, z[q] - lower); z[q] = lower; }
          });
          k = mainIn[k];
        }
        info.kind = 'estuary';
      }
      const top = tr > 3 ? -2 : 3;                                          // bars under water, or delta land
      let left = vol * 0.5 * tideShare, cells = clamp(Math.round(Math.sqrt(vol / (cellA * 2)) * tideShare / Math.sqrt(g)), 1, 30);
      const seen = new Set([m]), front = [m];
      for (let s = 0; s < front.length && left > 0 && cells > 0; s++) {
        const k = front[s];
        if (z[k] > shelf && z[k] < top) {
          const need = ((top - z[k]) * area[k]) / 1000, d = need <= left ? top - z[k] : (left * 1000) / area[k];
          const wasSea = z[k] <= 0;
          z[k] += d; laid[k] += d; left -= (d * area[k]) / 1000; delta += (d * area[k]) / 1000; cells--;
          if (wasSea && z[k] > 0) deltaArea += area[k];
        }
        if (front.length < 400) nb(k, (q) => { if (!seen.has(q) && !land[q] && z[q] > shelf && z[q] < top) { seen.add(q); front.push(q); } });
      }
      if (info.kind !== 'estuary') info.kind = tr > 2 ? 'tidal delta' : 'delta';
      mouthList.push(info);
    }
    let deepest = 0; for (let k = 0; k < N; k++) if (cut[k] > deepest) deepest = cut[k];
    // the drainage over the finished heights, for drawing and for closer maps: where each land cell
    // drains, the water through it (m³/s), lakes, and where water ends inland
    const fin = hydrology(gr, z, hydIn);
    for (const m of mouthList) if (m.from >= 0 && z[m.from] > 0) m.discharge = fin.flow[m.from];
    // (the rock's book: what left the land, against what was laid and what went out past the deltas)
    const toDeep = eroded + glacial + scour - basins - moraine - delta;
    return {
      cut, laid, mouths: mouths.size, mouthList, eroded, glacial, scour, basins, moraine, delta, overflow, toDeep, deltaArea, estuaryArea, deepest,
      ...settled(fin, runoff), hydIn,
    };
  }
  /* What a map keeps of its drainage (hydrology), with the runoff that made it. */
  const settled = (h, runoff) => ({ recv: h.recv, discharge: Float32Array.from(h.flow), cellsUp: h.cellsUp, lake: h.lake, terminal: h.terminal, evaporated: h.evaporated, lakes: h.lakes, saltLakes: h.saltLakes, runoff });

  /*
   * Build the map. P: the world's plates {plates, features, start}. opts: res (cells round, 720),
   * land (share of the surface above the sea, 0-1; by default crust × 29/41 as on Earth), shelf
   * (width factor), relief (height factor), seed, strokes [{lat, lon, r, dz}], age (0, the present),
   * gravity (Earth g, 1), scaling (1-2, 2), radiusKm (6371), ridgeDepth (m, 2600), erosion (how
   * fast the land wears down, × Earth's, 1), cells (circulation cells per hemisphere, 3), carve
   * (rivers cut valleys and build deltas, true), tides (the planet's tide, × Earth's, 1).
   * The result keeps what a closer map of a region would need to agree with it: the heights, the
   * plates, the ocean floor's age, the tidal range (tides), the drainage and discharge (rivers.recv,
   * rivers.discharge) and the river mouths (rivers.mouthList), and how it was built (carving).
   */
  function build(P, opts = {}) {
    const W = Math.max(90, Math.round((opts.res ?? 720) / 2) * 2), gr = makeGrid(W), { N } = gr;
    const start = P.start ?? 1000, age = opts.age ?? 0, m = Q.model(P.plates, start);
    const seed = (opts.seed ?? P.seed ?? 1) >>> 0, nz = noise3(seed ^ 0x6d61), shelfF = opts.shelf ?? 1;
    // the planet: heights and widths shrink as gravity grows (÷ g^scaling); km become degrees by its radius
    const g = Math.max(0.05, opts.gravity ?? 1), f = g ** clamp(opts.scaling ?? 2, 0, 3), radius = opts.radiusKm ?? 6371;
    const H = (metres) => metres / f;
    const km = (k) => ((k / f) * 180) / (Math.PI * radius);           // a mountain feature's width on Earth, in degrees here (÷ g^scaling)
    // the lie of the land (coasts, shelves, basins, how far inland) does not shrink with gravity: only
    // what stands up does (ranges, trenches, volcanoes); this is a plain distance, in degrees
    const geo = (k) => (k * 180) / (Math.PI * radius);
    const ridge = opts.ridgeDepth ?? 2600, depth = (a) => C.oceanDepth(ridge, Math.max(0, a));
    const live = (f) => (f.begin ?? start) >= age && (f.end == null || f.end < age);
    const placed = (f) => m.reconstruct(f.plateId, f.coords, age);
    const at = (k) => [gr.xyz[k * 3], gr.xyz[k * 3 + 1], gr.xyz[k * 3 + 2]];
    const fbm = (k, freq, oct) => nz(gr.xyz[k * 3], gr.xyz[k * 3 + 1], gr.xyz[k * 3 + 2], freq, oct);

    // 1. continental crust and the plate it is on
    const cont = new Uint8Array(N), plate = new Int32Array(N), craton = new Uint8Array(N);
    for (const f of P.features.filter((x) => x.kind === 'crust' && live(x) && x.coords.length >= 3)) fillPolygon(gr, placed(f), (k) => { cont[k] = 1; plate[k] = f.plateId; });
    for (const f of P.features.filter((x) => x.kind === 'craton' && live(x) && x.coords.length >= 3)) fillPolygon(gr, placed(f), (k) => { craton[k] = 1; });

    // 2. the ocean floor's age, from each opening rift's isochrons, on the plate that carries it
    const oage = new Float32Array(N).fill(-1);
    const ridges = [];
    for (const f of P.features.filter((x) => x.kind === 'rift' && x.left && x.right && x.left !== x.right && live(x) && x.coords.length >= 2)) {
      const begin = f.begin ?? start;
      if (begin <= age) continue;
      const sp = Q.spreading(m, f.coords, f.left, f.right, begin, age, P.step || 10);
      if (!sp.isochrons.length) continue;
      if (sp.isochrons[sp.isochrons.length - 1].age - age <= 15) ridges.push(sp.ridge);
      for (const [edge, flank, pid] of [[sp.edgeL, 'left', f.left], [sp.edgeR, 'right', f.right]]) {
        let prev = edge, prevAge = begin;
        for (const iso of sp.isochrons) {
          if (prevAge - age <= OCEAN_LIFE && prevAge - iso.age <= 2 * (P.step || 10)) {
            const a = (prevAge + iso.age) / 2 - age;
            fillPolygon(gr, [...prev, ...iso[flank].slice().reverse()], (k) => { if (!cont[k] && (oage[k] < 0 || a < oage[k])) { oage[k] = a; plate[k] = pid; } });
          }
          prev = iso[flank]; prevAge = iso.age;
        }
      }
    }

    // 3. every cell on a plate (Log 20): crust and dated floor as they are, the rest to the nearest
    const known = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (cont[k] || oage[k] >= 0) known[k] = 1;
    const near = distance(gr, known, plate);
    const pl = near.label;
    // welded continents are one landmass: close the narrow gaps between pieces of crust (a dilation
    // then an erosion by ~200 km) so a suture lies inland, not between two coasts
    {
      const g = Math.max(1.5 * gr.dx, geo(200)), d0 = distance(gr, cont).d;
      const grown = Uint8Array.from(d0, (v) => (v <= g ? 1 : 0)), back = distance(gr, grown.map((c) => 1 - c)).d;
      for (let k = 0; k < N; k++) if (!cont[k] && grown[k] && back[k] > g) { cont[k] = 1; plate[k] = plate[k] || 0; }
    }
    const dIn = distance(gr, cont.map((c) => 1 - c)).d;       // inland from the coast of the crust
    const dOut = distance(gr, cont).d;                        // out to sea from the crust

    // subduction zones at this age, their trench side, for margins, trenches and boundaries
    const trenches = [];
    for (const z of P.features.filter((x) => x.kind === 'subduction' && live(x) && x.coords.length >= 2)) {
      const line = S.densify(placed(z), false, 0.5).map(S.vec), sg = z.side === 'right' ? 1 : -1;   // the ocean side: away from the teeth
      line.forEach((v, j) => {
        const a = line[Math.max(0, j - 1)], b = line[Math.min(line.length - 1, j + 1)];
        let n = [v[1] * (b[2] - a[2]) - v[2] * (b[1] - a[1]), v[2] * (b[0] - a[0]) - v[0] * (b[2] - a[2]), v[0] * (b[1] - a[1]) - v[1] * (b[0] - a[0])];
        const l = Math.hypot(...n) || 1; n = n.map((x) => x / l);
        trenches.push({ v, out: n.map((x) => sg * x) });
      });
    }
    const activeMargin = new Uint8Array(N);
    for (const t of trenches) stamp(gr, S.latLon(t.v), geo(550), (k) => { activeMargin[k] = 1; });

    // erosion: × opts.erosion, and by latitude as a stand-in for the climate (which is worked out from
    // this map): faster where air rises and it rains (the equator, the fronts between circulation cells),
    // slower in the dry belts where it sinks, and near the frozen poles. Averaged over the globe it is 1.
    const E = clamp(opts.erosion ?? 1, 0, 5), nCells = clamp(Math.round(opts.cells ?? 3), 1, 9);
    const wetRaw = (lat) => { const a = Math.abs(lat); return (0.35 + 1.3 * (0.5 + 0.5 * Math.cos((Math.PI * nCells * a) / 90))) * (1 - 0.7 * smooth((a - 60) / 25)); };
    let wetMean = 0, wetW = 0;
    for (let l = 0.25; l < 90; l += 0.5) { const c = Math.cos(l * D2R); wetMean += wetRaw(l) * c; wetW += c; }
    wetMean /= wetW;
    // (igneous provinces and hotspots: the time since they formed is scaled by it, as if that much more had passed)
    const rate = (lat) => (E * wetRaw(lat)) / wetMean;
    const latOf = (coords) => S.latLon(S.centroid(coords))[0];

    // what raised each cell (for the fidelity rules, js/fidelity.js): 1 belt, 2 plateau (older maps; belts
    // make their own plateaus now), 4 igneous province, 8 hotspot, 16 island arc, 32 drawn with the brush
    const cause = new Uint8Array(N);
    // mountain belts (Log 24), each from what its plates did (js/crust.js): crust fed to it as they closed,
    // worn by erosion all the while and after, standing on what is left (Airy isostasy), so an old belt
    // still stands on its thickened crust. Point by point along each belt: where the plates closed faster
    // it is higher and wider. A belt rises from its edges to its crest at the wedge's taper; where its crust
    // reaches the most that rock holds up, it widens into a plateau instead.
    // The rain the belts erode under is a STAND-IN: the latitude curve above (at each point of a belt, where
    // its plate carried it), until the climate is worked out with the land (Phase D).
    const oro = new Float32Array(N), beltOf = new Int32Array(N).fill(-1);
    const beltRows = CR.beltsAt(P, { radiusKm: radius, gravity: g, scaling: opts.scaling ?? 2, age, erosion: E, rain: (lat) => wetRaw(lat) / wetMean, key: `cells ${nCells}`, model: m });
    const tanW = Math.tan(CR.C.TAPER_DEG * D2R), kmDeg = (Math.PI * radius) / 180, reliefX = opts.relief ?? 1;
    const orogens = new Map(P.features.filter((x) => x.kind === 'orogen').map((x) => [x.id, x]));
    const belts = [], dyDeg = 180 / gr.H, lam = km(260);
    for (const b of beltRows) {
      const o = orogens.get(b.id);
      if (!b.born || !o || !live(o)) continue;
      const st = b.stations, idx = belts.length;
      // a station's value at a fraction along the belt
      const val = (q, key) => {
        if (st.length === 1) return st[0][key];
        let i = 1; while (i < st.length - 1 && st[i].frac < q) i++;
        const a = st[i - 1], c = st[i], u = c.frac > a.frac ? clamp((q - a.frac) / (c.frac - a.frac), 0, 1) : 0;
        return a[key] + (c[key] - a[key]) * u;
      };
      // (parallel ridges within it, a few hundred km apart, wandering: kept as they were until the carving
      // shapes the belt, Phase D)
      const put = (k, T, dEdgeDeg) => {
        if (!(T > 0)) return;
        cause[k] |= 1;
        const par = 0.5 + 0.5 * Math.cos((2 * Math.PI * (dEdgeDeg + 0.6 * lam * fbm(k, 5, 2))) / lam);
        const h = CR.airy(T) * reliefX * (0.88 + 0.17 * par);
        if (h > oro[k]) { oro[k] = h; beltOf[k] = idx; }
      };
      if (b.ref === 'drawn') {
        // drawn by hand: its outline as drawn, rising from the edge at the wedge's taper to the crest its crust allows
        const cells = [], dEdge = new Map();
        fillPolygon(gr, placed(o), (k) => { if (!dEdge.has(k)) { dEdge.set(k, 1e9); cells.push(k); } });
        const nbr = (k, f) => {
          const j = Math.floor(k / W), i = k - j * W, dx = dyDeg * Math.max(0.05, gr.cosl[j]);
          f(j * W + ((i + 1) % W), dx); f(j * W + ((i - 1 + W) % W), dx);
          if (j > 0) f(k - W, dyDeg); if (j + 1 < gr.H) f(k + W, dyDeg);
        };
        for (const k of cells) { let edge = false; nbr(k, (n) => { if (!dEdge.has(n)) edge = true; }); if (edge) dEdge.set(k, 0.5 * dyDeg); }
        for (let pass = 0, moved = true; moved && pass < 400; pass++) {
          moved = false;
          for (const k of cells) nbr(k, (n, sp) => { if (dEdge.has(n) && dEdge.get(n) + sp < dEdge.get(k) - 1e-6) { dEdge.set(k, dEdge.get(n) + sp); moved = true; } });
        }
        for (const k of cells) put(k, Math.min(st[0].crestDT, dEdge.get(k) * kmDeg * tanW), dEdge.get(k));
      } else {
        // along its line: each cell takes the nearest point of it, and how far across it (and past an end) it lies
        const rot = m.absolute(b.plateId, age), line = b.line.map((v) => Q.rotate(rot, v)), al = CR.alongLine(line);
        const inl = b.inland ? CR.alongLine(b.inland.map((v) => Q.rotate(rot, v))) : null;
        const n = Math.max(2, Math.ceil(al.length / 0.4) + 1), pts = [];
        for (let j = 0; j < n; j++) {
          const q = j / (n - 1), [p, tg] = al.at(q), nrm = norm(cross(p, tg));
          // (a cordillera lies inland of its line: towards its outline's other side)
          const sg = inl ? Math.sign(dot(sub3(inl.at(q)[0], p), nrm)) || 1 : 1;
          pts.push({ p, tg, nrm, sg, w: val(q, 'width'), ct: val(q, 'crestDT') });
        }
        const best = new Map();
        pts.forEach((pt, j) => {
          if (!(pt.w > 0)) return;
          const reach = (b.ref === 'edge' ? pt.w : pt.w / 2) / kmDeg + 1.5 * gr.dx;
          stamp(gr, S.latLon(pt.p), reach, (k, dd) => { const cur = best.get(k); if (!cur || dd < cur[0]) best.set(k, [dd, j]); });
        });
        for (const [k, [, j]] of best) {
          const pt = pts[j], c = at(k), d = sub3(c, pt.p);
          const across = Math.asin(clamp(dot(c, pt.nrm), -1, 1)) * R2D * kmDeg * pt.sg;
          let beyond = 0;                                                       // past an end of the line
          if (j === 0) beyond = Math.max(0, -dot(d, pt.tg)); else if (j === pts.length - 1) beyond = Math.max(0, dot(d, pt.tg));
          const dIn = b.ref === 'edge' ? (across >= 0 ? Math.min(across, pt.w - across) : -1) : pt.w / 2 - Math.abs(across);
          const dEdge = dIn - beyond * R2D * kmDeg;
          if (dEdge > 0) put(k, Math.min(pt.ct, dEdge * tanW), dEdge / kmDeg);
        }
      }
      const top = st.reduce((x, s) => (s.crest > x.crest ? s : x), st[0]);
      belts.push({ id: b.id, name: o.name, type: b.type, path: b.path, fed: b.fed, atCap: b.atCap, rising: b.rising, begin: o.begin ?? start, active: o.active ?? 0, crest: top.crest * reliefX, width: Math.max(...st.map((s) => s.width)) });
    }
    // (no smoothing: a belt's wedge already falls to nothing at its edges)
    const oroS = oro;

    // (noise, for what still uses it: the crests inside belts and the shapes of igneous provinces)
    const nA = noise3(seed ^ 0xa11), nB = noise3(seed ^ 0xb22), nC = noise3(seed ^ 0xc33);
    const warped = (k, freq, oct, amt) => {
      const x = gr.xyz[k * 3], y = gr.xyz[k * 3 + 1], w = gr.xyz[k * 3 + 2];
      return nz(x + amt * nA(x, y, w, 1.7, 3), y + amt * nB(x, y, w, 1.7, 3), w + amt * nC(x, y, w, 1.7, 3), freq, oct);
    };

    // 4. the continents stand on their crust (Phase C), by isostasy: a column of crust of thickness T
    // stands (T − 35 km) × (ρm − ρc)/ρm higher than one of 35 km (151.5 m a km). The crust:
    //  - each piece of continental crust starts at a thickness of its own (a province; a starting
    //    condition, bounded), the same all over it: a shield nothing has thickened or stretched is flat;
    //  - toward a rifted (passive) margin it thins over a few hundred km, as stretching left it, down to
    //    a thin edge where the ocean begins: a wide low coastal plain, then the shelf, then the slope; an
    //    active margin, never stretched, keeps its crust nearly to the edge: a narrow plain and shelf;
    //  - along a failed rift it was thinned too: a rift basin, and a broad sag as the rift cooled;
    //  - the belts (above) thickened it, and their weight bends the plate beside them: foreland basins;
    //  - over a hotspot the mantle's plume lifts it, and the sea floor, in a broad swell.
    // Basins are partly filled with what the land around them sheds (FILL): what shows is the rest.
    // The sea level is set last: the height of an ordinary crust above the sea that leaves dry the share
    // of the surface asked for (the ocean floor keeps its depths).
    const CR_KM = 35, M_PER_KM = 1000 * (CR.C.RHO_MANTLE - CR.C.RHO_CRUST) / CR.C.RHO_MANTLE;
    const PROVINCE_KM = [33, 39];                // a province's starting crust (Earth's continental crust: mostly 30-45 km; unverified)
    const PASSIVE = { km: 250, edge: 12 };       // rifted margin: thins over some 250 km to ~12 km at the ocean (unverified)
    const ACTIVE = { km: 80, edge: 25 };         // active margin: never stretched, thin only at its very edge (unverified)
    const RIFT = { beta: 1.3, km: 75, sagKm: 300 };   // a failed rift: stretched ×1.3 over ~75 km, sagging over ~300 km (unverified)
    // thermal subsidence after stretching by β: some 3.2 km × (1 − 1/β) once cooled (McKenzie 1978, as
    // usually quoted; unverified)
    const SAG_M = 3200 * (1 - 1 / RIFT.beta);
    // share of a basin filled with sediment from the land around: some are (the Ganges plain, the Rhine
    // graben), some not (the Persian Gulf, East Africa's rift lakes); whether what is left holds a lake or
    // spills is the carving's to decide, by rain against evaporation. A thinned margin is filled nearly to
    // the sea: shelves and coastal plains are sediment platforms (both unverified)
    const FILL = 0.5, MARGIN_FILL = 0.8;
    const FREEBOARD_MAX = 500;                   // m: an ordinary crust stands at most this high above the sea (Earth's: a few hundred m; unverified)
    // the plate's flexural parameter α = (4D / (Δρ g))^¼, D = E·Te³ / 12(1 − ν²): E 70 GPa, ν 0.25, an
    // elastic thickness Te of 30 km under a sediment-filled moat (Δρ 1000 kg/m³): ~91 km on Earth, ∝ g^−¼
    const ALPHA_KM = 91 * g ** -0.25;
    // a hotspot swell: ~1 km high over the plume, ~1000 km across, trailing along the track as the plate
    // carries the lifted ground away and it cools (Hawaii's; unverified)
    const SWELL = { m: 1000, km: 300, myr: 30 };
    const PLUME_SAG = { m: 1000, km: 500, myr: 60 };   // a plume's sag: ~1 km once cooled, some 1000 km across (unverified)
    const BACKARC = { km: 350, betaMax: 2 };     // a back-arc: stretched over some 350 km behind its trench, by β of 2 at most (unverified)
    // provinces: each piece of crust, its own thickness; land between pieces (welded) takes the nearest
    const provT = new Float32Array(N), seen = new Uint8Array(N), crustPieces = P.features.filter((x) => x.kind === 'crust' && live(x) && x.coords.length >= 3);
    // (a craton, the old core of a piece, is part of it: a shield, flat because nothing since has
    // thickened or stretched it, not a province apart)
    for (const f of crustPieces) {
      const thick = PROVINCE_KM[0] + (PROVINCE_KM[1] - PROVINCE_KM[0]) * hashRng(`p${f.id}`)();
      fillPolygon(gr, placed(f), (k) => { provT[k] = thick; seen[k] = 1; });
    }
    {
      const nearT = distance(gr, seen, Int32Array.from(provT, (v) => Math.round(v * 100))).label;
      for (let k = 0; k < N; k++) if (cont[k] && !seen[k]) provT[k] = nearT[k] / 100;
    }
    // how active each margin is (feathered), and so how wide its thinning
    const activeS = blur(gr, Float32Array.from(activeMargin), Math.max(1, Math.round(geo(150) / gr.dx)), 2);
    const T = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (!cont[k]) continue;
      const a = clamp(activeS[k], 0, 1), w = geo((PASSIVE.km + (ACTIVE.km - PASSIVE.km) * a) * shelfF), edge = PASSIVE.edge + (ACTIVE.edge - PASSIVE.edge) * a;
      T[k] = edge + (provT[k] - edge) * smooth(dIn[k] / w);
    }
    // the crust is stiff: thickness changes from one province to the next over the flexural wavelength
    const Ts = blur(gr, T, Math.max(1, Math.round(geo(ALPHA_KM) / gr.dx)), 2);
    for (let k = 0; k < N; k++) if (cont[k] && dIn[k] > geo(PASSIVE.km)) T[k] = Ts[k];
    // failed rifts: a rift basin along each, and the sag after it
    const basin = new Float32Array(N);
    for (const f of P.features.filter((x) => x.kind === 'failed' && live(x) && x.coords.length >= 2)) {
      const line = S.densify(placed(f), false, 0.5);
      for (const p of line) stamp(gr, p, geo(2 * RIFT.sagKm), (k, dd) => {
        if (!cont[k]) return;
        const dk = dd / geo(1), thin = T[k] * (1 - 1 / (1 + (RIFT.beta - 1) * Math.exp(-((dk / RIFT.km) ** 2))));
        const dep = (thin * M_PER_KM + SAG_M * Math.exp(-((dk / RIFT.sagKm) ** 2))) * (1 - FILL);
        if (dep > basin[k]) basin[k] = dep;
      });
    }
    // back-arc basins: behind a trench whose upper plate retreated from it (its extension episodes), the
    // margin was stretched as the trench rolled back (the Sea of Japan, the Aegean): by as much as the
    // plate drew back, spread over the back-arc's width
    for (const zf of P.features.filter((x) => x.kind === 'subduction' && x.episodes && (x.begin ?? start) >= age && x.coords.length >= 2)) {
      let ext = 0;
      for (const e of zf.episodes) if (e.mode === 'extension' && e.to >= age - 1e-9) ext += -e.vup * 10 * Math.max(0, Math.min(e.from, start) - Math.max(e.to, age));   // km drawn back
      if (!(ext > 1)) continue;
      const beta = Math.min(BACKARC.betaMax, 1 + ext / BACKARC.km), line = S.densify(placed(zf), false, 0.5).map(S.vec), sg = zf.side === 'right' ? -1 : 1;
      line.forEach((v, j) => {
        const a = line[Math.max(0, j - 1)], b = line[Math.min(line.length - 1, j + 1)], n = norm(cross(v, sub3(b, a)));
        const at = S.latLon(norm(v.map((x, q) => Math.cos(geo(BACKARC.km) * D2R) * x + sg * Math.sin(geo(BACKARC.km) * D2R) * n[q])));
        stamp(gr, at, geo(BACKARC.km), (k, dd) => {
          if (!cont[k]) return;
          const f = Math.exp(-(((dd / geo(1)) / (0.6 * BACKARC.km)) ** 2)), bb = 1 + (beta - 1) * f;
          const dep = (T[k] * (1 - 1 / bb) * M_PER_KM + 3200 * (1 - 1 / bb)) * (1 - MARGIN_FILL);   // (a marginal sea's floor: filled as a margin is)
          if (dep > basin[k]) basin[k] = dep;
        });
      });
    }
    // sag basins: where a plume's head once heated the lithosphere (its flood basalt), it has since cooled
    // and sunk, as after rifting (the Tunguska basin under the Siberian Traps, the Paraná, the Karoo), the
    // basalt lying in the bowl
    for (const f of P.features.filter((x) => x.kind === 'lip' && x.type !== 'oceanic plateau' && live(x) && x.coords.length >= 3)) {
      const c = S.latLon(S.centroid(placed(f))), since = Math.max(0, (f.begin ?? start) - age);
      const sag = PLUME_SAG.m * (1 - Math.exp(-since / PLUME_SAG.myr)) * (1 - FILL);
      if (!(sag > 1)) continue;
      stamp(gr, c, geo(2.5 * PLUME_SAG.km), (k, dd) => { if (!cont[k]) return; const v = sag * Math.exp(-(((dd / geo(1)) / PLUME_SAG.km) ** 2)); if (v > basin[k]) basin[k] = v; });
    }
    // foreland basins: the belts' crust (the part standing above an ordinary column) spread over the
    // flexural wavelength is the root that holds them up; beyond a belt that root pulls the plate down
    const beltT = Float32Array.from(oroS, (h) => h / (M_PER_KM * reliefX));
    const beltSpread = blur(gr, beltT, Math.max(1, Math.round(geo(ALPHA_KM) / gr.dx)), 3);
    for (let k = 0; k < N; k++) {
      if (!cont[k]) continue;
      const moat = Math.max(0, beltSpread[k] - beltT[k]) * (CR.C.RHO_CRUST / CR.C.RHO_MANTLE) * 1000 * (1 - FILL);
      if (moat > basin[k]) basin[k] = moat;
    }
    // hotspot swells, on land and sea, along the stretch of track the plume has lifted lately
    const swell = new Float32Array(N), hsCache = new Map();
    for (const h of P.features.filter((x) => x.kind === 'hotspot' && live(x))) {
      for (const t of G.hotspotTrack(P, m, h, age, { cache: hsCache, span: 3 * SWELL.myr, step: 4 })) {
        const top = SWELL.m * Math.exp(-(t.age - age) / SWELL.myr);
        stamp(gr, t.at, geo(2.5 * SWELL.km), (k, dd) => { const v = top * Math.exp(-(((dd / geo(1)) / SWELL.km) ** 2)); if (v > swell[k]) swell[k] = v; });
      }
    }
    for (let k = 0; k < N; k++) if (swell[k] > 200) cause[k] |= 8;

    // large igneous provinces: ragged basalt plateaus on land, raised ocean floor at sea
    const lip = new Float32Array(N);
    for (const f of P.features.filter((x) => x.kind === 'lip' && live(x) && x.coords.length >= 3)) {
      // a flood basalt is planed down too: the Deccan stands, the Keweenawan basalts are gone
      const pl = placed(f), old = Math.max(0, (f.begin ?? start) - age) * rate(latOf(pl));
      const h = f.type === 'oceanic plateau' ? H(2400) : H(450) * (0.4 * Math.exp(-old / 600) + 0.6 * Math.exp(-old / 150));
      // (an oceanic plateau is no smooth oval either: ragged, with higher and lower parts)
      const oce = f.type === 'oceanic plateau';
      fillPolygon(gr, pl, (k) => { const v = h * clamp(oce ? 0.35 + 1.4 * warped(k, 6, 4, 0.5) : 0.55 + 0.9 * warped(k, 8, 4, 0.3), 0, 1); if (v > lip[k]) lip[k] = v; });
    }
    for (let k = 0; k < N; k++) if (lip[k] > 0) cause[k] |= 4;
    const lipS = blur(gr, lip, Math.max(1, Math.round(geo(60) / gr.dx)), 2);

    // the continents' surface, but for the sea level: their crust, its basins, swells, belts, basalts
    const zc = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (!cont[k]) continue;
      const ridged = 1 - Math.abs(warped(k, 9, 5, 0.15));        // sharp, branching crests in the belts
      // (a margin thinned below its province's crust is filled from the land like any basin: shelves and
      // coastal plains are mostly the sediment on it)
      const sag = Math.max(0, provT[k] - T[k]) * M_PER_KM * (1 - MARGIN_FILL);
      zc[k] = H((provT[k] - CR_KM) * M_PER_KM - sag - basin[k] + swell[k]) + oroS[k] * (0.4 + 0.8 * ridged * ridged) + lipS[k] * 0.8;
    }
    // 5. sea level: how high an ordinary crust stands above the sea, to leave the share asked for dry
    const crustShare = shareAbove(gr, Float32Array.from(cont, (c) => (c ? 1 : 0)), 0.5);
    // (only continental crust stands above the sea: a world asking for more land than it has crust gets
    // nearly all its crust dry, its edges still under water)
    const target = clamp(opts.land ?? crustShare * (29 / 41), 0.01, Math.max(0.01, crustShare * 0.97));
    const lifted = new Float32Array(N);
    const shareAt = (s) => { for (let k = 0; k < N; k++) lifted[k] = cont[k] ? zc[k] + s : -1; return shareAbove(gr, lifted, 0); };
    let lo = -4000, hi = 4000;
    for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (shareAt(mid) > target) hi = mid; else lo = mid; }
    // (nothing lifts a continent's ordinary crust much above the sea: a world with too little crust for
    // the land asked gets less, not continents raised to meet it)
    const sea = Math.min((lo + hi) / 2, H(FREEBOARD_MAX));

    // 6. the land, and the continents' flooded margins: their own surface, set to that sea level
    const z = new Float32Array(N);
    for (let k = 0; k < N; k++) if (cont[k]) z[k] = zc[k] + sea;
    // the land's relief before the rivers began (Phase D.1): a starting condition, bounded, not something
    // made: rolling ground of every size from a continent's breadth down to a cell, up to some RELIEF0_M
    // (÷ g^scaling) above or below the crust's surface, in the heights themselves, so the water is routed
    // over what is drawn. Lower toward the sea in proportion, so land stays land and the coast where the
    // crust put it. It raises nothing high: where no cause has raised the ground, it levels off softly
    // below 1450 m (÷ g^scaling), high ground being the work of belts, plateaus, plumes and volcanoes
    const nS = noise3(seed ^ 0x5737), RELIEF0_M = 800, KNEE = H(1100), TOP = H(350);
    for (let k = 0; k < N; k++) {
      const h = z[k];
      if (!(h > 0)) continue;
      // (where a belt stands, its relief is its own folding, the crests and ridges in it: the plain's fades out)
      const plain = 1 - smooth(oroS[k] / H(1000));
      let v = h + H(RELIEF0_M) * nS(gr.xyz[k * 3], gr.xyz[k * 3 + 1], gr.xyz[k * 3 + 2], 3, 6) * (h / Math.max(h, H(700))) * plain;
      if (!cause[k] && v > KNEE && v > h) v = Math.max(h, KNEE + TOP * Math.tanh((v - KNEE) / TOP));
      z[k] = v;
    }

    // 7. the ocean floor (Log 26): depth from its age; oceanic plateaus; the swells over hotspots. Where it
    // meets a continent's thinned edge, the continental slope and rise join the two (over ~150 km)
    for (let k = 0; k < N; k++) {
      if (cont[k]) continue;
      // the world's depth curve (ridge depth + 350·√age, flattening on old floor); floor older than the
      // map's ocean (no isochron left) is taken as old
      const a = oage[k], hills = H(180) * fbm(k, 14, 3);
      const D = (a >= 0 ? depth(a) : depth(150) + 300 * fbm(k, 2, 3)) - 150 * Math.max(0, fbm(k, 3, 2));
      z[k] = -D + hills + lipS[k] + H(swell[k]);
    }
    {
      const zb = blur(gr, z, Math.max(1, Math.round(geo(75) / gr.dx)), 2);
      for (let k = 0; k < N; k++) {
        const near = cont[k] ? dIn[k] : dOut[k];
        if (near < geo(150) && !(z[k] > 0) && !(zb[k] > 0)) { const w = 1 - smooth(near / geo(150)); z[k] = z[k] + (zb[k] - z[k]) * w; }
      }
    }
    const dry = (k) => z[k] > 0;
    // trenches, on the ocean side of each subduction zone
    const off = km(40) * D2R, tw = km(50), trench = new Float32Array(N), landD = distance(gr, Uint8Array.from(z, (v) => (v > 0 ? 1 : 0))).d;
    for (const t of trenches) {
      const c = t.v.map((x, q) => x + off * t.out[q]), cl = S.latLon(c);
      stamp(gr, cl, tw * 2.4, (k, dd) => {
        if (z[k] > 0 || landD[k] < geo(70)) return;
        const extra = H(2600 + 1600 * (fbm(k, 4, 2) + 1) / 2) * Math.exp(-((dd / tw) ** 2));     // below the floor beside it
        if (extra > trench[k]) trench[k] = extra;
      });
    }
    for (let k = 0; k < N; k++) z[k] -= trench[k];

    // 7. islands (Log 22): island arcs, and hotspot volcanoes sinking as they age
    // an island arc: a broad submarine ridge (some 150-250 km across, its crest 1-2 km down), and on it
    // separate volcanoes every 40-120 km, only some of them breaking the surface as islands, a few large
    // (as Japan's or the Aleutians'); not one even strip
    {
      const ridge = new Float32Array(N), arcs = P.features.filter((x) => x.kind === 'arc' && live(x) && !x.accreted && x.coords.length >= 4);
      for (const f of arcs) fillPolygon(gr, placed(f), (k) => { ridge[k] = 1; });
      const swell = blur(gr, ridge, Math.max(1, Math.round(geo(80) / gr.dx)), 3);
      for (let k = 0; k < N; k++) {
        if (swell[k] < 0.01 || z[k] >= 0) continue;
        // higher and lower stretches along it, ragged flanks (the swell normalised: an arc is often under a cell wide)
        const s = smooth(Math.min(1, swell[k] / 0.12) * 1.1 + 0.3 * fbm(k, 16, 3) - 0.05) * (0.55 + 0.45 * smooth((fbm(k, 10, 3) + 0.25) / 0.5));
        if (s > 0) { z[k] = Math.max(z[k], z[k] + (H(-1900) - z[k]) * s + H(300) * fbm(k, 14, 2) * s); cause[k] |= 16; }
      }
      for (const f of arcs) {
        const ring = placed(f).map(S.vec), n = ring.length >> 1, r = hashRng(`${f.id}`);
        // the arc's middle line: halfway between its two sides
        const mid = Array.from({ length: n }, (_, i) => norm(ring[i].map((v, q) => v + ring[ring.length - 1 - i][q])));
        let along = r() * geo(60);
        for (let i = 1; i < mid.length; i++) {
          const seg = Math.acos(clamp(dot(mid[i - 1], mid[i]), -1, 1)) * R2D;
          for (; along < seg; along += geo(55) + r() * geo(90)) {
            const t = along / seg, v = norm(mid[i - 1].map((x, q) => x + (mid[i][q] - x) * t));
            const big = r() < 0.18, rad = big ? geo(25) + r() * geo(40) : geo(10) + r() * geo(16);
            const top = big ? 300 + r() * 1800 : -1000 + r() * 1600;         // many stay seamounts
            stamp(gr, S.latLon(v), Math.max(rad, gr.dx * 0.7), (k, dd) => { const hgt = H(-1500 + (top + 1500) * Math.max(0, 1 - dd / Math.max(rad, gr.dx * 0.7)) ** 1.3); if (hgt > z[k]) { z[k] = hgt; cause[k] |= 16; } });
          }
          along -= seg;
        }
      }
    }
    const cache = hsCache;
    for (const h of P.features.filter((x) => x.kind === 'hotspot' && (x.begin ?? start) >= age)) {
      for (const t of G.hotspotTrack(P, m, h, age, { cache, span: 120, step: 4 })) {
        const a = t.age - age, ea = a * rate(t.at[0]), summit = H(4200) - H(5600) * (1 - Math.exp(-a / 14)) - 6 * ea, r = km(60) + km(28) * Math.min(1, a / 20);
        stamp(gr, t.at, r, (k, dd) => {
          const floor = z[k], top = cont[k] ? floor + H(1600) * Math.exp(-ea / 10) : summit;
          if (top <= floor) return;
          cause[k] |= 8;
          z[k] = Math.max(z[k], floor + (top - floor) * Math.max(0, 1 - dd / r) ** 1.6);
        });
      }
    }

    // 8. rivers cut valleys into it, and lay what they carry in hollows and in deltas
    const tideX = Math.max(0, opts.tides ?? 1), tides = tidalRange(gr, z, tideX, radius, f);
    const carved = opts.carve === false || E <= 0 ? null : carve(gr, z, { radiusKm: radius, erosion: E, wet: (lat) => wetRaw(lat) / wetMean, seed, k: opts.carveK, gravity: g, tides, factor: f });

    // 9. what was drawn on it (and the water's way over the drawing)
    for (const s of opts.strokes || []) stamp(gr, [s.lat, s.lon], s.r, (k, dd) => { z[k] += s.dz * smooth(1 - dd / s.r); cause[k] |= 32; });
    if (carved && (opts.strokes || []).length) Object.assign(carved, settled(hydrology(gr, z, carved.hydIn), carved.hydIn.runoff));

    // 10. plate boundaries (Log 20): convergent near a trench, divergent on a young ridge, else transform
    const boundary = new Uint8Array(N);
    const nearTrench = new Uint8Array(N), nearRidge = new Uint8Array(N);
    for (const t of trenches) stamp(gr, S.latLon(t.v), Math.max(2 * gr.dx, geo(280)), (k) => { nearTrench[k] = 1; });
    for (const rl of ridges) for (const p of S.densify(rl, false, 1)) stamp(gr, p, Math.max(2 * gr.dx, geo(220)), (k) => { nearRidge[k] = 1; });
    for (let j = 0; j < gr.H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, r = j * W + ((i + 1) % W), d = j < gr.H - 1 ? k + W : -1;
      if (pl[k] !== pl[r] || (d >= 0 && pl[k] !== pl[d])) boundary[k] = nearTrench[k] ? 1 : nearRidge[k] ? 2 : 3;
    }

    const map = {
      W, H: gr.H, z, plate: pl, planet: { gravity: g, factor: f, radiusKm: radius, ridgeDepth: ridge }, boundary, oceanAge: oage, grid: gr, cause, belts, beltOf, beltH: oroS, age,
      crust: crustShare, target, sea, at, rivers: riversOf(carved, 'latitude'), tides, tideX,
      // what carveMap needs to carve it later, with the climate's water
      carving: { erosion: E, seed, rough: 0, k: opts.carveK, wet: (lat) => wetRaw(lat) / wetMean },
    };
    return measure(map);
  }
  const riversOf = (c, rain) => c && {
    cut: c.cut, laid: c.laid, eroded: c.eroded, glacial: c.glacial, scour: c.scour, delta: c.delta, basins: c.basins, moraine: c.moraine, overflow: c.overflow, toDeep: c.toDeep,
    mouths: c.mouths, mouthList: c.mouthList, deltaArea: c.deltaArea, estuaryArea: c.estuaryArea, deepest: c.deepest,
    recv: c.recv, discharge: c.discharge, cellsUp: c.cellsUp, lake: c.lake, terminal: c.terminal, evaporated: c.evaporated, lakes: c.lakes, saltLakes: c.saltLakes, runoff: c.runoff, rain,
  };
  /* A map's land share, highest and deepest points (after its heights have changed). */
  function measure(map) {
    const { W, z, grid: gr } = map;
    let landCells = 0, hiZ = -1e9, loZ = 1e9, hiK = 0, loK = 0;
    for (let k = 0; k < z.length; k++) { if (z[k] > hiZ) { hiZ = z[k]; hiK = k; } if (z[k] < loZ) { loZ = z[k]; loK = k; } if (z[k] > 0) landCells++; }
    const ll = (k) => [gr.lat[Math.floor(k / W)], lonOf(gr, k % W)];
    return Object.assign(map, { land: shareAbove(gr, z, 0), highest: { m: hiZ, at: ll(hiK) }, deepest: { m: loZ, at: ll(loK) }, cells: { land: landCells } });
  }

  /*
   * Carve a map built with carve: false, with the water its climate gives (biomes.js water: runoff,
   * P, PET in mm a year per cell), then add the brush strokes. Changes and returns the map. With no
   * liquid water (water.liquid false), nothing is carved.
   */
  function carveMap(map, opts = {}) {
    const s = map.carving || {}, wt = opts.water;
    // glaciers first (their troughs, basins and fjords), then the rivers in what they left
    map.glaciers = wt ? Object.assign(glaciate(map.grid, map.z, { water: wt, iceAge: opts.iceAge ?? s.iceAge, erosion: s.erosion, gravity: map.planet.gravity, radiusKm: map.planet.radiusKm, seed: s.seed, k: opts.glacierK }), { iceAge: opts.iceAge ?? s.iceAge ?? 6 }) : null;
    // (the rock the glaciers cut goes with the rivers: their meltwater carries it, and it is laid
    // as moraines where the ice ended, in hollows, in deltas, or out at sea)
    const gl = map.glaciers && map.glaciers.area > 0 ? map.glaciers : null;
    const carved = wt && wt.liquid === false ? null : carve(map.grid, map.z, { radiusKm: map.planet.radiusKm, erosion: s.erosion, seed: s.seed, k: s.k, water: wt, wet: s.wet, gravity: map.planet.gravity, tides: map.tides, factor: map.planet.factor, load: gl && gl.cut, ice: gl && gl.ice });
    for (const st of opts.strokes || []) stamp(map.grid, [st.lat, st.lon], st.r, (k, dd) => { map.z[k] += st.dz * smooth(1 - dd / st.r); if (map.cause) map.cause[k] |= 32; });
    if (carved && (opts.strokes || []).length) Object.assign(carved, settled(hydrology(map.grid, map.z, carved.hydIn), carved.hydIn.runoff));
    map.rivers = riversOf(carved, wt ? 'climate' : 'latitude');
    return measure(map);
  }

  /* Sample a built map at [lat, lon] (nearest cell). */
  const sample = (map, la, lo) => map.z[cellOf(map.grid, la, lo)];

  const api = { build, carve, carveMap, hydrology, upstreamFirst, glaciate, tidalRange, planetTides, fillPolygon, distance, stamp, makeGrid, shareAbove, sample, cellOf, noise3 };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.worldmap = api; }
})(typeof window !== 'undefined' ? window : globalThis);
