/*
 * Mountain belts from what the plates did: for each belt in a plate history (supercontinent.js
 * markOrogens), how fast the plates closed across it and for how long (from the rotation model,
 * rotation.js), the shortening that gives, the crust it thickens (area kept in cross-section), and
 * the height that crust stands at (Airy isostasy), capped by what rock can hold up under the
 * planet's gravity; and through time (beltsAt, what the map draws): point by point along each belt,
 * crust fed to it while the plates closed, worn by erosion all the while and after (Montgomery &
 * Brandon 2002), so a belt's size is the balance of the two (Whipple & Meade 2004) and an old belt
 * still stands on its root. Pure functions: runs in the page and in Node. No random numbers.
 *
 * What the history records (supercontinent.js), and what is assumed for a history saved before it did:
 *  - collision: the suture between two continents (`plateId` and its `partner`), the age they met
 *    (`begin`) and the age they welded (`weld`): after meeting they keep closing, slower and slower,
 *    until they weld. The closing is read from the rotation model between the two. Without `weld`:
 *    read until the plates stop closing.
 *  - cordillera: the subduction zone's `episodes` (compression, extension, neutral), each with the
 *    plate going down, the floor's age and the upper plate's advance on the trench (cm/yr). The margin
 *    shortens only in compression episodes, by ANDEAN_SHARE of that advance (a partly anchored slab:
 *    the rest moves the trench back). Without episodes: the trench's whole life, the overriding plate's
 *    motion towards it (the subducting plate was not recorded).
 *  - accretion: an island arc that ran into another plate's continent (`begin`), its shape. The arc
 *    is what is added: its width times the thickness of arc crust (ARC_CRUST_KM).
 *  - plateau: drawn by the history behind a long collision; here a plateau is where the thickened
 *    crust reaches what rock can hold up, so further shortening widens the belt instead.
 *  - a belt drawn by hand (no record of what raised it): ASSUMED_CM of closing while it rose.
 * Widths follow from the crust (a wedge of the critical taper), never a random draw.
 */
(function (root) {
  'use strict';
  const node = typeof module !== 'undefined' && module.exports;
  const Q = node ? require('./rotation.js') : root.WS.rotation;
  const S = node ? require('./sphere.js') : root.WS.sphere;

  /* The constants, with what they stand for and where they come from (read 2026-11-25; "unverified":
     from memory only, no source could be read). */
  const C = {
    RHO_CRUST: 2800,      // kg/m³, continental crust, and
    RHO_MANTLE: 3300,     // kg/m³, upper mantle: Airy, ρc·h = (ρm − ρc)·root (MIT 12.002 lecture 26:
                          //   5 km of relief on a root of about 28 km; U. Alberta EAS 325 notes)
    CRUST_KM: 35,         // km, continental crust standing at sea level (the reference column, as in those notes)
    MEAN_CAP_M: 5000,     // m, the highest mean elevation crust holds up on Earth: Tibet, "average elevation
                          //   exceeding 4,500 m" (Wikipedia), on crust 65-70 km thick (Yue et al. 2012, JGR),
                          //   which by Airy stands at about 5 km
    TAPER_DEG: 9,         // °, how fast crust thickens from a belt's edge to its crest, taken as a critical
                          //   wedge's taper, surface slope + basal dip: Taiwan's "α = 3°" and "β = 6°" (Dahlen 1990,
                          //   Annu. Rev. Earth Planet. Sci. 18, 55, citing Davis, Suppe & Dahlen 1983)
    CRUST_KEPT: 0.5,      // share of the shortened crust that stays in a belt: about half of India's and Asia's
                          //   crust is missing, subducted (Ingalls et al. 2016, Nature Geoscience)
    ANDEAN_SHARE: 0.3,    // share of the upper plate's advance on its trench that shortens its margin while it is in
                          //   compression (the rest moves the trench back: a partly anchored slab, Heuret & Lallemand
                          //   2005): the Bolivian Andes, ~420 km shortened since 50 Ma while South America moved
                          //   ~1400 km west (Schepers et al. 2017, Nature Communications 8, 15249)
    ARC_CRUST_KM: 25,     // km, the crust of an island arc: 10-35 km in the Izu-Bonin arc, 27-35 km in the
                          //   Aleutians (seismic studies, reviewed in Springer's "Seismic structure of arcs")
    STEP_MYR: 2.5,        // Myr between readings of the plates' motion (the simulation's own step)
    CLOSING_MIN: 0.05,    // cm/yr: slower than this, the plates are not closing (welded, or parting)
    // erosion, from Montgomery & Brandon 2002 (EPSL 201, 481), their Eq. 2: E = E0 + K·Rz / (1 − (Rz/Rc)²),
    // Rz the mean local relief (over 10 km), fitted to the world's drainage basins and active ranges:
    E0_MM: 0.01,          // mm/yr: background (chemical) erosion, their E0
    K_MM_KM: 0.25,        // mm/yr per km of local relief, their K = 2.5·10⁻⁴ mm/yr per m (Ahnert's line at low relief)
    RC_KM: 1.5,           // km: the local relief rock and soil can hold, their Rc = 1500 m (÷ g^scaling here)
    RZ_MAX: 0.98,         // relief stays this close to Rc at most: erosion is then ~9.5 mm/yr, the most a range sustains
                          //   (theirs: "long-term erosion rates > 10 mm/yr" are rare)
    RELIEF_SHARE: 0.3,    // local relief as a share of height on a belt's slopes: their active ranges have
                          //   1000-2000 m of it (their Fig. 6), on crests of some 3-6 km (Alps to Himalaya). Calibrated, not measured
    RAIN_EXP: 0.5,        // erosion grows as rain^m: the stream-power law with discharge for area, m/n ≈ 0.5, n ≈ 1
                          //   (Whipple & Meade 2004, JGR 109, F01011, §5 and Eq. 27: width ∝ K^−(0.4-0.7))
    STATION_DEG: 2,       // ° between the points along a belt that are worked out each on its own
    ASSUMED_CM: 2,        // cm/yr: the closing for a belt drawn by hand, with no record of what raised it (a typical
                          //   plate speed; unverified)
  };
  const D2R = Math.PI / 180;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

  /* Height (m) of crust thickened by dT km above the reference column (Airy). */
  const airy = (dT) => dT * 1000 * (C.RHO_MANTLE - C.RHO_CRUST) / C.RHO_MANTLE;
  /* The thickest crust that stands, under gravity factor f = g^scaling (the app's ÷ g^scaling rule on heights). */
  const thickMax = (f = 1) => C.CRUST_KM + (C.MEAN_CAP_M / f / 1000) * C.RHO_MANTLE / (C.RHO_MANTLE - C.RHO_CRUST);

  /*
   * Crust added to a belt (km² in cross-section), area kept: a wedge, thickening from both edges to a
   * crest at the taper TAPER_DEG, area = W²·tan θ / 4; once the crest reaches the thickest crust that
   * stands, more crust widens it instead, a plateau between the two slopes. Returns {width (km), dT
   * (km, mean), crestDT, thickness (km at the crest), height (m, mean), crest (m), plateau, plateauWidth}.
   */
  function thicken(areaKm2, f = 1) {
    const tan = Math.tan(C.TAPER_DEG * D2R), room = thickMax(f) - C.CRUST_KM, full = (room * room) / tan;
    if (!(areaKm2 > 0)) return { width: 0, dT: 0, crestDT: 0, thickness: C.CRUST_KM, height: 0, crest: 0, plateau: false, plateauWidth: 0 };
    let width, crestDT, plateauWidth = 0;
    if (areaKm2 <= full) { width = 2 * Math.sqrt(areaKm2 / tan); crestDT = (width / 2) * tan; }
    else { plateauWidth = (areaKm2 - full) / room; width = plateauWidth + (2 * room) / tan; crestDT = room; }
    const dT = areaKm2 / width;
    return { width, dT, crestDT, thickness: C.CRUST_KM + crestDT, height: airy(dT), crest: airy(crestDT), plateau: plateauWidth > 0, plateauWidth };
  }

  // ── what the plates did across a belt ──
  /* Where a point of a plate's frame is at an age (unit vector). */
  const placed = (m, pid, v, t) => Q.rotate(m.absolute(pid, t), v);
  /* The velocity (cm/yr) at an age of the plate's material at world position x. */
  function velocity(m, pid, x, t, R) {
    const dt = Math.min(1, t);
    if (dt <= 0) return [0, 0, 0];
    const own = Q.rotate(Q.inverse(m.absolute(pid, t)), x), y = Q.rotate(m.absolute(pid, t - dt), own);
    return sub(y, x).map((c) => (c * R * 0.1) / dt);                 // 1 km/Myr = 0.1 cm/yr
  }
  const tangent = (x, d) => norm(sub(d, x.map((c) => c * dot(d, x))));
  /* The middle of a plate's continental crust at an age, or null. */
  function crustMiddle(P, m, pid, t) {
    const start = P.start ?? 1000, fs = P.features.filter((f) => f.kind === 'crust' && f.plateId === pid && f.coords.length >= 3 && (f.begin ?? start) >= t);
    if (!fs.length) return null;
    return norm(fs.flatMap((f) => f.coords.map((c) => placed(m, pid, S.vec(c), t))).reduce((s, v) => [s[0] + v[0], s[1] + v[1], s[2] + v[2]], [0, 0, 0]));
  }
  const along = (coords) => [0.25, 0.5, 0.75].map((q) => Math.min(coords.length - 2, Math.max(0, Math.floor(q * (coords.length - 1)))));

  /* Closing (cm/yr) across a suture at an age: the partner coming at the larger plate, on its line. */
  function sutureClosing(P, m, s, t, R) {
    const cb = crustMiddle(P, m, s.plateId, t), cp = crustMiddle(P, m, s.partner, t);
    if (!cb || !cp) return null;
    let sum = 0;
    const idx = along(s.coords);
    for (const i of idx) {
      const x = placed(m, s.plateId, S.vec(s.coords[i]), t), u = tangent(x, sub(cb, cp));
      sum += dot(sub(velocity(m, s.partner, x, t, R), velocity(m, s.plateId, x, t, R)), u);
    }
    return sum / idx.length;
  }
  /* The overriding plate's motion (cm/yr) towards its trench at an age, across the trench line. */
  function trenchward(P, m, z, t, R) {
    let sum = 0;
    const idx = along(z.coords);
    for (const i of idx) {
      const a = placed(m, z.plateId, S.vec(z.coords[i]), t), b = placed(m, z.plateId, S.vec(z.coords[i + 1]), t);
      const left = norm(cross(a, sub(b, a))), seaward = z.side === 'left' ? left.map((c) => -c) : left;
      sum += dot(velocity(m, z.plateId, a, t, R), seaward);
    }
    return sum / idx.length;
  }
  /* Closing (cm/yr) of an arc's plate on the continent it was accreted to, at an age. */
  function arcClosing(P, m, accreted, arcPlate, t, R) {
    const cb = crustMiddle(P, m, accreted.plateId, t);
    if (!cb) return null;
    const x = placed(m, accreted.plateId, S.vec(accreted.coords[Math.floor(accreted.coords.length / 2)]), t);
    return dot(sub(velocity(m, arcPlate, x, t, R), velocity(m, accreted.plateId, x, t, R)), tangent(x, sub(cb, x)));
  }
  /* Readings from `from` down to `to` (ages) every STEP_MYR of f(t); stopping (if `stop`) at the first
     that does not close, after the first that does. Returns {series [{t, v}], km, myr, speed}. */
  function integrate(f, from, to, stop) {
    const series = [];
    let km = 0, myr = 0, started = false;
    for (let t = from; t >= Math.max(0, to) - 1e-9; t -= C.STEP_MYR) {
      const v = f(t);
      if (v == null) break;
      series.push({ t: +t.toFixed(2), v });
      if (v > C.CLOSING_MIN) { started = true; km += v * 10 * C.STEP_MYR; myr += C.STEP_MYR; }   // 1 cm/yr = 10 km/Myr
      else if (stop && (started || t < from - 10)) break;
    }
    return { series, km, myr, speed: myr ? km / (myr * 10) : 0 };
  }
  /* A belt's width in km on the sphere: its area over half its outline (as for a strip). */
  function stripWidthKm(coords, R) {
    const area = S.areaFraction(coords) * 4 * Math.PI * R * R;
    let per = 0;
    for (let i = 0; i < coords.length; i++) per += S.distance(coords[i], coords[(i + 1) % coords.length]) * D2R * R;
    return per > 0 ? area / (per / 2) : 0;
  }

  /*
   * Every mountain belt of a plate history P ({plates, features, start}), with what the plates did
   * there and the crust and height that gives. opts: radiusKm (6371), gravity (1), scaling (2).
   * Each row says how it was read (`path`): 'episodes' (a trench's compression episodes, as histories
   * now record them), 'weld' (a suture with its weld age), 'arc', or 'assumed' (an older history
   * without those records: the assumptions described at the top).
   * Returns [{id, name, type, begin, active, closing (cm/yr while closing), myr, shortening (km),
   * added (km² of crust in cross-section), width, dT, thickness (km), height (m), plateau, notes}].
   */
  function belts(P, opts = {}) {
    const start = P.start ?? 1000, m = Q.model(P.plates, start), R = opts.radiusKm ?? 6371;
    const f = Math.max(0.05, opts.gravity ?? 1) ** (opts.scaling ?? 2);
    const byId = new Map(P.features.map((x) => [x.id, x]));
    const out = [];
    for (const o of P.features.filter((x) => x.kind === 'orogen')) {
      const row = { id: o.id, name: o.name, type: o.type, begin: o.begin, active: o.active, closing: 0, myr: 0, shortening: 0, added: 0, notes: [] };
      if (o.type === 'cordillera') {
        const z = byId.get(o.id.slice(1)), eps = o.episodes || (z && z.episodes);
        if (eps) {
          // the history's own record: the margin shortens only while the upper plate advanced on the trench
          const comp = eps.filter((e) => e.mode === 'compression');
          let km = 0, myr = 0;
          for (const e of comp) { km += Math.max(0, e.vup) * 10 * (e.from - e.to); myr += e.from - e.to; }
          row.path = 'episodes'; row.closing = myr ? km / (10 * myr) : 0; row.myr = myr; row.upperPlate = km;
          row.shortening = C.ANDEAN_SHARE * km; row.added = C.CRUST_KEPT * row.shortening * C.CRUST_KM;
          row.down = [...new Set(comp.map((e) => e.down))];
        } else if (!z) { row.notes.push('no subduction zone'); out.push(row); continue; }
        else {
          // an older history: the trench's whole life, the upper plate's motion towards it
          const r = integrate((t) => trenchward(P, m, z, t, R), z.begin ?? start, z.end ?? 0, false);
          row.path = 'assumed'; row.closing = r.speed; row.myr = r.myr; row.shortening = C.ANDEAN_SHARE * r.km; row.added = C.CRUST_KEPT * row.shortening * C.CRUST_KM;
          row.upperPlate = r.km;
        }
      } else if (o.type === 'collision' || o.type === 'plateau') {
        const s = byId.get(o.id.slice(1));
        if (!s || s.partner == null) { row.notes.push('no suture'); out.push(row); continue; }
        // closing until the weld on record, or (an older history) until the plates stop closing
        const r = s.weld != null ? integrate((t) => sutureClosing(P, m, s, t, R), s.begin, s.weld, false) : integrate((t) => sutureClosing(P, m, s, t, R), s.begin, 0, true);
        row.path = s.weld != null ? 'weld' : 'assumed';
        row.closing = r.speed; row.myr = r.myr; row.shortening = r.km; row.added = C.CRUST_KEPT * r.km * C.CRUST_KM;
        if (!r.km) row.notes.push(r.series.length && r.series[0].v < -C.CLOSING_MIN ? 'the plates were parting' : 'no closing');
      } else if (o.type === 'accretion') {
        const arc = byId.get(o.id.slice(1).split('-t')[0]);
        const wArc = stripWidthKm(o.coords, R);
        row.arcWidth = wArc; row.added = wArc * C.ARC_CRUST_KM; row.path = 'arc';
        if (arc) { const r = integrate((t) => arcClosing(P, m, o, arc.plateId, t, R), o.begin, Math.max(0, o.begin - 100), true); row.closing = r.speed; row.myr = r.myr; row.shortening = r.km; }
      }
      Object.assign(row, thicken(row.added, f));
      if (!(row.added > 0)) row.notes.push('no shortening');
      out.push(row);
    }
    return out;
  }

  // ── a belt through time: fed by the plates, worn by erosion ──
  /* Erosion (mm/yr, i.e. km/Myr) where a belt's slope stands h km high: Montgomery & Brandon's Eq. 2, the
     local relief a share of the height, held below the relief rock holds up (÷ g^scaling). k: how hard the
     climate and the world erode (rain^m × the world's erosion × √g, 1 on Earth on average). */
  function erosionRate(hKm, k, f = 1) {
    const rc = C.RC_KM / f, rz = Math.min(C.RELIEF_SHARE * Math.max(0, hKm), C.RZ_MAX * rc);
    const x = rz / rc;
    return k * (C.E0_MM + (C.K_MM_KM * rz) / (1 - x * x));
  }
  /* Crust (km² in cross-section, per km along the belt) erosion takes off a belt of that shape in a Myr:
     its two slopes, from the foot to the crest; a plateau on top, high but little cut (it drains slowly,
     its relief is low), wears at the background rate only. */
  function erodes(g, k, f = 1) {
    if (!(g.width > 0)) return 0;
    const slope = (g.width - g.plateauWidth) / 2, hc = g.crest / 1000;
    let s = 0;
    for (let i = 0; i < 6; i++) s += erosionRate((hc * (i + 0.5)) / 6, k, f);
    return 2 * slope * (s / 6) + g.plateauWidth * k * C.E0_MM;
  }
  /* One step: the crust a belt has after dt Myr fed at F (km²/Myr) and worn as it goes (implicit, so a
     belt near the relief limit, where erosion climbs steeply, settles instead of overshooting). */
  function step(A, F, dt, k, f) {
    const tgt = A + F * dt;
    if (!(tgt > 0)) return 0;
    // (erosion grows with the crust, so the answer lies between tgt less what all of tgt would lose, and tgt)
    const g = (x) => x + erodes(thicken(x, f), k, f) * dt - tgt;
    let hi = tgt, lo = Math.max(0, tgt - erodes(thicken(tgt, f), k, f) * dt);
    if (g(lo) >= 0) return lo;
    while (hi - lo > 1e-4 * tgt + 1e-6) { const mid = (lo + hi) / 2; if (g(mid) > 0) hi = mid; else lo = mid; }
    return lo;
  }
  /*
   * A belt's crust through its life, at one point along it: inputs F (km²/Myr) at ages t (from the
   * oldest, every STEP_MYR), then worn with nothing coming in, down to the age asked for. kAt(t): the
   * erosion factor at an age (the rain where the point was then). Returns {A, peak (most crust it had),
   * rising (still fed at that age), born (false before it began)}.
   */
  function evolve(t, F, age, kAt, f = 1) {
    let A = 0, peak = 0, i = 0;
    if (!t.length || age >= t[0]) return { A: 0, peak: 0, rising: false, born: false };
    while (i < t.length && t[i] > age + 1e-9) {
      // (stretches with nothing coming in, as between a trench's episodes, in longer steps)
      let n = 1;
      if (!(F[i] > 0)) while (n < 4 && i + n < t.length && !(F[i + n] > 0) && t[i + n] > age + 1e-9) n++;
      A = step(A, F[i], Math.min(n * C.STEP_MYR, t[i] - age), kAt(t[i]), f);
      if (A > peak) peak = A;
      i += n;
    }
    const rising = i > 0 && F[i - 1] > 0 && t[t.length - 1] <= age + C.STEP_MYR + 1e-9;
    // after the last input, worn down (in longer steps: nothing is coming in)
    let now = t.length ? t[t.length - 1] - C.STEP_MYR : age;
    while (i >= t.length && now > age + 1e-9 && A > 1e-6) { const dt = Math.min(10, now - age); A = step(A, 0, dt, kAt(now), f); now -= dt; }
    return { A, peak, rising, born: true };
  }

  /* Points along a line (unit vectors) at fractions of its length: {at(frac) → [v, tangent], length (°)}. */
  function alongLine(vs) {
    const cum = [0];
    for (let i = 1; i < vs.length; i++) cum.push(cum[i - 1] + Math.acos(Math.max(-1, Math.min(1, dot(vs[i - 1], vs[i])))) / D2R);
    const L = cum[cum.length - 1];
    const at = (q) => {
      if (vs.length < 2) return [vs[0], [0, 0, 0]];
      const s = Math.max(0, Math.min(1, q)) * L;
      let i = 1; while (i < vs.length - 1 && cum[i] < s) i++;
      const a = vs[i - 1], b = vs[i], u = cum[i] > cum[i - 1] ? (s - cum[i - 1]) / (cum[i] - cum[i - 1]) : 0;
      const v = norm(a.map((x, j) => x + (b[j] - x) * u));
      return [v, tangent(v, sub(b, a))];
    };
    return { at, length: L };
  }
  const stationFracs = (lengthDeg) => { const n = Math.max(3, Math.ceil(lengthDeg / C.STATION_DEG) + 1); return Array.from({ length: n }, (_, i) => i / (n - 1)); };
  /* The two sides of a belt's outline as drawn ([...one side, ...the other reversed]), paired point by point. */
  function sides(coords) {
    const vs = coords.map(S.vec), n = Math.floor(vs.length / 2);
    return { a: vs.slice(0, n), b: Array.from({ length: n }, (_, i) => vs[vs.length - 1 - i]) };
  }

  /*
   * What fed a belt, point by point along it: {path, ref, plateId, stations [{frac, v}], t (ages from the
   * oldest), F [per station, km²/Myr at each age], line (the reference line, unit vectors in the plate's
   * frame: a cordillera's seaward edge, the middle of the others)}. ref: 'edge' (a cordillera: the belt
   * lies inland of its line), 'centre', or 'drawn' (a belt drawn by hand: its outline, no line).
   */
  function beltInputs(P, m0, o, R, byId) {
    // (the same plate at the same age is asked for again and again: remember it)
    const memo = new Map(), m = { absolute: (pid, t) => { const key = `${pid}|${t}`; let q = memo.get(key); if (!q) { q = m0.absolute(pid, t); memo.set(key, q); } return q; } };
    const start = P.start ?? 1000, kept = C.CRUST_KEPT * C.CRUST_KM, dt = C.STEP_MYR;
    const ages = (from, to) => { const t = []; for (let x = from; x >= Math.max(0, to) - 1e-9; x -= dt) t.push(+x.toFixed(3)); return t; };
    const src = byId.get(String(o.id).slice(1)), sd = o.coords.length >= 4 ? sides(o.coords) : null;
    const mid = sd ? sd.a.map((v, i) => norm([v[0] + sd.b[i][0], v[1] + sd.b[i][1], v[2] + sd.b[i][2]])) : null;
    if (o.type === 'collision' && src && src.kind === 'suture' && src.partner != null && src.coords.length >= 2) {
      const line = src.coords.map(S.vec), al = alongLine(line), fr = stationFracs(al.length), pts = fr.map((q) => al.at(q)[0]);
      // closing at each point, from when the continents met to the weld on record (or, an older history,
      // until they stop closing)
      const t = [], F = fr.map(() => []), to = src.weld ?? 0;
      let started = false;
      for (const x of ages(src.begin ?? start, to)) {
        const cb = crustMiddle(P, m, src.plateId, x), cp = crustMiddle(P, m, src.partner, x);
        if (!cb || !cp) break;
        let any = false;
        const vals = pts.map((v) => {
          const p = placed(m, src.plateId, v, x), u = tangent(p, sub(cb, cp));
          const c = dot(sub(velocity(m, src.partner, p, x, R), velocity(m, src.plateId, p, x, R)), u);
          if (c > C.CLOSING_MIN) any = true;
          return kept * Math.max(0, c) * 10;
        });
        if (src.weld == null) { if (any) started = true; else if (started || x < (src.begin ?? start) - 10) break; }
        t.push(x); vals.forEach((v, i) => F[i].push(v));
      }
      return { path: src.weld != null ? 'weld' : 'assumed', ref: 'centre', plateId: o.plateId, stations: fr.map((q, i) => ({ frac: q, v: pts[i] })), t, F, line: mid || line };
    }
    if (o.type === 'cordillera' && src && src.kind === 'subduction' && src.coords.length >= 2) {
      const line = src.coords.map(S.vec), al = alongLine(line), fr = stationFracs(al.length), pts = fr.map((q) => al.at(q));
      const eps = o.episodes || src.episodes, comp = eps ? eps.filter((e) => e.mode === 'compression') : null;
      // the windows the margin shortened in: its compression episodes, or (an older history) the trench's life
      const win = comp ? comp.map((e) => [e.from, e.to]) : [[src.begin ?? start, src.end ?? 0]];
      if (!win.length) return null;
      const from = Math.max(...win.map((w) => w[0])), to = Math.min(...win.map((w) => w[1]));
      const t = ages(from, to), F = fr.map(() => []);
      for (const x of t) {
        const on = win.some(([a, b]) => x <= a + 1e-9 && x >= b - dt + 1e-9);
        pts.forEach(([v, tg], i) => {
          if (!on) { F[i].push(0); return; }
          // the upper plate's advance on the trench there (its motion across the trench, seaward)
          const p = placed(m, src.plateId, v, x), q = placed(m, src.plateId, norm(sub(v, tg.map((c) => c * 1e-3))), x);
          const left = norm(cross(q, sub(p, q))), seaward = src.side === 'left' ? left.map((c) => -c) : left;
          F[i].push(kept * C.ANDEAN_SHARE * Math.max(0, dot(velocity(m, src.plateId, p, x, R), seaward)) * 10);
        });
      }
      return { path: comp ? 'episodes' : 'assumed', ref: 'edge', plateId: o.plateId, stations: fr.map((q, i) => ({ frac: q, v: pts[i][0] })), t, F, line: sd ? sd.a : line, inland: sd ? sd.b : null };
    }
    if (o.type === 'accretion' && sd && sd.a.length >= 2) {
      // the arc's own crust, added at once when it ran in
      const al = alongLine(mid), fr = stationFracs(al.length), cum = alongLine(mid);
      const wid = sd.a.map((v, i) => Math.acos(Math.max(-1, Math.min(1, dot(v, sd.b[i])))) * R);
      const widthAt = (q) => { const x = q * (wid.length - 1), i = Math.min(wid.length - 2, Math.floor(x)); return wid.length < 2 ? wid[0] : wid[i] + (wid[i + 1] - wid[i]) * (x - i); };
      const b = o.begin ?? start;
      return { path: 'arc', ref: 'centre', plateId: o.plateId, stations: fr.map((q) => ({ frac: q, v: cum.at(q)[0] })), t: [b], F: fr.map((q) => [(widthAt(q) * C.ARC_CRUST_KM) / dt]), line: mid };
    }
    if (o.type === 'plateau') return null;                    // (an older history's plateau: the collision's own crust makes it now)
    // drawn by hand, or its cause is gone: an assumed closing while it rose
    if (o.coords.length < 3) return null;
    const t = ages(o.begin ?? start, o.active ?? 0);
    const c = S.centroid(o.coords);
    return { path: 'drawn', ref: 'drawn', plateId: o.plateId, stations: [{ frac: 0.5, v: S.vec(c) }], t, F: [t.map(() => kept * C.ASSUMED_CM * 10 * (o.type === 'cordillera' ? C.ANDEAN_SHARE : 1))], line: null };
  }

  /*
   * Every belt of a history as it stands at an age, point by point: what fed it, what erosion left.
   * opts: radiusKm, gravity, scaling, age (0), erosion (the world's, × Earth's, 1), rain(lat) (how wet it
   * is at a latitude, 1 on average: a stand-in until the climate is worked out with the land), model
   * (a rotation model already made). Returns [{id, type, path, ref, plateId, line, inland, stations
   * [{frac, v, A, peak, width, crestDT, plateauWidth, height, crest, plateau, rising, fed (km² in all)}],
   * fed (mean km² of crust fed), atCap, rising, born}].
   */
  const inputCache = new WeakMap();
  function beltsAt(P, opts = {}) {
    const start = P.start ?? 1000, R = opts.radiusKm ?? 6371, age = opts.age ?? 0;
    const g = Math.max(0.05, opts.gravity ?? 1), f = g ** (opts.scaling ?? 2), m = opts.model || Q.model(P.plates, start);
    const rain = opts.rain || (() => 1), E = Math.max(0, opts.erosion ?? 1);
    let cache = inputCache.get(P.features);
    if (!cache || cache.R !== R) { cache = { R, rows: new Map() }; inputCache.set(P.features, cache); }
    // (opts.key names the rain curve and settings: the same key, the same answer)
    const key = opts.key != null ? `${opts.key}|${age}|${E}|${f}|${g}` : null;
    if (key && cache.done && cache.done.has(key)) return cache.done.get(key);
    const byId = new Map(P.features.map((x) => [String(x.id), x]));
    const out = [];
    for (const o of P.features.filter((x) => x.kind === 'orogen' && x.coords && x.coords.length >= 3)) {
      if (!cache.rows.has(o.id)) cache.rows.set(o.id, beltInputs(P, m, o, R, byId));
      const inp = cache.rows.get(o.id);
      if (!inp) continue;
      const stations = inp.stations.map((s, i) => {
        // the rain where this point was, read every 10 Myr as the plate carries it
        const kc = new Map(), kAt = (x) => {
          const key = Math.round(x / 10);
          if (!kc.has(key)) { const p = placed(m, inp.plateId, s.v, Math.min(start, Math.max(0, key * 10))), lat = Math.asin(Math.max(-1, Math.min(1, p[2]))) / D2R; kc.set(key, E * Math.max(0, rain(lat)) ** C.RAIN_EXP * Math.sqrt(g)); }
          return kc.get(key);
        };
        const ev = evolve(inp.t, inp.F[i], age, kAt, f), shape = thicken(ev.A, f);
        let fed = 0; for (let j = 0; j < inp.t.length && inp.t[j] > age; j++) fed += inp.F[i][j] * C.STEP_MYR;
        return { frac: s.frac, v: s.v, ...ev, ...shape, peakWidth: thicken(ev.peak, f).width, fed };
      });
      const born = stations.some((s) => s.born);
      out.push({ id: o.id, type: o.type, path: inp.path, ref: inp.ref, plateId: inp.plateId, line: inp.line, inland: inp.inland || null, stations, born,
        fed: stations.reduce((s, x) => s + x.fed, 0) / stations.length, atCap: stations.some((s) => s.plateau), rising: stations.some((s) => s.rising) });
    }
    if (key) { cache.done = cache.done || new Map(); if (cache.done.size > 8) cache.done.clear(); cache.done.set(key, out); }
    return out;
  }

  const api = { C, airy, thickMax, thicken, belts, velocity, stripWidthKm, erosionRate, erodes, evolve, beltInputs, beltsAt, sides, alongLine };
  if (node) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.crust = api; }
})(typeof window !== 'undefined' ? window : globalThis);
