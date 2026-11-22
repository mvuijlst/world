/*
 * The sky colour engine against the Panoptes renders it is anchored to, and the sky geometry.
 * Run with:  node --test tests/
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const SP = require('../js/spectra.js');
const PAN = require('../js/panoptes.js');
const OR = require('../js/orbits.js');
const C = require('../js/calc.js');
const D = require('../js/data.js');

test('sky colours reproduce every Panoptes render (ΔE < 4)', () => {
  let worst = 0;
  for (const [cls, T, high, low] of PAN.SKY) {
    PAN.PRESSURES.forEach((p, i) => {
      for (const [rows, elv] of [[high, PAN.SKY_HIGH_ELEVATION], [low, PAN.SKY_LOW_ELEVATION]]) {
        const s = SP.skySummary({ T, pressure: p }, elv);
        const [z, h, w] = rows[i];
        const dz = SP.deltaE(s.zenith, SP.fromHex(z)), dh = SP.deltaE(s.horizon, SP.fromHex(h)), dw = SP.deltaE(s.white, SP.fromHex(w));
        worst = Math.max(worst, dz, dh);
        assert.ok(dz < 4 && dh < 4, `${cls} ${p} atm ${elv}°: zenith ΔE ${dz.toFixed(1)}, horizon ΔE ${dh.toFixed(1)}`);
        assert.ok(dw < 6, `${cls} ${p} atm ${elv}°: card ΔE ${dw.toFixed(1)}`);
      }
    });
  }
  assert.ok(worst < 4);
});

test('a Sun-like sky behaves: blue zenith by day, darker towards night, warm low sun', () => {
  const lum = (b) => SP.lab(b)[0];
  const noon = SP.skySummary({ T: 5772, pressure: 1 }, 60), low = SP.skySummary({ T: 5772, pressure: 1 }, 4), night = SP.skySummary({ T: 5772, pressure: 1 }, -8);
  assert.ok(noon.zenith[2] > noon.zenith[0] + 40, 'blue zenith');
  assert.ok(lum(noon.zenith) > lum(low.zenith) && lum(low.zenith) > lum(night.zenith));
  assert.ok(low.white[0] > low.white[2] + 60, 'reddened sunlight near the horizon');
  assert.ok(lum(night.zenith) < 3, 'dark at night');
  // thicker air: whiter, brighter zenith
  const thick = SP.skySummary({ T: 5772, pressure: 10 }, 55);
  assert.ok(lum(thick.zenith) > lum(noon.zenith));
  // low gravity looks like more air (Panoptes)
  const light = SP.skySummary({ T: 5772, pressure: 1, gravity: 0.33 }, 55), p3 = SP.skySummary({ T: 5772, pressure: 3 }, 55);
  assert.ok(SP.deltaE(light.zenith, p3.zenith) < 4);
  // no air: black
  const vac = SP.skySummary({ T: 5772, pressure: 0 }, 55);
  assert.ok(lum(vac.zenith) < 1);
});

test('leaf colours match the Panoptes table at its classes and interpolate between them', () => {
  for (const [cls, T, rows] of PAN.LEAF) {
    PAN.LEAF_PRESSURES.forEach((p, i) => {
      const got = SP.leafColours(T, p);
      got.forEach((h, k) => assert.ok(SP.deltaE(SP.fromHex(h), SP.fromHex(rows[i][k])) < 1.5, `${cls} ${p} leaf ${k}`));
    });
  }
  const g2 = SP.leafColours(5770, 1)[2], k0 = SP.leafColours(5270, 1)[2], mid = SP.leafColours(5500, 1)[2];
  assert.ok(SP.deltaE(SP.fromHex(mid), SP.fromHex(g2)) < SP.deltaE(SP.fromHex(g2), SP.fromHex(k0)) + 1);
  assert.equal(SP.leafColours(3210, 1, { twilight: true }).length, 6);
});

test('orbits: periods, the vernal equinox at t = 0 and the solstice a quarter-year on', () => {
  const w = D.defaultWorld();
  w.planet.e = 0; // a circular orbit makes the quarter-year exact
  const d = C.computeAll(w);
  const els = OR.elements(w, d);
  const home = els.find((b) => b.home);
  assert.ok(Math.abs(home.period - 365.256) < 1e-6);
  const p0 = OR.position(home, 0);
  assert.ok(Math.abs(Math.atan2(p0[1], p0[0]) * 180 / Math.PI - 180) < 1e-6 || Math.abs(Math.atan2(p0[1], p0[0]) * 180 / Math.PI + 180) < 1e-6);
  // full orbit returns
  const p1 = OR.position(home, home.period);
  assert.ok(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-9);
  // equinox noon at the equator: star at the zenith; solstice noon at 23.5°N: at the zenith too
  let s = OR.skyFrom(w, d, els, 'home', 0, 0, 0.5);
  assert.ok(s.star.alt > 89.5, `equinox noon altitude ${s.star.alt}`);
  s = OR.skyFrom(w, d, els, 'home', home.period / 4, 23.5, 0.5);
  assert.ok(s.star.alt > 89.5, `solstice noon altitude ${s.star.alt}`);
  // midnight: below the horizon; morning: in the east
  assert.ok(OR.skyFrom(w, d, els, 'home', 0, 45, 0).star.alt < -40);
  const am = OR.skyFrom(w, d, els, 'home', 0, 45, 0.3).star;
  assert.ok(am.az > 45 && am.az < 135, `morning azimuth ${am.az}`);
  // the Sun's apparent size from Earth ≈ 0.53°
  assert.ok(Math.abs(s.star.size - 0.533) < 0.03);
  // the moon: full near t = 0 (opposite the star)
  const m = OR.skyFrom(w, d, els, 'home', 0, 0, 0).moon;
  assert.ok(m.phase < 10, `moon phase ${m.phase}`);
});
