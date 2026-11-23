/*
 * A region of the world map, closer up: a square window some hundreds of km across, at a few
 * hundred metres to a few km a pixel, that agrees with the world map it is cut from.
 *
 *   - the heights: the world map's (bicubic between its cells), with detail added below the size of
 *     one of its cells only (fractal noise in km on the sphere, so a place always gets the same
 *     detail): sharp ridged crests in mountains, rolling hills on uplands, gentle swells on plains,
 *     and a ragged coast with bays, spits and islets where the land meets the sea. How much detail
 *     follows how high and how rugged the world map is there; the large shapes stay its own;
 *   - the water: the climate's runoff (biomes.js water, from the world map) falls on every pixel and
 *     drains the lowest way out (a priority flood from the sea and from the window's edges where the
 *     world map's drainage leaves the window); rivers that enter from outside bring the world map's
 *     discharge with them. Shallow hollows silt up; deep ones are lakes, fresh if more water reaches
 *     them than they can evaporate, salt if not;
 *   - the valleys: rivers cut down towards a graded profile (steep for a brook, gentle for a big
 *     river), the more water the closer; valley sides then slump to a stable slope;
 *   - the biomes: the world map's climate between its cells, colder with height by the planet's lapse
 *     rate, so a range's crests are tundra or ice while the valleys below are forest.
 * Pure functions: runs in the page, in a worker and in Node.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const B = node ? require('./biomes.js') : root.WS.biomes;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI, YEAR_S = 3.156e7;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };

  /* 3-D gradient noise with a full 32-bit hash (no period), about -1..1. */
  const GX = [1, -1, 1, -1, 1, -1, 1, -1, 0, 0, 0, 0, 1, -1, 0, 0], GY = [1, 1, -1, -1, 0, 0, 0, 0, 1, -1, 1, -1, 1, 1, -1, -1], GZ = [0, 0, 0, 0, 1, 1, -1, -1, 1, 1, -1, -1, 0, 0, 1, -1];
  function gradNoise(seed) {
    const s = seed | 0;
    const g = (xi, yi, zi, x, y, z) => {
      let h = s ^ Math.imul(xi, 0x8da6b343) ^ Math.imul(yi, 0xd8163841) ^ Math.imul(zi, 0xcb1ab31f);
      h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); h ^= h >>> 15;
      const q = h & 15;
      return GX[q] * x + GY[q] * y + GZ[q] * z;
    };
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    return (x, y, z) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
      const u = fade(xf), v = fade(yf), w = fade(zf);
      const a = g(xi, yi, zi, xf, yf, zf), b = g(xi + 1, yi, zi, xf - 1, yf, zf), c = g(xi, yi + 1, zi, xf, yf - 1, zf), d = g(xi + 1, yi + 1, zi, xf - 1, yf - 1, zf);
      const e = g(xi, yi, zi + 1, xf, yf, zf - 1), f = g(xi + 1, yi, zi + 1, xf - 1, yf, zf - 1), gg = g(xi, yi + 1, zi + 1, xf, yf - 1, zf - 1), hh = g(xi + 1, yi + 1, zi + 1, xf - 1, yf - 1, zf - 1);
      const x1 = a + u * (b - a), x2 = c + u * (d - c), x3 = e + u * (f - e), x4 = gg + u * (hh - gg);
      const y1 = x1 + v * (x2 - x1), y2 = x3 + v * (x4 - x3);
      return y1 + w * (y2 - y1);
    };
  }

  /* A min-heap of pixel indices keyed by a Float64Array, in a typed array (fast for millions). */
  function heap(key, cap) {
    const a = new Int32Array(cap);
    let n = 0;
    return {
      get size() { return n; },
      push(k) { let i = n++; const v = key[k]; while (i > 0) { const p = (i - 1) >> 1; if (key[a[p]] <= v) break; a[i] = a[p]; i = p; } a[i] = k; },
      pop() {
        const top = a[0], last = a[--n];
        if (n) {
          const v = key[last];
          let i = 0;
          for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && key[a[c + 1]] < key[a[c]]) c++; if (key[a[c]] >= v) break; a[i] = a[c]; i = c; }
          a[i] = last;
        }
        return top;
      },
    };
  }

  /*
   * Where a window lies: centre lat, lon (degrees), span (km across, east-west and north-south), res
   * (pixels across). The window is square in km at its centre: degrees of longitude are wider than
   * degrees of latitude by 1/cos(latitude). Its centre is kept off the poles.
   */
  function frame(opts, radiusKm = 6371) {
    const kmDeg = (Math.PI * radiusKm) / 180, W = Math.max(64, Math.round(opts.res ?? 1024)), Hh = W;
    const span = clamp(opts.span ?? 800, 5, 0.5 * Math.PI * radiusKm), dLat = span / kmDeg;
    const lat = clamp(opts.lat ?? 0, -88 + dLat / 2, 88 - dLat / 2), lon = ((((opts.lon ?? 0) + 180) % 360) + 360) % 360 - 180;
    const cosc = Math.max(0.1, Math.cos(lat * D2R)), dLon = dLat / cosc;
    return { W, H: Hh, lat, lon, span, kmDeg, north: lat + dLat / 2, south: lat - dLat / 2, west: lon - dLon / 2, east: lon + dLon / 2, dLat, dLon, pxKm: span / W };
  }

  /*
   * Build a region. map: the world map (z, W, H, planet, rivers.recv and rivers.discharge if carved),
   * with water: biomes.js water(map, clim, planet) on it (runoff, P, PET, Tw, Tc, Ta, Pw, liquid,
   * tBoil); or another region (what build returns), for a closer map of part of it (water: null, its
   * own is used). Either is the source: the new map takes its heights, drainage and climate from it, and
   * adds only the detail finer than one of its cells (or pixels).
   * opts: lat, lon, span (km), res (pixels across), seed, erosion (× Earth's, 1), detail (× 1),
   * minFlow (m³/s to draw a river, 8), sea (true: the sea floor gets detail too).
   * Returns {frame, W, H, z (m), flow (m³/s), recv, lake (1 fresh, 2 salt), biome (code, 0 sea or
   * lake), rivers [{pts: [[x, y] in pixels], q}], inflows, stats}.
   */
  function build(map, water, opts = {}) {
    const planet = map.planet || {}, f = planet.factor ?? 1, R = planet.radiusKm ?? 6371, g = planet.gravity ?? 1;
    const fr = frame(opts, R), { W, H, kmDeg, pxKm } = fr, N = W * H;
    // the source: the world map (the whole globe, wrapping east-west) or a region (a box of its own)
    const sub = !!map.frame, sf = sub ? map.frame : { north: 90, dLat: 180, west: -180, dLon: 360, pxKm: (2 * Math.PI * R) / map.W };
    if (sub) water = map.water;
    const gW = map.W, gH = map.H, gz = map.z, gkm = sub ? sf.pxKm : (2 * Math.PI * R) / gW;   // a source cell, km
    const seed = (opts.seed ?? 1) | 0, E = Math.max(0, opts.erosion ?? 1), detailX = Math.max(0, opts.detail ?? 1);
    const latOf = (y) => fr.north - ((y + 0.5) / H) * fr.dLat, lonOf = (x) => fr.west + ((x + 0.5) / W) * fr.dLon;
    const wrapI = sub ? (i) => clamp(i, 0, gW - 1) : (i) => ((i % gW) + gW) % gW, clampJ = (j) => clamp(j, 0, gH - 1);
    // (longitude east of the source's west edge: round the globe for the world map, either side of it for a region)
    const east = sub ? (lon) => { let d = lon - sf.west; d -= 360 * Math.round((d - sf.dLon / 2) / 360); return d; } : (lon) => ((((lon + 180) % 360) + 360) % 360);
    const gfi = (lon) => (east(lon) / sf.dLon) * gW - 0.5, gfj = (lat) => ((sf.north - lat) / sf.dLat) * gH - 0.5;
    const gCell = (lat, lon) => clampJ(Math.floor(((sf.north - lat) / sf.dLat) * gH)) * gW + wrapI(Math.floor((east(lon) / sf.dLon) * gW));
    const gLat = (j) => sf.north - ((j + 0.5) * sf.dLat) / gH, gLon = (i) => sf.west + ((i + 0.5) * sf.dLon) / gW;
    // detail is fractal: below a source cell of a few hundred metres it is much finer than below a world
    // map cell of 55 km (its height falls as the cell size to the 0.7)
    const ampS = sub ? clamp((gkm / 55.6) ** 0.7, 0.02, 1) : 1;
    // a source's lakes stay lakes (as hollows they may be shallower than a new one must be)
    const srcLake = sub && map.lake ? map.lake : null;

    // ── the world map's relief round each of its cells (highest less lowest of the 3 × 3) ──
    const rel = new Float32Array(gW * gH);
    for (let j = 0; j < gH; j++) for (let i = 0; i < gW; i++) {
      let lo = Infinity, hi = -Infinity;
      // (on land, of the land only: a coast beside a deep sea is not rugged for that)
      const land = gz[j * gW + i] > 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { let v = gz[clampJ(j + dj) * gW + wrapI(i + di)]; if (land) v = Math.max(0, v); if (v < lo) lo = v; if (v > hi) hi = v; }
      rel[j * gW + i] = land ? hi - lo : Math.min(hi - lo, 1500);
    }

    // ── 1. the heights: the world map's, bicubic, plus detail finer than one of its cells ──
    const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
    const base = new Float32Array(N), relief = new Float32Array(N);
    const xyz = new Float32Array(N * 3);
    for (let y = 0; y < H; y++) {
      const la = latOf(y), fj = gfj(la), j0 = Math.floor(fj), tj = fj - j0, cl = Math.cos(la * D2R), sl = Math.sin(la * D2R);
      for (let x = 0; x < W; x++) {
        const lo = lonOf(x), fi = gfi(lo), i0 = Math.floor(fi), ti = fi - i0, k = y * W + x;
        const row = (jj) => { const r = clampJ(jj) * gW; return cr(gz[r + wrapI(i0 - 1)], gz[r + wrapI(i0)], gz[r + wrapI(i0 + 1)], gz[r + wrapI(i0 + 2)], ti); };
        base[k] = cr(row(j0 - 1), row(j0), row(j0 + 1), row(j0 + 2), tj);
        const r0 = clampJ(j0) * gW, r1 = clampJ(j0 + 1) * gW;
        relief[k] = (rel[r0 + wrapI(i0)] * (1 - ti) + rel[r0 + wrapI(i0 + 1)] * ti) * (1 - tj) + (rel[r1 + wrapI(i0)] * (1 - ti) + rel[r1 + wrapI(i0 + 1)] * ti) * tj;
        xyz[k * 3] = R * cl * Math.cos(lo * D2R); xyz[k * 3 + 1] = R * cl * Math.sin(lo * D2R); xyz[k * 3 + 2] = R * sl;
      }
    }
    // octaves from a world map cell down to two pixels (each half the last, as land is: fractal)
    const n1 = gradNoise(seed ^ 0x5e61), n2 = gradNoise(seed ^ 0x2b07), nw = gradNoise(seed ^ 0x77a1);
    const top = Math.min(gkm, 0.5 * fr.span), oct = clamp(Math.floor(Math.log2(top / (2 * pxKm))) + 1, 1, 10);
    const z = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      const b = base[k], bm = b * f, X = xyz[k * 3], Y = xyz[k * 3 + 1], Z = xyz[k * 3 + 2];
      // a little warp, so the detail does not line up
      const wq = 0.35 * top, wx = wq * nw(X / top, Y / top, Z / top), wy = wq * nw(Y / top + 31.7, Z / top, X / top);
      let s = 0, r = 0, c = 0, a = 1, ac = 1, lam = top;
      for (let o = 0; o < oct; o++, a *= 0.5, ac *= 0.66, lam *= 0.5) {
        const px = (X + wx) / lam, py = (Y + wy) / lam, pz = Z / lam, n = n1(px, py, pz);
        s += a * n;
        c += ac * n;                                // (rougher at small scales: for the shore)
        // ridged: sharp crests where |noise| is small, each octave weighted by the one above it
        const rr = 1 - Math.abs(n2(px + 5.3, py, pz)); r += a * (rr * rr - 0.42);
      }
      s *= 1.4; r *= 1.5;
      let amp, v;
      if (b > 0 || bm > -30) {
        // land (and the shore): more where it is high and rugged; ridged in mountains
        const mtn = smooth((bm - 700) / 1600) * smooth((relief[k] * f - 300) / 1200 + 0.3);
        amp = (ampS * (14 + 0.11 * Math.max(0, bm) + 0.22 * relief[k] * f)) / f;
        // the shore: low land and shallow sea break up into bays, spits and islets
        const shore = Math.exp(-Math.abs(bm) / (60 * Math.sqrt(ampS)));
        v = (1 - mtn) * s + mtn * (0.35 * s + 1.1 * r);
        v = (amp * v + ((30 * ampS) / f) * shore * c) / amp;
      } else {
        amp = (ampS * (6 + 0.04 * -bm + 0.12 * relief[k] * f)) / f;
        v = (amp * s + ((30 * ampS) / f) * Math.exp(bm / (60 * Math.sqrt(ampS))) * c) / amp;
      }
      z[k] = b + amp * detailX * v;
      // what was land on the source stays above the sea unless right at the shore, and the reverse
      if (b > (40 * ampS) / f && z[k] <= 0) z[k] = Math.min(b, 2 * ampS + Math.abs(z[k]) * 0.1);
      else if (b < (-60 * ampS) / f && z[k] > 0) z[k] = Math.max(b, -2 * ampS - z[k] * 0.1);
    }

    // ── pixel geometry ──
    const dxKm = new Float32Array(H);
    for (let y = 0; y < H; y++) dxKm[y] = fr.dLon * kmDeg * Math.cos(latOf(y) * D2R) / W;
    const dyKm = fr.dLat * kmDeg / H, areaOf = (k) => dxKm[(k / W) | 0] * dyKm;
    const DI = [-1, 0, 1, -1, 1, -1, 0, 1], DJ = [-1, -1, -1, 0, 0, 1, 1, 1];

    // sea narrower than a few pixels (a world map estuary, drawn finer than it can be) is the river's
    // floor, just above the sea: an opening of the sea (shrink it, then grow it back) by two pixels
    {
      const sea = Uint8Array.from(z, (v) => (v <= 0 ? 1 : 0));
      const morph = (src, keep) => {                       // keep 1: erode (all 8 neighbours sea); 0: dilate
        const out = new Uint8Array(N);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const k = y * W + x;
          let v = src[k];
          for (let q = 0; q < 8; q++) {
            const yy = y + DJ[q], xx = x + DI[q];
            if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
            const n = src[yy * W + xx];
            if (keep && !n) { v = 0; break; }
            if (!keep && n) { v = 1; break; }
          }
          out[k] = v;
        }
        return out;
      };
      const open = morph(morph(morph(morph(sea, 1), 1), 0), 0);
      for (let k = 0; k < N; k++) if (sea[k] && !open[k] && z[k] > -40 / f) z[k] = 1 + 0.02 * Math.min(50, -z[k]);
    }

    // the sea comes in only from the sea: ground below sea level that no water reaches from where the
    // world map has sea is a dry hollow (a lake, if enough water gathers in it), not an inland sea
    {
      const wet = new Uint8Array(N), st = [];
      for (let k = 0; k < N; k++) if (z[k] <= 0 && base[k] <= 0) { wet[k] = 1; st.push(k); }
      while (st.length) {
        const c = st.pop(), y = (c / W) | 0, x = c - y * W;
        for (let q = 0; q < 8; q++) {
          const yy = y + DJ[q], xx = x + DI[q];
          if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
          const n = yy * W + xx;
          if (!wet[n] && z[n] <= 0) { wet[n] = 1; st.push(n); }
        }
      }
      for (let k = 0; k < N; k++) if (z[k] <= 0 && !wet[k]) z[k] = 1 + 0.15 * Math.min(60, -z[k]);
    }
    const distKm = (y, q) => (DI[q] && DJ[q] ? Math.hypot(dxKm[y], dyKm) : DI[q] ? dxKm[y] : dyKm);

    // ── the window's edges: water leaves where the world map's drainage leaves the window ──
    const inBox = (la, lo) => { let d = lo - fr.west; d = ((d % 360) + 360) % 360; return la <= fr.north && la >= fr.south && d <= fr.dLon; };
    const grecv = sub ? map.recv : map.rivers && map.rivers.recv, gq = sub ? map.flow : map.rivers && map.rivers.discharge;
    const edge = new Uint8Array(N);
    for (let x = 0; x < W; x++) { edge[x] = 1; edge[(H - 1) * W + x] = 1; }
    for (let y = 0; y < H; y++) { edge[y * W] = 1; edge[y * W + W - 1] = 1; }
    const outlet = new Uint8Array(N);
    for (let k = 0; k < N; k++) {
      if (!edge[k]) continue;
      const y = (k / W) | 0, x = k - y * W, c = gCell(latOf(y), lonOf(x));
      const r = grecv ? grecv[c] : -1;
      outlet[k] = r >= 0 && inBox(gLat((r / gW) | 0), gLon(r % gW)) ? 0 : 1;
    }
    // rivers coming in: world map cells just outside whose water goes to a cell inside
    const inflows = [];
    if (grecv && gq) {
      const pad = 2;
      const j0 = clampJ(Math.floor(gfj(fr.north)) - pad), j1 = clampJ(Math.ceil(gfj(fr.south)) + pad);
      const i0 = Math.floor(gfi(fr.west)) - pad, i1 = Math.ceil(gfi(fr.east)) + pad;
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        if (sub && (ii < 0 || ii >= gW)) continue;
        const c = j * gW + wrapI(ii), r = grecv[c];
        if (r < 0 || gz[c] <= 0 || !(gq[c] > 0) || inBox(gLat(j), gLon(wrapI(ii)))) continue;
        const rl = gLat((r / gW) | 0), ro = gLon(r % gW);
        if (!inBox(rl, ro)) continue;
        // where the line from it to its receiver enters the window
        let la = gLat(j), lo = gLon(wrapI(ii)), dl = ro - lo; dl -= 360 * Math.round(dl / 360);
        let tIn = 0;
        for (let s = 0; s <= 40; s++) { const t = s / 40; if (inBox(la + (rl - la) * t, lo + dl * t)) { tIn = t; break; } }
        la += (rl - la) * tIn; lo += dl * tIn;
        let px = clamp(Math.floor(((((lo - fr.west) % 360) + 360) % 360) / fr.dLon * W), 0, W - 1), py = clamp(Math.floor(((fr.north - la) / fr.dLat) * H), 0, H - 1);
        px = clamp(px, 1, W - 2); py = clamp(py, 1, H - 2);
        inflows.push({ k: py * W + px, q: gq[c], from: c });
      }
      // the edge beside an inflow is no way out (or the river would turn straight back)
      for (const fl of inflows) {
        const y = (fl.k / W) | 0, x = fl.k - y * W, rr = Math.max(4, Math.ceil((1.5 * gkm) / pxKm));
        for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) outlet[yy * W + xx] = 0; }
      }
    }

    // a closer map of a region follows its rivers as the region draws them (bends and all): along each
    // line the ground is lowered a few metres, more for a bigger river, to a level that only falls
    // downstream, so the water here takes the same course and does not wander off across a flat to the
    // nearest edge
    if (sub && map.rivers && map.rivers.length) {
      const mf = clamp((8 * fr.span) / 800, 0.2, 8);
      const toChild = (p) => { const lat = sf.north - (p[1] / gH) * sf.dLat, lon = sf.west + (p[0] / gW) * sf.dLon; return [((east(lon) - east(fr.west)) / fr.dLon) * W, ((fr.north - lat) / fr.dLat) * H]; };
      const zSrc = (p) => gz[clampJ(Math.floor(p[1])) * gW + wrapI(Math.floor(p[0]))];
      const near = (c) => c[0] > -0.1 * W && c[0] < 1.1 * W && c[1] > -0.1 * H && c[1] < 1.1 * H;
      for (const rv of map.rivers) {
        if (!rv.pts.some((p) => near(toChild(p)))) continue;
        let lv = Infinity, prev = null;
        for (let i = 0; i < rv.pts.length; i++) {
          const q = rv.q[i];
          if (!(q >= 2 * mf)) { prev = null; continue; }
          const c = toChild(rv.pts[i]), depth = ((1.5 + 1.5 * Math.log10(q / mf)) * Math.sqrt(ampS)) / f;
          lv = Math.min(lv, Math.max(0, zSrc(rv.pts[i])) - depth);
          if (prev && (near(c) || near(prev))) {
            const half = Math.max(0.6, (1.35 * Math.sqrt(q)) / 1000 / pxKm), rr = Math.ceil(half);
            const n = Math.max(1, Math.ceil(Math.hypot(c[0] - prev[0], c[1] - prev[1]) * 2));
            for (let t = 0; t <= n; t++) {
              const x = prev[0] + ((c[0] - prev[0]) * t) / n, y = prev[1] + ((c[1] - prev[1]) * t) / n;
              for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
                const xx = Math.floor(x + dx), yy = Math.floor(y + dy);
                if (xx < 0 || yy < 0 || xx >= W || yy >= H || dx * dx + dy * dy > half * half + 0.5) continue;
                const k = yy * W + xx;
                if (z[k] > 0 && lv < z[k]) z[k] = Math.max(0.3, lv);
              }
            }
          }
          prev = c;
        }
      }
    }

    // ── the climate on the pixels: the world map's (land cells only, bilinear), colder with height ──
    const wt = water || null, lapse = 6.5 * g, tropo = 11000 / Math.max(0.05, g);
    const runoff = new Float32Array(N), P = new Float32Array(N), PET = new Float32Array(N), Tw = new Float32Array(N), Tc = new Float32Array(N), Ta = new Float32Array(N), Pw = new Float32Array(N), zc = new Float32Array(N);
    const liquid = wt ? wt.liquid !== false : true;
    if (wt) {
      // (looked up a little off each pixel, by noise about a world map cell across: a climate that
      // changes from one of its cells to the next must not draw biome edges along the cells' sides)
      const cw = gradNoise(seed ^ 0xc11a), cs0 = gkm, cA = 0.7;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const k = y * W + x, X = xyz[k * 3] / cs0, Y = xyz[k * 3 + 1] / cs0, Z = xyz[k * 3 + 2] / cs0;
          const fj = gfj(latOf(y)) + cA * (cw(X, Y, Z) + 0.5 * cw(2 * X + 9.1, 2 * Y, 2 * Z)), j0 = Math.floor(fj), tj = fj - j0;
          const fi = gfi(lonOf(x)) + cA * (cw(Y + 4.4, Z, X) + 0.5 * cw(2 * Y, 2 * Z + 3.3, 2 * X)), i0 = Math.floor(fi), ti = fi - i0;
          const cs = [[clampJ(j0) * gW + wrapI(i0), (1 - ti) * (1 - tj)], [clampJ(j0) * gW + wrapI(i0 + 1), ti * (1 - tj)], [clampJ(j0 + 1) * gW + wrapI(i0), (1 - ti) * tj], [clampJ(j0 + 1) * gW + wrapI(i0 + 1), ti * tj]];
          let sw = 0;
          for (const [c, w] of cs) if (gz[c] > 0) sw += w;
          // (no land cell near: the nearest land cell's climate, found below)
          if (sw <= 0) { zc[k] = NaN; continue; }
          let ru = 0, p = 0, pe = 0, tw = 0, tc = 0, ta = 0, pw = 0, zz = 0;
          for (const [c, w0] of cs) {
            if (!(gz[c] > 0)) continue;
            const w = w0 / sw;
            ru += w * wt.runoff[c]; p += w * wt.P[c]; pe += w * wt.PET[c]; tw += w * wt.Tw[c]; tc += w * wt.Tc[c]; ta += w * wt.Ta[c]; pw += w * wt.Pw[c]; zz += w * gz[c];
          }
          runoff[k] = ru; P[k] = p; PET[k] = pe; Tw[k] = tw; Tc[k] = tc; Ta[k] = ta; Pw[k] = pw; zc[k] = zz;
        }
      }
      // pixels with no land cell around them (an islet off the world map's coast): the climate of the
      // nearest pixel that has one, spreading out from them all at once (breadth first)
      const q = new Int32Array(N);
      let qh = 0, qt = 0;
      for (let k = 0; k < N; k++) if (!Number.isNaN(zc[k])) q[qt++] = k;
      if (!qt) zc.fill(0);
      while (qh < qt) {
        const c = q[qh++], y = (c / W) | 0, x = c - y * W;
        for (let s2 = 0; s2 < 8; s2++) {
          const yy = y + DJ[s2], xx = x + DI[s2];
          if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
          const n = yy * W + xx;
          if (!Number.isNaN(zc[n])) continue;
          runoff[n] = runoff[c]; P[n] = P[c]; PET[n] = PET[c]; Tw[n] = Tw[c]; Tc[n] = Tc[c]; Ta[n] = Ta[c]; Pw[n] = Pw[c]; zc[n] = zc[c];
          q[qt++] = n;
        }
      }
    } else {
      for (let k = 0; k < N; k++) { runoff[k] = 300; P[k] = 800; PET[k] = 700; Tw[k] = 20; Tc[k] = 5; Ta[k] = 12; Pw[k] = 400; zc[k] = Math.max(0, base[k]); }
    }
    // runoff over ice (summers below freezing at this height) does not flow; nor where water cannot be liquid
    const warm = (k) => Tw[k] - (lapse * (Math.min(z[k], tropo) - Math.min(zc[k], tropo))) / 1000;
    const toM3s = (mm, km2) => ((mm / 1000) * km2 * 1e6) / YEAR_S;

    // ── 2. where the water goes: flood the land up from the sea and the open edges ──
    // water is routed over the land plus a faint unevenness (a few metres at most, in lumps a few pixels
    // across and some five times larger): on a flat (a silted floor, a filled hollow) it then wanders as
    // real water does, rather than running off in ruler-straight lines; on a slope it makes no difference
    const silt = new Uint8Array(N), nf = gradNoise(seed ^ 0xf1a7), lumpKm = 4 * pxKm, LUMP = (1.5 * Math.max(0.2, Math.sqrt(ampS))) / f;
    const lump = (k) => { const X = xyz[k * 3] / lumpKm, Y = xyz[k * 3 + 1] / lumpKm, Z = xyz[k * 3 + 2] / lumpKm; return clamp(1.6 + 0.6 * nf(X, Y, Z) + nf(X / 5 + 7.7, Y / 5, Z / 5), 0, 3.2); };
    const routeZ = (zz) => Float32Array.from(zz, (v, k) => (v > 0 ? v + LUMP * lump(k) : v));
    function flood(zz0) {
      const zz = routeZ(zz0);
      const fill = new Float64Array(N), recv = new Int32Array(N).fill(-1), done = new Uint8Array(N), order = new Int32Array(N);
      const q = heap(fill, N);
      let no = 0;
      for (let k = 0; k < N; k++) {
        if (zz[k] <= 0) {
          done[k] = 1; fill[k] = zz[k];
          const y = (k / W) | 0, x = k - y * W;
          let coast = false;
          for (let s = 0; s < 8 && !coast; s++) { const yy = y + DJ[s], xx = x + DI[s]; if (yy >= 0 && yy < H && xx >= 0 && xx < W && zz[yy * W + xx] > 0) coast = true; }
          if (coast) { fill[k] = 0; q.push(k); }
        } else if (outlet[k]) { done[k] = 1; fill[k] = zz[k]; q.push(k); }
      }
      if (!q.size) {                                                  // no way out at all: the lowest edge
        let lo = -1; for (let k = 0; k < N; k++) if (edge[k] && (lo < 0 || zz[k] < zz[lo])) lo = k;
        done[lo] = 1; fill[lo] = zz[lo]; q.push(lo);
      }
      while (q.size) {
        const c = q.pop();
        if (zz[c] > 0) order[no++] = c;
        const y = (c / W) | 0, x = c - y * W;
        for (let s = 0; s < 8; s++) {
          const yy = y + DJ[s], xx = x + DI[s];
          if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
          const n = yy * W + xx;
          if (done[n]) continue;
          done[n] = 1; fill[n] = Math.max(zz[n], fill[c] + 1e-4); recv[n] = c; q.push(n);
        }
      }
      return { fill, recv, order, no, zr: zz };
    }
    /* Hollows: connected pixels the flood had to fill (by more than `min` metres). */
    function hollows(zz, fill, min) {
      const id = new Int32Array(N).fill(-1), list = [];
      for (let k = 0; k < N; k++) {
        if (id[k] >= 0 || !(zz[k] > 0) || fill[k] - zz[k] <= min) continue;
        const me = list.length, cells = [k]; id[k] = me;
        let depth = 0, area = 0;
        for (let s = 0; s < cells.length; s++) {
          const c = cells[s], y = (c / W) | 0, x = c - y * W;
          depth = Math.max(depth, fill[c] - zz[c]); area += areaOf(c);
          for (let q = 0; q < 8; q++) {
            const yy = y + DJ[q], xx = x + DI[q];
            if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
            const n = yy * W + xx;
            if (id[n] < 0 && zz[n] > 0 && fill[n] - zz[n] > min) { id[n] = me; cells.push(n); }
          }
        }
        list.push({ cells, depth, area });
      }
      return { id, list };
    }
    /* The water through each pixel (m³/s), upstream first; inflows from outside added where they enter. */
    const src = new Float64Array(N);
    for (let k = 0; k < N; k++) if (z[k] > 0 && liquid && warm(k) >= 0) src[k] = toM3s(runoff[k], areaOf(k));
    for (const fl of inflows) src[fl.k] += fl.q;

    let fl1 = flood(z);
    // shallow or small hollows are silted up: their floors are made level with their rims (a flat), so
    // the detail's dimples do not all become ponds; deep and large ones stay, to be lakes
    {
      // (in rugged country a hollow must be deeper to be more than the detail's: a tenth of the relief)
      const hs = hollows(fl1.zr, fl1.fill, 0.05);
      const bigEnough = Math.max(25 * ampS * ampS, 12 * pxKm * pxKm);
      let filled = 0;
      for (const hlw of hs.list) {
        let rl = 0; for (const c of hlw.cells) rl = Math.max(rl, relief[c]);
        let wasLake = false;
        if (srcLake) for (const c of hlw.cells) { const y = (c / W) | 0; if (srcLake[gCell(latOf(y), lonOf(c - y * W))]) { wasLake = true; break; } }
        if (!wasLake && (hlw.depth < (30 * Math.sqrt(ampS)) / f + 0.1 * rl || hlw.area < bigEnough)) { for (const c of hlw.cells) { z[c] = fl1.fill[c]; silt[c] = 1; } filled++; }
      }
      if (filled) fl1 = flood(z);
    }
    const Q = Float64Array.from(src);
    for (let o = fl1.no - 1; o >= 0; o--) { const k = fl1.order[o], r = fl1.recv[k]; if (r >= 0 && z[r] > 0) Q[r] += Q[k]; }

    // ── 3. the valleys: each pixel cut towards its river's graded profile, the more water the closer ──
    const z0 = Float32Array.from(z);
    if (E > 0 && liquid) {
      const K = 0.08 * E * Math.sqrt(g);
      for (let o = 0; o < fl1.no; o++) {
        const k = fl1.order[o], r = fl1.recv[k];
        if (r < 0) continue;
        // (a river grades to the water it flows into: a lake's surface, not its bed)
        const hr = z[r] > 0 ? Math.max(z[r], fl1.fill[r]) : 0;
        if (hr >= z[k]) continue;                                    // a hollow: left alone
        const y = (k / W) | 0, ry = (r / W) | 0, dk = Math.hypot((k - y * W - (r - ry * W)) * dxKm[y], (y - ry) * dyKm) * 1000;
        // the graded slope: steep for a brook, gentle for a big river (m per m); weaker gravity, steeper
        const qq = Math.max(1e-3, Q[k]), slope = clamp(0.02 * Math.pow(qq, -0.6) / f, 4e-5, 0.15);
        const target = hr + slope * dk;
        if (z[k] <= target) continue;
        const F = K * Math.sqrt(qq);
        z[k] = target + (z[k] - target) * Math.exp(-F);
      }
      // valley sides slump to a stable slope (steeper under weak gravity), lowering only
      const tanMax = 0.6 / Math.sqrt(f);
      for (let pass = 0; pass < 6; pass++) {
        let moved = 0;
        for (let k = 0; k < N; k++) {
          if (!(z[k] > 0)) continue;
          const y = (k / W) | 0, x = k - y * W;
          let lim = z[k];
          for (let q = 0; q < 8; q++) {
            const yy = y + DJ[q], xx = x + DI[q];
            if (yy < 0 || yy >= H || xx < 0 || xx >= W) continue;
            const n = yy * W + xx, m = Math.max(0, z[n]) + tanMax * distKm(y, q) * 1000;
            if (m < lim) lim = m;
          }
          if (lim < z[k] - 0.01) { z[k] = Math.max(lim, Math.min(z[k], 1)); moved++; }
        }
        if (!moved) break;
      }
    }
    const cut = new Float32Array(N);
    let eroded = 0, deepest = 0;
    for (let k = 0; k < N; k++) { cut[k] = Math.max(0, z0[k] - z[k]); eroded += (cut[k] * areaOf(k)) / 1000; if (cut[k] > deepest) deepest = cut[k]; }

    // ── 4. the water again over the carved land: lakes, salt lakes and rivers ──
    const fl = flood(z), recv = fl.recv;
    // (a lake must be deeper than the unevenness the water was routed over: no ponds in every dimple)
    const hs = hollows(fl.zr, fl.fill, 1 / f + 3.2 * LUMP);
    const minLake = 4 * pxKm * pxKm;
    // (a hollow under the ice holds no lake: most of it below freezing all summer)
    for (const hlw of hs.list) {
      let iced = 0; for (const c of hlw.cells) if (warm(c) < 0) iced++;
      if (hlw.area < minLake || iced > hlw.cells.length / 2) { hlw.gone = true; for (const c of hlw.cells) hs.id[c] = -1; }
    }
    const flow = Float64Array.from(src), lakeLoss = new Float64Array(hs.list.length), terminal = new Uint8Array(N), lake = new Uint8Array(N), up = new Int32Array(N).fill(1);
    hs.list.forEach((hlw, i) => { if (hlw.gone) return; let e = 0; for (const c of hlw.cells) e += toM3s(Math.max(0, 1.2 * PET[c] - P[c]), areaOf(c)); lakeLoss[i] = liquid ? e : 0; });
    for (let o = fl.no - 1; o >= 0; o--) {
      const k = fl.order[o], r = recv[k], id = hs.id[k];
      if (id >= 0 && (r < 0 || hs.id[r] !== id)) {
        // a lake's outlet: what reaches the lake, less what it evaporates
        if (flow[k] <= 0) { hs.list[id].gone = true; terminal[k] = 1; continue; }
        // a small hollow on a big river's course is filled with what the river carries: no lake
        if (hs.list[id].area < 30 * pxKm * pxKm && flow[k] > 20 * (opts.minFlow ?? 8)) { hs.list[id].gone = true; if (r >= 0 && z[r] > 0) { flow[r] += flow[k]; up[r] += up[k]; } continue; }
        const out = flow[k] - lakeLoss[id];
        if (out <= 0) { terminal[k] = 1; hs.list[id].salt = true; hs.list[id].share = lakeLoss[id] > 0 ? flow[k] / lakeLoss[id] : 0; continue; }
        flow[k] = out;
      }
      if (r >= 0 && z[r] > 0) { flow[r] += flow[k]; up[r] += up[k]; }
    }
    let lakes = 0, saltLakes = 0, lakeKm2 = 0;
    for (const hlw of hs.list) {
      if (hlw.gone) continue;
      lakes++;
      if (!hlw.salt) { for (const c of hlw.cells) { lake[c] = 1; lakeKm2 += areaOf(c); } continue; }
      saltLakes++;
      const sorted = hlw.cells.slice().sort((a, b) => z[a] - z[b]), want = hlw.area * clamp(hlw.share ?? 0, 0, 1);
      let a = 0;
      for (const c of sorted) { if (a >= want) break; lake[c] = 2; a += areaOf(c); lakeKm2 += areaOf(c); }
    }

    // ── 5. biomes: the climate at each pixel's own height ──
    const biome = new Uint8Array(N), tBoil = wt ? wt.tBoil ?? 100 : 100;
    const nb = gradNoise(seed ^ 0xb10e);
    // the climate at each pixel's own height (kept: a closer map of this one starts from it)
    const cTw = Float32Array.from(Tw), cTc = Float32Array.from(Tc), cTa = Float32Array.from(Ta), cPET = Float32Array.from(PET);
    for (let k = 0; k < N; k++) {
      if (!(z[k] > 0)) continue;
      const dT = (-lapse * (Math.min(z[k], tropo) - Math.min(zc[k], tropo))) / 1000 + (sub ? 0 : 0.6 * nb(xyz[k * 3] / 40, xyz[k * 3 + 1] / 40, xyz[k * 3 + 2] / 40));
      cTw[k] = Tw[k] + dT; cTc[k] = Tc[k] + dT; cTa[k] = Ta[k] + dT;
      // (evaporation follows the temperature down the mountain, roughly)
      cPET[k] = PET[k] * clamp(1 + dT / 30, 0.2, 1.5);
      if (lake[k]) continue;
      biome[k] = B.classify(cTw[k], cTc[k], cTa[k], P[k], cPET[k], Pw[k], liquid, tBoil);
    }
    // wetlands: big rivers over low, flat, wet ground, and the shores of fresh lakes
    const BI = B.BI, dry = new Set([BI.ice, BI.barren, BI.hotdesert, BI.colddesert]);
    for (let k = 0; k < N; k++) {
      if (!biome[k] || dry.has(biome[k])) continue;
      const r = recv[k], wetness = P[k] / Math.max(1, PET[k]);
      const flat = r >= 0 && Math.abs(z[k] - Math.max(0, z[r])) < 0.4 * pxKm;
      if (z[k] < 150 / f && flat && flow[k] > 300 && wetness > 0.6) { biome[k] = BI.wetland; continue; }
      if (wetness > 0.9 && z[k] < 600 / f) {
        const y = (k / W) | 0, x = k - y * W;
        let shore = false;
        for (let q = 0; q < 8 && !shore; q++) { const yy = y + DJ[q], xx = x + DI[q]; if (yy >= 0 && yy < H && xx >= 0 && xx < W && lake[yy * W + xx] === 1) shore = true; }
        if (shore) biome[k] = BI.wetland;
      }
    }

    // ── 6. rivers as lines, in pixels: from each source down to the sea, a lake, an edge, or a bigger river ──
    // a river once it drains enough land for the region's scale (spaced some tens of pixels apart: not
    // a line down every gully), or once it carries a lot of water (one entering from outside)
    const minFlow = opts.minFlow ?? clamp((8 * fr.span) / 800, 0.2, 8), minArea = opts.minArea ?? Math.max(25, (fr.span / 55) ** 2), minUp = Math.max(12, Math.round(minArea / (pxKm * pxKm)));
    const hid = (k) => lake[k] || biome[k] === BI.ice;
    const isRiver = (k) => z[k] > 0 && flow[k] >= minFlow && (up[k] >= minUp || flow[k] >= 30 * minFlow) && !hid(k);
    const kids = new Uint8Array(N);
    for (let k = 0; k < N; k++) if (isRiver(k) && recv[k] >= 0) kids[recv[k]]++;
    const jit = (k) => { let x = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b); x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16; return [((x & 0xffff) / 0xffff - 0.5) * 0.7, (((x >>> 16) & 0xffff) / 0xffff - 0.5) * 0.7]; };
    const pt = (k) => { const y = (k / W) | 0, x = k - y * W, [a, b] = jit(k); return [x + 0.5 + a, y + 0.5 + b]; };
    // a river's own sources: where nothing that is a river flows in, and where an inflow enters
    const starts = [];
    for (let k = 0; k < N; k++) if (isRiver(k) && !kids[k]) starts.push(k);
    for (const fl0 of inflows) if (isRiver(fl0.k) && !starts.includes(fl0.k)) starts.push(fl0.k);
    starts.sort((a, b) => flow[b] - flow[a]);
    // each line follows a river down for as long as it is the main stem (the branch with the most water
    // at each confluence); a smaller branch ends where it joins, so a main river is one unbroken line
    const mainKid = new Int32Array(N).fill(-1);
    for (let k = 0; k < N; k++) {
      if (!isRiver(k)) continue;
      const r = recv[k];
      if (r >= 0 && (mainKid[r] < 0 || flow[k] > flow[mainKid[r]])) mainKid[r] = k;
    }
    const seen = new Uint8Array(N), raw = [];
    for (const s of starts) {
      if (seen[s]) continue;
      let cur = s, line = [], qs = [], ks = [];
      const flush = (join = false) => { if (line.length > 1) raw.push({ pts: line, q: qs, k: ks, join }); line = []; qs = []; ks = []; };
      let join = false;
      while (cur >= 0) {
        if (hid(cur)) { if (line.length) { line.push(pt(cur)); qs.push(flow[cur]); ks.push(cur); } flush(); }
        else { line.push(pt(cur)); qs.push(flow[cur]); ks.push(cur); }
        if (seen[cur] && line.length > 1) { join = true; break; }
        seen[cur] = 1;
        if (terminal[cur]) break;
        const r = recv[cur];
        if (r < 0 || !(z[r] > 0)) { if (r >= 0) { const y = (r / W) | 0; line.push([r - y * W + 0.5, y + 0.5]); qs.push(flow[cur]); ks.push(cur); } break; }
        // leaving a lake or the ice: start again from its edge, unless that outlet is already drawn
        // (every stream into a lake would otherwise add a stub over its outlet)
        if (hid(cur) && !hid(r)) { if (seen[r]) break; line = [pt(cur)]; qs = [flow[cur]]; ks = [cur]; }
        // a tributary: it ends on the main stem (the point where they meet), which is its own line
        else if (!hid(r) && isRiver(cur) && mainKid[r] >= 0 && mainKid[r] !== cur) { line.push(pt(r)); qs.push(flow[cur]); ks.push(r); join = true; break; }
        cur = r;
      }
      flush(join);
    }
    // the main stems not yet drawn (fed only by tributaries' ends, or from a lake): from their own heads
    for (let k = 0; k < N; k++) {
      if (seen[k] || !isRiver(k)) continue;
      let up = k; while (mainKid[up] >= 0 && !seen[mainKid[up]] && !hid(mainKid[up])) up = mainKid[up];
      if (seen[up]) continue;
      let cur = up; const line = [], qs = [], ks = [];
      let join = false;
      while (cur >= 0 && !hid(cur)) {
        line.push(pt(cur)); qs.push(flow[cur]); ks.push(cur);
        if (seen[cur] && line.length > 1) { join = true; break; }
        seen[cur] = 1;
        if (terminal[cur]) break;
        const r = recv[cur];
        if (r < 0 || !(z[r] > 0)) { if (r >= 0) { const y = (r / W) | 0; line.push([r - y * W + 0.5, y + 0.5]); qs.push(flow[cur]); ks.push(cur); } break; }
        if (!hid(r) && mainKid[r] >= 0 && mainKid[r] !== cur) { line.push(pt(r)); qs.push(flow[cur]); ks.push(r); join = true; break; }
        cur = r;
      }
      if (line.length > 1) raw.push({ pts: line, q: qs, k: ks, join });
    }
    // short stubs (a little coastal stream, a tributary that joins at once) are left out unless they
    // carry real water; the rest are smoothed beyond the grid's 45° steps, then rounded off
    const minLen = Math.max(6, Math.round(12 / Math.sqrt(Math.max(0.05, pxKm))));
    const kept = raw.filter((rv) => rv.pts.length >= minLen || rv.q[rv.q.length - 1] >= 30 * minFlow);
    // the river's own slope along it (m per m, over a few pixels either side), for its meanders
    for (const rv of kept) {
      const n = rv.k.length, sl = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = Math.max(0, i - 4), b = Math.min(n - 1, i + 4);
        let d = 0; for (let j = a; j < b; j++) d += Math.hypot(rv.pts[j + 1][0] - rv.pts[j][0], rv.pts[j + 1][1] - rv.pts[j][1]);
        sl[i] = d > 0 ? Math.max(0, Math.max(0, z[rv.k[a]]) - Math.max(0, z[rv.k[b]])) / (d * pxKm * 1000) : 1;
      }
      rv.slope = Array.from(sl);
    }
    const smoothRivers = kept.map((rv) => { const pts = chaikin(chaikin(relax(relax(relax(relax(relax(rv.pts))))))); return { pts, q: resample(rv.q, pts.length), slope: resample(rv.slope, pts.length), level: resample(rv.k.map((k) => Math.max(0, z[k])), pts.length), join: rv.join }; });
    // (the ground under a point, for where a river may wander: its floodplain, not over the hills)
    const zAt = (x, y) => z[clamp(Math.floor(y), 0, H - 1) * W + clamp(Math.floor(x), 0, W - 1)];
    const mm = meanders(smoothRivers, { pxKm, minFlow, seed, gravityFactor: f, zAt, bank: 20 / f, off: opts.meanders === false }), rivers = mm.rivers, oxbows = mm.oxbows;

    // ── figures ──
    let landPx = 0, hiZ = -Infinity, loZ = Infinity, hiK = 0, loK = 0, landKm2 = 0, bigQ = 0, bigK = -1;
    const share = new Float64Array(B.BIOMES.length + 1);
    for (let k = 0; k < N; k++) {
      if (z[k] > hiZ) { hiZ = z[k]; hiK = k; } if (z[k] < loZ) { loZ = z[k]; loK = k; }
      if (z[k] > 0) { landPx++; landKm2 += areaOf(k); share[biome[k]] += areaOf(k); if (flow[k] > bigQ && (recv[k] < 0 || !(z[recv[k]] > 0) || edge[k])) { bigQ = flow[k]; bigK = k; } }
    }
    const ll = (k) => { const y = (k / W) | 0; return [latOf(y), ((lonOf(k - y * W) + 540) % 360) - 180]; };
    return {
      frame: fr, W, H, z, flow: Float32Array.from(flow), recv, lake, biome, rivers, oxbows, cut, inflows: inflows.map((x) => ({ at: ll(x.k), q: x.q })), minFlow,
      climate: { Tw: cTw, Tc: cTc, P },
      water: { runoff, P, PET: cPET, Tw: cTw, Tc: cTc, Ta: cTa, Pw, liquid, tBoil }, planet,
      stats: {
        land: landPx / N, landKm2, highest: { m: hiZ, at: ll(hiK) }, deepest: { m: loZ, at: ll(loK) }, lakes, saltLakes, lakeKm2,
        eroded, deepestCut: deepest, biggest: bigK >= 0 ? { q: bigQ, at: ll(bigK) } : null, rivers: rivers.length, minArea,
        biomeShare: Array.from(share.slice(1), (v) => v / Math.max(1, landKm2)), pxKm, worldCellKm: gkm,
      },
    };
  }

  /*
   * The drawn width of a river (pixels, before any zoom): a hairline for a brook, growing slowly with
   * its flow. Shared with the page, so meanders can be sized to the line that draws them.
   */
  const riverWidth = (q, minFlow = 8) => Math.min(2, 0.45 + 0.28 * Math.log10(1 + q / minFlow));

  /*
   * Meanders: on flat ground a river does not run down its valley's middle but swings from side to side
   * in loops. Its path follows the Kinoshita curve (Kinoshita 1961; Parker et al. 1983), the direction
   * θ = θ0·sin φ + θ0³·(Js·cos 3φ − Jf·sin 3φ) as the phase φ runs along the channel: skewed, overhanging
   * bends, not a sine. How far it swings (θ0, up to ~77°, for a sinuosity of about 2) grows as the slope falls (none above about
   * 0.2 %, fully below 0.02 %) and with the river's size (a brook barely), and varies from bend to bend, as
   * does each bend's length; the whole meander belt wanders slowly across the floodplain. A bend is about 11 channel widths long
   * (width ≈ 2.7·√Q m, Leopold & Wolman), but never shorter than about 12 widths of the line drawn,
   * or it would only thicken the line (on most maps a river is drawn far wider than it is). The
   * bends ease off towards each end, so the river still leaves its lake and reaches its mouth where it
   * did; a tributary is joined to the main river's bends where it meets it.
   * rivers: [{pts, q, slope, join}] in pixels; o: pxKm, minFlow, seed, gravityFactor, off.
   */
  function meanders(rivers, o) {
    if (o.off) return { rivers: rivers.map(({ pts, q }) => ({ pts, q })), oxbows: [] };
    const nz = gradNoise((o.seed ^ 0x3e4d) | 0), out = [], oxbows = [];
    // (the largest rivers first: the simulation's work is shared out, some 2.5 million point-steps)
    let budget = o.budget ?? 2.5e6;
    const order = rivers.map((rv, i) => [i, rv.q.reduce((a, b) => Math.max(a, b), 0)]).sort((a, b) => b[1] - a[1]).map(([i]) => i);
    const done = new Array(rivers.length);
    for (const ri of order) {
      const rv = rivers[ri];
      let hasFlat0 = false; for (const sl of rv.slope) if (sl < 0.002) { hasFlat0 = true; break; }
      // the bends swing about the valley's axis: the line smoothed over about a bend's length, so that
      // a sharp turn of the valley does not fold the bends inside it over each other
      let P = rv.pts;
      if (hasFlat0) {
        const qMax = rv.q.reduce((a, b) => Math.max(a, b), 0), lamMax = Math.max((11 * 2.7 * Math.sqrt(qMax)) / 1000 / o.pxKm, 12 * riverWidth(qMax, o.minFlow));
        let arc = 0; for (let i = 1; i < P.length; i++) arc += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
        const step = Math.max(0.05, arc / Math.max(1, P.length - 1));
        const passes = clamp(Math.round((lamMax / step) ** 2 / 12), 0, 60);
        for (let i = 0; i < passes; i++) P = relax(P);
      }
      const n = P.length;
      // the centreline by arc length, for C(u) and its normal
      const L = new Float64Array(n);
      for (let i = 1; i < n; i++) L[i] = L[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]);
      const total = L[n - 1];
      let hasFlat = false; for (const sl of rv.slope) if (sl < 0.002) { hasFlat = true; break; }
      if (total < 4 || !hasFlat) { done[ri] = ({ pts: P, q: rv.q, join: rv.join }); continue; }
      const pos = (u) => {
        u = clamp(u, 0, total);
        let lo = 0, hi = n - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= u) lo = m; else hi = m; }
        const t = (u - L[lo]) / (L[hi] - L[lo] || 1);
        const lv = rv.level ? rv.level[lo] + (rv.level[hi] - rv.level[lo]) * t : 0;
        return { x: P[lo][0] + (P[hi][0] - P[lo][0]) * t, y: P[lo][1] + (P[hi][1] - P[lo][1]) * t, q: rv.q[lo] + (rv.q[hi] - rv.q[lo]) * t, s: rv.slope[lo] + (rv.slope[hi] - rv.slope[lo]) * t, level: lv };
      };
      /* The axis at u: its point, its normal (over a pixel or two either way), and how sharply it turns
         there (its radius, from the turn over about a bend's length w). */
      const at = (u, w = 8, light = false) => {
        const c0 = pos(u), d = Math.max(1, w / 6), a0 = pos(u - d), b0 = pos(u + d);
        const dx = b0.x - a0.x, dy = b0.y - a0.y, l = Math.hypot(dx, dy) || 1;
        if (light) return { x: c0.x, y: c0.y, nx: -dy / l, ny: dx / l, q: c0.q, s: c0.s, level: c0.level };
        // (the tightest of the turns over a bend, half a bend and a quarter: a hairpin shorter than a
        // bend must not be missed)
        let radius = 1e9;
        for (const ww of [w, w / 2, w / 4]) {
          if (ww < 2) continue;
          const pa = pos(u - ww / 2), pb = pos(u + ww / 2);
          let turn = Math.abs(Math.atan2(pb.y - c0.y, pb.x - c0.x) - Math.atan2(c0.y - pa.y, c0.x - pa.x));
          if (turn > Math.PI) turn = 2 * Math.PI - turn;
          if (turn > 1e-3) radius = Math.min(radius, ww / turn);
        }
        return { x: c0.x, y: c0.y, nx: -dy / l, ny: dx / l, radius, q: c0.q, s: c0.s };
      };
      // a real river on a flat floodplain: let it migrate (below); a brook: a Kinoshita train of bends
      const qTop = rv.q.reduce((a, b) => Math.max(a, b), 0);
      // (only where the channel is at least nearly as wide as the line that draws it: else its true
      // bends are finer than the map can show, and simulating them at the line's scale would make its
      // meander belt far too wide; a map at that scale shows them generalised, as Kinoshita bends)
      const trueToDrawn = (2.7 * Math.sqrt(qTop)) / 1000 / o.pxKm / riverWidth(qTop, o.minFlow);
      if (qTop >= 15 * o.minFlow && trueToDrawn >= 0.8 && budget > 0) {
        const m = migrate(P, L, total, pos, at, rv, o, ri, nz);
        if (m) { budget -= m.work; done[ri] = { pts: m.pts, q: m.q, join: rv.join }; oxbows.push(...m.oxbows); continue; }
      }
      const h = (ri * 2654435761) >>> 0, phase0 = ((h & 0xffff) / 0xffff) * 2 * Math.PI, skew = (h >>> 16) & 1 ? 1 : -1;
      const Js = skew / 32, Jf = 1 / 192;
      let u = 0, v = 0, phi = phase0;
      const pts = [], qs = [];
      let c = at(0);
      pts.push([c.x, c.y]); qs.push(c.q);
      for (let guard = 0; u < total && guard < 200000; guard++) {
        c = at(u);
        const wTrue = (2.7 * Math.sqrt(Math.max(0, c.q))) / 1000 / o.pxKm;             // channel width, pixels
        const lam0 = Math.max(11 * wTrue, 12 * riverWidth(c.q, o.minFlow));
        // no two bends alike: each a little longer or shorter (±40 %), swinging more or less
        const lam = lam0 * (0.6 + 0.8 * (0.5 + 0.5 * nz(phi / 6.283, ri * 1.7, 0.3)));
        const flat = smooth((Math.log10(0.002) - Math.log10(Math.max(1e-6, c.s))) / 1);  // 0 at 0.2 %, 1 at 0.02 %
        const big = smooth(Math.log10(Math.max(1, c.q / o.minFlow)) / 2);                // a brook barely, a river fully
        const ends = smooth(Math.min(u, total - u) / (0.8 * lam0));
        const swing = 0.35 + 0.65 * smooth(0.5 + 0.9 * nz(phi / 6.283 + 0.37, ri * 3.1, 5.5));
        // (kept below about 80°, skew included: past 90° a bend overhangs and, with the belt wandering,
        // can cross itself; a real loop that would is cut off and left as an oxbow)
        const theta0 = Math.min(1.35, 1.35 * flat * big * ends * swing);
        const ds = theta0 > 0.05 ? lam / 32 : 0.5;
        const th = theta0 * Math.sin(phi) + theta0 ** 3 * (Js * Math.cos(3 * phi) - Jf * Math.sin(3 * phi));
        u += Math.cos(th) * ds; v += Math.sin(th) * ds;
        // where it straightens (steeper, or near the ends), back towards the valley's middle
        // (and always a little, over a few bends: the bends' small asymmetries must not add up to a drift)
        v -= v * Math.min(1, ds / (0.6 * lam)) * (1 - Math.min(1, theta0 / 0.6)) + v * Math.min(1, ds / (4 * lam));
        phi += (2 * Math.PI * ds) / lam;
        if (u >= total) break;
        const p = at(u, lam0);
        // the meander belt itself wanders slowly across the floodplain, a few bends at a time
        let belt = v + 0.25 * lam0 * flat * big * ends * nz(u / (3 * lam0), ri * 0.9 + 11.3, 2.2);
        // (never more than most of the way to the centre of a turn of the axis: a soft limit, no kinks)
        const lim = 0.55 * p.radius; belt = lim * Math.tanh(belt / lim);
        pts.push([p.x + belt * p.nx, p.y + belt * p.ny]); qs.push(p.q);
      }
      c = at(total);
      pts.push([c.x, c.y]); qs.push(c.q);
      const cut = cutoffs(pts, qs);
      done[ri] = { pts: cut.pts, q: cut.q, join: rv.join };
      const wq = riverWidth(qTop, o.minFlow);
      for (const lp of cut.loops) { const t = trimOxbow(lp); if (t) oxbows.push({ pts: t, w: wq, wTrue: (2.7 * Math.sqrt(qTop)) / 1000 / o.pxKm }); }
    }
    out.push(...done);
    // join each tributary to the main river's bends: its end moved onto the nearest point of a larger
    // river's drawn line, the last stretch of it bent over to meet it
    const cell = 3, grid = new Map(), keyOf = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    out.forEach((rv, ri) => rv.pts.forEach((p, i) => { const k = keyOf(p[0], p[1]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push([ri, i]); }));
    for (let ri = 0; ri < out.length; ri++) {
      const rv = out[ri];
      if (!rv.join || rv.pts.length < 2) continue;
      const e = rv.pts[rv.pts.length - 1], qEnd = rv.q[rv.q.length - 1];
      let best = null, bd = Infinity;
      const cx = Math.floor(e[0] / cell), cy = Math.floor(e[1] / cell);
      for (let gy = cy - 4; gy <= cy + 4; gy++) for (let gx = cx - 4; gx <= cx + 4; gx++) {
        for (const [rj, j] of grid.get(`${gx},${gy}`) || []) {
          if (rj === ri || out[rj].q[j] < qEnd) continue;
          const p = out[rj].pts[j], d = Math.hypot(p[0] - e[0], p[1] - e[1]);
          if (d < bd) { bd = d; best = p; }
        }
      }
      if (!best || bd < 1e-3) continue;
      const dx = best[0] - e[0], dy = best[1] - e[1], reach = Math.max(3, 3 * bd);
      let acc = 0;
      for (let i = rv.pts.length - 1; i >= 0; i--) {
        if (i < rv.pts.length - 1) acc += Math.hypot(rv.pts[i + 1][0] - rv.pts[i][0], rv.pts[i + 1][1] - rv.pts[i][1]);
        const t = smooth(1 - acc / reach);
        if (t <= 0) break;
        rv.pts[i] = [rv.pts[i][0] + dx * t, rv.pts[i][1] + dy * t];
      }
    }
    return { rivers: out.map(({ pts, q }) => ({ pts, q })), oxbows };
  }

  /*
   * Neck cutoffs: where a river's line crosses itself (a bend grown round until its neck meets), the
   * loop is cut off at the crossing, as a river does it (leaving an oxbow lake, not drawn). Looks for
   * crossings within a few hundred points of each other.
   */
  function cutoffs(pts, qs) {
    const cross = (a, b, c, d) => {
      const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1], den = r0 * s1 - r1 * s0;
      if (Math.abs(den) < 1e-12) return null;
      const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den, u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den;
      return t > 0 && t < 1 && u > 0 && u < 1 ? [a[0] + t * r0, a[1] + t * r1] : null;
    };
    const P = [], Q = [], loops = [];
    for (let i = 0; i < pts.length; i++) {
      P.push(pts[i]); Q.push(qs[i]);
      const n = P.length;
      if (n < 4) continue;
      const a = P[n - 2], b = P[n - 1];
      for (let j = n - 4; j >= Math.max(0, n - 400); j--) {
        const x = cross(P[j], P[j + 1], a, b);
        if (x) { loops.push([x, ...P.slice(j + 1, n - 1), x]); P.length = j + 1; Q.length = j + 1; P.push(x, b); Q.push(Q[j], qs[i]); break; }
      }
    }
    return { pts: P, q: Q, loops };
  }

  /*
   * An oxbow lake from a cut-off loop: the loop without its two ends, which the river plugs with sand
   * as it leaves (a crescent, not a ring). Null if too little is left.
   */
  function trimOxbow(loop) {
    if (loop.length < 8) return null;
    const L = [0]; for (let i = 1; i < loop.length; i++) L.push(L[i - 1] + Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]));
    const total = L[L.length - 1], cut = 0.14 * total, out = [];
    for (let i = 0; i < loop.length; i++) if (L[i] >= cut && L[i] <= total - cut) out.push(loop[i]);
    return out.length >= 5 ? out : null;
  }

  /*
   * A river migrating across its floodplain (Howard & Knutson 1984): each stretch of channel moves
   * sideways, towards its outer bank, at a rate set by its own curvature and, more, by the curvature
   * upstream of it (R = Ω·C + Γ·∫ C(s − ξ)·e^(−ξ/l) dξ, Ω = −1, Γ = 2.5, C the curvature times the
   * width, l = 2.5 widths): bends grow, skew downstream and travel down the valley. The ground is not
   * all alike (sand, clay, the plugs of old channels): how readily it gives way varies in patches about
   * a bend across, which is what makes real meanders irregular. Where a neck narrows to a channel's width
   * the river breaks through and the loop is left as an oxbow lake. Only on flat ground (as for the
   * Kinoshita bends), within a meander belt a few bends either side of the valley's axis; the ends are
   * held where they are. The channel's width is its true one (≈ 2.7·√Q m), or the drawn line's where that
   * is wider (as for the Kinoshita bends: bends ~11 widths long). Returns {pts, q, oxbows, work} or null
   * (no flat ground).
   */
  function migrate(P, L, total, pos, at, rv, o, ri, nz) {
    const qMax = rv.q.reduce((a, b) => Math.max(a, b), 0);
    const wTrue = (2.7 * Math.sqrt(qMax)) / 1000 / o.pxKm, wDraw = riverWidth(qMax, o.minFlow);
    const lam = Math.max(11 * wTrue, 12 * wDraw), w = lam / 11;
    if (total < 3 * lam) return null;
    // (the model's own lengths at half the channel's width: so run, its bends come out some 30 widths
    // long along the channel and a dozen along the valley, as rivers' are; at the full width they come
    // out about twice that. Its cutoffs still go by the true width.)
    const ls = lam / 2, ws = w / 2, ds = ls / 9;
    const freeAt = (u) => {
      const p = pos(u);
      return smooth((Math.log10(0.002) - Math.log10(Math.max(1e-6, p.s))) / 1) * smooth(Math.log10(Math.max(1, p.q / o.minFlow)) / 2) * smooth(Math.min(u, total - u) / (1.5 * lam));
    };
    let anyFree = 0; for (let u = 0; u <= total; u += ds) anyFree = Math.max(anyFree, freeAt(u));
    if (anyFree < 0.1) return null;
    // the channel to start from: the axis, nudged a little to one side and the other
    let X = [], Y = [], A = [];
    for (let u = 0; u <= total + 1e-9; u += ds) {
      const c = at(Math.min(u, total), lam), j = 0.5 * ws * freeAt(u) * nz(u / (0.8 * ls), ri * 2.3, 9.1);
      X.push(c.x + j * c.nx); Y.push(c.y + j * c.ny); A.push(Math.min(u, total));
    }
    if (A[A.length - 1] < total) { const c = at(total); X.push(c.x); Y.push(c.y); A.push(total); }
    // how readily the ground gives way: patches about a bend across, fixed in place
    const soft = (x, y) => 0.25 + 1.5 * smooth(0.5 + 0.8 * nz(x / (1.3 * ls) + ri * 0.37, y / (1.3 * ls), 3.3));
    const belt = 3 * ls, decay = Math.exp(-ds / (1.0 * ws)), OM = -1, GA = 2.5;
    const oxbows = [];
    // (how soft the ground is under each point, and the banks' push, worked out every few steps: the
    // points move a fraction of their spacing a step)
    let sCache = [], rCache = [];
    let work = 0;
    const T = o.iterations ?? 600;
    for (let it = 0; it < T; it++) {
      const m = X.length;
      if (m < 5) break;
      work += m;
      // curvature (signed, times the width) and the rate of migration
      const th = new Float64Array(m - 1), sg = new Float64Array(m - 1);
      for (let i = 0; i < m - 1; i++) { th[i] = Math.atan2(Y[i + 1] - Y[i], X[i + 1] - X[i]); sg[i] = Math.hypot(X[i + 1] - X[i], Y[i + 1] - Y[i]) || 1e-6; }
      const C = new Float64Array(m), Rr = new Float64Array(m);
      for (let i = 1; i < m - 1; i++) { let d = th[i] - th[i - 1]; d -= 2 * Math.PI * Math.round(d / (2 * Math.PI)); C[i] = (d / (0.5 * (sg[i - 1] + sg[i]))) * ws; }
      // (smoothed over a few points: the local term would otherwise grow the shortest wiggles fastest)
      for (let pass = 0; pass < 1; pass++) { let prev = C[0]; for (let i = 1; i < m - 1; i++) { const cur = C[i]; C[i] = (prev + 2 * cur + C[i + 1]) / 4; prev = cur; } }
      let F = 0;
      for (let i = 1; i < m - 1; i++) { Rr[i] = OM * C[i] + GA * F; F = decay * F + (1 - decay) * C[i]; }
      // move each point along its normal (the ends stay); not out of the belt
      const mv = new Float64Array(m), nx = new Float64Array(m), ny = new Float64Array(m), ax = new Array(m);
      let big = 0;
      for (let i = 1; i < m - 1; i++) {
        const tx = X[i + 1] - X[i - 1], ty = Y[i + 1] - Y[i - 1], l = Math.hypot(tx, ty) || 1;
        nx[i] = -ty / l; ny[i] = tx / l;
        const r = (Rr[i - 1] + 2 * Rr[i] + Rr[i + 1]) / 4;
        // (plus a small push from the banks' roughness that changes as they do: bars, slumps, logs; it
        // seeds new bends where the river runs straight, as nothing upstream does at the window's edge)
        if (it % 6 === 0 || sCache[i] === undefined || Number.isNaN(sCache[i])) { sCache[i] = soft(X[i], Y[i]) * freeAt(A[i]); rCache[i] = 0.12 * nz(X[i] / (0.45 * ls) + it * 0.07, Y[i] / (0.45 * ls), ri * 1.9 + 4.4); }
        let v = (r + rCache[i]) * sCache[i];
        const c = (ax[i] = at(A[i], lam, true)), off = (X[i] - c.x) * c.nx + (Y[i] - c.y) * c.ny, out = -v * (nx[i] * c.nx + ny[i] * c.ny) * Math.sign(off);
        if (out > 0) v *= 1 - smooth((Math.abs(off) - 0.4 * belt) / (0.6 * belt));
        mv[i] = v;
      }
      // the step: the typical fast stretch moves a tenth of the spacing (not the fastest point alone)
      const mags = Array.from(mv, Math.abs).sort((a, b) => a - b);
      big = mags[Math.floor(0.95 * (mags.length - 1))];
      if (big < 1e-9) break;
      const dt = (0.1 * ds) / big;
      for (let i = 1; i < m - 1; i++) {
        // (towards the outer bank where R > 0: for a bend curving towards the normal, against it)
        const d = -clamp(dt * mv[i], -0.3 * ds, 0.3 * ds);
        // (only over its floodplain: not onto ground more than a few metres above the river's level)
        if (o.zAt && o.zAt(X[i] + d * nx[i], Y[i] + d * ny[i]) > ax[i].level + o.bank) continue;
        X[i] += d * nx[i]; Y[i] += d * ny[i];
        // (where along the valley the point now is: moved on by its offset along the axis's tangent)
        const c = ax[i];
        A[i] = clamp(A[i] + (X[i] - c.x) * c.ny - (Y[i] - c.y) * c.nx, 0, total);
      }
      // a little diffusion: damps what is finer than a channel's width
      for (let pass = 0; pass < 1; pass++) {
        const X0 = X.slice(), Y0 = Y.slice();
        const e = 0.03;
        for (let i = 1; i < m - 1; i++) { X[i] = X0[i] + e * (X0[i - 1] - 2 * X0[i] + X0[i + 1]); Y[i] = Y0[i] + e * (Y0[i - 1] - 2 * Y0[i] + Y0[i + 1]); }
      }
      // keep the points about ds apart
      const X2 = [X[0]], Y2 = [Y[0]], A2 = [A[0]], S2 = [sCache[0]], R2 = [rCache[0]];
      for (let i = 1; i < m; i++) {
        const px = X2[X2.length - 1], py = Y2[Y2.length - 1], d = Math.hypot(X[i] - px, Y[i] - py);
        if (d < 0.45 * ds && i < m - 1) continue;
        if (d > 1.6 * ds) {
          const k = Math.ceil(d / ds), a0 = A2[A2.length - 1], s0 = S2[S2.length - 1], r0 = R2[R2.length - 1];
          for (let q = 1; q < k; q++) { const t = q / k; X2.push(px + (X[i] - px) * t); Y2.push(py + (Y[i] - py) * t); A2.push(a0 + (A[i] - a0) * t); S2.push(s0 + (sCache[i] - s0) * t); R2.push(r0 + (rCache[i] - r0) * t); }
        }
        X2.push(X[i]); Y2.push(Y[i]); A2.push(A[i]); S2.push(sCache[i]); R2.push(rCache[i]);
      }
      X = X2; Y = Y2; A = A2; sCache = S2; rCache = R2;
      // neck cutoffs: two stretches far apart along the river but within a channel's width of each other
      if (it % 2 === 0) {
        const cell = Math.max(ds, 1.2 * w), grid = new Map(), key = (x, y) => Math.floor(x / cell) * 73856093 ^ Math.floor(y / cell) * 19349663;
        for (let i = 0; i < X.length; i++) { const k = key(X[i], Y[i]); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
        const reach = Math.max(1.1 * w, 0.75 * ds), gap = Math.ceil((2 * ls) / ds);
        let cutA = -1, cutB = -1;
        for (let i = 0; i < X.length && cutA < 0; i++) {
          const gx = Math.floor(X[i] / cell), gy = Math.floor(Y[i] / cell);
          for (let a = -1; a <= 1 && cutA < 0; a++) for (let b = -1; b <= 1 && cutA < 0; b++) {
            for (const j of grid.get(((gx + a) * 73856093) ^ ((gy + b) * 19349663)) || []) {
              if (j > i + gap && Math.hypot(X[j] - X[i], Y[j] - Y[i]) < reach) { cutA = i; cutB = j; break; }
            }
          }
        }
        if (cutA >= 0) {
          const loop = []; for (let k = cutA; k <= cutB; k++) loop.push([X[k], Y[k]]);
          oxbows.push({ pts: loop, it });
          for (const arr of [X, Y, A, sCache, rCache]) arr.splice(cutA + 1, cutB - cutA - 1);
        }
      }
    }
    // the channel as drawn: lightly smoothed; its flow from the valley it is in
    let pts = X.map((x, i) => [x, Y[i]]);
    pts = relax(pts);
    const q = A.map((u) => pos(u).q);
    // oxbows, the youngest first: each erased where the river or a younger oxbow has since passed (the
    // floodplain reworked); the oldest (the first third of the history) silted up and grown over
    const cell = Math.max(1, 1.5 * w), grid = new Set();
    const mark = (p) => { for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) grid.add(`${Math.floor(p[0] / cell) + a},${Math.floor(p[1] / cell) + b}`); };
    for (const p of pts) mark(p);
    const lakes = [];
    for (const ob of oxbows.slice().sort((a, b) => b.it - a.it)) {
      if (ob.it < T / 3) continue;
      const t = trimOxbow(ob.pts);
      if (!t) continue;
      let run = [];
      const kept = [];
      const flush = () => { if (run.length >= 5) { const r = relax(run); kept.push(r); lakes.push({ pts: r, w: wDraw, wTrue, age: 1 - ob.it / T }); } run = []; };
      for (const p of t) { if (grid.has(`${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)}`)) flush(); else run.push(p); }
      flush();
      for (const r of kept) for (const p of r) mark(p);
    }
    return { pts, q, oxbows: lakes, work };
  }

  /* A moving average over five points (the ends kept): eases a line off the pixel grid's steps. */
  function relax(p) {
    if (p.length < 5) return p;
    const out = p.map((q) => q.slice());
    for (let i = 2; i < p.length - 2; i++) for (let c = 0; c < 2; c++) out[i][c] = (p[i - 2][c] + 2 * p[i - 1][c] + 3 * p[i][c] + 2 * p[i + 1][c] + p[i + 2][c]) / 9;
    if (p.length >= 3) for (const i of [1, p.length - 2]) for (let c = 0; c < 2; c++) out[i][c] = (p[i - 1][c] + 2 * p[i][c] + p[i + 1][c]) / 4;
    return out;
  }
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

  /* A pixel of the region at [lat, lon], or -1 outside it. */
  function pixelOf(reg, lat, lon) {
    const fr = reg.frame, d = ((((lon - fr.west) % 360) + 360) % 360);
    if (lat > fr.north || lat < fr.south || d > fr.dLon) return -1;
    const x = clamp(Math.floor((d / fr.dLon) * reg.W), 0, reg.W - 1), y = clamp(Math.floor(((fr.north - lat) / fr.dLat) * reg.H), 0, reg.H - 1);
    return y * reg.W + x;
  }
  /* [lat, lon] of a point in pixels. */
  const latLonOf = (reg, x, y) => { const fr = reg.frame; return [fr.north - (y / reg.H) * fr.dLat, ((fr.west + (x / reg.W) * fr.dLon + 540) % 360) - 180]; };

  const api = { build, frame, pixelOf, latLonOf, gradNoise, riverWidth, meanders };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.region = api; }
})(typeof window !== 'undefined' ? window : globalThis);
