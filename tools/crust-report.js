/*
 * The mountain belts of seeds and example worlds: what the plates did there and the belt that makes
 * (js/crust.js), as the map builds it at the present: the crust fed to each point of a belt while the
 * plates closed, worn by erosion under the rain the map build estimates by latitude (a stand-in until
 * the climate comes first, Phase D). A report; it changes nothing.
 *   node tools/crust-report.js                 seeds 7, 21, 99 and the example worlds
 *   node tools/crust-report.js 5 8 --rows      any seeds, and every belt listed
 */
const C = require('../js/calc.js');
const CR = require('../js/crust.js');
const T = require('./fidelity.js');
const path = require('path');

const smooth = (t) => { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); };
/* The map build's rain stand-in (js/worldmap.js build): wetter where air rises, 1 on average. */
function rainOf(nCells) {
  const n = Math.max(1, Math.min(9, Math.round(nCells ?? 3)));
  const wetRaw = (lat) => { const a = Math.abs(lat); return (0.35 + 1.3 * (0.5 + 0.5 * Math.cos((Math.PI * n * a) / 90))) * (1 - 0.7 * smooth((a - 60) / 25)); };
  let wm = 0, ww = 0; for (let l = 0.25; l < 90; l += 0.5) { const c = Math.cos((l * Math.PI) / 180); wm += wetRaw(l) * c; ww += c; } wm /= ww;
  return (lat) => wetRaw(lat) / wm;
}

/* Every belt of a world: what the plates did (CR.belts) and how it stands now (CR.beltsAt). */
function worldBelts(w) {
  const d = C.computeAll(w), f = Math.max(0.05, d.planet.gravity) ** (w.tectonics.scaling ?? 2);
  const opts = { radiusKm: d.planet.radiusKm, gravity: d.planet.gravity, scaling: w.tectonics.scaling };
  const did = new Map(CR.belts(w.plates, opts).map((b) => [b.id, b]));
  const now = CR.beltsAt(w.plates, { ...opts, erosion: w.map.erosion ?? 1, rain: rainOf(d.planet.cells.count) });
  const belts = now.map((b) => {
    const r = did.get(b.id) || {}, top = b.stations.reduce((x, s) => (s.crest > x.crest ? s : x), b.stations[0]);
    const o = w.plates.features.find((x) => x.id === b.id);
    return { id: b.id, name: o.name, type: b.type, path: b.path, begin: o.begin, active: o.active ?? 0, closing: r.closing ?? 0, myr: r.myr ?? 0, shortening: r.shortening ?? 0,
      fed: b.fed, widthNow: Math.max(...b.stations.map((s) => s.width)), peakWidth: Math.max(...b.stations.map((s) => s.peakWidth)), crestNow: top.crest,
      crestLow: Math.min(...b.stations.map((s) => s.crest)), atCap: b.atCap, rising: b.rising, young: b.rising || (o.active ?? 0) <= 50, stations: b.stations.length };
  });
  return { belts, f, g: d.planet.gravity };
}

const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };
const rng = (a, fx) => (a.length ? `${fx(med(a))} (${fx(Math.min(...a))}–${fx(Math.max(...a))})` : '—');
const int = (x) => String(Math.round(x));
/* Spearman rank correlation. */
function spearman(x, y) {
  const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]), r = new Array(a.length); idx.forEach(([, i], k) => { r[i] = k; }); return r; };
  const rx = rank(x), ry = rank(y), n = x.length; if (n < 3) return null;
  const mx = (n - 1) / 2; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - mx); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - mx) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}
const did = (b) => `${b.begin}–${Math.round(b.active)} Ma, ${b.closing.toFixed(2)} cm/yr × ${Math.round(b.myr)} Myr → ${int(b.shortening)} km shortened, ${int(b.fed)} km² fed`;

function table(name, w, showRows) {
  const { belts, f, g } = worldBelts(w);
  console.log(`\n${name} · ${g.toFixed(2)} g (÷ ${f.toFixed(2)}) · ${belts.length} belts · thickest crust that stands ${CR.thickMax(f).toFixed(0)} km`);
  const head = ['type', 'n', 'closing cm/yr', 'Myr closing', 'shortening km', 'crust fed km²', 'widest km', 'width now km', 'crest now m', 'young', 'at cap', 'notes'];
  const rows = [];
  for (const t of ['collision', 'cordillera', 'accretion', 'plateau']) {
    const bs = belts.filter((b) => b.type === t);
    if (!bs.length) continue;
    const pick = (k) => bs.map((b) => b[k]).filter((v) => v != null && Number.isFinite(v));
    const notes = [];
    const none = bs.filter((b) => !(b.fed > 0)).length; if (none) notes.push(`${none} fed nothing`);
    const long = t === 'cordillera' ? bs.filter((b) => b.shortening > 1000).length : 0; if (long) notes.push(`${long} over 1000 km shortened`);
    rows.push([t, bs.length, rng(pick('closing'), (x) => x.toFixed(2)), rng(pick('myr'), int), rng(pick('shortening'), int), rng(pick('fed'), int), rng(pick('peakWidth'), int), rng(pick('widthNow'), int), rng(pick('crestNow'), int),
      `${bs.filter((b) => b.young).length}`, `${bs.filter((b) => b.atCap).length}/${bs.length}`, notes.join('; ')]);
  }
  const wd = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (r) => r.map((c, i) => (i === 0 || i === r.length - 1 ? String(c).padEnd(wd[i]) : String(c).padStart(wd[i]))).join('  ');
  console.log(line(head)); console.log(wd.map((x) => '─'.repeat(x)).join('  ')); rows.forEach((r) => console.log(line(r)));
  const young = belts.filter((b) => b.young && b.fed > 0), rho = spearman(young.map((b) => b.fed), young.map((b) => b.crestNow));
  const paths = {}; for (const b of belts) paths[b.path] = (paths[b.path] || 0) + 1;
  console.log(`read from: ${Object.entries(paths).map(([k, v]) => `${v} ${k}`).join(', ')} · at the height cap: ${belts.filter((b) => b.atCap).length} of ${belts.length} · young belts (rising, or stopped in the last 50 Myr): ${young.length}, their crest against the crust fed, rank ${rho == null ? '—' : rho.toFixed(2)}`);
  // the tallest and lowest young belt of each type, with what the plates did there
  for (const t of ['collision', 'cordillera', 'accretion']) {
    const ys = young.filter((b) => b.type === t).sort((a, b) => b.crestNow - a.crestNow);
    if (!ys.length) continue;
    const show = ys.length === 1 ? [ys[0]] : [ys[0], ys[ys.length - 1]];
    for (const [i, b] of show.entries()) console.log(`  ${i ? 'lowest ' : 'tallest'} young ${t.padEnd(10)} ${b.name}: crest ${int(b.crestNow)} m (${int(b.crestLow)} m at its lowest point), ${int(b.widthNow)} km wide${b.atCap ? ', at the cap' : ''}${b.rising ? ', still rising' : ''}; ${did(b)}`);
  }
  if (showRows) for (const b of belts) console.log(`  ${b.type.padEnd(10)} ${b.name}: ${did(b)} · now ${int(b.widthNow)} km wide, crest ${int(b.crestNow)} m (${b.stations} points)${b.atCap ? ' · at the cap' : ''}`);
  return belts;
}

if (require.main === module) {
  const args = process.argv.slice(2), showRows = args.includes('--rows');
  const seeds = args.filter((a) => /^\d+$/.test(a)).map(Number);
  for (const s of seeds.length ? seeds : [7, 21, 99]) table(`seed ${s} (Earth settings)`, T.seedWorld(s), showRows);
  if (!seeds.length) for (const f of T.EXAMPLES()) table(`${path.basename(f, '.worldsmith.json')} (saved history)`, T.exampleWorld(f), showRows);
  const c = CR.C;
  console.log(`\nConstants: crust ${c.RHO_CRUST} / mantle ${c.RHO_MANTLE} kg/m³, reference crust ${c.CRUST_KM} km, mean-elevation cap ${c.MEAN_CAP_M} m ÷ g^scaling, wedge taper ${c.TAPER_DEG}°, crust kept ${c.CRUST_KEPT}, Andean share ${c.ANDEAN_SHARE}, arc crust ${c.ARC_CRUST_KM} km; erosion E0 ${c.E0_MM} mm/yr, K ${c.K_MM_KM} mm/yr per km of relief, Rc ${c.RC_KM} km ÷ g^scaling, relief ${c.RELIEF_SHARE} of height, rain^${c.RAIN_EXP}.`);
}
module.exports = { worldBelts, spearman };
