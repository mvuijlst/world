/*
 * Steps 04–06: planet, moon, sky (apparent size & brightness).
 */
(function () {
  'use strict';
  const { h, panel, field, textField, readouts, linked, fmt, replace, icon, gauge, info, cardify } = WS.ui;
  const V = WS.viz;
  const C = WS.calc;
  const between = (x, a, b) => x >= a && x <= b;
  const lvl = (ok, warn) => (ok ? 'ok' : warn ? 'warn' : 'fail');

  // ── 04 PLANET ────────────────────────────────────────────────────────
  WS.defineStep({
    id: 'planet', num: '04', title: 'Planet', code: '04_TERRESTRIAL/HOME', strip: 'Home world',
    blurb: 'Mass, composition, spin, orbit and air: the physical heart of the world.',
    lede: [
      'Pick a mass and a core-mass fraction and the planet’s density, size, gravity and escape velocity follow. Axial tilt sets the tropics and polar circles; rotation sets the number of atmospheric circulation cells; distance, albedo and greenhouse effect set the temperature.',
      'Then compose the atmosphere. Oxygen partial pressure must stay breathable, other gases below toxic levels, and the planet must be heavy enough to hold on to all of them.',
    ],
    build(ctx) {
      const k = WS.kit(ctx);
      ctx.ui.globeSpin = ctx.ui.globeSpin ?? !matchMedia('(prefers-reduced-motion: reduce)').matches;
      const st = () => ctx.d.star;
      const phys = panel('Physical characteristics', { ticks: true, tag: 'INPUT' },
        h('div', { class: 'fields' },
          textField(ctx, { path: 'planet.name', label: 'Name' }),
          k.f({ path: 'planet.mass', label: 'Mass', unit: 'M⊕', min: 0.01, slider: [0.1, 10], step: 0.01, help: 'Planet mass in Earth masses (Earth = 5.972×10²⁴ kg). Terrestrial planets: 0.1–10 M⊕. Habitable Earth-like planets: 0.1–3.5 M⊕.', sub: (c) => `${fmt.sci(c.d.planet.massKg)} kg` }),
          k.f({ path: 'planet.cmf', label: 'Core mass fraction', unit: '%', min: 0, max: 100, slider: [0, 80], step: 0.1, help: 'Share of the planet’s mass in its iron core. Stay close to Earth’s ~33% so the planet can generate a protective magnetic field.' }),
          k.f({ path: 'planet.tilt', label: 'Axial tilt', unit: '°', min: 0, max: 180, slider: [0, 180], step: 0.1, help: 'Tilt of the spin axis to the orbital plane (0–180°). Above 90° the planet spins retrograde. More tilt means harsher seasons; 0° or 180° means none. Earth-like: 0–90°, ideally 0–45°. Earth = 23.5°.' }),
          k.f({ path: 'planet.albedo', label: 'Bond albedo', min: 0, max: 1, slider: [0, 1], step: 0.01, help: 'How much light the planet reflects, 0 (absorbs everything) to 1 (reflects everything). Mercury 0.088 · Venus 0.689 · Earth 0.306 · Mars 0.25 · Jupiter 0.503.' }),
          k.f({ path: 'planet.greenhouse', label: 'Greenhouse effect', min: 0, max: 500, slider: [0, 5], step: 0.05, help: 'Strength of the greenhouse effect, 0 to 500. 0 = no atmosphere, 1 = Earth, 200 = Venus.' }),
          k.f({ path: 'planet.observerHeight', label: 'Observer height', unit: 'm', min: 0, slider: [0, 100], step: 0.05, help: 'Eye height for the horizon distance calculation.' })));
      const orbit = panel('Orbital characteristics', { ticks: true, tag: 'INPUT' },
        h('div', { class: 'fields' },
          k.f({ path: 'planet.rotation', label: 'Day length', unit: 'h', min: 0.1, slider: [2, 100], step: 0.1, help: 'Rotation period in Earth hours. Earth-like planets: roughly 6–48 hours.' }),
          k.f({ path: 'planet.a', label: 'Semi-major axis', unit: 'AU', min: 0.001, slider: [0.05, 5], step: 0.001, help: 'Distance from the star. Earth-like planets must orbit within the habitable zone.', sub: (c) => `HZ ${fmt.num(st().hzIn, 3)}–${fmt.num(st().hzOut, 3)} AU` }),
          k.f({ path: 'planet.e', label: 'Eccentricity', min: 0, max: 0.99, slider: [0, 0.5], step: 0.0001, help: 'How elliptical the orbit is (0 = circle). Keep it very low so the planet stays in the habitable zone all year. Earth = 0.0167.' }),
          k.f({ path: 'planet.inclination', label: 'Inclination', unit: '°', min: 0, max: 180, slider: [0, 180], step: 0.1, help: 'Tilt of the orbit relative to the primary habitable world’s orbital plane. The primary habitable world is 0° by definition.' }),
          k.f({ path: 'planet.lonPeriapsis', label: 'Longitude of periapsis', unit: '°', min: 0, max: 360, slider: [0, 360], step: 1, help: 'Geocentric longitude of periapsis, 0–360°. Earth ≈ 283°. Only used to place the seasons relative to the closest approach — any value works.' }),
          k.f({ path: 'planet.subsolarLon', label: 'Subsolar longitude', unit: '°', min: 0, max: 360, slider: [0, 360], step: 1, help: 'Longitude of the subsolar point at the vernal equinox, 0–360°. Used by the external Solar Events calculator — any value works.' })));
      const atmo = panel('Atmosphere', { ticks: true, tag: 'INPUT' },
        h('div', { class: 'fields' },
          k.f({ path: 'planet.pressure', label: 'Surface pressure', unit: 'atm', min: 0, slider: [0, 5], step: 0.01, help: 'Sea-level pressure in standard atmospheres. The breathable range depends on oxygen: 10% O₂ → 0.75–3.40 atm, 20% → 0.48–2.72, 30% → 0.34–1.84, 40% → 0.27–1.36, 50% → 0.23–1.09 …', sub: (c) => `${fmt.num(c.world.planet.pressure * 101.3, 1)} kPa · advised ${fmt.num(c.d.planet.pressureRange[0], 2)}–${fmt.num(c.d.planet.pressureRange[1], 2)} atm` }),
          k.f({ path: 'planet.o2', label: 'Oxygen O₂', unit: '%', min: 0, max: 100, slider: [0, 60], step: 0.01 }),
          k.f({ path: 'planet.co2', label: 'Carbon dioxide CO₂', unit: '%', min: 0, max: 100, slider: [0, 5], step: 0.01 }),
          k.f({ path: 'planet.ar', label: 'Argon Ar', unit: '%', min: 0, max: 100, slider: [0, 5], step: 0.01 })),
        h('div', { class: 'gas-host', style: { marginTop: '16px' } }));
      const gasHost = atmo.querySelector('.gas-host');

      const roPhys = k.ro([
        { label: 'Density', value: (c) => fmt.num(c.d.planet.density, 3), unit: 'g/cm³', state: (c) => lvl(between(c.d.planet.density, 3, 8)), help: 'Earth = 5.51 g/cm³. Silicate rock ≈ 3, iron ≈ 8 — an Earth-like world falls between, implying an iron core and rock mantle.' },
        { label: 'Radius', value: (c) => fmt.num(c.d.planet.radius, 4), unit: 'R⊕', sub: (c) => `${fmt.int(c.d.planet.radiusKm)} km`, state: (c) => lvl(between(c.d.planet.radius, 0.5, 1.5), c.d.planet.radius < 1.6), help: 'Terrestrial planets: below ~1.6 R⊕. Habitable Earth-like planets: 0.5–1.5 R⊕.' },
        { label: 'Surface gravity', value: (c) => fmt.num(c.d.planet.gravity, 3), unit: 'g', sub: (c) => `${fmt.num(c.d.planet.gravityMs2, 2)} m/s²`, state: (c) => lvl(between(c.d.planet.gravity, 0.4, 1.6)), help: 'Habitable Earth-like planets: 0.4–1.6 g.' },
        { label: 'Escape velocity', value: (c) => fmt.num(c.d.planet.escape, 3), unit: 'v⊕', sub: (c) => `${fmt.num(c.d.planet.escapeKms, 2)} km/s`, help: 'Earth = 11.2 km/s. The higher it is, the harder and costlier spaceflight becomes.' },
        { label: 'Surface temperature', value: (c) => fmt.int(c.d.planet.temperature), unit: 'K', sub: (c) => `${fmt.int(c.d.planet.temperatureC)} °C average`, help: 'Average surface temperature from luminosity, distance, albedo and greenhouse effect. Earth ≈ 287 K (14 °C).' },
        { label: 'Spin', value: (c) => c.d.planet.rotationDir, help: 'Prograde: spins the same way as its star — the sun rises in the east. Retrograde (tilt > 90°): the sun rises in the west.' },
        { label: 'Tropics', value: (c) => `0–${fmt.num(c.d.planet.tropics, 2)}`, unit: '° N/S', help: 'Latitudes where the star passes directly overhead at least one day a year.' },
        { label: 'Polar circles', value: (c) => `${fmt.num(c.d.planet.polar, 2)}–90`, unit: '° N/S', help: 'Latitudes where, at least one day a year, the star never rises or never sets.' },
        { label: 'Horizon', value: (c) => fmt.num(c.d.planet.horizon, 2), unit: 'km', help: 'Distance to the horizon for the observer height, ignoring terrain and refraction. About 5 km on Earth.' },
      ]);
      const roOrbit = k.ro([
        { label: 'Periapsis', value: (c) => fmt.num(c.d.planet.periapsis, 4), unit: 'AU', sub: (c) => `${fmt.num(c.d.planet.periapsis * 149.6, 2)} million km`, state: (c) => lvl(between(c.d.planet.periapsis, st().hzIn, st().hzOut)), help: 'Closest approach to the star. Must stay inside the habitable zone.' },
        { label: 'Apoapsis', value: (c) => fmt.num(c.d.planet.apoapsis, 4), unit: 'AU', sub: (c) => `${fmt.num(c.d.planet.apoapsis * 149.6, 2)} million km`, state: (c) => lvl(between(c.d.planet.apoapsis, st().hzIn, st().hzOut)), help: 'Farthest point from the star. Must stay inside the habitable zone.' },
        { label: 'Year', value: (c) => fmt.num(c.d.planet.yearLocalDays, 2), unit: 'local days', sub: (c) => `${fmt.num(c.d.planet.yearEarthDays, 2)} Earth days · ${fmt.num(c.d.planet.yearEarthYears, 3)} Earth years` },
        { label: 'Orbital direction', value: (c) => c.d.planet.orbitDir, state: (c) => lvl(c.d.planet.orbitDir === 'Prograde'), help: 'Prograde orbits go the same way as the star spins. Earth-like planets should be prograde.' },
        { label: 'Star’s apparent size', value: (c) => fmt.num(c.d.planet.starApparentSize, 3), unit: '°', sub: (c) => `${fmt.num(c.d.planet.starApparentSize / 0.5332, 2)}× the Sun from Earth` },
        { label: 'Atmospheric density', value: (c) => fmt.num(c.d.planet.atmDensity, 3), unit: 'kg/m³', help: 'Earth ≈ 1.2 kg/m³. Denser air makes flight — mechanical and natural — easier.' },
      ]);
      const globeHost = h('div', { class: 'viz-frame' });
      const cellsHost = h('div', { class: 'viz-frame' });
      const cellsInfo = h('div');
      const dayHost = h('div');
      const spinBtn = h('button', { class: 'btn small', type: 'button', onclick: () => { ctx.ui.globeSpin = !ctx.ui.globeSpin; spinBtn.textContent = ctx.ui.globeSpin ? 'Hold rotation' : 'Spin'; if (ctx.ui.globeSpin) spin(); } }, ctx.ui.globeSpin ? 'Hold rotation' : 'Spin');
      let globeSvg = null, raf = null, lon = 0, lastT = 0;
      const spin = (t = 0) => {
        if (!ctx.ui.globeSpin || (!globeHost.isConnected && t > 0)) { raf = null; return; }
        if (globeSvg && t - lastT > 40) { lon += 0.02; globeSvg._spin(lon); lastT = t; }
        raf = requestAnimationFrame(spin);
      };

      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' }, phys, orbit, atmo),
        h('div', { class: 'stack-gap' },
          panel('Globe', { tag: 'AXIAL TILT', flush: true }, globeHost,
            h('div', { class: 'viz-caption' }, spinBtn,
              h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--teal)' } }), 'tropics'),
              h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--amber)' } }), 'equator, polar circles'),
              h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--muted)' } }), 'cell boundaries'))),
          roPhys, roOrbit,
          panel('Atmospheric circulation', { tag: 'CELLS / HEMISPHERE' }, h('div', { class: 'grid two-even' }, cellsHost, cellsInfo)),
          panel('Daylight hours', { tag: 'LATITUDE × SEASON' }, dayHost)));

      return {
        el,
        update(c) {
          k.update(c);
          const p = c.d.planet;
          globeSvg = V.globe(c.world.planet.tilt, p.tropics, p.polar, p.cells);
          replace(globeHost, globeSvg);
          globeSvg._spin(lon);
          if (ctx.ui.globeSpin && !raf) spin();
          replace(cellsHost, V.cellsSection(p.cells, p.tropics, p.polar));
          replace(cellsInfo,
            h('div', { class: 'readouts' }, h('div', { class: 'readout' }, h('div', { class: 'lbl' }, 'Cells per hemisphere', info('Fast spinners have more circulation cells. Earth (24 h) has three per hemisphere: Hadley, Ferrel and polar. Earth-like worlds should have three.')),
              h('div', { class: 'val' }, p.cells.count ?? 'NA'))),
            h('table', { class: 'data', style: { marginTop: '8px' } }, h('tbody', null, (p.cells.bands || []).map(([a, b], i) =>
              h('tr', null, h('td', null, p.cells.count === 3 ? ['Hadley', 'Ferrel', 'Polar'][i] : `Cell ${i + 1}`), h('td', { class: 'num' }, `${a}–${b}° N/S`))))));
          // gases
          const pp = p.pp;
          const rows = [
            ['Oxygen O₂', 'o2', [0.16, 0.5], [0, 1], 'Partial pressure of O₂ should be 0.16–0.5 atm.'],
            ['Carbon dioxide CO₂', 'co2', [0, 0.02], [0, 0.05], 'Partial pressure of CO₂ should be below 0.02 atm (below 0.005 is optimal).'],
            ['Argon Ar', 'ar', [0, 1.6], [0, 3], 'Partial pressure of Argon should be below 1.6 atm.'],
            ['Nitrogen N₂', 'n2', [0, 3], [0, 5], 'Partial pressure of N₂ should be below 3 atm. Its share is whatever is left after the other gases.'],
          ];
          replace(gasHost,
            h('div', { class: 'panel-sub' }, 'Partial pressures'),
            h('div', { class: 'stack-gap', style: { gap: '12px' } }, rows.map(([n, key, band, scale, help]) => h('div', null,
              gauge(`${n} · ${fmt.num(p.pct[key], 2)}%`, pp[key], band, [scale[0], Math.max(scale[1], pp[key] * 1.1)], `${fmt.num(pp[key], 4)} atm`),
              h('div', { class: 'field-sub', style: { display: 'flex', justifyContent: 'space-between', gap: '8px' } },
                h('span', null, `${fmt.num(pp[key] * 101.3, 2)} kPa`),
                p.stability[key] >= 1 ? h('span', { class: 't-red' }, 'ESCAPES TO SPACE') : h('span', { class: 't-teal' }, `retained · ${fmt.num(p.stability[key], 2)}`),
                info(`${help}\n\nRetention: thermal speed vs. 1/6 of escape velocity. Values ≥ 1 mean the planet cannot hold this gas — tweak the physical characteristics.`))))));
          // daylight
          const grid = C.daylightGrid(c.world.planet, p, { days: 96, lats: 37 });
          const legend = h('div', { class: 'viz-caption' },
            h('span', null, `Rows 90°N → 90°S · columns: one local year from the vernal equinox · dark = 0 h, amber = ${fmt.num(c.world.planet.rotation, 1)} h`));
          replace(dayHost,
            h('div', { style: { display: 'grid', gridTemplateColumns: '38px 1fr', gap: '6px' } },
              h('div', { class: 'mono muted', style: { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', fontSize: '14px' } }, h('span', null, '90N'), h('span', null, '0'), h('span', null, '90S')),
              h('div', { style: { border: '1px solid var(--line-soft)' } }, V.daylightCanvas(grid, c.world.planet.rotation))),
            legend,
            h('div', { class: 'btn-row', style: { marginTop: '8px' } },
              h('a', { class: 'btn small', href: p.solarEventsUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('link'), 'Open the Solar Events calculator')),
            h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '6px' } }, 'The link opens rue_cr’s external Desmos calculator (used by the spreadsheet) with your values filled in.'));
        },
        destroy() { if (raf) cancelAnimationFrame(raf); raf = null; },
      };
    },
    checks(w, d) {
      const p = d.planet, st = d.star, out = [];
      const P = w.planet;
      out.push(between(P.mass, 0.1, 3.5) ? { level: 'ok', text: 'Mass suits a habitable Earth-like planet (0.1–3.5 M⊕).' } : between(P.mass, 0.1, 10) ? { level: 'warn', text: 'Terrestrial, but above the 3.5 M⊕ habitable limit.' } : { level: 'fail', text: 'Mass is outside the terrestrial range (0.1–10 M⊕).' });
      if (!between(p.radius, 0.5, 1.5)) out.push({ level: p.radius < 1.6 ? 'warn' : 'fail', text: `Radius ${fmt.num(p.radius, 3)} R⊕ is outside 0.5–1.5 R⊕.` });
      if (!between(p.gravity, 0.4, 1.6)) out.push({ level: 'fail', text: `Gravity ${fmt.num(p.gravity, 2)} g is outside 0.4–1.6 g.` });
      if (!between(p.density, 3, 8)) out.push({ level: 'warn', text: `Density ${fmt.num(p.density, 2)} g/cm³ is outside rock–iron (3–8).` });
      if (Math.abs(P.cmf - 33) > 12) out.push({ level: 'warn', text: 'Core mass fraction far from Earth’s ~33%: the magnetic field may be too weak.' });
      if (P.tilt > 90) out.push({ level: 'fail', text: 'Axial tilt above 90°: retrograde spin is not Earth-like.' });
      else if (P.tilt > 45) out.push({ level: 'warn', text: 'Axial tilt above 45°: extreme seasons.' });
      if (!between(P.rotation, 6, 48)) out.push({ level: 'warn', text: 'Day length outside roughly 6–48 hours.' });
      if (!(between(p.periapsis, st.hzIn, st.hzOut) && between(p.apoapsis, st.hzIn, st.hzOut))) out.push({ level: 'fail', text: 'Part of the orbit leaves the habitable zone.' });
      else out.push({ level: 'ok', text: 'The whole orbit stays inside the habitable zone.' });
      if (p.orbitDir !== 'Prograde') out.push({ level: 'fail', text: 'Orbit is not prograde.' });
      if (!between(p.pp.o2, 0.16, 0.5)) out.push({ level: 'fail', text: `O₂ partial pressure ${fmt.num(p.pp.o2, 3)} atm is outside 0.16–0.5.` });
      if (p.pp.co2 > 0.02) out.push({ level: 'fail', text: `CO₂ partial pressure ${fmt.num(p.pp.co2, 4)} atm is toxic (> 0.02).` });
      else if (p.pp.co2 > 0.005) out.push({ level: 'warn', text: 'CO₂ partial pressure above the optimal 0.005 atm.' });
      if (p.pp.ar > 1.6) out.push({ level: 'fail', text: 'Argon partial pressure above 1.6 atm.' });
      if (p.pp.n2 > 3) out.push({ level: 'fail', text: 'Nitrogen partial pressure above 3 atm.' });
      if (p.pct.n2 < 0) out.push({ level: 'fail', text: 'Gas percentages add up to more than 100%.' });
      if (!between(P.pressure, p.pressureRange[0], p.pressureRange[1])) out.push({ level: 'warn', text: `Pressure outside the ${fmt.num(p.pressureRange[0], 2)}–${fmt.num(p.pressureRange[1], 2)} atm advised for ${fmt.num(P.o2, 1)}% O₂.` });
      const lost = C.GASES.filter((g) => p.stability[g.key] >= 1).map((g) => g.formula);
      if (lost.length) out.push({ level: 'fail', text: `The planet cannot hold ${lost.join(', ')}. Increase mass or reduce temperature.` });
      if (p.cells.count !== 3) out.push({ level: 'warn', text: `${p.cells.count ?? 'No'} circulation cells per hemisphere; Earth-like worlds have 3.` });
      return out;
    },
  });

  // ── 05 MOON ──────────────────────────────────────────────────────────
  WS.defineStep({
    id: 'moon', num: '05', title: 'Moon', code: '05_SATELLITE/MAJOR', strip: 'Major moon',
    blurb: 'Size a large moon, keep it in a stable orbit and work out its tides.',
    lede: [
      'A large moon has to orbit between the Roche limit, where the planet’s gravity would tear it apart, and the edge of the Hill sphere where it would drift off. For long-term stability keep it inside half the Hill radius, on a near-circular, prograde, low-inclination orbit.',
      'The moon’s distance sets the length of the month and, with the star, the strength of the tides. A major moon should be tidally locked to its planet; the planet should not be locked to the star.',
    ],
    build(ctx) {
      const k = WS.kit(ctx);
      const toggle = h('input', { type: 'checkbox', checked: ctx.world.moon.enabled, id: 'moon-on' });
      toggle.addEventListener('change', () => ctx.set('moon.enabled', toggle.checked, { structural: true }));
      const head = panel('Satellite', { tag: 'TOGGLE' }, h('label', { class: 'check', for: 'moon-on' }, toggle, 'This world has a major moon'));
      if (!ctx.world.moon.enabled) {
        return { el: h('div', { class: 'stack-gap' }, head, panel('No major moon', { tag: 'STANDBY' }, h('p', { class: 'muted' }, 'Moon calculations, lunar calendars and eclipses are switched off. Tides come from the star alone.'))), update() {} };
      }
      const linkedBox = h('div', { class: 'fields' });
      const inputs = panel('Moon parameters', { ticks: true, tag: 'INPUT' },
        h('div', { class: 'fields' },
          textField(ctx, { path: 'moon.name', label: 'Name' }),
          k.f({ path: 'moon.mass', label: 'Mass', unit: 'M☾', min: 0.001, slider: [0.01, 10], step: 0.01, help: 'Moon mass in lunar masses (Moon = 7.342×10²² kg). It should be much less massive than its planet.', sub: (c) => `${fmt.sci(c.d.moon.massKg)} kg` }),
          k.f({ path: 'moon.density', label: 'Density', unit: 'g/cm³', min: 0.5, slider: [1, 6], step: 0.01, help: 'Rocky moons are denser than 3 g/cm³. The Moon is 3.34 g/cm³.' }),
          k.f({ path: 'moon.albedo', label: 'Bond albedo', min: 0, max: 1, slider: [0, 1], step: 0.001, help: 'Reflectivity, 0–1. The Moon is 0.136.' }),
          k.f({ path: 'moon.a', label: 'Semi-major axis', unit: 'km', min: 1, slider: [10000, 2000000], step: 100, help: 'Distance from the planet. Keep it between the Roche limit and half the Hill radius. Space multiple major moons at least 10 planetary radii apart. The Moon: 384,748 km.', sub: (c) => `${fmt.num(c.world.moon.a / c.d.planet.radiusKm, 1)} planetary radii` }),
          k.f({ path: 'moon.e', label: 'Eccentricity', min: 0, max: 0.99, slider: [0, 0.3], step: 0.001, help: 'Major moons should have very low eccentricities. The Moon: 0.055.' }),
          k.f({ path: 'moon.inclination', label: 'Inclination', unit: '°', min: 0, max: 180, slider: [0, 180], step: 0.01, help: 'Inclination relative to the planet’s orbital plane; keep it low. The Moon: 5.15°.' })),
        h('div', { class: 'panel-sub', style: { marginTop: '16px' } }, 'Linked from other steps'), linkedBox);
      const ro = k.ro([
        { label: 'Radius', value: (c) => fmt.num(c.d.moon.radius, 3), unit: 'R☾', sub: (c) => `${fmt.int(c.d.moon.radiusKm)} km`, state: (c) => lvl(c.d.moon.radius > 0.173), help: 'Major moons like ours should exceed 0.173 R☾.' },
        { label: 'Surface gravity', value: (c) => fmt.num(c.d.moon.gravity, 4), unit: 'g', sub: (c) => `${fmt.num(c.d.moon.gravityMs2, 3)} m/s²` },
        { label: 'Escape velocity', value: (c) => fmt.num(c.d.moon.escape, 3), unit: 'km/s' },
        { label: 'Moon zone', value: (c) => `${fmt.int(c.d.moon.zoneIn)}–${fmt.int(c.d.moon.zoneOut)}`, unit: 'km', sub: (c) => `stable inside ${fmt.int(c.d.moon.zoneOut / 2)} km`, help: 'Inner edge: the Roche limit. Outer edge: the Hill radius, beyond which the moon is no longer bound to the planet.' },
        { label: 'Periapsis / apoapsis', value: (c) => `${fmt.int(c.d.moon.periapsis)} / ${fmt.int(c.d.moon.apoapsis)}`, unit: 'km', state: (c) => lvl(c.d.moon.periapsis > c.d.moon.zoneIn && c.d.moon.apoapsis < c.d.moon.zoneOut / 2, c.d.moon.apoapsis < c.d.moon.zoneOut) },
        { label: 'Orbital direction', value: (c) => c.d.moon.orbitDir, state: (c) => lvl(c.d.moon.orbitDir === 'Prograde') },
        { label: 'Sidereal month', value: (c) => fmt.num(c.d.moon.sidereal, 3), unit: 'Earth days', help: 'One orbit measured against the background stars.' },
        { label: 'Synodic month', value: (c) => fmt.num(c.d.moon.synodic, 3), unit: 'Earth days', sub: (c) => `${fmt.num(c.d.moon.synodic * 24 / c.world.planet.rotation, 3)} local days`, help: 'Full moon to full moon: the natural month for a calendar.' },
        { label: 'Rotation period', value: (c) => (c.d.moon.rotation ? fmt.num(c.d.moon.rotation, 3) : 'not locked'), unit: (c) => (c.d.moon.rotation ? 'Earth days' : ''), help: 'Shown when the moon is tidally locked (as in the spreadsheet, the synodic period is used).' },
      ]);
      const tideRo = k.ro([
        { label: 'Total tides', value: (c) => fmt.num(c.d.moon.tides, 3), unit: '× Earth', state: (c) => lvl(between(c.d.moon.tides, 0.3, 3), true), help: 'Combined tidal force of moon and star relative to Earth’s. < 1 gentler, > 1 stronger tides.' },
        { label: 'Moon share', value: (c) => fmt.num(c.d.moon.tideMoonPct, 1), unit: '%', sub: () => 'Earth’s Moon ≈ 66%' },
        { label: 'Star share', value: (c) => fmt.num(c.d.moon.tideStarPct, 1), unit: '%', sub: () => 'Sun ≈ 33%' },
        { label: 'Moon locked to planet?', value: (c) => (c.d.moon.moonLocked ? 'Yes' : 'No'), state: (c) => lvl(c.d.moon.moonLocked), sub: (c) => `lock time ${fmt.num(c.d.moon.tMoonLock, 4)} Gyr`, help: 'Major moons should always be tidally locked (showing one face to the planet).' },
        { label: 'Planet locked to moon?', value: (c) => c.d.moon.planetLockedToMoon.text.replace('Possibly Locked in ', '~ '), state: (c) => lvl(c.d.moon.planetLockedToMoon.level >= 4, c.d.moon.planetLockedToMoon.level === 3), help: 'A rough approximation. Avoid anything faster than billions of years — change the moon’s distance to adjust.', wide: true },
        { label: 'Planet locked to star?', value: (c) => (c.d.moon.planetLockedToStar ? 'Yes' : 'No'), state: (c) => lvl(!c.d.moon.planetLockedToStar), help: 'For an Earth-like setup the answer should be “No”.' },
      ]);
      const rulerHost = h('div', { class: 'viz-frame' });
      const tideBar = h('div');
      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' }, head, inputs),
        h('div', { class: 'stack-gap' },
          panel('Moon zone', { tag: 'LOG SCALE', flush: true }, rulerHost,
            h('div', { class: 'viz-caption' }, h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--teal)' } }), 'stable (Roche – ½ Hill)'), h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--amber)' } }), 'bound but unstable'))),
          ro, panel('Tides & locking', { tag: 'TIDAL CALCULATOR' }, tideBar, tideRo)));
      return {
        el,
        update(c) {
          k.update(c);
          const pl = c.d.planet;
          replace(linkedBox,
            linked('Star mass', fmt.num(c.world.star.mass, 3), 'M☉', 'star'),
            linked('Star age', fmt.num(c.world.star.age, 2), 'Gyr', 'star'),
            linked('Planet mass', fmt.num(c.world.planet.mass, 3), 'M⊕', 'planet'),
            linked('Planet radius', fmt.int(pl.radiusKm), 'km', 'planet'),
            linked('Planet orbit', fmt.num(c.world.planet.a, 3), 'AU', 'planet'),
            linked('Planet day', fmt.num(c.world.planet.rotation, 2), 'h', 'planet'));
          replace(rulerHost, V.moonRuler(c.world.moon, c.d.moon, pl.radiusKm));
          const m = c.d.moon;
          replace(tideBar, h('div', { class: 'stack-row', style: { marginBottom: '12px' } },
            h('div', { class: 'cap' }, h('span', null, `${c.world.moon.name || 'Moon'} ${fmt.num(m.tideMoonPct, 1)}%`), h('span', null, `${c.world.star.name || 'Star'} ${fmt.num(m.tideStarPct, 1)}%`)),
            h('div', { class: 'stack-bar' }, h('div', { class: 'a', style: { width: `${m.tideMoonPct}%` } }, 'MOON'), h('div', { class: 'b', style: { width: `${m.tideStarPct}%` } }, 'STAR'))));
        },
      };
    },
    checks(w, d) {
      if (!w.moon.enabled) return [{ level: 'info', text: 'No major moon.' }];
      const m = d.moon, out = [];
      if (!m.massRatioOk) out.push({ level: 'fail', text: 'The moon is more massive than its planet.' });
      if (m.periapsis <= m.zoneIn) out.push({ level: 'fail', text: 'Periapsis is inside the Roche limit: the moon would be torn apart.' });
      else if (m.apoapsis >= m.zoneOut) out.push({ level: 'fail', text: 'Apoapsis is beyond the Hill radius: the moon is not bound.' });
      else if (w.moon.a > m.zoneOut / 2) out.push({ level: 'warn', text: 'Semi-major axis beyond half the Hill radius: long-term unstable.' });
      else out.push({ level: 'ok', text: 'Orbit sits inside the stable moon zone.' });
      if (m.radius <= 0.173) out.push({ level: 'warn', text: 'Radius below 0.173 R☾: more an asteroid than a major moon.' });
      if (w.moon.density < 3) out.push({ level: 'info', text: 'Density below 3 g/cm³: an icy rather than rocky moon.' });
      if (w.moon.e > 0.1) out.push({ level: 'warn', text: 'Major moons should have very low eccentricity.' });
      if (m.orbitDir !== 'Prograde') out.push({ level: 'fail', text: 'Major moons of Earth-like planets should orbit prograde.' });
      if (!m.moonLocked) out.push({ level: 'warn', text: 'The moon is not yet tidally locked to the planet.' });
      if (m.planetLockedToMoon.level < 4) out.push({ level: m.planetLockedToMoon.level < 3 ? 'fail' : 'warn', text: `Planet-to-moon locking: ${m.planetLockedToMoon.text}. Move the moon farther out.` });
      if (m.planetLockedToStar) out.push({ level: 'fail', text: 'The planet is tidally locked to its star.' });
      return out;
    },
  });

  // ── 06 SKY ───────────────────────────────────────────────────────────
  WS.defineStep({
    id: 'sky', num: '06', title: 'Sky', code: '06_OBSERVATORY/SKY', strip: 'Apparent size & brightness',
    blurb: 'How big and bright the star, planets and moon look from the ground.',
    lede: [
      'What your people see overhead shapes their myths and their science. From each world in the system the star has a different size and brightness; from the home world, the other planets wax and wane as their distance and phase change.',
      'Slide each planet between its closest and farthest distance to see when it shines brightest, whether it is lost in the glare, and whether it would have been known since antiquity or only found by telescope.',
    ],
    build(ctx) {
      const k = WS.kit(ctx);
      const starRo = k.ro([
        { label: 'Absolute magnitude', value: (c) => fmt.num(c.d.star.magnitude, 3), unit: 'M', help: 'Bolometric absolute magnitude: brightness at 10 parsecs. More negative is brighter. Sun ≈ 4.74.' },
        { label: 'From home', value: (c) => fmt.num(c.d.sky.home.magnitude, 2), unit: 'mag', sub: (c) => `${fmt.num(c.d.sky.home.brightness, 3)}× the Sun from Earth`, help: 'Apparent magnitude of the star from the home world. The Sun from Earth: −26.83.' },
        { label: 'Apparent size', value: (c) => fmt.num(c.d.sky.home.size, 3), unit: '× Sun', help: 'How large the star looks from the home world relative to the Sun from Earth.' },
      ]);
      const moonPanel = h('div');
      const sizesHost = h('div', { class: 'viz-frame' });
      const posHost = h('div', { class: 'viz-frame' });
      const starTable = h('div', { class: 'table-wrap' });
      const planetTable = h('div', { class: 'table-wrap' });

      if (ctx.world.moon.enabled) {
        moonPanel.appendChild(panel('Moon from the home world', { ticks: true, tag: 'INPUT' },
          h('div', { class: 'fields' },
            k.f({ path: 'moon.geoAlbedo', label: 'Geometric albedo', min: 0, max: 1, slider: [0, 1], step: 0.001, help: 'Geometric (not Bond) albedo of the moon. Our Moon ≈ 0.113.' }),
            k.f({ path: 'moon.phase', label: 'Phase angle', unit: '°', min: 0, max: 180, slider: [0, 180], step: 1, help: '0° = full moon, 90° = half moon, 180° = new moon.' })),
          h('div', { style: { marginTop: '12px' } }, k.ro([
            { label: 'Absolute magnitude', value: (c) => fmt.num(c.d.sky.moon.H, 3), help: 'Brightness if seen from 1 AU. Our Moon ≈ 0.28.' },
            { label: 'Apparent magnitude', value: (c) => (c.d.sky.moon.magnitude === null ? 'Invisible' : fmt.num(c.d.sky.moon.magnitude, 2)), help: 'Current brightness from the home world. Full Moon from Earth ≈ −12.7.' },
            { label: 'Brightness', value: (c) => (c.d.sky.moon.brightness === null ? 'NA' : fmt.num(c.d.sky.moon.brightness, 3)), unit: '× Moon' },
            { label: 'Apparent size', value: (c) => fmt.num(c.d.sky.moon.size, 3), unit: '× Moon' },
            { label: 'Eclipses', value: (c) => (c.d.sky.moon.totalEclipses ? 'Total possible' : 'Annular only'), state: (c) => (c.d.sky.moon.totalEclipses ? 'ok' : 'warn'), help: 'If the moon looks at least as large as the star, total solar eclipses happen; otherwise only annular ones.', wide: true },
          ]))));
      }

      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' },
          panel('The star from each world', { tag: 'APPARENT SIZE', flush: true }, sizesHost),
          starRo,
          panel('Star brightness by world', { tag: 'TABLE' }, starTable),
          moonPanel),
        h('div', { class: 'stack-gap' },
          panel('Current configuration', { tag: 'TOP-DOWN · √ SCALE', flush: true }, posHost,
            h('div', { class: 'viz-caption' }, h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--teal)' } }), 'naked-eye visible now'), h('span', null, 'dotted lines: lines of sight from home'))),
        ),
        h('div', { class: 'span-2' }, panel('Planets seen from home', { tag: 'OBSERVATORY LOG' }, planetTable)));

      let sig = '';
      const renderPlanetTable = (c) => {
        const bodies = c.world.system.bodies;
        const rows = c.d.sky.bodies.map((b, i) => {
          const src = bodies[i];
          const fh = b.fromHome;
          const span = fh.dMax - fh.dMin;
          const slider = h('input', { type: 'range', min: fh.dMin, max: fh.dMax, step: span / 400 || 0.001, value: src.distance, 'aria-label': `${b.name} current distance`, style: { width: '140px', flex: '1 1 140px', minWidth: 0 } });
          const num = h('input', { class: 'txt num', type: 'number', step: 'any', value: +src.distance.toFixed(4), 'aria-label': `${b.name} current distance (AU)`, style: { width: '96px', flex: '0 0 96px' } });
          const commit = (v) => { if (!Number.isFinite(v)) return; ctx.set(`system.bodies.${i}.distance`, v); };
          slider.addEventListener('input', () => { num.value = (+slider.value).toFixed(4); commit(Number(slider.value)); });
          num.addEventListener('input', () => { if (num.value !== '') { slider.value = num.value; commit(Number(num.value)); } });
          const cells = { phase: h('td', { class: 'num' }), elong: h('td', { class: 'num' }), mag: h('td', { class: 'num' }), naked: h('td'), obs: h('td', { class: 'txtcell' }), vis: h('td', { class: 'txtcell' }) };
          const tr = h('tr', null, h('td', { class: 'txtcell' }, h('b', null, b.name)), h('td', { class: 'num' }, `${fmt.num(fh.dMin, 3)}–${fmt.num(fh.dMax, 3)}`),
            h('td', { class: 'span-all' }, h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, slider, num)),
            cells.phase, cells.elong, cells.mag, cells.naked, cells.obs, cells.vis);
          tr._update = (cc) => {
            const f2 = cc.d.sky.bodies[i].fromHome;
            num.classList.toggle('bad', !f2.distanceValid);
            cells.phase.textContent = fmt.num(f2.phase, 1);
            cells.elong.textContent = fmt.num(f2.elong, 1);
            cells.mag.textContent = f2.magnitude === null ? 'NA' : fmt.num(f2.magnitude, 2);
            replace(cells.naked, h('span', { class: `pill ${f2.nakedEye === 'Yes' ? 'teal' : f2.nakedEye === 'Maybe' ? 'amber' : 'mute'}` }, f2.nakedEye));
            cells.obs.textContent = f2.observable;
            replace(cells.vis, h('span', { class: f2.visibility.startsWith('Naked') ? 't-teal' : f2.visibility === 'NA' ? 'muted' : '' }, f2.visibility));
          };
          return tr;
        });
        replace(planetTable, cardify(h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'Planet'), h('th', null, 'Range (AU)'), h('th', null, ['Distance now ', info('Current distance between this planet and the home world. It must lie between the minimum and maximum (red when outside).')]),
            h('th', null, ['Phase° ', info('Phase angle: 0° fully lit, 90° half lit, 180° unlit. Brightness is unreliable above ~120°.')]),
            h('th', null, ['Elong.° ', info('Angle from the star as seen from home. < 20°: lost in the glare. < 50°: twilight only. 180°: opposition.')]),
            h('th', null, ['Mag. ', info('Current apparent magnitude. Below about +5 to +7 is visible to the naked eye.')]),
            h('th', null, ['Known since antiquity? ', info('Could the planet ever be seen with the naked eye under perfect conditions? Yes: known since antiquity. Maybe: depends on the observer. No: a modern discovery.')]),
            h('th', null, 'Observable'), h('th', null, 'Visibility'))),
          h('tbody', null, rows))),
          bodies.length ? null : h('p', { class: 'muted' }, 'No other bodies yet — add some on the Planetary System step.'));
        planetTable._rows = rows;
      };

      return {
        el,
        update(c) {
          k.update(c);
          replace(sizesHost, V.starSizes(c.d.sky, c.world.planet.name));
          replace(posHost, V.skyPositions(c.d.sky, c.world.planet.a, c.world.planet.name, c.world.system.bodies));
          replace(starTable, cardify(h('table', { class: 'data' },
            h('thead', null, h('tr', null, h('th', null, 'World'), h('th', null, 'AU'), h('th', null, 'Magnitude'), h('th', null, 'Brightness'), h('th', null, 'Size'))),
            h('tbody', null,
              h('tr', { class: 'hz' }, h('td', { class: 'txtcell' }, h('b', { class: 't-amber' }, c.world.planet.name)), h('td', { class: 'num' }, fmt.num(c.world.planet.a, 3)), h('td', { class: 'num' }, fmt.num(c.d.sky.home.magnitude, 2)), h('td', { class: 'num' }, fmt.num(c.d.sky.home.brightness, 4)), h('td', { class: 'num' }, fmt.num(c.d.sky.home.size, 3))),
              c.d.sky.bodies.map((b) => h('tr', null, h('td', { class: 'txtcell' }, b.name), h('td', { class: 'num' }, fmt.num(b.fromBody.a, 3)), h('td', { class: 'num' }, fmt.num(b.fromBody.magnitude, 2)), h('td', { class: 'num' }, fmt.num(b.fromBody.brightness, 4)), h('td', { class: 'num' }, fmt.num(b.fromBody.size, 3))))))));
          const s2 = c.world.system.bodies.map((b) => `${b.id}:${b.a}`).join('|') + c.world.planet.a;
          if (s2 !== sig) { sig = s2; renderPlanetTable(c); }
          (planetTable._rows || []).forEach((r) => r._update(c));
        },
      };
    },
    checks(w, d) {
      const out = [];
      d.sky.bodies.forEach((b) => { if (!b.fromHome.distanceValid) out.push({ level: 'fail', text: `${b.name}: current distance is outside its possible range (${fmt.num(b.fromHome.dMin, 3)}–${fmt.num(b.fromHome.dMax, 3)} AU).` }); });
      const naked = d.sky.bodies.filter((b) => b.fromHome.nakedEye === 'Yes').map((b) => b.name);
      out.push({ level: 'info', text: naked.length ? `Known since antiquity: ${naked.join(', ')}.` : 'No other planet is visible to the naked eye.' });
      if (w.moon.enabled && d.sky.moon) out.push({ level: 'info', text: d.sky.moon.totalEclipses ? 'Total solar eclipses are possible.' : 'Only annular solar eclipses occur.' });
      return out;
    },
  });
})();
