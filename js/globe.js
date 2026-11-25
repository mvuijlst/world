/*
 * The map viewer: one WebGL2 view of the planet, as a globe or a flat map, shared by the World map,
 * Climate, Rivers & biomes and Atlas steps. WS.globe.create(host, opts) fills `host` with a canvas
 * (drawn on the GPU) and a 2-D canvas on top for lines and labels (rivers, winds, grids).
 *
 * The GPU draws only what it is given: heights (metres, equirectangular), coloured by the SEA and LAND
 * ramps and lit from the north-west; a colour layer draped over the relief; a mask on top; and closer
 * patches of heights (the Atlas's regions and close-ups) in their own lat/lon frames. Heights are read
 * between their samples with a Catmull-Rom spline, so no cells show at any zoom; nothing is added to
 * them (no noise), so no coast or river moves. Without WebGL2 the same is drawn on the CPU, coarser.
 *
 * The pure parts (ramps, mip levels, splitting a layer at the coast, the CPU colours) run in Node too.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Cam = node ? require('./camera.js') : root.WS.camera;
  const D2R = Math.PI / 180, R2D = 180 / Math.PI;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const wrap180 = (x) => ((((x + 180) % 360) + 360) % 360) - 180;

  // the atlas colours: depth below sea level, height above it (heights stretched by the planet's relief)
  const SEA = [[0, [178, 226, 232]], [200, [140, 202, 222]], [1000, [98, 162, 206]], [3000, [60, 114, 172]], [5000, [36, 76, 132]], [7000, [22, 46, 92]], [11000, [10, 20, 50]]];
  const LAND = [[0, [92, 146, 86]], [200, [118, 166, 94]], [500, [168, 188, 118]], [1000, [204, 182, 122]], [2000, [172, 132, 92]], [3500, [138, 110, 96]], [5000, [214, 208, 202]], [8000, [255, 255, 255]]];
  const ramp = (stops, x) => {
    if (x <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (x - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * t); }
    return stops[stops.length - 1][1];
  };
  const RAMP_N = 1024;
  /* A ramp as RAMP_N RGBA texels over [0, its last stop]. */
  function rampTable(stops, n = RAMP_N) {
    const max = stops[stops.length - 1][0], out = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) { const c = ramp(stops, (i / (n - 1)) * max); out[i * 4] = Math.round(c[0]); out[i * 4 + 1] = Math.round(c[1]); out[i * 4 + 2] = Math.round(c[2]); out[i * 4 + 3] = 255; }
    return { data: out, max, n };
  }
  const lookup = (t, x) => { const i = clamp(Math.round((x / t.max) * (t.n - 1)), 0, t.n - 1) * 4; return [t.data[i], t.data[i + 1], t.data[i + 2]]; };

  /* Mean-of-four levels of a height grid (level 0 itself first), down to 8 rows: for drawing it smaller. */
  function mipChain(z, W, H, wrap = true) {
    const out = [{ w: W, h: H, data: z instanceof Float32Array ? z : Float32Array.from(z) }];
    while (out[out.length - 1].h >= 16 && out[out.length - 1].w >= 16) {
      const a = out[out.length - 1], w = a.w >> 1, h = a.h >> 1, d = new Float32Array(w * h);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
        const r0 = 2 * j * a.w, r1 = r0 + a.w, i0 = 2 * i, i1 = wrap ? (2 * i + 1) % a.w : Math.min(a.w - 1, 2 * i + 1);
        d[j * w + i] = 0.25 * (a.data[r0 + i0] + a.data[r0 + i1] + a.data[r1 + i0] + a.data[r1 + i1]);
      }
      out.push({ w, h, data: d });
    }
    return out;
  }

  /*
   * A colour layer cut in two at the coast, for drawing it over smooth heights: `land` has every sea
   * texel next to land given the mean colour of that land, `sea` the other way round. The viewer reads
   * `land` where the heights stand above the sea and `sea` below, so a coast follows the heights, not the
   * layer's texels. Without heights of the same size, both are the layer itself.
   */
  function splitLayer(data, W, H, z) {
    if (!z || z.length !== W * H) return { land: data, sea: data };
    const land = new Uint8Array(data), sea = new Uint8Array(data);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, up = z[k] > 0, dst = up ? sea : land;
      const s = [0, 0, 0, 0]; let n = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = j + dj; if (jj < 0 || jj >= H) continue;
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const q = jj * W + ((i + di + W) % W);
          if ((z[q] > 0) === up) continue;
          for (let c = 0; c < 4; c++) s[c] += data[q * 4 + c];
          n++;
        }
      }
      if (n) for (let c = 0; c < 4; c++) dst[k * 4 + c] = Math.round(s[c] / n);
    }
    return { land, sea };
  }

  /*
   * The CPU's colours for a grid of heights (where there is no WebGL2, and for exports then): the ramps,
   * the layer over them, lit from the north-west like the GPU, the mask on top. src: {W, H, z, factor,
   * wrap, cellM: [east, north] metres a cell at the equator}; style {shade}; layer and mask: RGBA or null.
   */
  function colourImage(src, style, ramps, layer, mask, rows) {
    const { W, H, z } = src, f = src.factor ?? 1, out = src.out || new Uint8ClampedArray(W * H * 4);
    const [j0, j1] = rows || [0, H - 1], ve = clamp(1.5 + (0.25 * src.cellM[1]) / 1000, 1.5, 16), Lx = -0.55, Ly = 0.55, Lz = 0.63;
    for (let j = Math.max(0, j0); j <= Math.min(H - 1, j1); j++) {
      const cosl = src.wrap ? Math.max(0.05, Math.cos((90 - ((j + 0.5) * 180) / H) * D2R)) : 1;
      for (let i = 0; i < W; i++) {
        const k = j * W + i, v = z[k];
        let c = v > 0 ? lookup(ramps.land, v * f) : lookup(ramps.sea, -v);
        if (layer) { const a = layer[k * 4 + 3] / 255; if (a > 0) c = [0, 1, 2].map((q) => c[q] + (layer[k * 4 + q] - c[q]) * a); }
        if (style.shade !== false && v > 0) {
          const ie = i + 1 < W ? i + 1 : src.wrap ? 0 : i, iw = i > 0 ? i - 1 : src.wrap ? W - 1 : i;
          const e = Math.max(0, z[j * W + ie]), wv = Math.max(0, z[j * W + iw]), n = Math.max(0, z[Math.max(0, j - 1) * W + i]), s = Math.max(0, z[Math.min(H - 1, j + 1) * W + i]);
          const gx = (f * ve * (e - wv)) / (2 * src.cellM[0] * cosl), gy = (f * ve * (n - s)) / (2 * src.cellM[1]), len = Math.hypot(gx, gy, 1);
          const sh = clamp((0.3 + 0.95 * ((-gx * Lx - gy * Ly + Lz) / len)) / (0.3 + 0.95 * Lz), 0.45, 1.3);
          c = [c[0] * sh, c[1] * sh, c[2] * sh];
        }
        if (mask) { const a = mask[k * 4 + 3] / 255; if (a > 0) c = [0, 1, 2].map((q) => c[q] + (mask[k * 4 + q] - c[q]) * a); }
        const o = k * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
      }
    }
    return out;
  }

  // ── the GPU's program: a quad over the view, each pixel finding its place on the planet ──
  const VS = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const FS = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
out vec4 outColor;
uniform vec2 uSize;          // the view, CSS px
uniform float uPx;           // device px a CSS px
uniform int uProj;           // 0 globe, 1 flat, 2 the whole map (an export)
uniform vec3 uE, uN, uU;     // the camera's screen right, up and outward, in the planet's frame
uniform float uAlt, uFocal;
uniform vec4 uFlat;          // flat: centre lat, lon, px a degree, east-west stretch
uniform float uRadiusM;
uniform sampler2D uH; uniform int uHasH; uniform int uHLevels; uniform float uFactor;
uniform sampler2D uRampL, uRampS; uniform vec2 uRampMax;
uniform sampler2D uLayL, uLayS; uniform int uLayer;
uniform sampler2D uMask; uniform int uHasMask;
uniform sampler2D uP0H, uP0L, uP1H, uP1L, uP2H, uP2L;
uniform vec4 uPF[3];         // north, west, dLat, dLon
uniform vec3 uPI[3];         // levels, has a layer, factor
uniform int uPN;
uniform int uShade;
uniform vec4 uRim, uCoast;
const float PI = 3.141592653589793;

vec4 crw(float t) { float t2 = t * t, t3 = t2 * t; return 0.5 * vec4(-t3 + 2.0 * t2 - t, 3.0 * t3 - 5.0 * t2 + 2.0, -3.0 * t3 + 4.0 * t2 + t, t3 - t2); }
vec4 crd(float t) { float t2 = t * t; return 0.5 * vec4(-3.0 * t2 + 4.0 * t - 1.0, 9.0 * t2 - 10.0 * t, -9.0 * t2 + 8.0 * t + 1.0, 3.0 * t2 - 2.0 * t); }
// height and the land's slope along x and y (in this level's texels), Catmull-Rom over 4 x 4 samples
vec3 cubic(sampler2D t, vec2 uv, int lod, bool wrap) {
  ivec2 sz = textureSize(t, lod);
  vec2 p = uv * vec2(sz) - 0.5, f = floor(p), fr = p - f;
  ivec2 b = ivec2(f) - 1;
  vec4 wx = crw(fr.x), wy = crw(fr.y), dx = crd(fr.x), dy = crd(fr.y);
  ivec4 xs;
  for (int i = 0; i < 4; i++) { int ii = b.x + i; if (wrap) ii = ii < 0 ? ii + sz.x : (ii >= sz.x ? ii - sz.x : ii); else ii = clamp(ii, 0, sz.x - 1); xs[i] = ii; }
  vec3 r = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    int jj = clamp(b.y + j, 0, sz.y - 1);
    vec4 row = vec4(texelFetch(t, ivec2(xs.x, jj), lod).r, texelFetch(t, ivec2(xs.y, jj), lod).r, texelFetch(t, ivec2(xs.z, jj), lod).r, texelFetch(t, ivec2(xs.w, jj), lod).r);
    vec4 rl = max(row, vec4(0.0));                                  // (slopes of the land: the sea floor lights nothing)
    r += vec3(wy[j] * dot(row, wx), wy[j] * dot(rl, dx), dy[j] * dot(rl, wx));
  }
  return r;
}
// the same, between two levels for a pixel covering 2^lod texels; slopes in level 0's texels
vec3 heightAt(sampler2D t, vec2 uv, float lod, int levels, bool wrap) {
  lod = clamp(lod, 0.0, float(levels - 1));
  int l0 = int(floor(lod));
  float f = lod - float(l0);
  vec2 s0 = vec2(textureSize(t, 0));
  vec3 a = cubic(t, uv, l0, wrap);
  a.yz *= vec2(textureSize(t, l0)) / s0;
  if (f > 0.02 && l0 + 1 < levels) { vec3 b = cubic(t, uv, l0 + 1, wrap); b.yz *= vec2(textureSize(t, l0 + 1)) / s0; a = mix(a, b, f); }
  return a;
}
vec3 landC(float m) { return texture(uRampL, vec2(clamp(m / uRampMax.x, 0.0, 1.0), 0.5)).rgb; }
vec3 seaC(float m) { return texture(uRampS, vec2(clamp(m / uRampMax.y, 0.0, 1.0), 0.5)).rgb; }
float lodOf(float fp, float texRad) { return log2(max(fp, 1e-12) / texRad) - 0.25; }

// a closer patch, if [lat, lon] is in it: its heights (and colours) replace what is there
bool patchAt(sampler2D th, sampler2D tl, vec4 fr, vec3 inf, float lat, float lon, float fp, float coslat,
             inout float h, inout vec2 slope, inout vec3 col, inout float texM, inout float fac) {
  float dl = lon - fr.y; dl -= 360.0 * floor(dl / 360.0);
  vec2 uv = vec2(dl / fr.w, (fr.x - lat) / fr.z);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return false;
  ivec2 sz = textureSize(th, 0);
  float ty = radians(fr.z) / float(sz.y), lod = lodOf(fp, ty);
  vec3 g = heightAt(th, uv, lod, int(inf.x), false);
  float tyM = ty * uRadiusM, txM = radians(fr.w) * uRadiusM * coslat / float(sz.x);
  h = g.x; slope = vec2(g.y / txM, -g.z / tyM); texM = tyM * exp2(max(lod, 0.0)); fac = inf.z;
  col = h > 0.0 ? landC(h * fac) : seaC(-h);
  if (inf.y > 0.5 && h > 0.0) {
    vec4 c = textureLod(tl, uv, max(lodOf(fp, radians(fr.z) / float(textureSize(tl, 0).y)), 0.0));
    col = mix(col, c.rgb, c.a);
  }
  return true;
}

void main() {
  vec2 s = vec2(gl_FragCoord.x / uPx, uSize.y - gl_FragCoord.y / uPx);
  float alpha = 1.0, mu = 1.0, rimD = 1e9, lat, lon;
  vec3 P;
  if (uProj == 0) {
    vec3 d = normalize(vec3((s.x - 0.5 * uSize.x) / uFocal, (0.5 * uSize.y - s.y) / uFocal, -1.0));
    float D = 1.0 + uAlt, b = D * d.z, c = uAlt * (2.0 + uAlt), disc = b * b - c;
    vec3 q;
    if (disc >= 0.0) { float t = c / (-b + sqrt(disc)); q = vec3(0.0, 0.0, D) + t * d; mu = max(0.0, -dot(q, d)); }
    else { float r = max(length(d.xy), 1e-9), cc = 1.0 / D, ss = sqrt(max(0.0, 1.0 - cc * cc)); q = vec3(ss * d.xy / r, cc); mu = 0.0; }
    P = q.x * uE + q.y * uN + q.z * uU;
    lat = degrees(atan(P.z, length(P.xy))); lon = degrees(atan(P.y, P.x));
    float Rd = uFocal / sqrt(c), r = length(s - 0.5 * uSize);
    alpha = clamp(Rd - r + 0.5, 0.0, 1.0); rimD = abs(r - Rd);
  } else {
    if (uProj == 1) { lat = uFlat.x + (0.5 * uSize.y - s.y) / uFlat.z; lon = uFlat.y + (s.x - 0.5 * uSize.x) / (uFlat.z * uFlat.w); alpha = clamp((90.0 - abs(lat)) * uFlat.z + 0.5, 0.0, 1.0); }
    else { lat = 90.0 - s.y / uSize.y * 180.0; lon = s.x / uSize.x * 360.0 - 180.0; }
    lat = clamp(lat, -90.0, 90.0);
    float cl = cos(radians(lat));
    P = vec3(cl * cos(radians(lon)), cl * sin(radians(lon)), sin(radians(lat)));
  }
  float fp = max(length(dFdx(P)), length(dFdy(P)));            // radians a pixel
  float coslat = max(cos(radians(lat)), 0.05);
  float h = 0.0, texM = 1e5, fac = uFactor;
  vec2 slope = vec2(0.0);
  vec3 col = vec3(0.0);
  vec2 uv = vec2(fract((lon + 180.0) / 360.0), clamp((90.0 - lat) / 180.0, 0.0, 1.0));
  if (uHasH == 1) {
    ivec2 sz = textureSize(uH, 0);
    float ty = PI / float(sz.y), lod = lodOf(fp, ty);
    vec3 g = heightAt(uH, uv, lod, uHLevels, true);
    float tyM = ty * uRadiusM, txM = 2.0 * PI * uRadiusM * coslat / float(sz.x);
    h = g.x; slope = vec2(g.y / txM, -g.z / tyM); texM = tyM * exp2(max(lod, 0.0));
    col = h > 0.0 ? landC(h * fac) : seaC(-h);
    if (uLayer == 1) {
      float ll = max(lodOf(fp, PI / float(textureSize(uLayL, 0).y)), 0.0);
      vec4 c = h > 0.0 ? textureLod(uLayL, uv, ll) : textureLod(uLayS, uv, ll);
      col = mix(col, c.rgb, c.a);
    }
  } else alpha = 0.0;
  bool inPatch = false;
  if (uPN > 0) inPatch = patchAt(uP0H, uP0L, uPF[0], uPI[0], lat, lon, fp, coslat, h, slope, col, texM, fac) || inPatch;
  if (uPN > 1) inPatch = patchAt(uP1H, uP1L, uPF[1], uPI[1], lat, lon, fp, coslat, h, slope, col, texM, fac) || inPatch;
  if (uPN > 2) inPatch = patchAt(uP2H, uP2L, uPF[2], uPI[2], lat, lon, fp, coslat, h, slope, col, texM, fac) || inPatch;
  if (uShade == 1 && h > 0.0) {
    float ve = clamp(1.5 + 0.25 * texM / 1000.0, 1.5, 16.0);
    vec3 n = normalize(vec3(-ve * fac * slope.x, -ve * fac * slope.y, 1.0)), L = vec3(-0.55, 0.55, 0.63);
    col *= clamp((0.3 + 0.95 * dot(n, L)) / (0.3 + 0.95 * 0.63), 0.45, 1.3);
  }
  float fw = fwidth(h);
  if (uCoast.a > 0.0) col = mix(col, uCoast.rgb, uCoast.a * (1.0 - smoothstep(0.6 * uPx, 1.4 * uPx, abs(h) / max(fw, 1e-6))));
  if (uHasMask == 1 && !inPatch) { vec4 m = textureLod(uMask, uv, max(lodOf(fp, PI / float(textureSize(uMask, 0).y)), 0.0)); col = mix(col, m.rgb, m.a); }
  if (uProj == 0) {
    col *= 0.62 + 0.38 * mu;
    float rim = uRim.a * (1.0 - smoothstep(0.5 * uPx, 1.5 * uPx, rimD * uPx));
    col = mix(col, uRim.rgb, rim); alpha = max(alpha, rim);
  }
  if (uProj == 2) alpha = 1.0;
  outColor = vec4(col * alpha, alpha);
}`;
  const UNIFORMS = ['uSize', 'uPx', 'uProj', 'uE', 'uN', 'uU', 'uAlt', 'uFocal', 'uFlat', 'uRadiusM', 'uH', 'uHasH', 'uHLevels', 'uFactor', 'uRampL', 'uRampS', 'uRampMax', 'uLayL', 'uLayS', 'uLayer', 'uMask', 'uHasMask',
    'uP0H', 'uP0L', 'uP1H', 'uP1L', 'uP2H', 'uP2L', 'uPF', 'uPI', 'uPN', 'uShade', 'uRim', 'uCoast'];
  const UNIT = { uH: 0, uRampL: 1, uRampS: 2, uLayL: 3, uLayS: 4, uMask: 5, uP0H: 6, uP0L: 7, uP1H: 8, uP1L: 9, uP2H: 10, uP2L: 11 };
  const MAX_PATCHES = 3;

  const noGL = () => typeof location !== 'undefined' && /[?&]nowebgl\b/.test(location.search);
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const rgbOf = (s, fallback) => {
    if (!s) return fallback;
    if (s[0] === '#') { const x = s.length === 4 ? s.slice(1).split('').map((c) => c + c) : [s.slice(1, 3), s.slice(3, 5), s.slice(5, 7)]; return x.map((v) => parseInt(v, 16) / 255); }
    const m = s.match(/[\d.]+/g); return m ? m.slice(0, 3).map((v) => Number(v) / 255) : fallback;
  };

  /*
   * A viewer in `host` (which sets its size). opts: projection ('globe' | 'flat'), lat, lon, alt,
   * minAlt (the closest it may go, in planet radii), radiusKm, label (for screen readers), and callbacks:
   * onHover([lat, lon] | null, event), onClick([lat, lon], event), onStroke('start' | 'move' | 'end',
   * [lat, lon] | null, event) in stroke mode, onView(view, moving) after the view changes.
   */
  function create(host, opts = {}) {
    const doc = host.ownerDocument;
    const el = doc.createElement('div'); el.className = 'viewer';
    let cv = doc.createElement('canvas'); cv.className = 'viewer-gl';
    const ov = doc.createElement('canvas'); ov.className = 'viewer-ov'; ov.tabIndex = 0; ov.setAttribute('role', 'img'); ov.setAttribute('aria-label', opts.label || 'Map');
    const ctl = doc.createElement('div'); ctl.className = 'viewer-ctl';
    const button = (text, label, fn) => { const b = doc.createElement('button'); b.type = 'button'; b.className = 'btn small'; b.textContent = text; b.setAttribute('aria-label', label); b.title = label; b.addEventListener('click', fn); ctl.appendChild(b); return b; };
    button('+', 'Zoom in', () => { Cam.zoomBy(cam, cam.w / 2, cam.h / 2, 0.5); kick(); });
    button('−', 'Zoom out', () => { Cam.zoomBy(cam, cam.w / 2, cam.h / 2, 2); kick(); });
    button('⟲', 'Reset view', () => { reset(); });
    el.append(cv, ov, ctl);
    host.classList.add('has-viewer');
    host.appendChild(el);
    const og = ov.getContext('2d');

    const cam = Cam.create({ projection: opts.projection || 'globe', lat: opts.lat ?? 20, lon: opts.lon ?? 0, alt: opts.alt ?? null, minAlt: opts.minAlt, w: host.clientWidth || 800, h: host.clientHeight || 400 });
    const home = { lat: opts.lat ?? 20, lon: opts.lon ?? 0 };
    let radiusKm = opts.radiusKm || 6371;
    // what is drawn (kept on the CPU too: for a lost context, and the fallback)
    const st = { height: null, layer: null, mask: null, patches: [], style: { shade: true, coast: null, sea: SEA, land: LAND }, overlay: null, message: '', mode: 'grab' };
    let ramps = { land: rampTable(LAND), sea: rampTable(SEA) };
    let dpr = 1, res = 1, destroyed = false;

    // ── WebGL2, or the CPU ──
    let gl = null, prog = null, U = {}, T = {}, lost = false, timer = null;
    const useGL = !noGL() && opts.webgl !== false;
    if (useGL) { try { gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }); } catch { gl = null; } }
    const cpu = gl ? null : { g: cv.getContext('2d'), small: doc.createElement('canvas'), world: null, patches: [] };
    function initGL() {
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) throw new Error(gl.getShaderInfoLog(s)); return s; };
      prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
      gl.bindAttribLocation(prog, 0, 'aPos'); gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error(gl.getProgramInfoLog(prog));
      U = {}; for (const n of UNIFORMS) U[n] = gl.getUniformLocation(prog, n) || gl.getUniformLocation(prog, `${n}[0]`);
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.useProgram(prog);
      for (const [n, u] of Object.entries(UNIT)) gl.uniform1i(U[n], u);
      T = {};
      T.blankF = texF(null, [{ w: 1, h: 1, data: new Float32Array(1) }], false);
      T.blankC = texC(null, 1, 1, new Uint8Array(4), false);
      for (const [n, u] of Object.entries(UNIT)) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, /H$/.test(n) ? T.blankF : T.blankC); }
      timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
      uploadAll();
    }
    /* A float texture of heights with its levels (read with texelFetch: no filtering needed). */
    function texF(tex, levels, wrap) {
      gl.activeTexture(gl.TEXTURE15);                                     // (a spare unit: the others stay bound)
      tex = tex || gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      levels.forEach((L, i) => gl.texImage2D(gl.TEXTURE_2D, i, gl.R32F, L.w, L.h, 0, gl.RED, gl.FLOAT, L.data));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, levels.length - 1);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }
    /* A colour texture (RGBA), smoothed and with levels. */
    function texC(tex, W, H, data, wrap, mips = true) {
      gl.activeTexture(gl.TEXTURE15);
      tex = tex || gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
      if (mips) gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return tex;
    }
    const bindUnit = (name, tex) => { gl.activeTexture(gl.TEXTURE0 + UNIT[name]); gl.bindTexture(gl.TEXTURE_2D, tex); };
    function uploadRamps() {
      T.rampL = texC(T.rampL, ramps.land.n, 1, ramps.land.data, false, false); bindUnit('uRampL', T.rampL);
      T.rampS = texC(T.rampS, ramps.sea.n, 1, ramps.sea.data, false, false); bindUnit('uRampS', T.rampS);
    }
    function uploadHeight() {
      const H = st.height;
      if (!H) return;
      H.levels = mipChain(H.z, H.W, H.H, true);
      T.h = texF(T.h, H.levels, true); bindUnit('uH', T.h);
    }
    function uploadLayer() {
      const L = st.layer;
      if (!L) return;
      const parts = splitLayer(L.data, L.W, L.H, L.land ? null : st.height && st.height.z.length === L.W * L.H ? st.height.z : null);
      T.layL = texC(T.layL, L.W, L.H, parts.land, true); bindUnit('uLayL', T.layL);
      T.layS = texC(T.layS, L.W, L.H, parts.sea, true); bindUnit('uLayS', T.layS);
    }
    function uploadMask() { if (st.mask) { T.mask = texC(T.mask, st.mask.W, st.mask.H, st.mask.data, true); bindUnit('uMask', T.mask); } }
    function uploadPatch(i) {
      const p = st.patches[i], slot = T.p || (T.p = []);
      slot[i] = slot[i] || {};
      if (slot[i].z !== p.z) { p.levels = mipChain(p.z, p.W, p.H, false); slot[i].h = texF(slot[i].h, p.levels, false); slot[i].z = p.z; }
      if (p.layer && slot[i].layer !== p.layer) { slot[i].l = texC(slot[i].l, p.W, p.H, splitLayer(p.layer, p.W, p.H, p.z).land, false); slot[i].layer = p.layer; }
      bindUnit(`uP${i}H`, slot[i].h); bindUnit(`uP${i}L`, p.layer ? slot[i].l : T.blankC);
    }
    function uploadAll() { uploadRamps(); uploadHeight(); uploadLayer(); uploadMask(); if (T.p) T.p = []; st.patches.forEach((_, i) => uploadPatch(i)); }
    if (gl) {
      try { initGL(); } catch (e) { console.error(e); gl = null; }
      cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
      cv.addEventListener('webglcontextrestored', () => { lost = false; try { initGL(); kick(); } catch (e) { console.error(e); } });
    }
    const fallback = !gl;
    if (fallback && !cpu) { const c2 = doc.createElement('canvas'); c2.className = cv.className; cv.replaceWith(c2); cv = c2; }   // (a WebGL2 context that would not start)
    const cpuState = fallback ? (cpu || { g: cv.getContext('2d'), small: doc.createElement('canvas'), world: null, patches: [] }) : null;

    // ── the CPU's drawing: the colours worked out once per change, then looked up per pixel ──
    const cellM = (W, H, dLat = 180, dLon = 360) => [(dLon * D2R * radiusKm * 1000) / W, (dLat * D2R * radiusKm * 1000) / H];
    function cpuWorld(rows) {
      const H = st.height;
      if (!H) { cpuState.world = null; return; }
      const L = st.layer && st.layer.W === H.W && st.layer.H === H.H ? st.layer.data : null, M = st.mask && st.mask.W === H.W && st.mask.H === H.H ? st.mask.data : null;
      const src = { W: H.W, H: H.H, z: H.z, factor: H.factor, wrap: true, cellM: cellM(H.W, H.H), out: rows && cpuState.world ? cpuState.world.px : null };
      const px = colourImage(src, st.style, ramps, L, M, rows);
      cpuState.world = { px, W: H.W, H: H.H };
    }
    function cpuPatches() {
      cpuState.patches = st.patches.map((p) => ({ frame: p.frame, W: p.W, H: p.H, px: colourImage({ W: p.W, H: p.H, z: p.z, factor: p.factor, wrap: false, cellM: cellM(p.W, p.H, p.frame.dLat, p.frame.dLon) }, st.style, ramps, p.layer ? p.layer : null, null) }));
    }
    function cpuDraw(moving) {
      const g = cpuState.g, s = moving ? 0.5 : Math.min(1, dpr), W = Math.max(1, Math.round(cam.w * s)), H = Math.max(1, Math.round(cam.h * s));
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
      const wd = cpuState.world;
      if (!wd) return;
      const sm = cpuState.small; if (sm.width !== W || sm.height !== H) { sm.width = W; sm.height = H; }
      const sg = sm.getContext('2d'), img = sg.createImageData(W, H), d = img.data;
      const F = Cam.frame(cam), D = F.D, c = cam.alt * (2 + cam.alt), flat = cam.projection === 'flat', k = Cam.ppd(cam), str = flat ? Cam.stretch(cam) : 1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const X = (x + 0.5) / s, Y = (y + 0.5) / s;
        let la, lo, mu = 1;
        if (flat) { la = cam.lat + (cam.h / 2 - Y) / k; if (Math.abs(la) > 90) continue; lo = wrap180(cam.lon + (X - cam.w / 2) / (k * str)); }
        else {
          let dx = (X - cam.w / 2) / F.f, dy = (cam.h / 2 - Y) / F.f, dz = -1; const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
          const b = D * dz, disc = b * b - c; if (disc < 0) continue;
          const t = c / (-b + Math.sqrt(disc)), qx = t * dx, qy = t * dy, qz = D + t * dz;
          mu = -(qx * dx + qy * dy + qz * dz);
          const px = qx * F.e[0] + qy * F.n[0] + qz * F.u[0], py = qx * F.e[1] + qy * F.n[1] + qz * F.u[1], pz = qx * F.e[2] + qy * F.n[2] + qz * F.u[2];
          la = Math.atan2(pz, Math.hypot(px, py)) * R2D; lo = Math.atan2(py, px) * R2D;
        }
        let src = null, idx = 0;
        for (let q = cpuState.patches.length - 1; q >= 0 && !src; q--) {
          const p = cpuState.patches[q], fr = p.frame, dl = ((((lo - fr.west) % 360) + 360) % 360);
          if (la <= fr.north && la >= fr.north - fr.dLat && dl <= fr.dLon) { src = p; idx = (clamp(Math.floor(((fr.north - la) / fr.dLat) * p.H), 0, p.H - 1) * p.W + clamp(Math.floor((dl / fr.dLon) * p.W), 0, p.W - 1)) * 4; }
        }
        if (!src) { src = wd; idx = (clamp(Math.floor(((90 - la) / 180) * wd.H), 0, wd.H - 1) * wd.W + ((Math.floor(((lo + 180) / 360) * wd.W) % wd.W) + wd.W) % wd.W) * 4; }
        const lit = flat ? 1 : 0.62 + 0.38 * mu, o = (y * W + x) * 4;
        d[o] = src.px[idx] * lit; d[o + 1] = src.px[idx + 1] * lit; d[o + 2] = src.px[idx + 2] * lit; d[o + 3] = 255;
      }
      sg.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true; g.drawImage(sm, 0, 0, cv.width, cv.height);
      if (!flat) { const R = F.f / Math.sqrt(c); g.save(); g.scale(cv.width / cam.w, cv.height / cam.h); g.strokeStyle = colours.rimCss; g.lineWidth = 1.5; g.beginPath(); g.arc(cam.w / 2, cam.h / 2, R, 0, 2 * Math.PI); g.stroke(); g.restore(); }
    }

    // ── drawing a frame ──
    let colours = { rim: [0.5, 0.5, 0.5], rimCss: '#888', t: -1e9 };
    function readColours(now) {
      if (now - colours.t < 400) return;
      const line = css('--line') || '#888';
      colours = { rim: rgbOf(line, [0.5, 0.5, 0.5]), rimCss: line, muted: css('--muted') || '#999', font: css('--font-mono') || 'monospace', t: now };
    }
    const times = [];
    let lastFrame = 0, raf = 0, interacting = false;
    function render(isMoving) {
      const t0 = performance.now();
      readColours(t0);
      if (gl && !lost) drawGL(isMoving);
      else if (fallback) cpuDraw(isMoving);
      drawOverlay();
      const ms = performance.now() - t0;
      times.push(ms); if (times.length > 60) times.shift();
      return ms;
    }
    function drawGL(isMoving) {
      const want = isMoving ? res : 1;
      const W = Math.max(1, Math.round(cam.w * dpr * want)), H = Math.max(1, Math.round(cam.h * dpr * want));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      setUniforms(W / cam.w, cam.w, cam.h, cam.projection === 'flat' ? 1 : 0);
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function setUniforms(px, w, h, proj) {
      const F = Cam.frame(cam), Hh = st.height, sty = st.style;
      gl.useProgram(prog);
      gl.uniform2f(U.uSize, w, h); gl.uniform1f(U.uPx, px); gl.uniform1i(U.uProj, proj);
      gl.uniform3fv(U.uE, F.e); gl.uniform3fv(U.uN, F.n); gl.uniform3fv(U.uU, F.u);
      gl.uniform1f(U.uAlt, cam.alt); gl.uniform1f(U.uFocal, F.f);
      gl.uniform4f(U.uFlat, cam.lat, cam.lon, Cam.ppd(cam), cam.projection === 'flat' ? Cam.stretch(cam) : 1);
      gl.uniform1f(U.uRadiusM, radiusKm * 1000);
      gl.uniform1i(U.uHasH, Hh ? 1 : 0); gl.uniform1i(U.uHLevels, Hh ? Hh.levels.length : 1); gl.uniform1f(U.uFactor, Hh ? Hh.factor : 1);
      gl.uniform2f(U.uRampMax, ramps.land.max, ramps.sea.max);
      gl.uniform1i(U.uLayer, st.layer ? 1 : 0); gl.uniform1i(U.uHasMask, st.mask ? 1 : 0);
      const n = Math.min(MAX_PATCHES, st.patches.length), pf = new Float32Array(12), pi = new Float32Array(9);
      st.patches.slice(0, n).forEach((p, i) => { pf.set([p.frame.north, p.frame.west, p.frame.dLat, p.frame.dLon], i * 4); pi.set([p.levels.length, p.layer ? 1 : 0, p.factor ?? 1], i * 3); });
      gl.uniform4fv(U.uPF, pf); gl.uniform3fv(U.uPI, pi); gl.uniform1i(U.uPN, n);
      gl.uniform1i(U.uShade, sty.shade !== false ? 1 : 0);
      gl.uniform4f(U.uRim, ...colours.rim, sty.rim === false || (!Hh && !n) ? 0 : 0.9);
      const cc = sty.coast ? rgbOf(sty.coast, [0.1, 0.1, 0.12]) : [0, 0, 0];
      gl.uniform4f(U.uCoast, ...cc, sty.coast ? 0.9 : 0);
    }
    /* What the overlay is given to draw with. */
    function viewOf() {
      const F = Cam.frame(cam), flat = cam.projection === 'flat', k = Cam.ppd(cam), str = flat ? Cam.stretch(cam) : 1, D = F.D, hw = cam.w / 2, hh = cam.h / 2;
      const project = flat
        ? (la, lo) => [hw + wrap180(lo - cam.lon) * k * str, hh - (la - cam.lat) * k, true]
        : (la, lo) => {
          const p = la * D2R, l = lo * D2R, cp = Math.cos(p), x = cp * Math.cos(l), y = cp * Math.sin(l), z = Math.sin(p);
          const a = x * F.e[0] + y * F.e[1] + z * F.e[2], b = x * F.n[0] + y * F.n[1] + z * F.n[2], c = x * F.u[0] + y * F.u[1] + z * F.u[2], vz = D - c;
          return [hw + (F.f * a) / vz, hh - (F.f * b) / vz, c > 1 / D];
        };
      const scale = Cam.scale(cam);
      return { project, w: cam.w, h: cam.h, dpr, scale, kmPx: (Math.PI * radiusKm) / 180 / scale, projection: cam.projection, lat: cam.lat, lon: cam.lon, pick: (x, y) => Cam.pick(cam, x, y), radiusKm };
    }
    function drawOverlay() {
      const W = Math.round(cam.w * dpr), H = Math.round(cam.h * dpr);
      if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
      og.setTransform(1, 0, 0, 1, 0, 0); og.clearRect(0, 0, W, H);
      og.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (st.overlay && (st.height || st.patches.length)) { try { og.save(); st.overlay(og, viewOf()); og.restore(); } catch (e) { console.error(e); } }
      if (st.message) { og.fillStyle = colours.muted || '#999'; og.font = `16px ${colours.font || 'monospace'}`; og.fillText(st.message, 20, 34); }
    }

    // ── the loop: draw only when something changed ──
    function kick() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }
    let lowFrames = 0, fastFrames = 0;
    function frame(t) {
      raf = 0;
      if (destroyed) return;
      const dt = lastFrame ? Math.min(50, t - lastFrame) : 16;
      const anim = Cam.step(cam, dt);
      const nowMoving = anim || interacting;
      render(nowMoving);
      // a frame over 20 ms while moving: draw the next ones at a lower resolution
      if (nowMoving && lastFrame && t - lastFrame > 20) { fastFrames = 0; if (++lowFrames >= 3) { res = Math.max(0.5, res * 0.8); lowFrames = 0; } }
      else if (nowMoving && lastFrame && t - lastFrame < 14 && res < 1) { lowFrames = 0; if (++fastFrames >= 30) { res = Math.min(1, res * 1.15); fastFrames = 0; } }
      lastFrame = nowMoving ? t : 0;
      if (opts.onView) opts.onView(api.view(), nowMoving);
      if (anim) kick();
    }

    // ── size ──
    function fit() {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      dpr = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
      if (w !== cam.w || h !== cam.h) Cam.resize(cam, w, h);
      if (fallback) { cv.width = Math.round(w * Math.min(1, dpr)); cv.height = Math.round(h * Math.min(1, dpr)); }
      kick();
    }
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    if (ro) ro.observe(host);

    // ── pointer, wheel, keys ──
    const ptrs = new Map();
    let grabbed = null, pinch = null, stroke = false, down = null;
    const xy = (e) => { const r = ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const at = (x, y) => Cam.pick(cam, x, y);
    function startPinch() {
      const [a, b] = [...ptrs.values()], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      Cam.normalize(cam);
      pinch = { g: Cam.grab(cam, mx, my), d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1 };
      grabbed = null;
    }
    ov.addEventListener('pointerdown', (e) => {
      ov.focus({ preventScroll: true });
      try { ov.setPointerCapture(e.pointerId); } catch { /* (an ended pointer) */ }
      const p = xy(e); ptrs.set(e.pointerId, p);
      down = { x: p[0], y: p[1], t: performance.now(), moved: false };
      if (ptrs.size === 2) {
        if (stroke) { stroke = false; if (opts.onStroke) opts.onStroke('end', null, e); }
        startPinch(); interacting = true; kick(); return;
      }
      if (ptrs.size > 2) return;
      if (st.mode === 'stroke' && e.button === 0 && opts.onStroke) { stroke = true; opts.onStroke('start', at(...p), e); return; }
      Cam.normalize(cam);
      grabbed = Cam.grab(cam, p[0], p[1]); Cam.drag(cam, grabbed, p[0], p[1], e.timeStamp || performance.now());
      interacting = true; el.classList.add('grabbing');
    });
    ov.addEventListener('pointermove', (e) => {
      const p = xy(e);
      if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
      if (down && Math.hypot(p[0] - down.x, p[1] - down.y) > 4) down.moved = true;
      if (pinch && ptrs.size >= 2) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
        Cam.pinch(cam, pinch.g, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, pinch.d / d); pinch.d = d;
        kick(); return;
      }
      if (stroke) { if (opts.onStroke) opts.onStroke('move', at(...p), e); }
      else if (grabbed) { Cam.drag(cam, grabbed, p[0], p[1], e.timeStamp || performance.now()); kick(); }
      if (opts.onHover) opts.onHover(at(...p), e);
    });
    function up(e) {
      const had = ptrs.delete(e.pointerId);
      if (!had) return;
      const p = xy(e);
      if (pinch) {
        if (ptrs.size < 2) {
          pinch = null;
          // the finger left on the screen carries on turning it
          if (ptrs.size === 1) { const q = [...ptrs.values()][0]; grabbed = Cam.grab(cam, q[0], q[1]); }
          else { interacting = false; Cam.settle(cam); kick(); }
        }
        down = null; return;
      }
      if (stroke) { stroke = false; if (opts.onStroke) opts.onStroke('end', at(...p), e); }
      else if (grabbed) { Cam.release(cam, grabbed, e.timeStamp || performance.now()); grabbed = null; interacting = false; el.classList.remove('grabbing'); kick(); }
      if (down && !down.moved && e.type === 'pointerup' && performance.now() - down.t < 500 && opts.onClick) { const ll = at(...p); if (ll) opts.onClick(ll, e); }
      down = null;
    }
    ov.addEventListener('pointerup', up);
    ov.addEventListener('pointercancel', up);
    ov.addEventListener('pointerleave', (e) => { if (!ptrs.size && opts.onHover) opts.onHover(null, e); });
    ov.addEventListener('lostpointercapture', (e) => { if (ptrs.has(e.pointerId)) up(e); });
    ov.addEventListener('contextmenu', (e) => { if (st.mode === 'stroke') e.preventDefault(); });
    ov.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [x, y] = xy(e), d = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      Cam.zoomAt(cam, x, y, Math.exp(clamp(d, -300, 300) * (e.ctrlKey ? 0.01 : 0.0015)));
      interacting = true; kick();
      clearTimeout(wheelEnd); wheelEnd = setTimeout(() => { interacting = false; kick(); }, 140);
    }, { passive: false });
    let wheelEnd = null;
    ov.addEventListener('dblclick', (e) => { const [x, y] = xy(e); Cam.zoomBy(cam, x, y, e.shiftKey ? 2 : 0.5); kick(); });
    ov.addEventListener('keydown', (e) => {
      const step = 80, keys = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
      if (keys[e.key]) { Cam.panBy(cam, ...keys[e.key]); kick(); }
      else if (e.key === '+' || e.key === '=') Cam.zoomBy(cam, cam.w / 2, cam.h / 2, 0.5);
      else if (e.key === '-' || e.key === '_') Cam.zoomBy(cam, cam.w / 2, cam.h / 2, 2);
      else if (e.key === '0' || e.key === 'Home') reset();
      else return;
      e.preventDefault(); kick();
    });
    function reset() { Cam.reset(cam, home.lat, home.lon); kick(); }

    // ── the API ──
    const api = {
      el, canvas: cv, overlay: ov,
      /* Heights: {W, H, z (m, row 0 at the north, wrapping east-west), factor (the relief's stretch for the colours)}. */
      setHeight(hgt) {
        st.height = hgt ? { W: hgt.W, H: hgt.H, z: hgt.z instanceof Float32Array ? hgt.z : Float32Array.from(hgt.z), src: hgt.z, factor: hgt.factor ?? 1 } : null;
        if (gl) { if (st.height) uploadHeight(); if (st.layer) uploadLayer(); }
        if (fallback) cpuWorld();
        kick();
      },
      /* The heights changed in place between rows j0 and j1 (inclusive): the brush. */
      updateHeight(rect = {}) {
        const H = st.height;
        if (!H) return;
        const j0 = clamp(rect.j0 ?? 0, 0, H.H - 1), j1 = clamp(rect.j1 ?? H.H - 1, 0, H.H - 1);
        if (H.src !== H.z) for (let k = j0 * H.W; k < (j1 + 1) * H.W; k++) H.z[k] = H.src[k];
        if (gl && T.h) {
          H.levels = mipChain(H.z, H.W, H.H, true);
          gl.activeTexture(gl.TEXTURE15); gl.bindTexture(gl.TEXTURE_2D, T.h); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, j0, H.W, j1 - j0 + 1, gl.RED, gl.FLOAT, H.z.subarray(j0 * H.W, (j1 + 1) * H.W));
          for (let i = 1; i < H.levels.length; i++) { const L = H.levels[i]; gl.texSubImage2D(gl.TEXTURE_2D, i, 0, 0, L.w, L.h, gl.RED, gl.FLOAT, L.data); }
          if (st.layer && !st.layer.land) uploadLayer();
        }
        if (fallback) cpuWorld([j0 - 1, j1 + 1]);
        kick();
      },
      /* How it is drawn: shade (relief shading), coast (a CSS colour: a line along the coast), rim (false: none), sea and land ramps. */
      setStyle(s = {}) {
        Object.assign(st.style, s);
        if (s.sea || s.land) { ramps = { land: rampTable(st.style.land), sea: rampTable(st.style.sea) }; if (gl) uploadRamps(); }
        if (fallback) { cpuWorld(); cpuPatches(); }
        kick();
      },
      /* A colour layer over the relief: {W, H, data: RGBA, alpha its cover}, or null; land: true if it is for land only. */
      setLayer(l) { st.layer = l || null; if (gl && l) uploadLayer(); if (fallback) cpuWorld(); kick(); },
      /* Colours drawn over everything (alpha their cover), unlit: {W, H, data}, or null. */
      setMask(m) { st.mask = m || null; if (gl && m) uploadMask(); if (fallback) cpuWorld(); kick(); },
      /* Closer heights, deepest last: [{frame: {north, west, dLat, dLon}, W, H, z, factor, layer: RGBA for land or null}] (up to 3). */
      setPatches(list) {
        st.patches = (list || []).filter(Boolean).slice(0, MAX_PATCHES).map((p) => ({ ...p, z: p.z instanceof Float32Array ? p.z : Float32Array.from(p.z) }));
        if (gl) st.patches.forEach((_, i) => uploadPatch(i));
        if (fallback) cpuPatches();
        kick();
      },
      /* Lines and labels: fn(ctx2d, view) with view.project(lat, lon) → [x, y, visible] in CSS px. */
      setOverlay(fn) { st.overlay = fn || null; kick(); },
      setMessage(text) { if (st.message !== (text || '')) { st.message = text || ''; kick(); } },
      /* 'grab' (dragging turns the planet) or 'stroke' (dragging calls onStroke; the right button still turns it). */
      setMode(m) { st.mode = m; el.classList.toggle('stroking', m === 'stroke'); },
      setProjection(p) { Cam.setProjection(cam, p); kick(); },
      setRadius(km) { radiusKm = km || 6371; kick(); },
      /* The place under a point of the view (CSS px), or of a pointer event, or null. */
      pick(x, y) { if (typeof x === 'object' && x) { const p = xy(x); return at(p[0], p[1]); } return at(x, y); },
      project(lat, lon) { return viewOf().project(lat, lon); },
      /* Where it looks: centre, altitude (planet radii), projection; km a CSS px and across at the centre. */
      view() { const v = Cam.view(cam), s = Cam.scale(cam), kmPx = (Math.PI * radiusKm) / 180 / s; return { ...v, kmPx, spanKm: kmPx * Math.max(cam.w, cam.h), w: cam.w, h: cam.h }; },
      setView(v = {}) {
        if (v.projection && v.projection !== cam.projection) Cam.setProjection(cam, v.projection);
        if (v.lat != null) cam.lat = v.lat;
        if (v.lon != null) cam.lon = v.lon;
        if (v.spanKm) v = { ...v, alt: Cam.altForSpan(cam, v.spanKm / ((Math.PI * radiusKm) / 180)) };
        if (v.auto) cam.auto = true;
        else if (v.alt != null) { cam.alt = v.alt; cam.auto = false; }
        cam.anim = null; Cam.resize(cam, cam.w, cam.h); kick();
      },
      /* Fly there; spanKm: how much to show across. */
      flyTo(lat, lon, spanKm, ms = 700) { const alt = spanKm ? Cam.altForSpan(cam, spanKm / ((Math.PI * radiusKm) / 180)) : cam.alt; Cam.flyTo(cam, lat, lon, clamp(alt, ...Cam.limits(cam)), ms); kick(); },
      setHome(lat, lon) { home.lat = lat; home.lon = lon; },
      reset,
      redraw: kick,
      /* The whole map, flat, as a canvas of W x H (an export): what the view draws, without the overlay. */
      renderEquirect(W, H) {
        const out = doc.createElement('canvas'); out.width = W; out.height = H;
        const og2 = out.getContext('2d');
        if (gl && !lost) {
          gl.activeTexture(gl.TEXTURE15);
          const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
          const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          setUniforms(1, W, H, 2); gl.viewport(0, 0, W, H); gl.drawArrays(gl.TRIANGLES, 0, 3);
          const px = new Uint8Array(W * H * 4); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
          gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
          const img = og2.createImageData(W, H);
          for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
          og2.putImageData(img, 0, 0);
          kick();
        } else if (cpuState && cpuState.world) {
          const s = doc.createElement('canvas'); s.width = cpuState.world.W; s.height = cpuState.world.H;
          s.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(cpuState.world.px), s.width, s.height), 0, 0);
          og2.imageSmoothingEnabled = true; og2.drawImage(s, 0, 0, W, H);
        }
        return out;
      },
      /* Frame times: the last ones drawn (ms, CPU side), and n frames drawn and waited for (with the GPU). */
      stats() { const a = times.slice().sort((x, y) => x - y); return { gl: !!gl, res, frames: a.length, median: a[a.length >> 1], max: a[a.length - 1], dpr, size: [Math.round(cam.w * dpr), Math.round(cam.h * dpr)] }; },
      bench(n = 60, what = 'drag') {
        const out = [], g0 = Cam.grab(cam, cam.w / 2, cam.h / 2);
        for (let i = 0; i < n; i++) {
          if (what === 'drag') Cam.drag(cam, g0, cam.w / 2 + 6 * i, cam.h / 2 + 2 * i);
          else Cam.zoomAt(cam, cam.w * 0.6, cam.h * 0.4, i < n / 2 ? 0.93 : 1 / 0.93);
          const t0 = performance.now(); render(false);
          if (gl) gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));          // (waits for the GPU)
          out.push(performance.now() - t0);
        }
        out.sort((a, b) => a - b);
        kick();
        return { n, median: +out[n >> 1].toFixed(2), p90: +out[Math.floor(n * 0.9)].toFixed(2), max: +out[n - 1].toFixed(2), size: [cv.width, cv.height], gl: !!gl };
      },
      camera: cam,
      destroy() {
        destroyed = true; cancelAnimationFrame(raf); clearTimeout(wheelEnd);
        if (ro) ro.disconnect();
        if (gl) { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); }
        el.remove(); host.classList.remove('has-viewer');
      },
    };
    fit();
    return api;
  }

  const api = { create, rampTable, mipChain, splitLayer, colourImage, ramp, SEA, LAND };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.globe = api; }
})(typeof window !== 'undefined' ? window : globalThis);
