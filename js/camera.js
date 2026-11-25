/*
 * The camera of the map viewer: where it looks from, and how screen points and places on the planet
 * map to each other. Pure functions: runs in the page and in Node.
 *
 * Globe: a narrow-angle perspective camera straight above a centre point (lat, lon) at an altitude
 * in planet radii, looking at the planet's centre, its screen turned by a heading (0: north up).
 * Flat: the equirectangular map, centred on (lat, lon), at a scale the same altitude gives (so a
 * degree at the centre is as wide in both), wrapping in longitude.
 *
 * Zoomed in on the flat map (less than about 90° across), east-west is stretched by the cosine of the
 * centre's latitude, fading in from 90° to 27° across, so shapes keep their proportions there.
 *
 * Screen coordinates are pixels of a w × h viewport, y down. Grabbing keeps the grabbed place under
 * the pointer exactly, with north up; dragging over a pole carries the camera past it (its latitude
 * runs beyond ±90°, the picture upside down) and on release the view turns back to north up about
 * its centre. A camera is a plain object; the functions change it in place.
 */
(function (root) {
  'use strict';
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const wrap180 = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
  const FOV = 30 * D2R, MIN_ALT = 0.003, GLOBE_R = 0.46;            // vertical field of view; closest; globe radius / short side

  /* A camera for a w × h viewport. */
  function create(o = {}) {
    const cam = { lat: o.lat ?? 20, lon: o.lon ?? 0, heading: 0, alt: o.alt ?? null, projection: o.projection || 'globe', w: o.w || 800, h: o.h || 400, anim: null, auto: o.alt == null, minAlt: o.minAlt || MIN_ALT };
    if (cam.alt == null) cam.alt = defaultAlt(cam);
    clampView(cam);
    return cam;
  }
  const focal = (cam) => cam.h / 2 / Math.tan(FOV / 2);
  /* The altitude at which the globe's disc fills GLOBE_R of the viewport's short side. */
  function fitAlt(cam) {
    const t = (GLOBE_R * Math.min(cam.w, cam.h)) / focal(cam);           // tan of the disc's angular radius
    return 1 / Math.sin(Math.atan(t)) - 1;
  }
  /* Flat: pixels per degree at an altitude, and the altitude that shows the whole width. */
  const ppd = (cam, alt = cam.alt) => (focal(cam) * D2R) / alt;
  const flatMax = (cam) => (focal(cam) * D2R * 360) / cam.w;
  const defaultAlt = (cam) => (cam.projection === 'flat' ? flatMax(cam) : fitAlt(cam));
  /* The altitudes allowed: [closest, farthest]. */
  const limits = (cam) => [cam.minAlt || MIN_ALT, cam.projection === 'flat' ? flatMax(cam) : 3 * fitAlt(cam)];
  const smooth = (t) => { const x = clamp(t, 0, 1); return x * x * (3 - 2 * x); };
  /* Flat: how much wider than tall a degree is drawn, at the camera's latitude and zoom (1: plain). */
  function stretch(cam, lat = cam.lat) {
    const span = Math.max(cam.w, cam.h) / ppd(cam);                       // degrees across the view
    return 1 + (Math.max(0.1, Math.cos(lat * D2R)) - 1) * (1 - smooth((span - 27) / 63));
  }

  /* A new viewport size; a camera left at its default distance keeps it. */
  function resize(cam, w, h) {
    cam.w = Math.max(1, w); cam.h = Math.max(1, h);
    if (cam.auto) cam.alt = defaultAlt(cam);
    clampView(cam);
  }
  function clampView(cam) {
    const [lo, hi] = limits(cam);
    cam.alt = clamp(cam.alt, lo, hi);
    cam.lon = wrap180(cam.lon);
    if (cam.projection === 'flat') {
      cam.heading = 0;
      const half = cam.h / 2 / ppd(cam);
      cam.lat = half >= 90 ? 0 : clamp(cam.lat, -90 + half, 90 - half);
    }
  }
  /* Switch between globe and flat, keeping the centre; a view at its default distance gets the other's default. */
  function setProjection(cam, p) {
    if (p === cam.projection) return;
    const atDefault = cam.auto || cam.alt >= 0.9 * defaultAlt(cam);
    normalize(cam); cam.anim = null;
    cam.projection = p;
    if (atDefault) { cam.auto = true; cam.alt = defaultAlt(cam); }
    if (p === 'flat') cam.heading = 0;
    clampView(cam);
  }

  // ── the globe's frame ──
  /* The camera's axes in the planet's frame: screen right (e), screen up (n), and the way out (u). */
  function frame(cam) {
    const p = cam.lat * D2R, l = cam.lon * D2R, hd = cam.heading * D2R;
    const E = [-Math.sin(l), Math.cos(l), 0], N = [-Math.sin(p) * Math.cos(l), -Math.sin(p) * Math.sin(l), Math.cos(p)], U = [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)];
    const ch = Math.cos(hd), sh = Math.sin(hd);
    const e = [0, 1, 2].map((i) => ch * E[i] - sh * N[i]), n = [0, 1, 2].map((i) => sh * E[i] + ch * N[i]);
    return { e, n, u: U, D: 1 + cam.alt, f: focal(cam) };
  }
  const vec = (lat, lon) => { const p = lat * D2R, l = lon * D2R; return [Math.cos(p) * Math.cos(l), Math.cos(p) * Math.sin(l), Math.sin(p)]; };
  const latLon = (v) => [Math.asin(clamp(v[2], -1, 1)) * R2D, Math.atan2(v[1], v[0]) * R2D];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  /* Where the ray through a screen point meets the unit sphere, in the camera's own axes; with
     `limb`, a ray that misses gives the nearest point of the visible rim. */
  function hitLocal(cam, x, y, limb) {
    const f = focal(cam), D = 1 + cam.alt;
    let dx = (x - cam.w / 2) / f, dy = (cam.h / 2 - y) / f, dz = -1;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const b = D * dz, disc = b * b - (D * D - 1);
    if (disc >= 0) { const t = -b - Math.sqrt(disc); return [t * dx, t * dy, D + t * dz]; }
    if (!limb) return null;
    const r = Math.hypot(dx, dy) || 1, c = 1 / D, s = Math.sqrt(1 - c * c);
    return [(s * dx) / r, (s * dy) / r, c];
  }

  // ── screen ↔ planet ──
  /* A place on the screen: [x, y, visible]. */
  function toScreen(cam, lat, lon) {
    if (cam.projection === 'flat') { const k = ppd(cam); return [cam.w / 2 + wrap180(lon - cam.lon) * k * stretch(cam), cam.h / 2 - (lat - cam.lat) * k, true]; }
    const F = frame(cam), P = vec(lat, lon), a = dot(P, F.e), b = dot(P, F.n), c = dot(P, F.u), vz = c - F.D;
    return [cam.w / 2 + (F.f * a) / -vz, cam.h / 2 - (F.f * b) / -vz, c > 1 / F.D];
  }
  /* The place under a screen point, [lat, lon], or null off the planet. */
  function pick(cam, x, y) {
    if (cam.projection === 'flat') {
      const k = ppd(cam), lat = cam.lat + (cam.h / 2 - y) / k;
      return Math.abs(lat) > 90 ? null : [lat, wrap180(cam.lon + (x - cam.w / 2) / (k * stretch(cam)))];
    }
    const q = hitLocal(cam, x, y, false);
    if (!q) return null;
    const F = frame(cam);
    return latLon([0, 1, 2].map((i) => q[0] * F.e[i] + q[1] * F.n[i] + q[2] * F.u[i]));
  }
  /* Pixels a degree of latitude spans at the centre of the view. */
  const scale = (cam) => (cam.projection === 'flat' ? ppd(cam) : (focal(cam) * D2R) / cam.alt);

  // ── grabbing ──
  /* Take hold of the place under a screen point (on the globe, the nearest rim point if off it). */
  function grab(cam, x, y) {
    cam.anim = null;
    if (cam.projection === 'flat') { const k = ppd(cam); return { lat: cam.lat + (cam.h / 2 - y) / k, lon: cam.lon + (x - cam.w / 2) / (k * stretch(cam)), x, y, t: 0, track: [] }; }
    const q = hitLocal(cam, x, y, true), F = frame(cam);
    return { P: [0, 1, 2].map((i) => q[0] * F.e[i] + q[1] * F.n[i] + q[2] * F.u[i]), x, y, t: 0, track: [] };
  }
  /* Move the camera so the grabbed place is under the screen point (x, y). */
  function drag(cam, g, x, y, t) {
    if (t != null) { g.track.push([t, x, y]); while (g.track.length > 2 && t - g.track[0][0] > 90) g.track.shift(); }
    if (cam.projection === 'flat') {
      const k = ppd(cam);
      cam.lat = g.lat - (cam.h / 2 - y) / k; clampView(cam);
      cam.lon = wrap180(g.lon - (x - cam.w / 2) / (k * stretch(cam)));
      return;
    }
    const q = hitLocal(cam, x, y, true), hd = cam.heading * D2R, P = g.P;
    const e = q[0] * Math.cos(hd) + q[1] * Math.sin(hd), n = -q[0] * Math.sin(hd) + q[1] * Math.cos(hd), c = q[2];
    // the centre's latitude p solves n·cos p + c·sin p = P.z; of its two roots, the nearer one
    const R = Math.hypot(n, c), beta = Math.atan2(n, c), s = Math.asin(clamp(P[2] / R, -1, 1)), p0 = cam.lat * D2R;
    const near = (a) => p0 + Math.atan2(Math.sin(a - p0), Math.cos(a - p0));
    const r1 = near(s - beta), r2 = near(Math.PI - s - beta), p = Math.abs(r1 - p0) <= Math.abs(r2 - p0) ? r1 : r2;
    const gg = c * Math.cos(p) - n * Math.sin(p);
    cam.lat = clamp(Math.atan2(Math.sin(p), Math.cos(p)) * R2D, -179.999, 180);
    cam.lon = wrap180((Math.atan2(P[1], P[0]) - Math.atan2(e, gg)) * R2D);
  }
  /* Let go: a quick drag keeps the globe turning, slowing down; a view past a pole turns north up. */
  function release(cam, g, t) {
    const tr = g.track;
    if (tr.length >= 2 && t - tr[tr.length - 1][0] < 60) {
      const [t0, x0, y0] = tr[0], [t1, x1, y1] = tr[tr.length - 1], dt = Math.max(8, t1 - t0);
      const vx = (x1 - x0) / dt, vy = (y1 - y0) / dt;                    // px per ms
      if (Math.hypot(vx, vy) > 0.15) { cam.anim = { kind: 'fling', g, x: x1, y: y1, vx, vy }; return; }
    }
    settle(cam);
  }
  /* Past a pole (|lat| > 90): the same view, written with the heading turned half round; then turn
     the heading back to north up. */
  function normalize(cam) {
    if (Math.abs(cam.lat) > 90) { cam.lat = Math.sign(cam.lat) * 180 - cam.lat; cam.lon = wrap180(cam.lon + 180); cam.heading = wrap180(cam.heading + 180); }
  }
  function settle(cam) {
    normalize(cam);
    cam.anim = Math.abs(cam.heading) > 0.01 ? { kind: 'north', from: cam.heading, t: 0, ms: 450 } : null;
    if (!cam.anim) cam.heading = 0;
  }

  /* Zoom by a factor (< 1: closer) keeping the place under (x, y) where it is. */
  function zoomAt(cam, x, y, factor) {
    cam.auto = false;
    const g = pick(cam, x, y) ? grab(cam, x, y) : null;
    const [lo, hi] = limits(cam);
    cam.alt = clamp(cam.alt * factor, lo, hi);
    if (g) drag(cam, g, x, y);
    clampView(cam);
  }
  /* Zoom by a factor about (x, y), eased over `ms` milliseconds. */
  function zoomBy(cam, x, y, factor, ms = 260) { normalize(cam); cam.auto = false; cam.anim = { kind: 'zoom', x, y, logF: Math.log(factor), done: 0, t: 0, ms }; }
  /* Two fingers: the place grabbed between them stays under their midpoint as they spread or close. */
  function pinch(cam, g, x, y, factor) {
    cam.auto = false;
    const [lo, hi] = limits(cam);
    cam.alt = clamp(cam.alt * factor, lo, hi);
    drag(cam, g, x, y); clampView(cam);
  }
  /* Move the view by (dx, dy) pixels, as if the middle of the screen were dragged that far. */
  function panBy(cam, dx, dy) {
    normalize(cam);
    const g = grab(cam, cam.w / 2, cam.h / 2);
    drag(cam, g, cam.w / 2 + dx, cam.h / 2 + dy);
    settle(cam);
  }
  /* The altitude at which max(w, h) spans `deg` degrees at the centre, and the span at an altitude. */
  const altForSpan = (cam, deg) => (focal(cam) * D2R * deg) / Math.max(cam.w, cam.h);
  const span = (cam) => Math.max(cam.w, cam.h) / scale(cam);

  /* Fly to a place (and altitude) over `ms` milliseconds. */
  function flyTo(cam, lat, lon, alt = cam.alt, ms = 700) {
    normalize(cam); cam.auto = false;
    cam.anim = { kind: 'fly', a: [cam.lat, cam.lon, cam.alt, cam.heading], b: [lat, lon, alt], t: 0, ms };
  }
  /* Back to the default view: north up, whole globe or map. */
  function reset(cam, lat = 20, lon = 0) { cam.auto = true; flyTo(cam, lat, lon, defaultAlt(cam)); cam.auto = true; }

  /* Advance any motion by dt ms; true while something still moves. */
  function step(cam, dt) {
    const a = cam.anim;
    if (!a) return false;
    if (a.kind === 'fling') {
      a.x += a.vx * dt; a.y += a.vy * dt;
      drag(cam, a.g, a.x, a.y);
      const k = Math.exp(-dt / 300); a.vx *= k; a.vy *= k;
      if (Math.hypot(a.vx, a.vy) < 0.02) settle(cam);
      return true;
    }
    if (a.kind === 'zoom') {
      a.t += dt;
      const target = a.logF * smooth(a.t / a.ms);
      zoomAt(cam, a.x, a.y, Math.exp(target - a.done)); a.done = target;
      cam.anim = a.t >= a.ms ? null : a;                                  // (zoomAt lets go of any motion)
      if (!cam.anim) settle(cam);
      return true;
    }
    a.t += dt;
    const t = Math.min(1, a.t / a.ms), s = t * t * (3 - 2 * t);
    if (a.kind === 'north') cam.heading = a.from * (1 - s);
    else if (a.kind === 'fly') {
      // along the great circle between the two centres; altitude on a log scale
      const A = vec(a.a[0], a.a[1]), B = vec(a.b[0], a.b[1]), w = Math.acos(clamp(dot(A, B), -1, 1));
      const P = w < 1e-6 ? B : [0, 1, 2].map((i) => (Math.sin((1 - s) * w) * A[i] + Math.sin(s * w) * B[i]) / Math.sin(w));
      [cam.lat, cam.lon] = latLon(P);
      cam.alt = Math.exp(Math.log(a.a[2]) * (1 - s) + Math.log(a.b[2]) * s);
      cam.heading = a.a[3] * (1 - s);
      clampView(cam);
    }
    if (t >= 1) { cam.anim = null; if (a.kind !== 'fling') cam.heading = 0; }
    return true;
  }

  /* The view as it can be stored: centre, altitude, projection (north up). */
  function view(cam) {
    const c = { ...cam }; normalize(c);
    return { lat: c.lat, lon: c.lon, alt: cam.alt, projection: cam.projection, auto: cam.auto };
  }

  const api = { create, resize, setProjection, frame, toScreen, pick, scale, grab, drag, release, zoomAt, zoomBy, pinch, panBy, flyTo, reset, step, view, fitAlt, limits, normalize, settle, ppd, stretch, altForSpan, span, focal, MIN_ALT, FOV };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.camera = api; }
})(typeof window !== 'undefined' ? window : globalThis);
