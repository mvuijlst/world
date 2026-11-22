/*
 * Geometry on the sphere for the Plates step: points as [lat, lon] in degrees, unit vectors,
 * great-circle interpolation, polygon areas, point-in-polygon, coverage of a set of polygons,
 * and the orthographic projection the globe editor draws with.
 * Pure functions: runs in the page and in Node.
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;

  const vec = ([lat, lon]) => { const p = lat * D2R, l = lon * D2R; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; };
  const latLon = ([x, y, z]) => [Math.asin(Math.max(-1, Math.min(1, z))) * R2D, Math.atan2(y, x) * R2D];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const angle = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));          // radians

  /* Great-circle distance in degrees. */
  const distance = (p, q) => angle(vec(p), vec(q)) * R2D;

  /* Points along the great circle from p to q, about every `step` degrees (q excluded). */
  function arc(p, q, step = 2) {
    const a = vec(p), b = vec(q), w = angle(a, b);
    const n = Math.max(1, Math.ceil((w * R2D) / step));
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = i / n;
      if (w < 1e-9) { out.push(p); continue; }
      const s = Math.sin(w), k1 = Math.sin((1 - t) * w) / s, k2 = Math.sin(t * w) / s;
      out.push(latLon([a[0] * k1 + b[0] * k2, a[1] * k1 + b[1] * k2, a[2] * k1 + b[2] * k2]));
    }
    return out;
  }
  /* A ring or line with its edges as great circles, densified for drawing. */
  function densify(points, closed, step = 2) {
    const out = [];
    const n = points.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) out.push(...arc(points[i], points[(i + 1) % n], step));
    if (!closed && n) out.push(points[n - 1]);
    return out;
  }

  /*
   * Area of a spherical polygon as a fraction of the whole sphere. Edges are great circles; the
   * polygon is fanned from its first vertex and the signed solid angles of the triangles summed
   * (Van Oosterom & Strackee 1983). The smaller of the two regions the ring bounds is returned.
   */
  function areaFraction(points) {
    if (points.length < 3) return 0;
    const v = points.map(vec);
    let omega = 0;
    for (let i = 1; i < v.length - 1; i++) {
      const a = v[0], b = v[i], c = v[i + 1];
      omega += 2 * Math.atan2(dot(a, cross(b, c)), 1 + dot(a, b) + dot(b, c) + dot(c, a));
    }
    const f = Math.abs(omega) / (4 * Math.PI);
    return Math.min(f, 1 - f);
  }

  /*
   * Is point p inside the polygon (the smaller region its ring bounds)? Counts crossings of the
   * ring on the gnomonic projection centred on the polygon's centroid, where great circles are
   * straight lines; fine for any polygon smaller than a hemisphere.
   */
  function centroid(points) {
    const s = points.map(vec).reduce((acc, u) => [acc[0] + u[0], acc[1] + u[1], acc[2] + u[2]], [0, 0, 0]);
    return norm(s);
  }
  function gnomonic(c) {
    const east = norm(Math.abs(c[2]) > 0.999 ? cross([0, 1, 0], c) : cross([0, 0, 1], c)), north = cross(c, east);
    return (u) => { const d = dot(u, c); if (d <= 1e-6) return null; return [dot(u, east) / d, dot(u, north) / d]; };
  }
  function prepare(points) {
    const c = centroid(points), proj = gnomonic(c), vs = points.map(vec);
    const ring = vs.map(proj);
    // a cap round the centroid that holds the whole polygon (cosine of its radius), for quick rejection
    const cosR = Math.min(...vs.map((u) => dot(u, c))) - 1e-9;
    return { c, proj, cosR, ring: ring.some((q) => !q) ? null : ring };
  }
  function insidePrepared(prep, u) {
    if (!prep.ring) return false;
    const q = prep.proj(u);
    if (!q) return false;
    let inside = false;
    const r = prep.ring;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      if ((r[i][1] > q[1]) !== (r[j][1] > q[1]) && q[0] < ((r[j][0] - r[i][0]) * (q[1] - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) inside = !inside;
    }
    return inside;
  }
  const contains = (points, p) => points.length >= 3 && insidePrepared(prepare(points), vec(p));

  /* Evenly spread points over the sphere (Fibonacci lattice), as unit vectors. */
  const lattice = new Map();
  function fibonacci(n) {
    if (lattice.has(n)) return lattice.get(n);
    const g = Math.PI * (3 - Math.sqrt(5)), out = [];
    for (let i = 0; i < n; i++) { const z = 1 - (2 * i + 1) / n, r = Math.sqrt(1 - z * z), t = g * i; out.push([r * Math.cos(t), r * Math.sin(t), z]); }
    lattice.set(n, out);
    return out;
  }

  /*
   * Share of the sphere covered by the union of some polygons (overlaps counted once), by
   * sampling a Fibonacci lattice: 20 000 points give about ±0.3 % of the sphere.
   */
  function coverage(polygons, n = 20000) {
    const preps = polygons.filter((p) => p.length >= 3).map(prepare);
    if (!preps.length) return 0;
    let hit = 0;
    for (const u of fibonacci(n)) {
      for (const pr of preps) { if (dot(u, pr.c) < pr.cosR) continue; if (insidePrepared(pr, u)) { hit++; break; } }
    }
    return hit / n;
  }

  /* Shortest distance in degrees from p to a polyline (with great-circle edges). */
  function distanceToLine(p, line) {
    const u = vec(p);
    let best = Infinity;
    for (let i = 0; i < line.length - 1; i++) {
      const a = vec(line[i]), b = vec(line[i + 1]);
      const nrm = norm(cross(a, b));
      // projection of u onto the great circle through a and b
      const proj = norm([u[0] - nrm[0] * dot(u, nrm), u[1] - nrm[1] * dot(u, nrm), u[2] - nrm[2] * dot(u, nrm)]);
      const ab = angle(a, b), onSeg = Math.abs(angle(a, proj) + angle(proj, b) - ab) < 1e-6;
      const d = onSeg ? Math.abs(Math.asin(Math.max(-1, Math.min(1, dot(u, nrm))))) : Math.min(angle(u, a), angle(u, b));
      best = Math.min(best, d);
    }
    if (line.length === 1) best = angle(u, vec(line[0]));
    return best * R2D;
  }

  /*
   * Orthographic projection of the globe, centred on [lat0, lon0], radius R pixels, centre cx, cy.
   * project(p) → [x, y, front] ; invert(x, y) → [lat, lon] or null off the globe.
   */
  function orthographic(lat0, lon0, R, cx, cy) {
    const c = vec([lat0, lon0]);
    const east = norm(Math.abs(c[2]) > 0.999 ? cross([0, 1, 0], c) : cross([0, 0, 1], c)), north = cross(c, east);
    return {
      project(p) {
        const u = vec(p), z = dot(u, c);
        let x = dot(u, east), y = dot(u, north);
        if (z < 0) { const l = Math.hypot(x, y) || 1; x /= l; y /= l; }       // behind: pinned to the rim
        return [cx + R * x, cy - R * y, z >= 0];
      },
      invert(px, py) {
        const x = (px - cx) / R, y = (cy - py) / R, r2 = x * x + y * y;
        if (r2 > 1) return null;
        const z = Math.sqrt(1 - r2);
        return latLon([c[0] * z + east[0] * x + north[0] * y, c[1] * z + east[1] * x + north[1] * y, c[2] * z + east[2] * x + north[2] * y]);
      },
    };
  }

  const api = { vec, latLon, distance, arc, densify, areaFraction, centroid, contains, coverage, fibonacci, distanceToLine, orthographic };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.sphere = api; }
})(typeof window !== 'undefined' ? window : globalThis);
