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
    const span = clamp(opts.span ?? 800, 20, 0.5 * Math.PI * radiusKm), dLat = span / kmDeg;
    const lat = clamp(opts.lat ?? 0, -88 + dLat / 2, 88 - dLat / 2), lon = ((((opts.lon ?? 0) + 180) % 360) + 360) % 360 - 180;
    const cosc = Math.max(0.1, Math.cos(lat * D2R)), dLon = dLat / cosc;
    return { W, H: Hh, lat, lon, span, kmDeg, north: lat + dLat / 2, south: lat - dLat / 2, west: lon - dLon / 2, east: lon + dLon / 2, dLat, dLon, pxKm: span / W };
  }

  /*
   * Build a region. map: the world map (z, W, H, planet, rivers.recv and rivers.discharge if carved);
   * water: biomes.js water(map, clim, planet) on it (runoff, P, PET, Tw, Tc, Ta, Pw, liquid, tBoil);
   * opts: lat, lon, span (km), res (pixels across), seed, erosion (× Earth's, 1), detail (× 1),
   * minFlow (m³/s to draw a river, 8), sea (true: the sea floor gets detail too).
   * Returns {frame, W, H, z (m), flow (m³/s), recv, lake (1 fresh, 2 salt), biome (code, 0 sea or
   * lake), rivers [{pts: [[x, y] in pixels], q}], inflows, stats}.
   */
  function build(map, water, opts = {}) {
    const planet = map.planet || {}, f = planet.factor ?? 1, R = planet.radiusKm ?? 6371, g = planet.gravity ?? 1;
    const fr = frame(opts, R), { W, H, kmDeg, pxKm } = fr, N = W * H;
    const gW = map.W, gH = map.H, gz = map.z, gkm = (2 * Math.PI * R) / gW;   // a world map cell, km
    const seed = (opts.seed ?? 1) | 0, E = Math.max(0, opts.erosion ?? 1), detailX = Math.max(0, opts.detail ?? 1);
    const latOf = (y) => fr.north - ((y + 0.5) / H) * fr.dLat, lonOf = (x) => fr.west + ((x + 0.5) / W) * fr.dLon;
    const wrapI = (i) => ((i % gW) + gW) % gW, clampJ = (j) => clamp(j, 0, gH - 1);
    const gfi = (lon) => ((lon + 180) / 360) * gW - 0.5, gfj = (lat) => ((90 - lat) / 180) * gH - 0.5;
    const gCell = (lat, lon) => clampJ(Math.floor(((90 - lat) / 180) * gH)) * gW + wrapI(Math.floor(((lon + 180) / 360) * gW));
    const gLat = (j) => 90 - ((j + 0.5) * 180) / gH, gLon = (i) => -180 + ((i + 0.5) * 360) / gW;

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
        amp = (14 + 0.11 * Math.max(0, bm) + 0.22 * relief[k] * f) / f;
        // the shore: low land and shallow sea break up into bays, spits and islets
        const shore = Math.exp(-Math.abs(bm) / 60);
        v = (1 - mtn) * s + mtn * (0.35 * s + 1.1 * r);
        v = (amp * v + (30 / f) * shore * c) / amp;
      } else {
        amp = (6 + 0.04 * -bm + 0.12 * relief[k] * f) / f;
        v = (amp * s + (30 / f) * Math.exp(bm / 60) * c) / amp;
      }
      z[k] = b + amp * detailX * v;
      // what was land on the world map stays above the sea unless right at the shore, and the reverse
      if (b > 40 / f && z[k] <= 0) z[k] = Math.min(b, 2 + Math.abs(z[k]) * 0.1);
      else if (b < -60 / f && z[k] > 0) z[k] = Math.max(b, -2 - z[k] * 0.1);
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
    const grecv = map.rivers && map.rivers.recv, gq = map.rivers && map.rivers.discharge;
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
        const y = (fl.k / W) | 0, x = fl.k - y * W, rr = 4;
        for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) { const yy = y + dy, xx = x + dx; if (yy >= 0 && yy < H && xx >= 0 && xx < W) outlet[yy * W + xx] = 0; }
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
    // silted floors are flat; water on them follows a faint unevenness (about a metre), not a ruler
    const silt = new Uint8Array(N), nf = gradNoise(seed ^ 0xf1a7), lumpKm = Math.max(3 * pxKm, 4);
    const routeZ = (zz) => Float32Array.from(zz, (v, k) => (silt[k] ? v + (1.2 / f) * (1 + nf(xyz[k * 3] / lumpKm, xyz[k * 3 + 1] / lumpKm, xyz[k * 3 + 2] / lumpKm)) : v));
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
      const bigEnough = Math.max(25, 12 * pxKm * pxKm);
      let filled = 0;
      for (const hlw of hs.list) {
        let rl = 0; for (const c of hlw.cells) rl = Math.max(rl, relief[c]);
        if (hlw.depth < (30 / f) + 0.1 * rl || hlw.area < bigEnough) { for (const c of hlw.cells) { z[c] = fl1.fill[c]; silt[c] = 1; } filled++; }
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
    const hs = hollows(fl.zr, fl.fill, 1 / f);
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
    for (let k = 0; k < N; k++) {
      if (!(z[k] > 0) || lake[k]) continue;
      const dT = (-lapse * (Math.min(z[k], tropo) - Math.min(zc[k], tropo))) / 1000 + 0.6 * nb(xyz[k * 3] / 40, xyz[k * 3 + 1] / 40, xyz[k * 3 + 2] / 40);
      const tw = Tw[k] + dT, tc = Tc[k] + dT, ta = Ta[k] + dT;
      // (evaporation follows the temperature down the mountain, roughly)
      const pe = PET[k] * clamp(1 + dT / 30, 0.2, 1.5);
      biome[k] = B.classify(tw, tc, ta, P[k], pe, Pw[k], liquid, tBoil);
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
    const minFlow = opts.minFlow ?? 8, minArea = opts.minArea ?? Math.max(25, (fr.span / 55) ** 2), minUp = Math.max(12, Math.round(minArea / (pxKm * pxKm)));
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
    const seen = new Uint8Array(N), raw = [];
    for (const s of starts) {
      if (seen[s]) continue;
      let cur = s, line = [], qs = [];
      const flush = () => { if (line.length > 1) raw.push({ pts: line, q: qs }); line = []; qs = []; };
      while (cur >= 0) {
        if (hid(cur)) { if (line.length) { line.push(pt(cur)); qs.push(flow[cur]); } flush(); }
        else { line.push(pt(cur)); qs.push(flow[cur]); }
        if (seen[cur] && line.length > 1) break;
        seen[cur] = 1;
        if (terminal[cur]) break;
        const r = recv[cur];
        if (r < 0 || !(z[r] > 0)) { if (r >= 0) { const y = (r / W) | 0; line.push([r - y * W + 0.5, y + 0.5]); qs.push(flow[cur]); } break; }
        // leaving a lake or the ice: start again from its edge, unless that outlet is already drawn
        // (every stream into a lake would otherwise add a stub over its outlet)
        if (hid(cur) && !hid(r)) { if (seen[r]) break; line = [pt(cur)]; qs = [flow[cur]]; }
        cur = r;
      }
      flush();
    }
    // short stubs (a little coastal stream, a tributary that joins at once) are left out unless they
    // carry real water; the rest are smoothed beyond the grid's 45° steps, then rounded off
    const minLen = Math.max(6, Math.round(12 / Math.sqrt(Math.max(0.05, pxKm))));
    const rivers = raw.filter((rv) => rv.pts.length >= minLen || rv.q[rv.q.length - 1] >= 30 * minFlow)
      .map((rv) => { const pts = chaikin(chaikin(relax(relax(relax(relax(relax(rv.pts))))))); return { pts, q: resample(rv.q, pts.length) }; });

    // ── figures ──
    let landPx = 0, hiZ = -Infinity, loZ = Infinity, hiK = 0, loK = 0, landKm2 = 0, bigQ = 0, bigK = -1;
    const share = new Float64Array(B.BIOMES.length + 1);
    for (let k = 0; k < N; k++) {
      if (z[k] > hiZ) { hiZ = z[k]; hiK = k; } if (z[k] < loZ) { loZ = z[k]; loK = k; }
      if (z[k] > 0) { landPx++; landKm2 += areaOf(k); share[biome[k]] += areaOf(k); if (flow[k] > bigQ && (recv[k] < 0 || !(z[recv[k]] > 0) || edge[k])) { bigQ = flow[k]; bigK = k; } }
    }
    const ll = (k) => { const y = (k / W) | 0; return [latOf(y), ((lonOf(k - y * W) + 540) % 360) - 180]; };
    return {
      frame: fr, W, H, z, flow: Float32Array.from(flow), recv, lake, biome, rivers, cut, inflows: inflows.map((x) => ({ at: ll(x.k), q: x.q })), minFlow,
      climate: { Tw, Tc, P },
      stats: {
        land: landPx / N, landKm2, highest: { m: hiZ, at: ll(hiK) }, deepest: { m: loZ, at: ll(loK) }, lakes, saltLakes, lakeKm2,
        eroded, deepestCut: deepest, biggest: bigK >= 0 ? { q: bigQ, at: ll(bigK) } : null, rivers: rivers.length, minArea,
        biomeShare: Array.from(share.slice(1), (v) => v / Math.max(1, landKm2)), pxKm, worldCellKm: gkm,
      },
    };
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

  const api = { build, frame, pixelOf, latLonOf, gradNoise };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.region = api; }
})(typeof window !== 'undefined' ? window : globalThis);
