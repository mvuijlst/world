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
 *   - land topography (Log 24): mountain belts by type and by how long ago they stopped rising
 *     (worn down after), large igneous provinces as plateaus;
 *   - islands (Log 22): island arcs, and hotspot volcanoes that sink into seamounts as they age;
 *   - sea topography (Log 26): depth from the ocean floor's age (ridges shallow, old floor deep),
 *     continental slopes, trenches off subduction zones, oceanic plateaus.
 * Then any brush strokes. Pure functions: runs in the page and in Node.
 *
 * Not only Earth: like the Tectonics step, heights and widths are divided by g^scaling (gravity in
 * Earth g; scaling 1-2, 2 by default), widths are set in km and turned into degrees by the planet's
 * radius, and the sea floor follows the world's own ridge depth and depth curve.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const S = node ? require('./sphere.js') : root.WS.sphere;
  const Q = node ? require('./rotation.js') : root.WS.rotation;
  const G = node ? require('./supercontinent.js') : root.WS.supercontinent;
  const C = node ? require('./calc.js') : root.WS.calc;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const OCEAN_LIFE = 200;                                    // older ocean floor has been subducted
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

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
   * gr: the grid; z: heights (changed in place). opts: radiusKm, erosion (× Earth's, 1), wet(lat)
   * (rain, 1 on average), rough (m of unevenness for the routing), seed, steps (3), k (strength, 0.8).
   * Returns {cut, laid} (m, per cell), {mouths}, the volumes (km³) and the deltas' new land (km²).
   */
  function carve(gr, z, opts = {}) {
    const { W, H, N } = gr, R = opts.radiusKm ?? 6371, kmDeg = (Math.PI * R) / 180;
    const E = Math.max(0, opts.erosion ?? 1), wet = opts.wet || (() => 1), steps = Math.max(1, opts.steps ?? 3);
    // F = K·(A / 10⁴ km²)^0.6 · (100 km / distance): calibrated by eye and in the tests
    const K = ((opts.k ?? 0.8) * E) / steps, mExp = 0.6;
    const land = Uint8Array.from(z, (v) => (v > 0 ? 1 : 0));
    const cut = new Float32Array(N), laid = new Float32Array(N);
    const area = new Float32Array(N), wA = new Float32Array(N);
    for (let k = 0; k < N; k++) { const j = Math.floor(k / W); area[k] = (gr.dx * kmDeg) ** 2 * Math.max(0.02, gr.cosl[j]); wA[k] = area[k] * wet(gr.lat[j]); }
    const nz = noise3(((opts.seed ?? 1) ^ 0x71ae) >>> 0), rough = opts.rough ?? 300;
    const zr = Float32Array.from(z, (v, k) => (v > 0 ? v + rough * (1 + nz(gr.xyz[k * 3 + 1], gr.xyz[k * 3 + 2], gr.xyz[k * 3], 7, 5)) : v));
    const nb = (k, f) => {
      const j = Math.floor(k / W), i = k - j * W;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= H) continue;
        for (let di = -1; di <= 1; di++) if (di || dj) f(jj * W + ((i + di + W) % W), di, dj, j);
      }
    };
    const distKm = (di, dj, j) => gr.dx * kmDeg * Math.hypot(di * Math.max(0.02, gr.cosl[j]), dj);

    // where the water goes: flood the land up from the coast
    const fill = new Float64Array(N), recv = new Int32Array(N).fill(-1), dist = new Float32Array(N), done = new Uint8Array(N), order = new Int32Array(N);
    let no = 0;
    const q = heap(fill);
    for (let k = 0; k < N; k++) if (!land[k]) { done[k] = 1; let coast = false; nb(k, (n) => { if (land[n]) coast = true; }); if (coast) { fill[k] = 0; q.push(k); } }
    if (!q.size) return { cut, laid, mouths: 0, eroded: 0, delta: 0, basins: 0, deltaArea: 0, deepest: 0 };
    while (q.size) {
      const c = q.pop();
      if (land[c]) order[no++] = c;
      nb(c, (n, di, dj, j) => {
        if (done[n]) return;
        done[n] = 1; fill[n] = Math.max(zr[n], fill[c] + 1e-3); recv[n] = c; dist[n] = distKm(di, dj, j); q.push(n);
      });
    }
    // the rain gathered on the way down (upstream cells first)
    const A = Float64Array.from(wA);
    for (let o = no - 1; o >= 0; o--) { const k = order[o], r = recv[k]; if (r >= 0 && land[r]) A[r] += A[k]; }

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

    // the rock goes downstream: hollows on the way fill up with it, the rest reaches the sea
    const Qs = new Float64Array(N), mouths = new Map();
    let eroded = 0, basins = 0;
    for (let o = no - 1; o >= 0; o--) {
      const k = order[o], r = recv[k];
      Qs[k] += cut[k] * area[k] / 1000; eroded += cut[k] * area[k] / 1000;      // km³
      const room = r >= 0 && land[r] && z[r] > z[k] ? z[r] - z[k] : 0;          // a hollow: fill it to its lip
      if (room > 0 && Qs[k] > 0) { const d = Math.min(room, (Qs[k] * 1000) / area[k]); z[k] += d; laid[k] += d; Qs[k] -= (d * area[k]) / 1000; basins += (d * area[k]) / 1000; }
      if (land[r]) Qs[r] += Qs[k]; else mouths.set(r, (mouths.get(r) || 0) + Qs[k]);
    }

    let deltaArea = 0;
    // deltas: where a big river meets the shelf, the biggest first: a fan of new land a few metres
    // above the sea in front of the mouth, as big as its load allows (a few cells for the largest);
    // small rivers' loads, and what a delta cannot hold, go out over the shelf and down the slope
    let delta = 0;
    const shelf = -250, top = 3, cellA = (gr.dx * kmDeg) ** 2;
    const big = [...mouths].sort((a, b) => b[1] - a[1]), biggest = big.length ? big[0][1] : 0;
    for (const [m, vol] of big) {
      if (vol < biggest * 0.08) break;
      let left = vol * 0.5, cells = clamp(Math.round(Math.sqrt(vol / (cellA * 2))), 1, 30);
      const seen = new Set([m]), front = [m];
      for (let s = 0; s < front.length && left > 0 && cells > 0; s++) {
        const k = front[s];
        if (z[k] > shelf && z[k] < top) {
          const need = ((top - z[k]) * area[k]) / 1000, d = need <= left ? top - z[k] : (left * 1000) / area[k];
          const wasSea = z[k] <= 0;
          z[k] += d; laid[k] += d; left -= (d * area[k]) / 1000; delta += (d * area[k]) / 1000; cells--;
          if (wasSea && z[k] > 0) deltaArea += area[k];
        }
        if (front.length < 400) nb(k, (n) => { if (!seen.has(n) && !land[n] && z[n] > shelf && z[n] < top) { seen.add(n); front.push(n); } });
      }
    }
    let deepest = 0; for (let k = 0; k < N; k++) if (cut[k] > deepest) deepest = cut[k];
    return { cut, laid, mouths: mouths.size, eroded, delta, basins, deltaArea, deepest };
  }

  /*
   * Build the map. P: the world's plates {plates, features, start}. opts: res (cells round, 720),
   * land (share of the surface above the sea, 0-1; by default crust × 29/41 as on Earth), shelf
   * (width factor), relief (height factor), seed, strokes [{lat, lon, r, dz}], age (0, the present),
   * gravity (Earth g, 1), scaling (1-2, 2), radiusKm (6371), ridgeDepth (m, 2600), erosion (how
   * fast the land wears down, × Earth's, 1), cells (circulation cells per hemisphere, 3), carve
   * (rivers cut valleys and build deltas, true).
   */
  function build(P, opts = {}) {
    const W = Math.max(90, Math.round((opts.res ?? 720) / 2) * 2), gr = makeGrid(W), { N } = gr;
    const start = P.start ?? 1000, age = opts.age ?? 0, m = Q.model(P.plates, start);
    const seed = (opts.seed ?? P.seed ?? 1) >>> 0, nz = noise3(seed ^ 0x6d61), shelfF = opts.shelf ?? 1;
    // the planet: heights and widths shrink as gravity grows (÷ g^scaling); km become degrees by its radius
    const g = Math.max(0.05, opts.gravity ?? 1), f = g ** clamp(opts.scaling ?? 2, 0, 3), radius = opts.radiusKm ?? 6371;
    const H = (metres) => metres / f, relief = (opts.relief ?? 1) / f;
    const km = (k) => ((k / f) * 180) / (Math.PI * radius);           // a width on Earth, in degrees here
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
      const g = Math.max(1.5 * gr.dx, km(200)), d0 = distance(gr, cont).d;
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
    for (const t of trenches) stamp(gr, S.latLon(t.v), km(550), (k) => { activeMargin[k] = 1; });

    // mountain belts (Log 24): heights by type (a collision range, a plateau behind one, a cordillera,
    // accreted highlands), worn down once they stop rising: Alps-like while young, Appalachian after
    // some 250 Myr, low hills after a billion years
    const oro = new Float32Array(N), plat = new Float32Array(N);
    const PEAK = { collision: 6600, cordillera: 4600, accretion: 2600, plateau: 3800 };
    const worn = (since) => 0.12 + 0.88 * Math.exp(-since / 110);
    // erosion: × opts.erosion, and by latitude as a stand-in for the climate (which is worked out from
    // this map): faster where air rises and it rains (the equator, the fronts between circulation cells),
    // slower in the dry belts where it sinks, and near the frozen poles. Averaged over the globe it is 1.
    // Times since a feature stopped growing are scaled by it, as if that much more time had passed.
    const E = clamp(opts.erosion ?? 1, 0, 5), nCells = clamp(Math.round(opts.cells ?? 3), 1, 9);
    const wetRaw = (lat) => { const a = Math.abs(lat); return (0.35 + 1.3 * (0.5 + 0.5 * Math.cos((Math.PI * nCells * a) / 90))) * (1 - 0.7 * smooth((a - 60) / 25)); };
    let wetMean = 0, wetW = 0;
    for (let l = 0.25; l < 90; l += 0.5) { const c = Math.cos(l * D2R); wetMean += wetRaw(l) * c; wetW += c; }
    wetMean /= wetW;
    const rate = (lat) => (E * wetRaw(lat)) / wetMean;
    const latOf = (coords) => S.latLon(S.centroid(coords))[0];
    // the thickened crust under a belt holds the ground up after the peaks are gone (the Appalachians),
    // but it is worn away too: after a billion years or so a belt is a flat shield (the Grenville)
    const rootW = new Float32Array(N);
    // A belt is not a flat-topped block: it rises from its edges to a crest along its middle, has peaks
    // and passes along its length, and parallel ranges within it. So each belt's height follows the
    // distance in from its edge (relative to its half-width), times a slow variation along it, times
    // parallel ridges at that distance (a few hundred km apart, wandering). Plateaus stay flat-topped.
    const inBelt = new Int32Array(N).fill(-1), dEdge = new Float32Array(N);
    const dyDeg = 180 / gr.H;
    let beltNo = 0;
    for (const o of P.features.filter((x) => x.kind === 'orogen' && live(x) && x.coords.length >= 3)) {
      const pl = placed(o), into = o.type === 'plateau' ? plat : oro;
      const since = Math.max(0, (o.active ?? 0) - age) * rate(latOf(pl));
      const h = (PEAK[o.type] ?? 3000) * (o.type === 'plateau' ? Math.exp(-since / 60) : worn(since) * (since > 500 ? Math.exp(-(since - 500) / 500) : 1)) * relief;
      const root = Math.exp(-since / 500);
      const cells = [], id = beltNo++;
      fillPolygon(gr, pl, (k) => { if (inBelt[k] !== id) { inBelt[k] = id; cells.push(k); } if (root > rootW[k]) rootW[k] = root; });
      if (!cells.length) continue;
      if (o.type === 'plateau') { for (const k of cells) if (h > into[k]) into[k] = h; continue; }
      // distance in from the edge (degrees), by relaxing over the belt's cells
      const nbr = (k, f) => {
        const j = Math.floor(k / W), i = k - j * W, dx = dyDeg * Math.max(0.05, gr.cosl[j]);
        f(j * W + ((i + 1) % W), dx); f(j * W + ((i - 1 + W) % W), dx);
        if (j > 0) f(k - W, dyDeg); if (j + 1 < gr.H) f(k + W, dyDeg);
      };
      for (const k of cells) { let edge = false; nbr(k, (n) => { if (inBelt[n] !== id) edge = true; }); dEdge[k] = edge ? 0.5 * dyDeg : 1e9; }
      for (let pass = 0, moved = true; moved && pass < 400; pass++) {
        moved = false;
        for (const k of cells) nbr(k, (n, step) => { if (inBelt[n] === id && dEdge[n] + step < dEdge[k] - 1e-6) { dEdge[k] = dEdge[n] + step; moved = true; } });
      }
      let half = 0; for (const k of cells) half = Math.max(half, dEdge[k]);
      const lam = km(260);
      for (const k of cells) {
        // edges to crest, the foothills fading out along a ragged line rather than the outline
        const t = clamp(dEdge[k] / Math.max(half, 1e-6) + 0.3 * fbm(k, 8, 3), 0, 1);
        const profile = 0.05 + 0.95 * Math.pow(smooth(t * 1.25), 0.85);
        const along = clamp(1.05 + 0.9 * fbm(k, 3.2, 3), 0.45, 1.2);         // peaks and passes
        const par = 0.5 + 0.5 * Math.cos((2 * Math.PI * (dEdge[k] + 0.6 * lam * fbm(k, 5, 2))) / lam);
        const v = h * profile * along * (0.88 + 0.17 * par);
        if (v > into[k]) into[k] = v;
      }
    }
    const oroS = blur(gr, oro, Math.max(1, Math.round(km(65) / gr.dx)), 2), platS = blur(gr, plat, Math.max(1, Math.round(km(120) / gr.dx)), 2);

    // 4. where the coast runs (Log 23): not the crust's outline but a field of "how far inland", the
    // distance into the crust (negative out at sea) roughened by domain-warped fractal noise, so the
    // coast gets bays, peninsulas, capes and offshore islands at every scale
    const nA = noise3(seed ^ 0xa11), nB = noise3(seed ^ 0xb22), nC = noise3(seed ^ 0xc33);
    const warped = (k, freq, oct, amt) => {
      const x = gr.xyz[k * 3], y = gr.xyz[k * 3 + 1], w = gr.xyz[k * 3 + 2];
      return nz(x + amt * nA(x, y, w, 1.7, 3), y + amt * nB(x, y, w, 1.7, 3), w + amt * nC(x, y, w, 1.7, 3), freq, oct);
    };
    // three scales (the noise's spread is about 0.35): peninsulas and gulfs shifting the coast by some
    // 450 km, bays and headlands by 140 km, coves by 45 km
    // a mountain belt stands on crust thickened beneath it, and stays high long after it is worn down
    // (the Appalachians, the Urals): the ground under any belt, however old, is lifted
    const beltS = blur(gr, rootW, Math.max(1, Math.round(km(90) / gr.dx)), 2);
    const reachK = km(3000), Pot = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const sd = cont[k] ? dIn[k] : -dOut[k];
      Pot[k] = Math.abs(sd) > reachK ? sd : sd + km(1290) * warped(k, 2.2, 6, 0.4) + km(400) * warped(k, 7.5, 4, 0.2) + km(130) * fbm(k, 22, 3);
      // mountains and plateaus near the crust stand above the sea: ranges join the land they rise on
      if (sd > -km(400) && (oroS[k] > H(300) || platS[k] > H(300))) Pot[k] += km(500) * clamp(Math.max(oroS[k], platS[k]) / H(1500), 0, 1);
      if (sd > -km(100) && beltS[k] > 0.02) Pot[k] += km(650) * smooth(beltS[k] * 1.6) * smooth((sd + km(100)) / km(200));
    }
    // 5. sea level: the coast is where that field crosses the level that leaves the share asked for dry
    const crustShare = shareAbove(gr, Float32Array.from(cont, (c) => (c ? 1 : 0)), 0.5);
    const target = clamp(opts.land ?? crustShare * (29 / 41), 0.01, Math.max(0.02, crustShare * 1.05));
    let lo = -40, hi = 40;
    for (let it = 0; it < 40; it++) { const mid = (lo + hi) / 2; if (shareAbove(gr, Pot, mid) > target) lo = mid; else hi = mid; }
    const p0 = (lo + hi) / 2, sea = p0;
    const dry = (k) => Pot[k] > p0;

    // 6. the land: rising gently inland, broad basins and uplands, cratons as old flat shields
    const z = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      if (!dry(k)) continue;
      const d = Pot[k] - p0;
      z[k] = H(Math.max(4, 25 + 1250 * (1 - Math.exp(-d / km(900))) + (380 * fbm(k, 2.5, 5) + 320 * fbm(k, 1.1, 3)) * smooth(d / km(250)) - (craton[k] ? 80 : 0)));
    }
    // large igneous provinces: ragged basalt plateaus on land, raised ocean floor at sea
    const lip = new Float32Array(N);
    for (const f of P.features.filter((x) => x.kind === 'lip' && live(x) && x.coords.length >= 3)) {
      // a flood basalt is planed down too: the Deccan stands, the Keweenawan basalts are gone
      const pl = placed(f), old = Math.max(0, (f.begin ?? start) - age) * rate(latOf(pl));
      const h = f.type === 'oceanic plateau' ? H(2400) : H(450) * (0.4 * Math.exp(-old / 600) + 0.6 * Math.exp(-old / 150));
      fillPolygon(gr, pl, (k) => { const v = h * clamp(0.55 + 0.9 * warped(k, 8, 4, 0.3), 0, 1); if (v > lip[k]) lip[k] = v; });
    }
    const lipS = blur(gr, lip, Math.max(1, Math.round(km(60) / gr.dx)), 2);
    for (let k = 0; k < N; k++) {
      if (!dry(k)) continue;
      const ridged = 1 - Math.abs(warped(k, 9, 5, 0.15));        // sharp, branching crests
      z[k] += oroS[k] * (0.4 + 0.8 * ridged * ridged) + platS[k] * (0.85 + 0.15 * fbm(k, 6, 3)) + lipS[k] * 0.8;
    }

    // 7. the sea floor (Log 26): shelf, slope, then depth from the floor's age; oceanic plateaus
    for (let k = 0; k < N; k++) {
      if (dry(k)) continue;
      const e = p0 - Pot[k];                                      // how far out from the coast
      const shelfW = (activeMargin[k] ? km(40) : km(150) * (0.6 + 0.5 * (fbm(k, 1.5, 2) + 1))) * shelfF;
      // the world's depth curve (ridge depth + 350·√age, flattening on old floor); floor older than the
      // map's ocean (no isochron left) is taken as old
      const a = oage[k], hills = H(180) * fbm(k, 14, 3);
      const D = (a >= 0 ? depth(a) : depth(150) + 300 * fbm(k, 2, 3)) - 150 * Math.max(0, fbm(k, 3, 2));
      const shelf = 20 + 120 * clamp(e / shelfW, 0, 1);
      const rise = smooth((e - shelfW) / km(260));             // continental slope and rise
      z[k] = -(shelf + (D - shelf) * rise) + (hills + lipS[k]) * rise;
    }
    // trenches, on the ocean side of each subduction zone
    const off = km(40) * D2R, tw = km(50), trench = new Float32Array(N);
    for (const t of trenches) {
      const c = t.v.map((x, q) => x + off * t.out[q]), cl = S.latLon(c);
      stamp(gr, cl, tw * 2.4, (k, dd) => {
        if (Pot[k] > p0 - km(70)) return;
        const extra = H(2600 + 1600 * (fbm(k, 4, 2) + 1) / 2) * Math.exp(-((dd / tw) ** 2));     // below the floor beside it
        if (extra > trench[k]) trench[k] = extra;
      });
    }
    for (let k = 0; k < N; k++) z[k] -= trench[k];

    // 7. islands (Log 22): island arcs, and hotspot volcanoes sinking as they age
    for (const f of P.features.filter((x) => x.kind === 'arc' && live(x) && !x.accreted && x.coords.length >= 3)) {
      // a submarine ridge with volcanoes along it: only their tops break the surface, as a chain of islands
      fillPolygon(gr, placed(f), (k) => { const v = warped(k, 26, 4, 0.2); const hgt = H(-1600 + 4300 * smooth((v + 0.05) / 0.75)); z[k] = Math.max(z[k], hgt); });
    }
    const cache = new Map();
    for (const h of P.features.filter((x) => x.kind === 'hotspot' && (x.begin ?? start) >= age)) {
      for (const t of G.hotspotTrack(P, m, h, age, { cache, span: 120, step: 4 })) {
        const a = t.age - age, ea = a * rate(t.at[0]), summit = H(4200) - H(5600) * (1 - Math.exp(-a / 14)) - 6 * ea, r = km(60) + km(28) * Math.min(1, a / 20);
        stamp(gr, t.at, r, (k, dd) => {
          const floor = z[k], top = cont[k] ? floor + H(1600) * Math.exp(-ea / 10) : summit;
          if (top <= floor) return;
          z[k] = Math.max(z[k], floor + (top - floor) * Math.max(0, 1 - dd / r) ** 1.6);
        });
      }
    }

    // 8. rivers cut valleys into it, and lay what they carry in hollows and in deltas
    const carved = opts.carve === false || E <= 0 ? null : carve(gr, z, { radiusKm: radius, erosion: E, wet: (lat) => wetRaw(lat) / wetMean, rough: 300 / f, seed, k: opts.carveK });

    // 9. what was drawn on it
    for (const s of opts.strokes || []) stamp(gr, [s.lat, s.lon], s.r, (k, dd) => { z[k] += s.dz * smooth(1 - dd / s.r); });

    // 10. plate boundaries (Log 20): convergent near a trench, divergent on a young ridge, else transform
    const boundary = new Uint8Array(N);
    const nearTrench = new Uint8Array(N), nearRidge = new Uint8Array(N);
    for (const t of trenches) stamp(gr, S.latLon(t.v), Math.max(2 * gr.dx, km(280)), (k) => { nearTrench[k] = 1; });
    for (const rl of ridges) for (const p of S.densify(rl, false, 1)) stamp(gr, p, Math.max(2 * gr.dx, km(220)), (k) => { nearRidge[k] = 1; });
    for (let j = 0; j < gr.H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, r = j * W + ((i + 1) % W), d = j < gr.H - 1 ? k + W : -1;
      if (pl[k] !== pl[r] || (d >= 0 && pl[k] !== pl[d])) boundary[k] = nearTrench[k] ? 1 : nearRidge[k] ? 2 : 3;
    }

    let landCells = 0, hiZ = -1e9, loZ = 1e9, hiK = 0, loK = 0;
    for (let k = 0; k < N; k++) { if (z[k] > hiZ) { hiZ = z[k]; hiK = k; } if (z[k] < loZ) { loZ = z[k]; loK = k; } if (z[k] > 0) landCells++; }
    const ll = (k) => [gr.lat[Math.floor(k / W)], lonOf(gr, k % W)];
    return {
      W, H: gr.H, z, plate: pl, planet: { gravity: g, factor: f, radiusKm: radius, ridgeDepth: ridge }, boundary, oceanAge: oage, grid: gr,
      land: shareAbove(gr, z, 0), crust: crustShare, target, sea,
      highest: { m: hiZ, at: ll(hiK) }, deepest: { m: loZ, at: ll(loK) }, cells: { land: landCells }, at,
      rivers: carved && { cut: carved.cut, laid: carved.laid, eroded: carved.eroded, delta: carved.delta, basins: carved.basins, mouths: carved.mouths, deltaArea: carved.deltaArea, deepest: carved.deepest },
    };
  }

  /* Sample a built map at [lat, lon] (nearest cell). */
  const sample = (map, la, lo) => map.z[cellOf(map.grid, la, lo)];

  const api = { build, carve, fillPolygon, distance, stamp, makeGrid, shareAbove, sample, cellOf, noise3 };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.worldmap = api; }
})(typeof window !== 'undefined' ? window : globalThis);
