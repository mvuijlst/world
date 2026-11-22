/*
 * Spectral light: star spectra, sky colour, the colour of things lit by a sky.
 *
 * The sky follows the method described on Panoptes V, "Colors of Alien Worlds — Alien Skies"
 * (https://panoptesv.com/SciFi/ColorsOfAlienWorlds/AlienSkies.php): an Earth-like air, clear,
 * with a stratospheric ozone layer whose amount is proportional to the star's ultraviolet flux
 * below 240 nm; a 30 % grey ground; brightness referred to a 50 % grey card facing the star; and
 * the colours shown as an eye used to Earth sunlight would see them (the card is not made white).
 * That page gives the method in words only, so the physics here is the textbook version, and its
 * free constants are calibrated against the colours of the page's renders (tests/spectra.test.js):
 *
 *   star          a blackbody at the effective temperature (real spectra have absorption lines)
 *   Rayleigh      optical depth of the Earth's air, Hansen & Travis (1974) eq. 2.29:
 *                 τ(λ) = 0.008569 λ⁻⁴ (1 + 0.0113 λ⁻² + 0.00013 λ⁻⁴), λ in µm; scaled by the column
 *                 of air, which goes as pressure / gravity (Panoptes: low gravity looks like more air)
 *   ozone         the Chappuis band as one Gaussian, peak 5.2×10⁻²¹ cm² at 602 nm; the Earth's
 *                 column 300 DU = 8.07×10¹⁸ cm⁻²
 *   air mass      Kasten & Young (1989), so the horizon stays finite
 *   scattering    single scattering in a plane-parallel layer, plus an approximate multiply
 *                 scattered and ground-reflected part (calibrated), which whitens thick skies
 *   colour        CIE 1931 2° observer, multi-lobe fit of Wyman, Sloan & Shirley (JCGT 2, 2013);
 *                 XYZ → linear sRGB (D65) → sRGB
 * Pure functions: runs in the page and in Node.
 */
(function (root) {
  'use strict';

  const WL = []; for (let l = 380; l <= 780; l += 10) WL.push(l);
  const N = WL.length;

  // ── colour science ───────────────────────────────────────────────────
  const lobe = (l, m, s1, s2) => { const t = (l - m) / (l < m ? s1 : s2); return Math.exp(-0.5 * t * t); };
  const cmf = (l) => [
    1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2),
    0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1),
    1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8),
  ];
  const CMF = WL.map(cmf);
  function toXYZ(spec) {
    let X = 0, Y = 0, Z = 0;
    for (let i = 0; i < N; i++) { const s = spec[i]; X += s * CMF[i][0]; Y += s * CMF[i][1]; Z += s * CMF[i][2]; }
    return [X, Y, Z];
  }
  const xyzToLinear = ([x, y, z]) => [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.2040 * y + 1.0570 * z,
  ];
  const encode = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const decode = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

  /*
   * Linear RGB → sRGB bytes. Out-of-gamut colours are pulled towards their own grey (keeping
   * luminance) rather than clipped channel by channel, and over-bright ones are scaled down so
   * the hue survives, as a photograph's highlights would.
   */
  function toBytes(rgb) {
    let [r, g, b] = rgb;
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const lo = Math.min(r, g, b);
    if (lo < 0 && Y > 0) { const k = Y / (Y - lo); r = Y + (r - Y) * k; g = Y + (g - Y) * k; b = Y + (b - Y) * k; }
    const hi = Math.max(r, g, b);
    if (hi > 1) { r /= hi; g /= hi; b /= hi; }
    return [r, g, b].map((v) => Math.round(255 * encode(Math.max(0, Math.min(1, v)))));
  }
  /* A linear colour pulled into gamut (no negative channel), keeping its luminance. */
  function positive(rgb) {
    const [r, g, b] = rgb, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, lo = Math.min(r, g, b);
    if (lo >= 0) return rgb;
    if (Y <= 0) return [0, 0, 0];
    const k = Y / (Y - lo);
    return [Y + (r - Y) * k, Y + (g - Y) * k, Y + (b - Y) * k].map((v) => Math.max(0, v));
  }
  /* positive(), with a small floor in every channel so a ratio can always reach the target. */
  const floored = (rgb) => { const p = positive(rgb), Y = 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]; return p.map((v) => v + 0.03 * Y + 1e-6); };
  const hex = (bytes) => '#' + bytes.map((v) => v.toString(16).padStart(2, '0')).join('');
  const fromHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));

  // CIE L*a*b* of an sRGB byte colour, for comparing colours (D65 white)
  function lab(bytes) {
    const [r, g, b] = bytes.map((v) => decode(v / 255));
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, Y = 0.2126 * r + 0.7152 * g + 0.0722 * b, Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
    const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
  }
  const deltaE = (a, b) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };

  // ── stars ────────────────────────────────────────────────────────────
  function planck(lnm, T) {
    const l = lnm * 1e-9;
    return 1 / (l ** 5 * (Math.exp(0.0143877735 / (l * T)) - 1));
  }
  /*
   * A real star's visible light is not a blackbody's at its effective temperature (absorption
   * lines and bands, the Balmer jump). For each class Panoptes shows, this is the blackbody
   * temperature whose light gives the same colour as the page's grey card under 0.3 atm
   * (fitted in tests/spectra.test.js); between classes it is interpolated in log T.
   */
  const COLOUR_T = [[2400, 3226], [3060, 3785], [3850, 4352], [4440, 5208], [5270, 6018], [5660, 6421], [5930, 6551], [6550, 7310], [7220, 7608], [9700, 7646], [30000, 20000]];
  function colourTemperature(T) {
    const t = COLOUR_T;
    if (T <= t[0][0]) return t[0][1] * T / t[0][0];
    for (let i = 1; i < t.length; i++) if (T <= t[i][0]) {
      const k = Math.log(T / t[i - 1][0]) / Math.log(t[i][0] / t[i - 1][0]);
      return Math.exp(Math.log(t[i - 1][1]) + k * Math.log(t[i][1] / t[i - 1][1]));
    }
    return t[t.length - 1][1];
  }

  const starCache = new Map();
  /* The star's visible spectrum over WL (by its colour temperature), scaled to integrate to 1. */
  function starSpectrum(T) {
    const key = Math.round(T);
    if (starCache.has(key)) return starCache.get(key);
    const Tc = colourTemperature(T);
    const s = WL.map((l) => planck(l, Tc));
    const sum = s.reduce((a, b) => a + b, 0);
    const out = s.map((v) => v / sum);
    starCache.set(key, out);
    return out;
  }
  /* Fraction of a blackbody's whole output below `cut` nm (series for the Planck integral). */
  function fractionBelow(T, cut) {
    const x = 0.0143877735 / (cut * 1e-9 * T);
    let s = 0;
    for (let n = 1; n <= 40; n++) s += Math.exp(-n * x) * (x ** 3 / n + 3 * x ** 2 / n ** 2 + 6 * x / n ** 3 + 6 / n ** 4);
    return (15 / Math.PI ** 4) * s;
  }
  /* Ozone column relative to the Earth's: the star's UV (< 240 nm) at the planet, relative to the Sun's at Earth. */
  function ozoneFactor(T, insolation = 1) {
    return Math.min(40, (fractionBelow(T, 240) / fractionBelow(5772, 240)) * insolation);
  }
  /* Blackbody colour of a star, normalised to its brightest channel (for discs and glows). */
  function starColour(T) {
    const rgb = xyzToLinear(toXYZ(starSpectrum(T)));
    const m = Math.max(...rgb);
    return toBytes(rgb.map((v) => v / m));
  }

  // ── the atmosphere ───────────────────────────────────────────────────
  const TAU_R = WL.map((l) => { const u = l / 1000; return 0.008569 * u ** -4 * (1 + 0.0113 * u ** -2 + 0.00013 * u ** -4); });
  const O3_SIGMA = WL.map((l) => 5.2e-21 * Math.exp(-0.5 * ((l - 602) / 48) ** 2));
  const O3_EARTH = 8.07e18;
  // methane (Panoptes: a whole atmosphere of it): visible bands at 619, 727 and 543 nm, as Gaussians
  // with optical depths per Earth-column; strengths are rough
  const CH4_TAU = WL.map((l) => 0.9 * Math.exp(-0.5 * ((l - 619) / 9) ** 2) + 3.5 * Math.exp(-0.5 * ((l - 727) / 12) ** 2) + 0.15 * Math.exp(-0.5 * ((l - 543) / 8) ** 2) + 0.4 * Math.exp(-0.5 * ((l - 780) / 25) ** 2));

  /* Kasten & Young (1989) relative air mass for a zenith angle in degrees (finite at 90°). */
  function airmass(zdeg) {
    const z = Math.min(90, Math.max(0, zdeg));
    return 1 / (Math.cos(z * Math.PI / 180) + 0.50572 * Math.pow(96.07995 - z, -1.6364));
  }

  // calibrated against the Panoptes renders (tests/spectra.test.js)
  const CAL = { ms: 1.5, ground: 0.3, horizon: 0.5, haze: 0, ozone: 1, gain: 1 };

  /*
   * An atmosphere's optical depths per wavelength.
   *   pressure  atm at the surface;  gravity  in g;  T  star temperature;  insolation  S/S⊕
   *   gas: 'air' (N₂/O₂), 'co2' (Rayleigh ≈ 2.45× air per molecule column, heavier), 'h2' (H₂/He)
   *   methane: 0..1 share;  haze: aerosol optical depth at 550 nm;  ozone: multiplier (null = from the star)
   */
  function atmosphere({ pressure = 1, gravity = 1, T = 5772, insolation = 1, gas = 'air', methane = 0, haze = 0, ozone = null } = {}) {
    // column of molecules ∝ P / (g μ); Rayleigh cross-section per molecule relative to air
    const MU = { air: 28.97, co2: 44.01, h2: 2.3 }, XS = { air: 1, co2: 2.45, h2: 0.22 };
    const g = Math.max(0.01, gravity);
    const column = (pressure / g) * (MU.air / (MU[gas] || MU.air));          // molecules, relative to Earth
    const rayleigh = TAU_R.map((t) => t * column * (XS[gas] || 1));
    const o3 = ozone === null ? (gas === 'air' ? ozoneFactor(T, insolation) : 0) : ozone;
    const absorb = WL.map((l, i) => O3_SIGMA[i] * O3_EARTH * o3 * CAL.ozone + CH4_TAU[i] * methane * column);
    const aer = WL.map((l) => (haze || CAL.haze) * Math.pow(l / 550, -1.3));
    return { rayleigh, absorb, aer, pressure, column, empty: pressure <= 0.0005 };
  }

  const phaseR = (c) => 0.75 * (1 + c * c);
  const phaseHG = (c, g = 0.7) => (1 - g * g) / Math.pow(1 + g * g - 2 * g * c, 1.5);

  /*
   * Sky radiance (spectral, arbitrary units of F0) looking at elevation `elv` (deg), with the star
   * at elevation `sunElv` and angular distance `gamma` (deg) between view and star.
   */
  function skyRadiance(atm, star, elv, sunElv, gamma) {
    const out = new Array(N).fill(0);
    if (atm.empty) return out;
    const below = sunElv < 0;
    // the star below the horizon: light still grazes the upper air (twilight). Treat it as a star on
    // the horizon, dimmed as it sinks: e-folding with 1.6° (a rough fit to civil twilight)
    const se = Math.max(sunElv, 0.5);
    const fade = below ? Math.exp(sunElv / 1.6) : 1;
    const a = airmass(90 - se), b = airmass(90 - Math.max(elv, 0.05));
    const c = Math.cos(gamma * Math.PI / 180), pr = phaseR(c), ph = phaseHG(c);
    const mu = Math.sin(se * Math.PI / 180);
    for (let i = 0; i < N; i++) {
      const ts = atm.rayleigh[i], ta = atm.aer[i], te = ts + ta + atm.absorb[i];
      const F = star[i] * fade;
      const geo = Math.abs(b - a) < 1e-6 ? te * b * Math.exp(-te * a) : (b / (b - a)) * (Math.exp(-te * a) - Math.exp(-te * b));
      const single = (F / (4 * Math.PI)) * ((ts * pr + ta * 0.95 * ph) / Math.max(te, 1e-9)) * geo;
      // Multiply scattered light. The diffuse light reaching the ground comes from the Eddington
      // two-stream solution for a conservatively scattering layer (g = 0), with the ground's
      // reflections between it and the sky (spherical albedo τ / (4/3 + τ)):
      //   T(μ) = [2/3 + μ + (2/3 - μ) e^(-τ/μ)] / (4/3 + τ)
      // spread over the sky, brighter towards the horizon where the path is longest. In thin air
      // the sky is single scattering, in thick air the diffuse glow: the two are blended by the
      // optical depth (weight 1 - e^(-k τ), k calibrated).
      const scat = ts + 0.95 * ta, absorbed = Math.exp(-(te - scat) * (a + b) * 0.5);
      const m = 1 / a;
      const Ttot = (2 / 3 + m + (2 / 3 - m) * Math.exp(-scat * a)) / (4 / 3 + scat);
      const Rs = scat / (4 / 3 + scat);
      const Ed = F * mu * Math.max(0, Ttot / (1 - CAL.ground * Rs) - Math.exp(-scat * a));
      const shape = (1 + CAL.horizon * (1 - Math.exp(-scat * b))) / (1 + CAL.horizon * 0.5);
      const multi = Ed / Math.PI * shape * absorbed;
      const w = 1 - Math.exp(-CAL.ms * scat);
      out[i] = CAL.gain * ((1 - w) * single + w * multi);
    }
    return out;
  }

  /* Direct beam at the surface (per unit area normal to the beam). */
  function directBeam(atm, star, sunElv) {
    if (sunElv <= -1) return new Array(N).fill(0);
    const a = airmass(90 - Math.max(sunElv, -0.5));
    const fade = sunElv < 0 ? Math.exp(sunElv / 0.5) : 1;
    return star.map((F, i) => F * fade * Math.exp(-(atm.empty ? 0 : (atm.rayleigh[i] + atm.aer[i] + atm.absorb[i])) * a));
  }

  /* Diffuse light from the whole sky on a level surface, by summing the sky (coarse). */
  function skyIrradiance(atm, star, sunElv) {
    const out = new Array(N).fill(0);
    if (atm.empty) return out;
    const sz = (90 - sunElv) * Math.PI / 180;
    for (let e = 2.5; e < 90; e += 5) for (let az = 0; az < 360; az += 20) {
      const ev = e * Math.PI / 180, azr = az * Math.PI / 180;
      const cg = Math.sin(ev) * Math.cos(sz) + Math.cos(ev) * Math.sin(sz) * Math.cos(azr);
      const L = skyRadiance(atm, star, e, sunElv, Math.acos(Math.max(-1, Math.min(1, cg))) * 180 / Math.PI);
      const w = Math.sin(ev) * Math.cos(ev) * (5 * Math.PI / 180) * (20 * Math.PI / 180);
      for (let i = 0; i < N; i++) out[i] += L[i] * w;
    }
    return out;
  }

  /*
   * One place's light: star, atmosphere and a sun elevation. Exposure follows Panoptes: a 50 % grey
   * card facing the unattenuated star shows at full brightness in its brightest channel.
   */
  function scene(opts) {
    const star = starSpectrum(opts.T);
    const atm = atmosphere(opts);
    const card = xyzToLinear(toXYZ(star.map((v) => 0.5 * v / Math.PI)));
    const exposure = 1 / Math.max(...card);
    const display = (spec) => toBytes(xyzToLinear(toXYZ(spec)).map((v) => v * exposure));
    const linear = (spec) => xyzToLinear(toXYZ(spec)).map((v) => v * exposure);
    return { star, atm, exposure, display, linear };
  }

  /* The model's own zenith, horizon-ring (6°) and grey-card colours, linear RGB. */
  function modelSummary(sc, sunElv) {
    const ring = new Array(N).fill(0);
    const sz = 90 - sunElv;
    for (let az = 0; az < 360; az += 15) {
      const e = 6, ev = e * Math.PI / 180, szr = sz * Math.PI / 180;
      const cg = Math.sin(ev) * Math.cos(szr) + Math.cos(ev) * Math.sin(szr) * Math.cos(az * Math.PI / 180);
      const L = skyRadiance(sc.atm, sc.star, e, sunElv, Math.acos(cg) * 180 / Math.PI);
      for (let i = 0; i < N; i++) ring[i] += L[i] / 24;
    }
    const zen = skyRadiance(sc.atm, sc.star, 90, sunElv, sz);
    const direct = directBeam(sc.atm, sc.star, sunElv);
    const diffuse = skyIrradiance(sc.atm, sc.star, sunElv);
    const cardSpec = direct.map((d, i) => 0.5 * (d + diffuse[i] * 0.5) / Math.PI);
    return { zen: floored(sc.linear(zen)), hor: floored(sc.linear(ring)), card: floored(sc.linear(cardSpec)) };
  }

  // ── anchoring to the Panoptes renders ────────────────────────────────
  /*
   * The model gives the sky its structure (gradients, the glow round the star, twilight, other
   * gases, gravity); its colours are anchored to the page's renders. At each rendered point (star
   * class, pressure, star high or near the horizon) the ratio of the page's colour to the model's
   * is kept per channel, for the zenith, the horizon and the grey card; between points the ratios
   * are interpolated in log T, log pressure and the star's elevation, and applied to the model.
   * So the page's colours are reproduced where it drew them, and the model fills in the rest.
   */
  const PAN = (typeof module !== 'undefined' && module.exports) ? require('./panoptes.js') : (root.WS && root.WS.panoptes);
  let anchorTable = null;
  const ratio = (target, model) => model.map((m, i) => {
    const t = decode(target[i] / 255);
    if (m <= 1e-4 && t <= 1e-3) return 1;
    return Math.min(200, Math.max(0.005, t / Math.max(m, 1e-4)));
  });
  function buildAnchors() {
    if (!PAN) return null;
    anchorTable = PAN.SKY.map(([cls, T, high, low]) => ({
      cls, T,
      modes: [[high, PAN.SKY_HIGH_ELEVATION], [low, PAN.SKY_LOW_ELEVATION]].map(([rows, elv]) => rows.map(([z, h, w], pi) => {
        const sc = scene({ T, pressure: PAN.PRESSURES[pi] });
        const m = modelSummary(sc, elv);
        return { zen: ratio(fromHex(z), m.zen), hor: ratio(fromHex(h), m.hor), card: ratio(fromHex(w), m.card) };
      })),
    }));
    return anchorTable;
  }
  const lerpLog = (a, b, t) => a.map((v, i) => Math.exp(Math.log(v) * (1 - t) + Math.log(b[i]) * t));
  const mixAnchor = (a, b, t) => ({ zen: lerpLog(a.zen, b.zen, t), hor: lerpLog(a.hor, b.hor, t), card: lerpLog(a.card, b.card, t) });
  function bracket(xs, x, log = true) { // xs ascending; returns [i, j, t]
    if (x <= xs[0]) return [0, 0, 0];
    if (x >= xs[xs.length - 1]) return [xs.length - 1, xs.length - 1, 0];
    for (let i = 1; i < xs.length; i++) if (x <= xs[i]) {
      const t = log ? Math.log(x / xs[i - 1]) / Math.log(xs[i] / xs[i - 1]) : (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
      return [i - 1, i, t];
    }
    return [xs.length - 1, xs.length - 1, 0];
  }
  const anchorCache = new Map();
  /* Correction ratios for a star temperature, an effective pressure (air columns) and the star's elevation. */
  function anchor(T, peff, sunElv) {
    const key = `${Math.round(T / 10)}|${Math.round(Math.log(Math.max(peff, 1e-3)) * 40)}|${Math.round(sunElv * 2)}`;
    if (anchorCache.has(key)) return anchorCache.get(key);
    const table = anchorTable || buildAnchors();
    const one = { zen: [1, 1, 1], hor: [1, 1, 1], card: [1, 1, 1] };
    if (!table) return one;
    const temps = table.map((r) => r.T).slice().reverse();          // ascending
    const [ia, ib, tt] = bracket(temps, T);
    const rowA = table[table.length - 1 - ia], rowB = table[table.length - 1 - ib];
    const [pa, pb, tp] = bracket(PAN.PRESSURES, Math.max(1e-3, peff));
    const lo = PAN.SKY_LOW_ELEVATION, hi = PAN.SKY_HIGH_ELEVATION;
    let ts = (Math.max(lo, Math.min(hi, sunElv)) - lo) / (hi - lo);
    ts = ts * ts * (3 - 2 * ts);
    const at = (row, mode) => mixAnchor(row.modes[mode][pa], row.modes[mode][pb], tp);
    const byMode = (mode) => mixAnchor(at(rowA, mode), at(rowB, mode), tt);
    const out = mixAnchor(byMode(1), byMode(0), ts);
    anchorCache.set(key, out);
    if (anchorCache.size > 4000) anchorCache.clear();
    return out;
  }

  /*
   * A place's sky, ready to draw: anchored colours (linear RGB, exposure as Panoptes) for any view
   * elevation and angle from the star. opts as atmosphere() plus T.
   */
  function sky(opts) {
    const sc = scene(opts);
    const peff = sc.atm.column * ({ air: 1, co2: 2.45, h2: 0.22 }[opts.gas || 'air'] || 1);
    const radiance = (elv, sunElv, gamma, a) => {
      const k = a || anchor(opts.T, peff, sunElv);
      const lin = floored(sc.linear(skyRadiance(sc.atm, sc.star, elv, sunElv, gamma)));
      let t = (Math.max(6, Math.min(90, elv)) - 6) / 84;
      t = Math.sqrt(t);
      return lin.map((v, i) => v * Math.exp(Math.log(k.hor[i]) * (1 - t) + Math.log(k.zen[i]) * t));
    };
    const light = (sunElv) => {                                         // light on a level surface
      const k = anchor(opts.T, peff, sunElv);
      const d = directBeam(sc.atm, sc.star, sunElv), f = skyIrradiance(sc.atm, sc.star, sunElv);
      const mu = Math.max(0, Math.sin(sunElv * Math.PI / 180));
      const spec = d.map((v, i) => v * mu + f[i]);
      return { spec, linear: floored(sc.linear(spec.map((v) => v / Math.PI))).map((v, i) => v * k.card[i]) };
    };
    return { ...sc, peff, anchor: (sunElv) => anchor(opts.T, peff, sunElv), radiance, light };
  }

  /* Colours of the sky as Panoptes shows them: zenith, horizon ring (6°) and grey card, sRGB bytes. */
  function skySummary(opts, sunElv) {
    const sc = scene(opts);
    const peff = sc.atm.column * ({ air: 1, co2: 2.45, h2: 0.22 }[opts.gas || 'air'] || 1);
    const k = opts.raw ? { zen: [1, 1, 1], hor: [1, 1, 1], card: [1, 1, 1] } : anchor(opts.T, peff, sunElv);
    const m = modelSummary(sc, sunElv);
    const apply = (lin, r) => toBytes(lin.map((v, i) => v * r[i]));
    return { zenith: apply(m.zen, k.zen), horizon: apply(m.hor, k.hor), white: apply(m.card, k.card) };
  }

  // ── plants (Panoptes, "Colors of Alien Plants") ──────────────────────
  /*
   * Leaf colours for a star and pressure: the page's six concentrations of pigment, interpolated
   * between its classes (log T) and pressures (log P, 1-10 atm) in linear RGB. `twilight`: the
   * pigments of photosynthesisers adapted to a star that stays low (tidally locked K and M worlds).
   */
  function leafColours(T, pressure = 1, { twilight = false } = {}) {
    if (!PAN) return ['#557733', '#446622', '#335511', '#2a4a10', '#223f0c', '#1c360a'];
    let table = twilight ? PAN.LEAF_TWILIGHT : PAN.LEAF;
    if (twilight && T > table[0][1] * 1.02) table = PAN.LEAF;
    const temps = table.map((r) => r[1]).slice().reverse();
    const [ia, ib, tt] = bracket(temps, T);
    const A = table[table.length - 1 - ia], B = table[table.length - 1 - ib];
    const [pa, pb, tp] = bracket(PAN.LEAF_PRESSURES, Math.max(1, Math.min(10, pressure)));
    const lin = (h) => fromHex(h).map((v) => decode(v / 255));
    const mix = (a, b, t) => a.map((v, i) => v * (1 - t) + b[i] * t);
    return A[2][0].map((_, k) => {
      const a = mix(lin(A[2][pa][k]), lin(A[2][pb][k]), tp), b = mix(lin(B[2][pa][k]), lin(B[2][pb][k]), tp);
      return hex(mix(a, b, tt).map((v) => Math.round(255 * encode(Math.max(0, Math.min(1, v))))));
    });
  }

  /*
   * The colour of a surface with reflectance spectrum `refl` (array over WL, or a number) under
   * a place's light, as displayed. `adapt`: 'earth' keeps the Earth-adapted eye (Panoptes);
   * 'local' white-balances to the local daylight (von Kries in the Bradford cone space).
   */
  const BRAD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
  const BRAD_INV = [[0.9869929, -0.1470543, 0.1599627], [0.4323053, 0.5183603, 0.0492912], [-0.0085287, 0.0400428, 0.9684867]];
  const mul = (M, v) => M.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const D65 = [0.95047, 1, 1.08883];
  function adaptXYZ(xyz, white) {
    const ws = mul(BRAD, white.map((v) => v / white[1])), wd = mul(BRAD, D65);
    const c = mul(BRAD, xyz).map((v, i) => v * wd[i] / ws[i]);
    return mul(BRAD_INV, c);
  }

  function lit(sc, illum, refl, { adapt = 'earth' } = {}) {
    const spec = illum.map((v, i) => v * (typeof refl === 'number' ? refl : refl[i]) / Math.PI);
    let xyz = toXYZ(spec).map((v) => v * sc.exposure);
    if (adapt === 'local') xyz = adaptXYZ(xyz, toXYZ(illum));
    return toBytes(xyzToLinear(xyz));
  }

  const api = {
    WL, N, CMF, toXYZ, xyzToLinear, toBytes, positive, encode, decode, hex, fromHex, lab, deltaE,
    planck, colourTemperature, starSpectrum, fractionBelow, ozoneFactor, starColour,
    atmosphere, airmass, skyRadiance, directBeam, skyIrradiance, scene, skySummary, adaptXYZ, lit, CAL,
    anchor, sky, leafColours, modelSummary,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.spectra = api; }
})(typeof window !== 'undefined' ? window : globalThis);
