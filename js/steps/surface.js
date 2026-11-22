/*
 * Steps 07–11: tectonics, climate zones, population, calendar, dossier.
 */
(function () {
  'use strict';
  const { h, panel, field, textField, readouts, linked, fmt, replace, icon, toast, info, tabs, cardify } = WS.ui;
  const V = WS.viz;
  const C = WS.calc;
  const lvl = (ok, warn) => (ok ? 'ok' : warn ? 'warn' : 'fail');

  // ── 07 TECTONICS ─────────────────────────────────────────────────────
  function suggested(type, gravity, scaling) {
    const r = C.mountainRange({ type, heights: [], widths: [], erosion: 0, age: 0 }, gravity, scaling);
    return {
      heights: r.features.map((f) => (f.heightRange.min !== undefined ? Math.round((f.heightRange.min + f.heightRange.max) / 2 / 10) * 10 : null)),
      widths: r.features.map((f) => (f.widthRange.min !== undefined ? Math.round((f.widthRange.min + f.widthRange.max) / 2 / 10) * 10 : null)),
    };
  }

  WS.defineStep({
    id: 'tectonics', num: '07', title: 'Tectonics', code: '07_LANDFORM/OROGENY', strip: 'Mountains & oceans',
    blurb: 'Profile your mountain ranges, erode them, and set the depth of your oceans.',
    lede: [
      'Gravity caps how tall a peak can stand, and every mountain range has a recognisable cross-section depending on how it formed: at a subduction margin (Andean, Laramide) or where continents collide (Ural, Himalayan), thin or thick. Pick a type, then size each feature within the suggested ranges, which shrink as gravity grows.',
      'Once tectonic activity stops, ranges erode — a few metres per million years. Under the sea, ocean depth follows the age of the crust: shallow at young mid-ocean ridges, deepening as the plate cools.',
    ],
    build(ctx) {
      const k = WS.kit(ctx);
      const T = ctx.world.tectonics;
      const idx = Math.min(T.active || 0, T.ranges.length - 1);
      const r = T.ranges[idx];
      const base = `tectonics.ranges.${idx}`;
      const rangeTabs = h('div', { class: 'btn-row', style: { marginBottom: '12px' } },
        T.ranges.map((rg, i) => h('button', { class: ['btn small', i === idx && 'primary'], type: 'button', onclick: () => ctx.set('tectonics.active', i, { structural: true }) }, rg.name || `Range ${i + 1}`)),
        h('button', { class: 'btn small', type: 'button', onclick: () => ctx.mutate((w) => {
          const s = suggested('Andean', ctx.d.planet.gravity, w.tectonics.scaling);
          w.tectonics.ranges.push({ id: WS.data.newId('r'), name: `Range ${w.tectonics.ranges.length + 1}`, type: 'Andean', heights: s.heights, widths: s.widths, erosion: 5, age: 50 });
          w.tectonics.active = w.tectonics.ranges.length - 1;
        }, { structural: true }) }, icon('plus'), 'Add range'));
      const typeSel = h('select', { id: 'range-type' }, Object.keys(C.RANGE_TYPES).map((t) => h('option', { value: t, selected: t === r.type }, t)));
      typeSel.addEventListener('change', () => ctx.mutate((w) => {
        const rr = w.tectonics.ranges[idx];
        rr.type = typeSel.value;
        const s = suggested(rr.type, ctx.d.planet.gravity, w.tectonics.scaling);
        rr.heights = s.heights; rr.widths = s.widths;
      }, { structural: true }));
      const inputs = panel('Range parameters', { ticks: true, tag: 'INPUT' },
        rangeTabs,
        h('div', { class: 'fields' },
          textField(ctx, { path: `${base}.name`, label: 'Range name' }),
          h('div', { class: 'field' }, h('label', { class: 'field-label', for: 'range-type' }, 'Type', info('Andean: thin orogeny at a subduction margin (southern Andes).\nLaramide: thick orogeny at a subduction margin (Rockies).\nUral: thin orogeny at a continent–continent collision (Urals, Alps, Caucasus).\nHimalayan: thick orogeny at a continent–continent collision (Himalayas).\n\nChanging the type refills the table with mid-range suggestions.')), typeSel),
          k.f({ path: 'tectonics.scaling', label: 'Gravity scaling', min: 1, max: 2, slider: [1, 2], step: 0.05, help: 'How strongly elevations scale with gravity: suggested heights and widths are divided by g^factor. Range 1–2.' }),
          k.f({ path: `${base}.erosion`, label: 'Erosion rate', unit: 'm/Myr', min: 0, slider: [0, 20], step: 0.5, help: 'Global average ≈ 4–5 m/Myr. Regionally: arid 3, cold 7, polar 1, temperate 16, tropical 5.' }),
          k.f({ path: `${base}.age`, label: 'Inactive for', unit: 'Myr', min: 0, slider: [0, 500], step: 1, help: 'How long the range has been tectonically inactive. 0 = still active.' })),
        h('div', { class: 'btn-row', style: { marginTop: '12px' } },
          h('button', { class: 'btn small', type: 'button', onclick: () => ctx.mutate((w) => { const s = suggested(r.type, ctx.d.planet.gravity, w.tectonics.scaling); Object.assign(w.tectonics.ranges[idx], s); }, { structural: true }) }, icon('reset'), 'Fill suggested midpoints'),
          T.ranges.length > 1 ? h('button', { class: 'btn small danger', type: 'button', onclick: async () => { if (await WS.ui.ask(`Remove ${r.name} and everything set for it?`, { title: 'Remove range', ok: 'Remove', danger: true })) ctx.mutate((w) => { w.tectonics.ranges.splice(idx, 1); w.tectonics.active = 0; }, { structural: true }); } }, icon('x'), 'Remove range') : null));
      const featTable = h('div', { class: 'table-wrap' });
      const roTop = k.ro([
        { label: 'Max peak height', value: (c) => fmt.int(c.d.tectonics.maxPeak), unit: 'm', help: 'The absolute highest a single peak can stand under this gravity.' },
        { label: 'Gravity', value: (c) => fmt.num(c.d.planet.gravity, 3), unit: 'g', sub: () => 'linked from Planet' },
      ]);
      const xsHost = h('div', { class: 'viz-frame' });
      const oceanHost = h('div', { class: 'viz-frame' });
      const oceanTable = h('div', { class: 'table-wrap' });
      const oceanIn = k.f({ path: 'tectonics.ridgeDepth', label: 'Mid-ocean ridge depth', unit: 'm', min: 0, slider: [1500, 4000], step: 50, help: 'Average depth of the ridge crest below sea level. On Earth ridges sit at a near-uniform ~2,600 m; stay within about ±500 m of that.' });

      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' }, inputs, roTop),
        h('div', { class: 'stack-gap' },
          panel('Cross-section', { tag: 'ACTIVE vs ERODED', flush: true }, xsHost,
            h('div', { class: 'viz-caption' }, h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--amber)' } }), 'active profile'), h('span', { class: 'key' }, h('i', { class: 'sw', style: { background: 'var(--teal)' } }), 'after erosion'), h('span', null, 'vertical exaggeration varies'))),
          panel('Features', { tag: 'HEIGHT × WIDTH' }, featTable)),
        h('div', { class: 'span-2' }, panel('Ocean depth', { tag: 'BY CRUST AGE' },
          h('div', { class: 'grid two' }, h('div', { class: 'stack-gap' }, oceanIn, oceanTable), oceanHost))));

      const renderFeatures = (c) => {
        const rr = c.d.tectonics.ranges[idx];
        const cur = c.world.tectonics.ranges[idx];
        const rows = rr.features.map((f, i) => {
          const mk = (arr, key, disabled, ok) => {
            if (disabled) return h('span', { class: 'muted' }, '—');
            const inp = h('input', { class: ['txt num', !ok && 'bad'], type: 'number', step: 10, value: cur[arr][i] ?? '', 'aria-label': `${f.name} ${key}` });
            inp.addEventListener('input', () => { const v = inp.value === '' ? null : Number(inp.value); ctx.set(`${base}.${arr}.${i}`, v); });
            return inp;
          };
          return h('tr', null, h('td', { class: 'txtcell' }, h('b', null, f.name)),
            h('td', null, mk('heights', 'height (m)', f.tapering, f.heightOk)), h('td', { class: 'txtcell muted' }, f.heightRange.text),
            h('td', null, mk('widths', 'width (km)', f.infinite, f.widthOk)), h('td', { class: 'txtcell muted' }, f.widthRange.text),
            h('td', { class: 'num' }, f.erodedHeight === null ? 'Tapering' : fmt.int(f.erodedHeight)));
        });
        replace(featTable, cardify(h('table', { class: 'data' },
          h('thead', null, h('tr', null, h('th', null, 'Feature'), h('th', null, 'Height m'), h('th', null, ['Suggested ', info('Average heights. Individual peaks may exceed them. 0 means at or below sea level. “Tapering” slopes between its neighbours — leave it blank.')]), h('th', null, 'Width km'), h('th', null, ['Suggested ', info('Average widths. 0 means the feature may be absent. ∞ tapers off until it meets another feature (mountain, coast, rift…) — leave it blank.')]), h('th', null, 'Eroded m'))),
          h('tbody', null, rows))));
      };
      let featSig = '';
      return {
        el,
        update(c) {
          k.update(c);
          const rr = c.d.tectonics.ranges[idx];
          replace(xsHost, V.crossSection(rr, c.d.tectonics.maxPeak));
          const sig = `${c.world.tectonics.scaling}|${c.d.planet.gravity.toFixed(4)}|${rr.features.map((f) => `${f.heightOk}${f.widthOk}${f.erodedHeight}`).join(',')}`;
          if (sig !== featSig) {
            const active = document.activeElement;
            const pos = active && featTable.contains(active) ? active.getAttribute('aria-label') : null;
            featSig = sig; renderFeatures(c);
            if (pos) { const again = featTable.querySelector(`[aria-label="${pos}"]`); if (again) { again.focus(); const v = again.value; again.value = ''; again.value = v; } }
          }
          replace(oceanHost, V.oceanCurve({ ridge: c.world.tectonics.ridgeDepth }));
          const oc = c.d.tectonics.ocean.filter((o) => [0, 10, 20, 50, 100, 200, 500, 1000].includes(o.age));
          replace(oceanTable, h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Crust age (Myr)'), h('th', null, 'Depth (m)'))),
            h('tbody', null, oc.map((o) => h('tr', null, h('td', null, String(o.age)), h('td', { class: 'num' }, fmt.int(o.depth)))))));
        },
      };
    },
    checks(w, d) {
      const out = [];
      d.tectonics.ranges.forEach((r, i) => {
        const name = w.tectonics.ranges[i].name || `Range ${i + 1}`;
        r.features.forEach((f) => {
          if (!f.heightOk) out.push({ level: 'warn', text: `${name}: ${f.name} height outside the suggested ${f.heightRange.text} m.` });
          if (!f.widthOk) out.push({ level: 'warn', text: `${name}: ${f.name} width outside the suggested ${f.widthRange.text} km.` });
          if (f.height !== null && f.height > d.tectonics.maxPeak) out.push({ level: 'fail', text: `${name}: ${f.name} exceeds the maximum peak height (${fmt.int(d.tectonics.maxPeak)} m).` });
        });
      });
      if (Math.abs(w.tectonics.ridgeDepth - 2600) > 500) out.push({ level: 'warn', text: 'Mid-ocean ridge depth is more than 500 m from Earth’s ~2,600 m.' });
      if (!out.length) out.push({ level: 'ok', text: 'All features sit within the suggested ranges.' });
      return out;
    },
  });

  // ── 08 CLIMATE ───────────────────────────────────────────────────────
  WS.defineStep({
    id: 'climate', num: '08', title: 'Climate Zones', code: '08_ATMOSPHERIC/KÖPPEN', strip: 'Köppen climate reference',
    blurb: 'Paint climates onto your map using the circulation cells as a guide.',
    lede: [
      'With continents drawn, climate follows from latitude, circulation and ocean currents: rainforest under the rising air of the equator, deserts where the Hadley cells sink, Mediterranean coasts on cold currents, oceanic coasts on warm ones, taiga and tundra toward the poles.',
      'The strip below places the belts for your planet’s circulation. Use the reference cards — each lists where a zone typically appears — to paint your map.',
    ],
    build(ctx) {
      ctx.ui.climateGroup = ctx.ui.climateGroup || 'all';
      const stripHost = h('div', { class: 'viz-frame' });
      const cards = h('div', { class: 'cards' });
      const groupTabs = h('div');
      const groups = [['all', 'All'], ...Object.entries(WS.data.CLIMATE_GROUPS).map(([k2, v]) => [k2, `${k2} · ${v}`])];
      const drawCards = () => {
        replace(groupTabs, tabs(groups, ctx.ui.climateGroup, (g) => { ctx.ui.climateGroup = g; drawCards(); }));
        replace(cards, WS.data.CLIMATE_ZONES.filter((z) => ctx.ui.climateGroup === 'all' || z.group === ctx.ui.climateGroup).map((z) => h('details', { class: 'card', open: window.matchMedia('(min-width: 700px)').matches },
          h('summary', null,
            h('div', { class: 'swatch', style: { background: z.color } }),
            h('h3', null, h('span', null, z.name), h('span', { class: 'code' }, z.code)),
            h('p', { class: 'muted', style: { fontSize: '12.5px' } }, z.key),
            h('span', { class: 'chev' }, `${z.rainfall.split(',')[0]} rain · ${z.examples} ▾`)),
          h('dl', null,
            h('dt', null, 'Rainfall'), h('dd', null, z.rainfall),
            h('dt', null, 'Temperature'), h('dd', null, z.temperature),
            h('dt', null, 'Seasons'), h('dd', null, z.seasons),
            h('dt', null, 'Environment'), h('dd', null, h('ul', null, z.environment.map((x) => h('li', null, x)))),
            h('dt', null, 'Where'), h('dd', null, h('ul', null, z.location.map((x) => h('li', null, x)))),
            h('dt', null, 'Example'), h('dd', null, z.examples),
            z.comments.length ? [h('dt', null, 'Notes'), h('dd', null, h('ul', null, z.comments.map((x) => h('li', null, x))))] : null))));
      };
      drawCards();
      const el = h('div', { class: 'stack-gap' },
        h('div', { class: 'grid two' },
          panel('Latitude belts', { tag: 'YOUR PLANET', flush: true }, stripHost),
          panel('How to use this', { tag: 'GUIDE' },
            h('ol', { class: 'seq' },
              h('li', null, h('div', null, h('b', null, 'Find the cells'), h('div', { class: 'muted' }, 'Hadley cells rise at the equator (wet) and sink near their poleward edge (dry). Ferrel cells carry westerly storms; polar cells are cold and dry.'))),
              h('li', null, h('div', null, h('b', null, 'Lay down the belts'), h('div', { class: 'muted' }, 'Start with A at the equator, B where the Hadley cells sink, C and D in the Ferrel cells, E beyond the polar circle.'))),
              h('li', null, h('div', null, h('b', null, 'Bend for coasts'), h('div', { class: 'muted' }, 'Warm currents (east coasts) favour Cfa / Cfb; cold currents (west coasts) favour Csa / Csb and fog deserts.'))),
              h('li', null, h('div', null, h('b', null, 'Bend for terrain'), h('div', { class: 'muted' }, 'Mountains cast rain shadows (BWk / BSk behind them) and stack highland climates (Cwb, Cfb, ET) at elevation.')))),
            h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '12px' } }, 'Belt positions are indicative for a 3-cell, Earth-like circulation. With 1, 5 or 7 cells the method gives no zone placement; use the cell boundaries as your guide.'))),
        panel('Köppen reference', { tag: `${WS.data.CLIMATE_ZONES.length} ZONES` }, groupTabs, cards));
      return {
        el,
        update(c) {
          const p = c.d.planet;
          let zones = null;
          if (p.cells.count === 3) {
            const H = p.cells.bands[0][1], F = p.cells.bands[1][1];
            const Z = (g) => WS.data.CLIMATE_ZONES.find((z) => z.group === g).color;
            zones = [
              { group: 'A', lo: 0, hi: H * 0.6, color: Z('A') },
              { group: 'B', lo: H * 0.55, hi: H + (F - H) * 0.2, color: Z('B') },
              { group: 'C', lo: H * 0.85, hi: H + (F - H) * 0.65, color: Z('C') },
              { group: 'D', lo: H + (F - H) * 0.5, hi: F + (90 - F) * 0.35, color: Z('D') },
              { group: 'E', lo: F + (90 - F) * 0.1, hi: 90, color: Z('E') },
            ];
          }
          replace(stripHost, V.latitudeStrip(p.cells, p.tropics, p.polar, zones));
        },
      };
    },
  });

  // ── 09 POPULATION ────────────────────────────────────────────────────
  WS.defineStep({
    id: 'population', num: '09', title: 'Population', code: '09_DEMOGRAPHIC/CENSUS', strip: 'Land use & people',
    blurb: 'How many people the land can feed, how the population grows, and where it lives.',
    lede: [
      'Start from the surface: how much is land, how much of that is habitable, how much of that productive, and how it splits between pasture and crops. Productive land times people fed per km² gives the carrying capacity.',
      'Population grows logistically toward that ceiling. Zipf’s law then distributes the total across continents, regions and subregions — the biggest holding about twice the second, three times the third, and so on.',
    ],
    build(ctx) {
      const k = WS.kit(ctx);
      const P = ctx.world.population;
      const land = panel('Land use', { ticks: true, tag: 'INPUT' },
        h('div', { class: 'fields' },
          k.f({ path: 'population.land', label: 'Land', unit: '% surface', min: 0, max: 100, slider: [0, 100], step: 0.1, help: 'Share of the planet covered by land. Estimate it from your map (GPlates is useful). Earth ≈ 30%.' }),
          k.f({ path: 'population.uninhabitable', label: 'Uninhabitable', unit: '% land', min: 0, max: 100, slider: [0, 100], step: 0.1, help: 'Share of land that is deserts, high mountains, ice caps and so on.' }),
          k.f({ path: 'population.productive', label: 'Productive', unit: '% habitable', min: 0, max: 100, slider: [0, 100], step: 0.1, help: 'Share of habitable land that can provide food.' }),
          k.f({ path: 'population.livestock', label: 'Livestock', unit: '% productive', min: 0, max: 100, slider: [0, 100], step: 0.1, help: 'Share of productive land used for livestock; the rest grows crops.' }),
          k.f({ path: 'population.fedPerKm2', label: 'People fed', unit: 'per km²', min: 0, slider: [0, 500], step: 1, help: 'How many people one km² of productive land can feed at your technology level.' })));
      const growth = panel('Growth', { ticks: true, tag: 'INPUT' },
        h('div', { class: 'fields' },
          k.f({ path: 'population.initial', label: 'Initial population', unit: 'people', min: 1, slider: [100, 1000000], step: 100 }),
          k.f({ path: 'population.growth', label: 'Growth rate', unit: '% / yr', min: 0, slider: [0, 3], step: 0.005, help: 'Historical estimates: ≤1400 CE ≈ 0% · 1500 < 0.12% · 1600 0.15–0.3% · 1700 0.1–0.15% · 1800 0.3–0.5% · 1900 0.5–0.6% · 2000 1.3–1.4% · 2100 (projected) 0.7–0.8%.' }),
          k.f({ path: 'population.years', label: 'Time elapsed', unit: 'years', min: 0, slider: [0, 10000], step: 10, help: 'Local years over which the population grows at that rate.' })));
      const ro = k.ro([
        { label: 'Surface area', value: (c) => fmt.num(c.d.population.area, 1), unit: 'M km²', sub: (c) => `radius ${fmt.num(c.d.planet.radius, 3)} R⊕ (Planet)` },
        { label: 'Carrying capacity', value: (c) => fmt.big(c.d.population.capacity), unit: 'people', help: 'The maximum population the planet can sustain.' },
        { label: 'World population', value: (c) => fmt.big(c.d.population.world), unit: 'people', state: () => 'ok' },
        { label: 'Density', value: (c) => fmt.num(c.d.population.density, 4), unit: 'per km²', help: 'Average people per km² of land.' },
      ]);
      const stackHost = h('div', { class: 'stack' });
      const curveHost = h('div', { class: 'viz-frame' });

      const level = (key, label, chosenKey, nextLabel, unitLabel) => {
        const host = h('div', { class: 'bars' });
        const nIn = k.f({ path: `population.${key}.n`, label: `Inhabited ${label}`, min: 0, max: 100, slider: [1, 30], step: 1, help: `Number of inhabited ${label}.` });
        const aIn = k.f({ path: `population.${key}.a`, label: 'Slider A', slider: [0.5, 2], step: 0.01, help: 'Zipf exponent. A standard Zipfian distribution uses A = 1.' });
        const bIn = k.f({ path: `population.${key}.b`, label: 'Slider B', slider: [0, 5], step: 0.01, help: 'Zipf offset. A standard Zipfian distribution uses B = 0. Raising it evens out the shares.' });
        const p = panel(label[0].toUpperCase() + label.slice(1), { tag: 'ZIPF' }, h('div', { class: 'fields' }, nIn, aIn, bIn), h('div', { style: { marginTop: '12px' } }, host));
        p._draw = (c, list, chosen) => {
          const max = Math.max(1, ...list);
          const names = c.world.population[key].names;
          replace(host, list.map((v, i) => {
            const inp = h('input', { value: names[i] || '', placeholder: `${unitLabel} ${i + 1}`, 'aria-label': `${unitLabel} ${i + 1} name` });
            inp.addEventListener('input', () => { names[i] = inp.value; ctx.set(`population.${key}.names`, names, { soft: true }); });
            const row = h('div', { class: ['bar-row', chosen === i + 1 && 'chosen'] }, h('span', { class: 'nm' }, inp), h('div', { class: 'track' }, h('i', { style: { width: `${(v / max) * 100}%` } })), h('span', { class: 'v' }, fmt.big(v)));
            if (chosenKey) {
              row.style.cursor = 'pointer';
              row.title = `Break down ${nextLabel} of this ${unitLabel.toLowerCase()}`;
              row.addEventListener('click', (e) => { if (e.target.tagName !== 'INPUT') ctx.set(`population.${chosenKey}`, i + 1); });
            }
            return row;
          }));
        };
        return p;
      };
      const contP = level('continents', 'continents', 'chosenContinent', 'regions', 'Continent');
      const regP = level('regions', 'regions', 'chosenRegion', 'subregions', 'Region');
      const subP = level('subregions', 'subregions', null, null, 'Subregion');
      const regHead = h('p', { class: 'muted' });
      const subHead = h('p', { class: 'muted' });
      regP.querySelector('.panel-body').prepend(regHead);
      subP.querySelector('.panel-body').prepend(subHead);

      const el = h('div', { class: 'stack-gap' },
        h('div', { class: 'grid two' },
          h('div', { class: 'stack-gap' }, land, growth),
          h('div', { class: 'stack-gap' }, panel('Land budget', { tag: 'MILLION km²' }, stackHost), ro,
            panel('World population over time', { tag: 'LOGISTIC', flush: true }, curveHost))),
        h('div', { class: 'grid two-even' }, contP, regP, h('div', { class: 'span-2' }, subP)));

      let listSig = '';
      return {
        el,
        update(c) {
          k.update(c);
          const pd = c.d.population;
          const bar = (cap, a, b, la, lb) => h('div', { class: 'stack-row' },
            h('div', { class: 'cap' }, h('span', null, cap), h('span', null, `${fmt.num(a + b, 1)}`)),
            h('div', { class: 'stack-bar' }, h('div', { class: 'a', style: { width: `${(a / (a + b || 1)) * 100}%` } }, `${la} ${fmt.num(a, 1)}`), h('div', { class: 'b', style: { width: `${(b / (a + b || 1)) * 100}%` } }, `${lb} ${fmt.num(b, 1)}`)));
          replace(stackHost,
            bar('Planet surface', pd.land, pd.ocean, 'LAND', 'OCEAN'),
            bar('Land', pd.habitable, pd.uninhabitable, 'HABITABLE', 'UNINHABITABLE'),
            bar('Habitable land', pd.productive, pd.unproductive, 'PRODUCTIVE', 'UNPRODUCTIVE'),
            bar('Productive land', pd.crops, pd.livestock, 'CROPS', 'LIVESTOCK'));
          replace(curveHost, V.growthCurve(pd, c.world.population.years));
          const pop = c.world.population;
          const cn = (pop.continents.names[pop.chosenContinent - 1]) || `Continent ${pop.chosenContinent}`;
          const rn = (pop.regions.names[pop.chosenRegion - 1]) || `Region ${pop.chosenRegion}`;
          regHead.textContent = `Within ${cn} (${fmt.big(pd.continentPop)} people). Click a continent to switch.`;
          subHead.textContent = `Within ${rn} of ${cn} (${fmt.big(pd.regionPop)} people). Click a region to switch.`;
          const sig = [pd.continents, pd.regions, pd.subregions].map((l) => l.map((x) => x.toFixed(0)).join(',')).join('|') + pop.chosenContinent + pop.chosenRegion;
          if (sig !== listSig) {
            listSig = sig;
            contP._draw(c, pd.continents, pop.chosenContinent);
            regP._draw(c, pd.regions, pop.chosenRegion);
            subP._draw(c, pd.subregions, null);
          }
        },
      };
    },
    checks(w, d) {
      const out = [], p = w.population;
      if (p.chosenContinent > p.continents.n) out.push({ level: 'fail', text: 'The chosen continent does not exist; pick one from the continent list.' });
      if (p.chosenRegion > p.regions.n) out.push({ level: 'fail', text: 'The chosen region does not exist; pick one from the region list.' });
      const sat = d.population.world / d.population.capacity;
      out.push({ level: sat > 0.95 ? 'warn' : 'info', text: `Population is at ${fmt.num(sat * 100, 1)}% of carrying capacity.` });
      return out;
    },
  });

  // ── 10 CALENDAR ──────────────────────────────────────────────────────
  const leapText = (o, unitA, unitB) => `${o.p} ${unitA} every ${o.q} ${unitB}`;

  WS.defineStep({
    id: 'calendar', num: '10', title: 'Calendar', code: '10_CHRONOMETRIC/CALENDAR', strip: 'Days, months & years',
    blurb: 'Turn the year, the month and the day into solar, lunar or lunisolar calendars.',
    lede: [
      'A calendar reconciles cycles that do not divide evenly: days into months, months into years. Solar calendars follow the seasons and suit strongly seasonal places; lunar calendars follow the moon; lunisolar calendars track both by adding a whole leap month now and then.',
      'Each leap option below is a continued-fraction approximation, from crude to precise — pick the one your culture could plausibly have worked out.',
    ],
    build(ctx) {
      const k = WS.kit(ctx);
      ctx.ui.calTab = ctx.ui.calTab || 'solar';
      const cw = ctx.world.calendar;
      const linkBox = h('input', { type: 'checkbox', checked: cw.linked, id: 'cal-link' });
      linkBox.addEventListener('change', () => {
        ctx.mutate((w) => {
          w.calendar.linked = linkBox.checked;
          if (!linkBox.checked) { const ci = ctx.d.calendarInputs; w.calendar.yearDays = +ci.yearDays.toFixed(4); w.calendar.monthDays = +ci.monthDays.toFixed(4); w.calendar.dayHours = ci.dayHours; }
        }, { structural: true });
      });
      const inputsBody = cw.linked
        ? h('div', { class: 'fields' }, h('div', { class: 'linked-host', style: { display: 'contents' } }))
        : h('div', { class: 'fields' },
          k.f({ path: 'calendar.yearDays', label: 'Year (orbital period)', unit: 'Earth days', min: 0.1, step: 0.0001, help: 'Your planet’s orbital period in Earth days. Earth’s tropical year is 365.2422.' }),
          k.f({ path: 'calendar.monthDays', label: 'Month (moon’s period)', unit: 'Earth days', min: 0.1, step: 0.0001, help: 'Your moon’s synodic period in Earth days. The Moon: 29.5306.' }),
          k.f({ path: 'calendar.dayHours', label: 'Day (rotation period)', unit: 'Earth hours', min: 0.1, step: 0.01, help: 'Your planet’s rotation period in Earth hours.' }));
      const inputs = panel('Cycles', { ticks: true, tag: 'INPUT' },
        h('label', { class: 'check', for: 'cal-link', style: { marginBottom: '12px' } }, linkBox, 'Link to Planet & Moon steps'),
        inputsBody,
        h('div', { class: 'fields', style: { marginTop: '12px' } },
          k.f({ path: 'calendar.solarWeeks', label: 'Weeks / month (solar)', min: 1, max: 16, slider: [1, 10], step: 1, help: 'Weeks per month. Usually tied to the moon’s phases, so 4 or 8 work well.' }),
          k.f({ path: 'calendar.lunarWeeks', label: 'Weeks / month (lunar)', min: 1, max: 16, slider: [1, 10], step: 1 }),
          k.f({ path: 'calendar.lunisolarWeeks', label: 'Weeks / month (lunisolar)', min: 1, max: 16, slider: [1, 10], step: 1 })),
        cw.linked ? h('p', { class: 'muted', style: { fontSize: '13px', marginTop: '10px' } }, 'Linked mode uses the sidereal year from the Planet step and the synodic month from the Moon step. Unlink to type exact values such as a tropical year.') : null);
      const ro = k.ro([
        { label: 'Local year', value: (c) => fmt.num(c.d.calendar.year, 4), unit: 'local days', help: 'The actual year length in local days.' },
        { label: 'Local month', value: (c) => fmt.num(c.d.calendar.month, 4), unit: 'local days', help: 'The actual month length in local days.' },
        { label: 'Months per year', value: (c) => fmt.num(c.d.calendar.year / c.d.calendar.month, 4) },
      ]);
      const tabHost = h('div');
      const body = h('div');
      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' }, inputs, ro),
        h('div', { class: 'stack-gap' }, panel('Calendar systems', { tag: 'DESIGN' }, tabHost, body)));

      const kv = (rows) => h('div', { class: 'readouts' }, rows.map(([l, v, u, tip]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l, info(tip)), h('div', { class: 'val' }, String(v), u ? h('small', null, u) : null))));
      const leapList = (opts, a, b, tip) => opts.length
        ? h('table', { class: 'data' }, h('thead', null, h('tr', null, h('th', null, 'Cycle'), h('th', null, ['Rule ', info(tip)]), h('th', null, 'Ratio'), h('th', null, 'Drift'))),
          h('tbody', null, opts.map((o, i) => h('tr', { class: i === opts.length - 1 ? 'hz' : '' }, h('td', null, String(i + 1)), h('td', { class: 'txtcell' }, leapText(o, a, b)), h('td', { class: 'num' }, fmt.num(o.value, 6)), h('td', { class: 'num' }, fmt.sci(o.error, 1))))))
        : h('p', { class: 'muted' }, 'No leap correction needed: the cycle divides evenly.');

      const yearStrip = (s) => {
        const months = s.months;
        if (!months || months > 40) return null;
        const cells = [];
        for (let m = 0; m < months; m++) cells.push(h('div', { style: { border: '1px solid var(--line-soft)', padding: '4px 6px', fontFamily: 'var(--font-mono)', fontSize: '15px' } },
          h('div', { class: 't-amber' }, `M${String(m + 1).padStart(2, '0')}`), h('div', { class: 'muted' }, `${s.daysPerMonth} d · ${s.weeks}×${s.daysPerWeek}${s.weekIntercalary ? `+${s.weekIntercalary}` : ''}`)));
        if (s.intercalary) cells.push(h('div', { style: { border: '1px dashed var(--teal)', padding: '4px 6px', fontFamily: 'var(--font-mono)', fontSize: '15px' } }, h('div', { class: 't-teal' }, 'EXTRA'), h('div', { class: 'muted' }, `${s.intercalary} d (+1 leap)`)));
        return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(92px, 1fr))', gap: '4px', marginTop: '12px' } }, cells);
      };

      const draw = (c) => {
        const cal = c.d.calendar;
        const moonOn = c.world.moon.enabled || !c.world.calendar.linked;
        const items = [['solar', 'Solar'], ...(moonOn ? [['lunar', 'Lunar'], ['lunisolar', 'Lunisolar']] : [])];
        if (!items.some((x) => x[0] === ctx.ui.calTab)) ctx.ui.calTab = 'solar';
        replace(tabHost, tabs(items, ctx.ui.calTab, (t) => { ctx.ui.calTab = t; draw(ctx); }));
        const t = ctx.ui.calTab;
        if (t === 'solar') {
          const s = cal.solar;
          replace(body,
            h('p', { class: 'muted', style: { marginBottom: '12px' } }, 'Follows the planet around its star. Works well where seasons are pronounced.'),
            h('div', { class: 'panel-sub' }, 'Year'),
            kv([['Common year', s.common, 'days', 'A standard year in local days.'], ['Leap year', s.leap, 'days', 'A year with one extra day.']]),
            h('div', { class: 'panel-sub' }, 'Leap-year options'),
            leapList(s.leapOptions, 'leap years', 'years', 'Leap years per calendar year, from crude to precise. Drift is the residual error per year.'),
            h('div', { class: 'panel-sub' }, 'Months & weeks'),
            kv([['Months', s.months, '', 'Months per calendar year (whole moon cycles that fit).'], ['Days / month', s.daysPerMonth, '', 'Standard days per month.'], ['Extra days', s.intercalary, '', 'Days left over after the months — festivals, holy days, or tacked onto months.'], ['Days / week', s.daysPerWeek, '', 'Days in a week.'], ['Extra / month', s.weekIntercalary, '', 'Days per month that fall outside the weeks.']]),
            yearStrip(s));
        } else if (t === 'lunar') {
          const l = cal.lunar;
          replace(body,
            h('p', { class: 'muted', style: { marginBottom: '12px' } }, 'Tracks the moon and its phases; drifts against the seasons. Works well where seasonality is low.'),
            kv([['Lunar year', l.year, 'days', 'Length of the lunar year in local days.'], ['Months', l.months, '', 'Months per year.'], ['Common month', l.commonMonth, 'days', 'A standard month.'], ['Leap month', l.leapMonth, 'days', 'A month with one extra day.']]),
            h('div', { class: 'panel-sub' }, 'Leap-month options'),
            leapList(l.leapOptions, 'long months', 'months', 'Months with an extra day per calendar month. E.g. 2 in 5 → two of every five months get an extra day.'),
            h('div', { class: 'panel-sub' }, 'Weeks'),
            kv([['Days / week', l.daysPerWeek, '', 'Days in a week.'], ['Extra / month', l.weekIntercalary, '', 'Days per month outside the weeks.']]));
        } else {
          const ls = cal.lunisolar;
          replace(body,
            h('p', { class: 'muted', style: { marginBottom: '12px' } }, 'Tracks both moon and star by inserting a whole leap month every few years.'),
            kv([['Common year', ls.common, 'days', 'A common year in local days.'], ['Months', ls.commonMonths, '', 'Months in a common year.'], ['Leap year', ls.leap, 'days', 'A year with an extra month.'], ['Months', ls.leapMonths, '', 'Months in a leap year.']]),
            h('div', { class: 'panel-sub' }, 'Leap-month years'),
            leapList(ls.leapOptions, 'leap months', 'years', 'Leap months per calendar year. Earth’s 7 in 19 is the Metonic cycle.'),
            h('div', { class: 'panel-sub' }, 'Months'),
            kv([['Common month', ls.commonMonth, 'days', 'A standard month.'], ['Leap month', ls.leapMonth, 'days', 'A month with an extra day.']]),
            leapList(ls.monthLeapOptions, 'long months', 'months', 'Months with an extra day per calendar month.'),
            h('div', { class: 'panel-sub' }, 'Weeks'),
            kv([['Days / week', ls.daysPerWeek, '', 'Days in a week.'], ['Extra / month', ls.weekIntercalary, '', 'Days per month outside the weeks.']]));
        }
      };
      const linkedHost = inputsBody.querySelector('.linked-host');
      return {
        el,
        update(c) {
          k.update(c);
          if (linkedHost) {
            const ci = c.d.calendarInputs;
            replace(linkedHost,
              linked('Year', fmt.num(ci.yearDays, 4), 'Earth days', 'planet'),
              linked('Month', c.world.moon.enabled ? fmt.num(ci.monthDays, 4) : 'no moon', 'Earth days', 'moon'),
              linked('Day', fmt.num(ci.dayHours, 2), 'Earth hours', 'planet'));
          }
          draw(c);
        },
      };
    },
    checks(w, d) {
      const out = [];
      const s = d.calendar.solar;
      if (s.months < 1) out.push({ level: 'warn', text: 'The month is longer than the year: no whole months fit.' });
      if (s.daysPerWeek < 1) out.push({ level: 'warn', text: 'Too many weeks per month: weeks would be shorter than a day.' });
      if (!out.length) out.push({ level: 'ok', text: `${s.months} months of ${s.daysPerMonth} days plus ${s.intercalary} extra day${s.intercalary === 1 ? '' : 's'}.` });
      return out;
    },
  });

  // ── 11 DOSSIER ───────────────────────────────────────────────────────
  WS.defineStep({
    id: 'dossier', num: '11', title: 'Dossier', code: '11_ARCHIVE/DOSSIER', strip: 'World summary',
    blurb: 'Every key number on one sheet, plus export, import and print.',
    lede: ['A one-page record of the world as it stands. Print it, export it as JSON to back it up or move it to another machine, or copy it as Markdown into your notes.'],
    notes: false,
    build(ctx) {
      const host = h('div', { class: 'cards' });
      const toMd = (sections) => sections.map(([t, rows]) => `## ${t}\n\n${rows.map(([k2, v]) => `- **${k2}:** ${v}`).join('\n')}`).join('\n\n');
      let sections = [];
      const el = h('div', { class: 'stack-gap' },
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn primary', type: 'button', onclick: () => WS.store.exportJson(ctx.world) }, icon('download'), 'Export JSON'),
          h('button', { class: 'btn', type: 'button', onclick: async () => { const md = `# ${ctx.world.name}\n\n${toMd(sections)}\n`; try { await navigator.clipboard.writeText(md); toast('Copied as Markdown'); } catch { toast('Clipboard unavailable in this browser'); } } }, icon('copy'), 'Copy as Markdown'),
          h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, icon('print'), 'Print')),
        host);
      return {
        el,
        update(c) {
          const w = c.world, d = c.d;
          sections = [
            ['Galaxy', [['Name', w.galaxy.name], ['Radius', `${fmt.int(w.galaxy.radius)} ly`], ['Home location', `${fmt.int(w.galaxy.location)} ly from the core`], ['Neighbourhood', `${d.galaxy.totalSystems} systems within ${w.galaxy.hoodRadius} ly`], ['Nearest system', d.galaxy.nearest ? `${w.galaxy.systemNames[d.galaxy.nearest.index] || `Star System ${d.galaxy.nearest.index}`}, ${fmt.num(d.galaxy.nearest.distance, 2)} ly` : '—']]],
            ['Star', [['Name', w.star.name], ['Class', d.star.spectral.code], ['Mass', `${fmt.num(w.star.mass, 3)} M☉`], ['Age', `${w.star.age} of ${fmt.num(d.star.maxAge, 2)} Gyr`], ['Luminosity', `${fmt.num(d.star.luminosity, 4)} L☉`], ['Temperature', `${fmt.int(d.star.temperature)} K`], ['Habitable zone', `${fmt.num(d.star.hzIn, 3)}–${fmt.num(d.star.hzOut, 3)} AU`], ['Frost line', `${fmt.num(d.star.frostLine, 3)} AU`]]],
            ['System', [['Bodies', [w.planet.name, ...w.system.bodies.map((b) => b.name)].join(', ')], ['Orbit spacing', `a₁ ${w.system.firstOrbit} AU, factor ${w.system.spacing}`], ['Debris disk', `${fmt.num(d.system.debrisIn, 2)}–${fmt.num(d.system.debrisOut, 2)} AU`]]],
            ['Planet', [['Name', w.planet.name], ['Mass', `${fmt.num(w.planet.mass, 3)} M⊕`], ['Radius', `${fmt.num(d.planet.radius, 3)} R⊕ (${fmt.int(d.planet.radiusKm)} km)`], ['Gravity', `${fmt.num(d.planet.gravity, 3)} g`], ['Day', `${w.planet.rotation} h`], ['Year', `${fmt.num(d.planet.yearLocalDays, 2)} local days`], ['Axial tilt', `${w.planet.tilt}°`], ['Temperature', `${d.planet.temperature} K (${d.planet.temperatureC} °C)`], ['Atmosphere', `${w.planet.pressure} atm · O₂ ${w.planet.o2}% · N₂ ${fmt.num(d.planet.pct.n2, 2)}%`], ['Circulation', `${d.planet.cells.count} cells per hemisphere`]]],
            ['Moon', w.moon.enabled ? [['Name', w.moon.name], ['Mass', `${w.moon.mass} M☾`], ['Radius', `${fmt.int(d.moon.radiusKm)} km`], ['Distance', `${fmt.int(w.moon.a)} km`], ['Month', `${fmt.num(d.moon.synodic, 3)} Earth days`], ['Tides', `${fmt.num(d.moon.tides, 2)}× Earth`], ['Eclipses', d.sky.moon.totalEclipses ? 'Total possible' : 'Annular only']] : [['Moon', 'None']]],
            ['Sky', [['Star from home', `${fmt.num(d.sky.home.size, 2)}× the Sun’s size, magnitude ${fmt.num(d.sky.home.magnitude, 2)}`], ['Naked-eye planets', d.sky.bodies.filter((b) => b.fromHome.nakedEye === 'Yes').map((b) => b.name).join(', ') || 'none']]],
            ['Surface', [['Max peak', `${fmt.int(d.tectonics.maxPeak)} m`], ['Ranges', w.tectonics.ranges.map((r) => `${r.name} (${r.type})`).join(', ')], ['Land', `${fmt.num(w.population.land, 1)}% of ${fmt.num(d.population.area, 1)} M km²`]]],
            ['People', [['Carrying capacity', fmt.big(d.population.capacity)], ['Population', `${fmt.big(d.population.world)} after ${w.population.years} years`], ['Continents', `${w.population.continents.n}`]]],
            ['Calendar', [['Solar', `${d.calendar.solar.months} × ${d.calendar.solar.daysPerMonth} days + ${d.calendar.solar.intercalary}`], ['Leap rule', d.calendar.solar.leapOptions.length ? leapText(d.calendar.solar.leapOptions[Math.min(2, d.calendar.solar.leapOptions.length - 1)], 'leap years', 'years') : 'none'], ['Week', `${d.calendar.solar.daysPerWeek} days`]]],
          ];
          replace(host, sections.map(([t, rows]) => h('article', { class: 'card' }, h('h3', null, h('span', null, t)),
            h('dl', null, rows.map(([k2, v]) => [h('dt', null, k2), h('dd', { class: 'mono', style: { fontSize: '17px' } }, v)])))));
        },
      };
    },
  });
})();
