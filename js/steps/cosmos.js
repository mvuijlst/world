/*
 * Steps 00–03: briefing, galaxy, star, planetary system.
 */
(function () {
  'use strict';
  const { h, panel, field, textField, readouts, linked, fmt, replace, icon, toast, leds, info, cardify, fold } = WS.ui;
  const V = WS.viz;
  const lvl = (ok, warn) => (ok ? 'ok' : warn ? 'warn' : 'fail');
  const between = (x, a, b) => x >= a && x <= b;

  // small helper: collect components with an _update hook
  function kit(ctx) {
    const parts = [];
    const add = (el) => { if (el && el._update) parts.push(el); return el; };
    return {
      f: (def) => add(field(ctx, def)),
      ro: (defs) => add(readouts(defs)),
      add,
      update: (c) => parts.forEach((p) => p._update(c)),
    };
  }
  WS.kit = kit;

  // ── 00 BRIEFING ──────────────────────────────────────────────────────
  WS.defineStep({
    id: 'briefing', num: '00', title: 'Briefing', code: '00_MISSION/BRIEFING', strip: 'World identity',
    lede: [
      'This console walks you through building a habitable world the way Artifexian does it in his Worldbuilder’s Log: start with the galaxy, settle on a star, lay out the planetary system, then work down to the planet, its moon, its sky, its mountains and oceans, its climates, its people and finally its calendar.',
      'Every value is linked. Change the star’s mass and the habitable zone, the planet’s temperature, the tides and the length of the year all follow. You start from an Earth/Sol analogue, so every number begins at a familiar reference.',
    ],
    build(ctx) {
      const k = kit(ctx);
      const seq = h('ol', { class: 'seq' }, WS.steps.filter((s) => s.id !== 'briefing').map((s) =>
        h('li', null, h('div', null, h('a', { href: `#/${s.id}`, class: 't-amber', style: { textDecoration: 'none' } }, h('b', null, s.title)),
          h('div', { class: 'muted', style: { fontSize: '14px' } }, s.blurb || '')))));
      const roll = async () => {
        if (!await WS.ui.ask('Replace this world’s parameters with a randomly rolled habitable system? The notes and the world’s name are kept.', { title: 'Roll a world', ok: 'Roll it' })) return;
        const keep = { id: ctx.world.id, name: ctx.world.name, notes: ctx.world.notes, created: ctx.world.created };
        const w = WS.generate.randomWorld();
        ctx.mutate((cur) => { Object.keys(cur).forEach((key) => delete cur[key]); Object.assign(cur, w, keep); }, { structural: true });
        toast(`Rolled a ${WS.calc.star(ctx.world.star).spectral.code} star with ${ctx.world.system.bodies.length + 1} worlds`);
      };
      const reset = async () => {
        if (!await WS.ui.ask('Reset every parameter to the Sol/Earth template? The notes and the world’s name are kept.', { title: 'Reset to Sol/Earth', ok: 'Reset', danger: true })) return;
        const keep = { id: ctx.world.id, name: ctx.world.name, notes: ctx.world.notes, created: ctx.world.created };
        const w = WS.data.defaultWorld();
        ctx.mutate((cur) => { Object.keys(cur).forEach((key) => delete cur[key]); Object.assign(cur, w, keep); }, { structural: true });
        toast('Reset to the Sol/Earth template');
      };
      const status = h('div');
      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' },
          panel('World identity', { ticks: true, tag: 'NAMES' },
            h('div', { class: 'fields' },
              textField(ctx, { path: 'name', label: 'World project' }),
              textField(ctx, { path: 'galaxy.name', label: 'Galaxy' }),
              textField(ctx, { path: 'star.name', label: 'Star' }),
              textField(ctx, { path: 'planet.name', label: 'Home world' }),
              textField(ctx, { path: 'moon.name', label: 'Major moon' }))),
          panel('Starting point', { tag: 'PRESETS' },
            h('p', { class: 'muted', style: { marginBottom: '12px' } }, 'Keep the Sol/Earth template and change one thing at a time, or roll a random system that already sits inside the habitable guidance.'),
            h('div', { class: 'btn-row' },
              h('button', { class: 'btn primary', type: 'button', onclick: roll }, icon('dice'), 'Roll a habitable world'),
              h('button', { class: 'btn', type: 'button', onclick: reset }, icon('reset'), 'Reset to Sol / Earth'))),
          panel('Reading the console', { tag: 'LEGEND' },
            h('ul', { class: 'diag' },
              h('li', { class: 'info' }, h('span', { class: 'flag' }, 'INPUT'), h('span', null, 'Teal boxes are yours to edit. Sliders cover the useful range; type a value to go beyond it.')),
              h('li', { class: 'info' }, h('span', { class: 'flag' }, 'OUTPUT'), h('span', null, 'Amber numbers are calculated from your inputs and update as you type.')),
              h('li', { class: 'info' }, h('span', { class: 'flag' }, '↗ LINK'), h('span', null, 'Dashed amber boxes are values owned by another step. Follow the chip to change them at the source.')),
              h('li', { class: 'info' }, h('span', { class: 'flag' }, 'i'), h('span', null, 'Hover or tap the small “i” for the explanation that sits behind each cell of the original spreadsheet.')),
              h('li', { class: 'ok' }, h('span', { class: 'flag' }, 'LAMPS'), h('span', null, 'Each step’s lamp shows its self-test: teal is Earth-like, amber is possible but unusual, red breaks the method.'))))),
        h('div', { class: 'stack-gap' },
          panel('Build sequence', { tag: '11 MODULES' }, seq),
          panel('System status', { tag: 'ALL MODULES' }, status)));
      return {
        el,
        update(c) {
          k.update(c);
          replace(status, h('ul', { class: 'diag' }, WS.steps.filter((s) => s.checks).map((s) => {
            const list = s.checks(c.world, c.d);
            const lv = WS.ui.worst(list);
            const faults = list.filter((x) => x.level === 'fail').length, warns = list.filter((x) => x.level === 'warn').length;
            return h('li', { class: lv }, h('span', { class: 'flag' }, s.num),
              h('span', null, h('a', { href: `#/${s.id}`, style: { color: 'inherit' } }, s.title), ' — ',
                faults ? `${faults} fault${faults > 1 ? 's' : ''}` : warns ? `${warns} caution${warns > 1 ? 's' : ''}` : 'nominal'));
          })));
        },
      };
    },
  });

  // ── 01 GALAXY ────────────────────────────────────────────────────────
  WS.defineStep({
    id: 'galaxy', num: '01', title: 'Galaxy', code: '01_GALACTIC/NEIGHBOURHOOD', strip: 'Stellar neighbourhood',
    blurb: 'Place your home in a spiral galaxy and populate the stars around it.',
    lede: [
      'Life favours a ring of the galactic disc: far enough from the crowded, radiation-heavy core, close enough in to have the heavy elements rocky planets need. Put your home system in that galactic habitable zone.',
      'Around it, a sphere of space — your stellar neighbourhood — fills with stars at a chosen density. Most are dim red dwarfs; many come in pairs or triples. The seed generates repeatable 3D positions for each system.',
    ],
    build(ctx) {
      const k = kit(ctx);
      ctx.ui.yaw = ctx.ui.yaw ?? 0.6; ctx.ui.pitch = ctx.ui.pitch ?? 0.45;
      ctx.ui.spin = ctx.ui.spin ?? !matchMedia('(prefers-reduced-motion: reduce)').matches;
      const g = ctx.world.galaxy;
      const inputs = panel('Galactic parameters', { ticks: true, tag: 'INPUT' },
        h('div', { class: 'fields' },
          k.f({ path: 'galaxy.radius', label: 'Galactic radius', unit: 'ly', min: 1000, slider: [10000, 150000], step: 1000, help: 'Radius of your spiral galaxy. The Milky Way is roughly 50,000 ly in radius.' }),
          k.f({ path: 'galaxy.location', label: 'Home location', unit: 'ly', min: 0, slider: [0, g.radius], step: 100, help: 'Distance of your stellar neighbourhood from the galactic centre. It should fall within the galactic habitable zone.', sub: (c) => `GHZ ${fmt.int(c.d.galaxy.ghzIn)} – ${fmt.int(c.d.galaxy.ghzOut)} ly` }),
          k.f({ path: 'galaxy.hoodRadius', label: 'Neighbourhood radius', unit: 'ly', min: 1, slider: [2, 40], step: 0.5, help: 'Your stellar neighbourhood is the sphere of space centred on your home system.' }),
          k.f({ path: 'galaxy.density', label: 'Stellar density', unit: 'stars/ly³', min: 0.0001, slider: [0.001, 0.02], step: 0.0005, help: 'Average stars per cubic light year. Milky Way average ≈ 0.006; around the Sun ≈ 0.003–0.004.' }),
          k.f({ path: 'galaxy.seed', label: 'Random seed', min: 1, max: 2000000000, step: 1, help: 'Any whole number from 1 to 2 billion. The same seed always generates the same star positions.' })),
        h('div', { class: 'btn-row', style: { marginTop: '12px' } },
          h('button', { class: 'btn small', type: 'button', onclick: () => ctx.set('galaxy.seed', 1 + Math.floor(Math.random() * 2e9)) }, icon('dice'), 'New seed')));
      const ro = k.ro([
        { label: 'Galactic habitable zone', value: (c) => `${fmt.int(c.d.galaxy.ghzIn)}–${fmt.int(c.d.galaxy.ghzOut)}`, unit: 'ly', state: (c) => lvl(c.d.galaxy.inGhz), help: 'The region of the disc where life is most likely to develop: 47%–60% of the galactic radius.' },
        { label: 'Stellar objects', value: (c) => fmt.int(c.d.galaxy.totalObjects), sub: (c) => `${fmt.num(c.d.galaxy.objects, 1)} expected by volume` },
        { label: 'Star systems', value: (c) => fmt.int(c.d.galaxy.totalSystems), sub: (c) => (c.d.galaxy.capped ? 'map shows the first 100' : 'including home') },
        { label: 'Nearest system', value: (c) => (c.d.galaxy.nearest ? fmt.num(c.d.galaxy.nearest.distance, 2) : '—'), unit: 'ly', state: () => 'ok' },
      ]);
      const mapHost = h('div', { class: 'viz-frame' });
      const hoodHost = h('div', { class: 'viz-frame drag-x', style: { cursor: 'grab' } });
      const classTable = h('div');
      const sysTable = h('div', { class: 'table-wrap' });

      // drag to rotate
      let drag = null;
      hoodHost.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: ctx.ui.yaw, pitch: ctx.ui.pitch, touch: e.pointerType !== 'mouse' }; if (!drag.touch) hoodHost.setPointerCapture(e.pointerId); ctx.ui.spin = false; spinBtn.textContent = 'Auto-rotate'; });
      hoodHost.addEventListener('pointercancel', () => { drag = null; });
      hoodHost.addEventListener('pointermove', (e) => { if (!drag) return; ctx.ui.yaw = drag.yaw + (e.clientX - drag.x) / 120; if (!drag.touch) ctx.ui.pitch = Math.max(-1.4, Math.min(1.4, drag.pitch + (e.clientY - drag.y) / 120)); drawHood(); });
      hoodHost.addEventListener('pointerup', () => { drag = null; });
      const spinBtn = h('button', { class: 'btn small', type: 'button', onclick: () => { ctx.ui.spin = !ctx.ui.spin; spinBtn.textContent = ctx.ui.spin ? 'Hold rotation' : 'Auto-rotate'; if (ctx.ui.spin) loop(); } }, ctx.ui.spin ? 'Hold rotation' : 'Auto-rotate');
      const drawHood = () => replace(hoodHost, V.neighbourhood(ctx.d.galaxy, ctx.world.galaxy.hoodRadius, ctx.ui.yaw, ctx.ui.pitch, ctx.world.galaxy.systemNames));
      let raf = null, last = 0;
      const loop = (t = 0) => {
        if (!ctx.ui.spin || !hoodHost.isConnected && t > 0) { raf = null; return; }
        if (t - last > 50) { ctx.ui.yaw += 0.012; drawHood(); last = t; }
        raf = requestAnimationFrame(loop);
      };

      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' }, inputs, ro,
          panel('Stellar mass objects', { tag: 'CENSUS' }, classTable)),
        h('div', { class: 'stack-gap' },
          panel('Galactic disc', { tag: 'TOP-DOWN', flush: true }, mapHost,
            h('div', { class: 'viz-caption' }, h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--teal)' } }), 'habitable zone'), h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--amber)' } }), 'home'))),
          panel('Stellar neighbourhood', { tag: 'DRAG TO ROTATE', flush: true }, hoodHost,
            h('div', { class: 'viz-caption' }, spinBtn, h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--teal)' } }), 'nearest'), h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--line)' } }), 'farthest')))),
        h('div', { class: 'span-2' }, panel('Star system coordinates', { tag: 'GENERATOR' }, sysTable)));

      let sysSig = '';
      return {
        el,
        update(c) {
          k.update(c);
          const gd = c.d.galaxy;
          replace(mapHost, V.galaxyMap(c.world.galaxy, gd));
          drawHood();
          const rows = [
            ['O', 'Main sequence', gd.counts.O], ['B', 'Main sequence', gd.counts.B], ['A', 'Main sequence', gd.counts.A], ['F', 'Main sequence', gd.counts.F],
            ['G', 'Main sequence', gd.counts.G], ['K', 'Main sequence', gd.counts.K], ['M', 'Main sequence', gd.counts.M],
            ['D', 'White dwarfs', gd.counts.D], ['L/T/Y', 'Brown dwarfs', gd.counts.BD], ['—', 'Giants, neutron stars, black holes', gd.counts.other],
          ];
          const mx = Math.max(1, ...rows.map((r) => r[2]));
          replace(classTable, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
            h('thead', null, h('tr', null, h('th', null, 'Class'), h('th', null, 'Type'), h('th', { style: { width: '40%' } }, ''), h('th', null, 'No.'))),
            h('tbody', null, rows.map(([cl, t, n]) => h('tr', null, h('td', { class: 't-amber' }, cl), h('td', { class: 'txtcell' }, t), h('td', null, leds(n / mx, 16)), h('td', { class: 'num' }, n))),
              h('tr', null, h('td', null, ''), h('td', { class: 'txtcell' }, h('b', null, 'Total')), h('td'), h('td', { class: 'num' }, gd.totalObjects))))),
          h('div', { class: 'readouts', style: { marginTop: '12px' } },
            [['Single', gd.single], ['Binary', gd.binary], ['Triple', gd.triple], ['≥ Quadruple', gd.quad]].map(([l, v]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l, l === 'Single' ? info('Multiplicity follows Raghavan et al. 2010 (arXiv:1007.0414): roughly 33% binaries, 8% triples, 3% higher-order systems.') : null), h('div', { class: 'val' }, String(v), h('small', null, 'systems'))))));
          const sig = `${c.world.galaxy.seed}|${c.world.galaxy.hoodRadius}|${gd.systems.length}`;
          if (sig !== sysSig) {
            sysSig = sig;
            const names = c.world.galaxy.systemNames;
            replace(sysTable, fold(`${gd.systems.length + 1} star systems · names & coordinates`, h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
              h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'Star system name'), h('th', { class: 'hide-sm' }, 'x'), h('th', { class: 'hide-sm' }, 'y'), h('th', { class: 'hide-sm' }, 'z'), h('th', null, 'Distance (ly)'), h('th', null, ''))),
              h('tbody', null,
                h('tr', null, h('td', null, '0'), h('td', { class: 'txtcell' }, h('b', { class: 't-amber' }, `${c.world.star.name} (home)`)), h('td', { class: 'num hide-sm' }, '0'), h('td', { class: 'num hide-sm' }, '0'), h('td', { class: 'num hide-sm' }, '0'), h('td', { class: 'num' }, '0'), h('td')),
                gd.systems.map((sy) => {
                  const inp = h('input', { class: 'txt', value: names[sy.index] || '', placeholder: `Star System ${sy.index}`, 'aria-label': `Name for star system ${sy.index}` });
                  inp.addEventListener('input', () => { c.world.galaxy.systemNames[sy.index] = inp.value; ctx.set('galaxy.systemNames', c.world.galaxy.systemNames, { soft: true }); });
                  inp.addEventListener('change', () => drawHood());
                  return h('tr', null, h('td', null, String(sy.index)), h('td', null, inp),
                    h('td', { class: 'num hide-sm' }, fmt.num(sy.x, 2)), h('td', { class: 'num hide-sm' }, fmt.num(sy.y, 2)), h('td', { class: 'num hide-sm' }, fmt.num(sy.z, 2)),
                    h('td', { class: 'num' }, fmt.num(sy.distance, 2)),
                    h('td', null, gd.nearest && sy.index === gd.nearest.index ? h('span', { class: 'pill teal' }, 'nearest') : gd.farthest && sy.index === gd.farthest.index ? h('span', { class: 'pill red' }, 'farthest') : null));
                }))))));
          }
          if (ctx.ui.spin && !raf) loop();
        },
        destroy() { if (raf) cancelAnimationFrame(raf); raf = null; },
      };
    },
    checks(w, d) {
      const g = d.galaxy;
      const out = [];
      out.push(g.inGhz ? { level: 'ok', text: `Home sits inside the galactic habitable zone (${fmt.int(g.ghzIn)}–${fmt.int(g.ghzOut)} ly).` }
        : { level: 'warn', text: `Home at ${fmt.int(w.galaxy.location)} ly is outside the galactic habitable zone (${fmt.int(g.ghzIn)}–${fmt.int(g.ghzOut)} ly).` });
      if (g.capped) out.push({ level: 'info', text: `${g.totalSystems} systems — the coordinate generator, like the spreadsheet, places the first 100.` });
      if (g.totalSystems <= 1) out.push({ level: 'warn', text: 'The neighbourhood holds no other star systems. Increase its radius or the stellar density.' });
      return out;
    },
  });

  // ── 02 STAR ──────────────────────────────────────────────────────────
  WS.defineStep({
    id: 'star', num: '02', title: 'Star', code: '02_STELLAR/PRIMARY', strip: 'Main sequence star',
    blurb: 'Choose the mass and age of your sun; everything else follows from those two numbers.',
    lede: [
      'A main-sequence star is defined almost entirely by its mass. Mass sets its luminosity, radius, temperature, colour and how long it will burn — and from luminosity comes the habitable zone where an Earth-like planet can orbit.',
      'For complex life, stay between 0.5 and 1.4 solar masses, and give the star at least 3.5 billion years so life has had time to get going.',
    ],
    build(ctx) {
      const k = kit(ctx);
      const inputs = panel('Stellar parameters', { ticks: true, tag: 'INPUT' },
        h('div', { class: 'fields' },
          textField(ctx, { path: 'star.name', label: 'Name' }),
          k.f({ path: 'star.mass', label: 'Mass', unit: 'M☉', min: 0.075, max: 100, hard: false, slider: [0.08, 2.5], step: 0.01, help: 'Your star’s mass in solar masses (Sun = 1 M☉ = 1.989×10³⁰ kg).\n\nO ≈ 16+ · B ≈ 2.19–16 · A ≈ 1.44–2.19 · F ≈ 1.06–1.44 · G ≈ 0.84–1.06 · K ≈ 0.47–0.84 · M ≈ 0.075–0.47\n\nStars between 0.5 and 1.4 M☉ are the most suitable for Earth-like life. The method accepts 0.075–100 M☉.', sub: (c) => `${fmt.sci(c.d.star.massKg)} kg` }),
          k.f({ path: 'star.age', label: 'Current age', unit: 'Gyr', min: 0, slider: [0, 13], step: 0.1, help: 'Age of your star in billions of years. It must be less than the star’s main-sequence lifetime.', sub: (c) => `lifetime ${fmt.num(c.d.star.maxAge, 2)} Gyr` })));
      const ro = k.ro([
        { label: 'Spectral class', value: (c) => c.d.star.spectral.code, help: 'Stars are classed O, B, A, F, G, K, M from most to least massive. The digit (0–9) subdivides each class; V means main sequence.' },
        { label: 'Temperature', value: (c) => fmt.int(c.d.star.temperature), unit: 'K', help: 'Effective surface temperature.' },
        { label: 'Luminosity', value: (c) => fmt.num(c.d.star.luminosity, 4), unit: 'L☉', sub: (c) => `${fmt.sci(c.d.star.luminosityW)} W`, help: 'Light output in solar luminosities (Sun = 3.828×10²⁶ W).' },
        { label: 'Radius', value: (c) => fmt.num(c.d.star.radius, 4), unit: 'R☉', sub: (c) => `${fmt.int(c.d.star.radiusKm)} km` },
        { label: 'Density', value: (c) => fmt.num(c.d.star.density, 4), unit: 'D☉', sub: (c) => `${fmt.num(c.d.star.densityGcm3, 3)} g/cm³` },
        { label: 'Main-sequence lifetime', value: (c) => fmt.num(c.d.star.maxAge, 2), unit: 'Gyr', state: (c) => lvl(c.world.star.age < c.d.star.maxAge), help: 'How long the star will remain on the main sequence.' },
        { label: 'Habitable zone', value: (c) => `${fmt.num(c.d.star.hzIn, 3)}–${fmt.num(c.d.star.hzOut, 3)}`, unit: 'AU', sub: (c) => `${fmt.num(c.d.star.hzIn * 149.6, 1)}–${fmt.num(c.d.star.hzOut * 149.6, 1)} million km`, help: 'A planet orbiting here receives Earth-like heating. Earth-like planets must orbit within this zone.', state: () => 'ok' },
        { label: 'Earth-like life?', value: (c) => c.d.star.life, state: (c) => (c.d.star.life === 'Yes' ? 'ok' : c.d.star.life === 'No' ? 'fail' : 'warn'), help: '“Yes”: a biosphere like modern Earth’s is possible. “Star Too Young”: only something like pre-Cambrian Earth. “No”: not around this star.' },
      ]);
      const discHost = h('div', { class: 'viz-frame' });
      const ref = h('table', { class: 'data' },
        h('thead', null, h('tr', null, h('th', null, 'Class'), h('th', null, 'Mass range (M☉)'), h('th', null, 'Temperature (K)'))),
        h('tbody', null, [['O', '16+', '33,000+'], ['B', '2.19 – 16', '10,000 – 33,000'], ['A', '1.44 – 2.19', '7,500 – 10,000'], ['F', '1.06 – 1.44', '6,000 – 7,500'], ['G', '0.84 – 1.06', '5,200 – 6,000'], ['K', '0.47 – 0.84', '3,700 – 5,200'], ['M', '0.075 – 0.47', '2,000 – 3,700']]
          .map(([c, m, t]) => h('tr', { 'data-cls': c }, h('td', { class: 't-amber' }, c), h('td', { class: 'num' }, m), h('td', { class: 'num' }, t)))));
      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' }, inputs, panel('Reference', { tag: 'MAIN SEQUENCE' }, h('div', { class: 'table-wrap' }, ref))),
        h('div', { class: 'stack-gap' }, panel('Stellar disc', { tag: 'TO SCALE vs SOL', flush: true }, discHost), ro));
      return {
        el,
        update(c) {
          k.update(c);
          replace(discHost, V.starDisc(c.d.star));
          ref.querySelectorAll('tr[data-cls]').forEach((tr) => { tr.className = tr.dataset.cls === c.d.star.spectral.letter ? 'hz' : ''; });
        },
      };
    },
    checks(w, d) {
      const s = d.star, out = [];
      if (!s.valid) out.push({ level: 'fail', text: 'Mass must be between 0.075 and 100 M☉ for a main-sequence star.' });
      if (w.star.age >= s.maxAge) out.push({ level: 'fail', text: `The star is ${w.star.age} Gyr old but leaves the main sequence at ${fmt.num(s.maxAge, 2)} Gyr.` });
      if (s.life === 'Yes') out.push({ level: 'ok', text: 'A biosphere comparable to modern Earth’s can orbit this star.' });
      else if (s.life === 'No') out.push({ level: 'fail', text: 'Outside 0.5–1.4 M☉: an Earth-like biosphere cannot orbit this star.' });
      else out.push({ level: 'warn', text: 'Star younger than 3.5 Gyr: expect something like pre-Cambrian Earth, not complex life.' });
      return out;
    },
  });

  // ── 03 PLANETARY SYSTEM ──────────────────────────────────────────────
  const KINDS = [['terrestrial', 'Terrestrial'], ['gas', 'Gas giant'], ['ice', 'Ice giant'], ['dwarf', 'Dwarf planet'], ['belt', 'Asteroid belt']];

  WS.defineStep({
    id: 'system', num: '03', title: 'Planetary System', code: '03_ORBITAL/ARCHITECTURE', strip: 'Orbits & bodies',
    blurb: 'Space out stable orbits, find the frost line and decide what sits where.',
    lede: [
      'Planets do not orbit just anywhere. Inside the Roche limit nothing survives; orbits are spaced roughly logarithmically (Titius–Bode style); habitable worlds sit in the habitable zone; gas giants form beyond the frost line, the largest on the first orbit past it, often with an empty orbit or asteroid belt just inside.',
      'Set the first orbit and the spacing, then place your bodies. The outermost gas giant shepherds a debris (Kuiper) belt at its 2:3 and 1:2 resonances.',
    ],
    build(ctx) {
      const k = kit(ctx);
      const st = () => ctx.d.star;
      const linkedBox = h('div', { class: 'fields' });
      const inputs = panel('Orbital layout', { ticks: true, tag: 'INPUT' },
        linkedBox,
        h('div', { class: 'fields', style: { marginTop: '12px' } },
          k.f({ path: 'system.firstOrbit', label: 'Orbit 1', unit: 'AU', min: 0.001, slider: [0.02, 2], step: 0.005, help: 'Distance of your innermost planetary orbit. It must lie beyond the system’s inner limit.', sub: (c) => `${fmt.num(c.world.system.firstOrbit * 149.6, 2)} million km` }),
          k.f({ path: 'system.spacing', label: 'Spacing factor', min: 0.01, slider: [0.05, 1], step: 0.01, help: 'Orbits are spaced with a Bode’s-law progression: aₙ = a₁ + s·2ⁿ⁻². The Solar System’s value is 0.3.' }),
          k.f({ path: 'system.outerGasGiant', label: 'Outermost gas giant', unit: 'AU', min: 0.01, slider: [1, 100], step: 0.01, help: 'Orbit of your outermost gas planet. Its 2:3 and 1:2 resonances bound the debris disk.' })));
      const ro = k.ro([
        { label: 'Inner limit', value: (c) => fmt.num(c.d.system.innerLimit, 4), unit: 'AU', sub: (c) => `${fmt.num(c.d.system.innerLimit * 149.6, 2)} million km`, help: 'The Roche limit of the star. Planets cannot orbit closer than this.' },
        { label: 'Habitable zone', value: (c) => `${fmt.num(st().hzIn, 3)}–${fmt.num(st().hzOut, 3)}`, unit: 'AU', state: () => 'ok' },
        { label: 'Frost line', value: (c) => fmt.num(c.d.star.frostLine, 3), unit: 'AU', sub: (c) => `${fmt.num(c.d.star.frostLine * 149.6, 1)} million km`, help: 'Beyond this, water, ammonia, methane and CO₂ freeze. Gas giants may only form beyond the frost line.' },
        { label: 'Debris disk', value: (c) => `${fmt.num(c.d.system.debrisIn, 2)}–${fmt.num(c.d.system.debrisOut, 2)}`, unit: 'AU', help: 'Your Kuiper belt. A host of dwarf planets may sit here, especially at its edges.' },
      ]);
      const mapHost = h('div', { class: 'viz-frame' });
      const orbitHost = h('div', { class: 'table-wrap' });
      const bodyHost = h('div', { class: 'table-wrap' });

      const addBody = (kind) => {
        ctx.mutate((w) => {
          const d = ctx.d;
          const free = d.system.orbits.find((o) => !o.crowded && !o.insideLimit && !w.system.bodies.some((b) => Math.abs(b.a - o.a) / o.a < 0.03) && Math.abs(o.a - w.planet.a) / o.a > 0.03);
          const b = WS.data.blankBody(kind, free ? +free.a.toFixed(4) : 1);
          b.name = `Body ${w.system.bodies.length + 1}`;
          w.system.bodies.push(b);
          w.system.bodies.sort((x, y) => x.a - y.a);
        }, { structural: true });
      };

      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' }, inputs, ro, panel('Stable orbits', { tag: 'BODE SEQUENCE' }, orbitHost)),
        h('div', { class: 'stack-gap' },
          panel('System map', { tag: 'LOG SCALE', flush: true }, mapHost,
            h('div', { class: 'viz-caption' },
              h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--teal)' } }), 'habitable zone'),
              h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--amber)' } }), 'frost line / debris disk'),
              h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--red)' } }), 'inner limit, crowded orbit'))),
          panel('Bodies', { tag: 'EDIT' }, bodyHost,
            h('div', { class: 'btn-row', style: { marginTop: '12px' } }, KINDS.map(([kk, label]) => h('button', { class: 'btn small', type: 'button', onclick: () => addBody(kk) }, icon('plus'), label))))));

      const renderBodies = (c) => {
        const w = c.world;
        const orbitOpts = c.d.system.orbits.filter((o) => o.a < 200);
        const row = (b, i) => {
          const num = (key, step, label) => {
            const inp = h('input', { class: 'txt num', type: 'number', step, value: b[key], 'aria-label': `${b.name} ${label}` });
            inp.addEventListener('input', () => { const v = Number(inp.value); if (inp.value !== '' && Number.isFinite(v)) { b[key] = v; ctx.set(`system.bodies.${i}.${key}`, v); } });
            return inp;
          };
          const nameIn = h('input', { class: 'txt name-in', value: b.name, 'aria-label': 'Body name' });
          nameIn.addEventListener('input', () => ctx.set(`system.bodies.${i}.name`, nameIn.value));
          const kindSel = h('select', { class: 'sel', 'aria-label': `${b.name} type` }, KINDS.map(([v, t]) => h('option', { value: v, selected: v === b.kind }, t)));
          kindSel.addEventListener('change', () => ctx.set(`system.bodies.${i}.kind`, kindSel.value, { structural: true }));
          const snap = h('select', { class: 'sel', 'aria-label': `Snap ${b.name} to an orbit`, style: { width: '86px' } },
            h('option', { value: '' }, 'orbit…'), orbitOpts.map((o) => h('option', { value: o.a }, `#${o.n} · ${fmt.num(o.a, 3)}`)));
          snap.addEventListener('change', () => { if (snap.value) { ctx.mutate((ww) => { ww.system.bodies[i].a = Number(snap.value); ww.system.bodies.sort((x, y) => x.a - y.a); }, { structural: true }); } });
          const atm = h('input', { type: 'checkbox', checked: !!b.atmosphere, 'aria-label': `${b.name} has an atmosphere` });
          atm.addEventListener('change', () => ctx.set(`system.bodies.${i}.atmosphere`, atm.checked));
          const del = h('button', { class: 'btn small danger', type: 'button', 'aria-label': `Remove ${b.name}`, onclick: () => ctx.mutate((ww) => ww.system.bodies.splice(i, 1), { structural: true }) }, icon('x'));
          const aIn = num('a', 'any', 'semi-major axis');
          aIn.addEventListener('change', () => ctx.mutate((ww) => ww.system.bodies.sort((x, y) => x.a - y.a), { structural: true }));
          return h('tr', null, h('td', null, nameIn), h('td', null, kindSel), h('td', null, h('div', { style: { display: 'flex', gap: '4px' } }, aIn, snap)),
            h('td', null, num('radius', 'any', 'radius')), h('td', null, num('albedo', 'any', 'geometric albedo')), h('td', null, h('label', { class: 'check' }, atm)), h('td', { class: 'actions', 'data-label': '' }, del));
        };
        replace(bodyHost, cardify(h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'Name'), h('th', null, 'Type'), h('th', null, 'Orbit (AU)'), h('th', null, 'Radius R⊕'), h('th', null, 'Albedo (geom.)'), h('th', null, 'Atmosphere'), h('th'))),
          h('tbody', null,
            h('tr', { class: 'hz' }, h('td', { class: 'txtcell' }, h('b', { class: 't-amber' }, w.planet.name), ' ', h('span', { class: 'pill amber' }, 'home')), h('td', { class: 'txtcell' }, 'Terrestrial'),
              h('td', { class: 'num' }, h('a', { href: '#/planet', class: 'link-chip' }, `${fmt.num(w.planet.a, 3)} ↗`)), h('td', { class: 'num' }, fmt.num(c.d.planet.radius, 3)), h('td', { class: 'num' }, '—'), h('td', null, '✓'), h('td')),
            w.system.bodies.map(row)))),
        h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '8px' } }, 'Radius, geometric albedo and atmosphere feed the brightness calculations on the Sky step. The home world is edited on the Planet step.'));
      };

      const renderOrbits = (c) => {
        const occ = (o) => {
          const hits = c.world.system.bodies.filter((b) => Math.abs(b.a - o.a) / o.a < 0.03).map((b) => b.name);
          if (Math.abs(c.world.planet.a - o.a) / o.a < 0.03) hits.unshift(c.world.planet.name);
          return hits.join(', ');
        };
        const shown = c.d.system.orbits.filter((o, i) => i < 8 || o.a <= c.d.system.debrisOut * 1.1);
        replace(orbitHost, h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, '#'), h('th', null, 'AU'), h('th', { class: 'hide-sm' }, 'Mkm'), h('th', null, 'Notes'), h('th', null, 'Occupant'))),
          h('tbody', null, shown.map((o) => h('tr', { class: [o.habitable && 'hz', o.beyondFrost && 'frost', (o.crowded || o.insideLimit) && 'bad'] },
            h('td', null, String(o.n)), h('td', { class: 'num' }, fmt.num(o.a, 3)), h('td', { class: 'num hide-sm' }, fmt.num(o.a * 149.6, 1)),
            h('td', { class: 'txtcell' },
              o.habitable ? h('span', { class: 'pill teal' }, 'habitable') : null,
              o.role ? h('span', { class: 'pill amber' }, o.role) : o.beyondFrost ? h('span', { class: 'pill mute' }, 'beyond frost') : null,
              o.crowded ? h('span', { class: 'pill red' }, '< 0.15 AU apart') : null,
              o.insideLimit ? h('span', { class: 'pill red' }, 'inside limit') : null),
            h('td', { class: 'txtcell' }, occ(o)))))),
        h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '8px' } }, 'Fill orbits or leave them empty as you like. Earth-like worlds go on habitable orbits; gas giants only beyond the frost line; orbits within 0.15 AU of a neighbour cannot hold a planet.'));
      };

      let bodySig = '';
      return {
        el,
        update(c) {
          k.update(c);
          replace(linkedBox,
            linked('Star mass', fmt.num(c.world.star.mass, 3), 'M☉', 'star'),
            linked('Luminosity', fmt.num(c.d.star.luminosity, 4), 'L☉', 'star'),
            linked('Radius', fmt.num(c.d.star.radius, 4), 'R☉', 'star'));
          replace(mapHost, V.systemMap(c.d.system, c.d.star, c.world.system.bodies, c.world.planet, c.world.planet.name));
          renderOrbits(c);
          const sig = c.world.system.bodies.map((b) => b.id + b.kind).join('|') + '|' + c.d.system.orbits.map((o) => o.a.toFixed(3)).slice(0, 12).join(',') + c.world.planet.name;
          if (sig !== bodySig) { bodySig = sig; renderBodies(c); }
        },
      };
    },
    checks(w, d) {
      const out = [], s = d.system, st = d.star;
      if (w.system.firstOrbit <= s.innerLimit) out.push({ level: 'fail', text: `Orbit 1 (${w.system.firstOrbit} AU) is inside the inner limit (${fmt.num(s.innerLimit, 4)} AU).` });
      const pa = w.planet.a;
      out.push(between(pa, st.hzIn, st.hzOut) ? { level: 'ok', text: `${w.planet.name} orbits inside the habitable zone.` } : { level: 'fail', text: `${w.planet.name} at ${pa} AU is outside the habitable zone (${fmt.num(st.hzIn, 3)}–${fmt.num(st.hzOut, 3)} AU).` });
      const onOrbit = s.orbits.some((o) => Math.abs(o.a - pa) / o.a < 0.03);
      if (!onOrbit) out.push({ level: 'warn', text: `${w.planet.name} is not on one of the computed stable orbits. Adjust Orbit 1 or the spacing factor, or move the planet.` });
      for (const b of w.system.bodies) {
        if ((b.kind === 'gas' || b.kind === 'ice') && b.a < st.frostLine) out.push({ level: 'fail', text: `${b.name} is a giant inside the frost line (${fmt.num(st.frostLine, 2)} AU).` });
        if (b.a <= s.innerLimit) out.push({ level: 'fail', text: `${b.name} is inside the inner limit.` });
      }
      const all = [...w.system.bodies.filter((b) => b.kind !== 'belt').map((b) => [b.name, b.a]), [w.planet.name, pa]].sort((a, b) => a[1] - b[1]);
      for (let i = 1; i < all.length; i++) if (all[i][1] - all[i - 1][1] < 0.15) out.push({ level: 'warn', text: `${all[i - 1][0]} and ${all[i][0]} are within 0.15 AU of each other.` });
      if (!s.outerGasGiantBeyondFrost) out.push({ level: 'fail', text: 'The outermost gas giant is inside the frost line.' });
      return out;
    },
  });
})();
