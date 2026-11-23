/*
 * Static data: the default world (an Earth/Sol analogue matching the
 * workbook's own example values) and the climate-zone reference.
 */
(function (root) {
  'use strict';

  let uid = 0;
  const id = (p) => `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;

  const SOL_BODIES = [
    // name, kind, a (AU), radius (R⊕), geometric albedo, atmosphere, current distance from home (AU)
    ['Mercury', 'terrestrial', 0.387098, 0.3829, 0.142, false, 1.37],
    ['Venus', 'terrestrial', 0.723332, 0.9499, 0.689, true, 0.4],
    ['Mars', 'terrestrial', 1.523679, 0.533, 0.17, true, 2.4],
    ['Jupiter', 'gas', 5.2044, 10.973, 0.538, true, 5],
    ['Saturn', 'gas', 9.5826, 9.1402, 0.499, true, 9],
    ['Uranus', 'ice', 19.19126, 4.007, 0.488, true, 19],
    ['Neptune', 'ice', 30.07, 3.883, 0.422, true, 30],
    ['Pluto', 'dwarf', 39.482, 0.1868, 0.575, false, 38.8],
  ];

  function defaultWorld(name) {
    const now = new Date().toISOString();
    return {
      schema: 1,
      id: id('w'),
      name: name || 'Terra Nova',
      created: now,
      updated: now,
      galaxy: { name: 'The Galaxy', radius: 50000, location: 25800, hoodRadius: 10, density: 0.003, seed: 1, systemNames: {} },
      star: { name: 'Sol', mass: 1, age: 4.5 },
      system: {
        spacing: 0.3, firstOrbit: 0.4, outerGasGiant: 30.07,
        // every body except the home world (which lives in `planet`)
        bodies: SOL_BODIES.map(([n, kind, a, r, alb, atm, d]) => ({
          id: id('b'), name: n, kind, a, radius: r, albedo: alb, atmosphere: atm, distance: d,
        })),
      },
      planet: {
        name: 'Earth', mass: 1, cmf: 33.4, tilt: 23.5, albedo: 0.29, greenhouse: 1, observerHeight: 1.75,
        rotation: 24, a: 1, e: 0.0167, inclination: 0, lonPeriapsis: 283, subsolarLon: 0,
        pressure: 1, o2: 20.95, co2: 0.04, ar: 0.93,
      },
      moon: {
        enabled: true, name: 'Luna', mass: 1, density: 3.34, albedo: 0.136, a: 384748, e: 0.055, inclination: 5.15,
        geoAlbedo: 0.113, phase: 0,
      },
      tectonics: {
        scaling: 2, ridgeDepth: 2600, active: 0,
        ranges: [{
          id: id('r'), name: 'Spine Range', type: 'Andean',
          heights: [1500, 500, null, 6000, null, 800], widths: [100, 150, 100, 200, 200, null],
          erosion: 5, age: 50,
        }],
      },
      population: {
        land: 29.4, uninhabitable: 28.7, productive: 46, livestock: 77, fedPerKm2: 12,
        initial: 30000, growth: 0.045, years: 1000,
        continents: { n: 6, a: 1, b: 0, names: [] }, chosenContinent: 1,
        regions: { n: 10, a: 1, b: 0, names: [] }, chosenRegion: 1,
        subregions: { n: 15, a: 1, b: 0, names: [] },
      },
      calendar: {
        linked: false, yearDays: 365.2422, monthDays: 29.5306, dayHours: 24,
        solarWeeks: 4, lunarWeeks: 4, lunisolarWeeks: 4, system: 'solar',
      },
      // where you stand on the Vista step: a body ('home' or a body id), latitude, the time of
      // year and of day (fractions), how you look
      // the supercontinent: plates, and shapes on them (cratons, crust, rifts, failed rifts) as [lat, lon] rings/lines
      plates: { plates: [], features: [], nextPlate: 101, start: 1000, step: 10 },
      map: { land: null, shelf: 1, relief: 1, erosion: 1, carve: true, iceAge: 6, res: 720, strokes: [] },
      // a closer map of part of the world map: its centre (null: chosen from the map), km across, pixels across
      region: { lat: null, lon: null, span: 800, res: 1024 },
      // closer still: part of the region (null: on the region's largest river), km across, pixels across
      closeup: { lat: null, lon: null, span: 50, res: 1024 },
      vista: { body: 'home', lat: 40, day: 0.3, hour: 0.62, az: 240, mode: 'panorama', exposure: 0, haze: 0, eye: 'earth', habitat: 'auto', labels: true },
      notes: {},
    };
  }

  /* Rules of thumb for blank sheets: a few empty bodies a user can start from. */
  function blankBody(kind = 'terrestrial', a = 1) {
    const presets = {
      terrestrial: { radius: 1, albedo: 0.3, atmosphere: true },
      gas: { radius: 10, albedo: 0.5, atmosphere: true },
      ice: { radius: 4, albedo: 0.45, atmosphere: true },
      dwarf: { radius: 0.18, albedo: 0.5, atmosphere: false },
      belt: { radius: 0.05, albedo: 0.15, atmosphere: false },
    }[kind] || {};
    return { id: id('b'), name: 'New body', kind, a, distance: a, ...presets };
  }

  // Köppen climate reference — CLIMATE ZONES sheet (typos corrected)
  const CLIMATE_ZONES = [
    { group: 'A', name: 'Tropical Rainforest', code: 'Af', key: 'A = tropical, f = wet year round', rainfall: 'High, year round', temperature: 'Hot, year round', seasons: 'None', environment: ['Rainforests', 'Evergreen hardwood trees: mahogany, teak, sandalwood, rosewood', 'Bananas, coconuts, palm oil', 'Highest biodiversity on the planet', 'Poor soil quality'], examples: 'Amazon River Basin', location: ['Within the equatorward half of the tropics', 'Windward side of tropical islands', 'At low elevations only'], comments: [], color: '#1f8a4c' },
    { group: 'A', name: 'Tropical Monsoon', code: 'Am', key: 'A = tropical, m = monsoon', rainfall: 'High with some lower months', temperature: 'Hot, year round', seasons: 'Wet and less wet', environment: ['Monsoon forest to grassland', 'Rice, sugar cane, cocoa', 'Lower biodiversity than tropical rainforests (Af)'], examples: 'West coast of India', location: ['In the tropics', 'As a transition away from tropical rainforests (Af)', 'In areas subject to monsoon circulation', 'Limited area'], comments: ['Overall wetter, or a shorter dry season, than savannas (Aw)'], color: '#2fa35d' },
    { group: 'A', name: 'Tropical Savanna', code: 'Aw', key: 'A = tropical, w = savanna, dry winter', rainfall: 'High in rainy season, low or absent in dry', temperature: 'Hot, year round', seasons: 'Wet & dry', environment: ['Scrub, forest, grassland', 'Rice, sugar cane, cocoa'], examples: 'Serengeti', location: ['In the tropics', 'Transition away from tropical monsoon (Am)', 'Widespread'], comments: ['Classic wet-and-dry type', 'Overall drier, or a longer dry season, than tropical monsoon (Am)'], color: '#9ab83a' },
    { group: 'C', name: 'Subtropical Highland', code: 'Cwb', key: 'C = temperate, w = dry winter, b = long, warm summer', rainfall: 'High in summer, low or absent in winter', temperature: 'Warm, year round', seasons: 'Wet & dry', environment: ['Forest & grassland', 'Rice, corn, tea, coffee'], examples: 'Southern Himalayan foothills', location: ['In the tropics', 'Usually between 1500–4000 m elevation'], comments: ['High-altitude, cooler version of savannas (Aw) or tropical monsoon (Am)', '"Eternal spring" climate', 'More common than Cfb highland'], color: '#5fa88a' },
    { group: 'C', name: 'Subtropical Highland (wet)', code: 'Cfb', key: 'C = temperate, f = wet year round, b = long, warm summer', rainfall: 'Moderate to high, year round', temperature: 'Warm, year round', seasons: 'Wet & dry', environment: ['Mixed woodland', 'Lower reaches: thick "cloud" forests', 'Rice, corn, tea, coffee'], examples: 'Andes foothills', location: ['Within the tropics', 'Windward side of tropical islands', 'At elevation, 1500–4000 m', 'Bordering tropical rainforests (Af)'], comments: ['High-altitude, cooler version of tropical rainforest (Af)', 'Similar to the oceanic climate of north-west Europe', '"Eternal spring" type climate'], color: '#4d9a7a' },
    { group: 'B', name: 'Hot Desert', code: 'BWh', key: 'B = arid, W = desert, h = hot', rainfall: 'Very low, year round', temperature: 'Long, very hot summer; shorter mild winter', seasons: 'Very hot then mild', environment: ['Limited or absent vegetation', 'Sand & bare rock'], examples: 'Sahara Desert', location: ['Poleward third of the Hadley cell, may extend a little into the Ferrel cell', 'Rain shadows of tropical and subtropical mountains'], comments: ['Classic scorched desert', 'Highest temperatures on the planet', 'Hot deserts along cold-current coasts are milder "fog deserts"'], color: '#e0a441' },
    { group: 'B', name: 'Hot Steppe', code: 'BSh', key: 'B = arid, S = steppe, h = hot', rainfall: 'Low, year round', temperature: 'Very hot summer, mild winter', seasons: 'Very hot then mild', environment: ['Limited vegetation', 'Stunted hardy shrubs, cacti'], examples: 'North-eastern Australian outback', location: ['Bordering hot deserts (BWh)'], comments: ['Marginal habitability'], color: '#d9b25a' },
    { group: 'C', name: 'Humid Subtropical', code: 'Cfa', key: 'C = temperate, f = wet year round, a = long, hot summers', rainfall: 'Moderate, year round; occasional winter snow', temperature: 'Hot to cool', seasons: 'Classic four seasons', environment: ['Mixed forest, grassland, swamps', 'Good for agriculture', 'Rice, nuts, wheat, cotton, tobacco, ranching', 'Can support high populations'], examples: 'South-east US', location: ['Poleward third of the Hadley cell to equatorward third of the Ferrel cell', 'Along warm-current (eastern) coasts only'], comments: ['Sultry summers, fresh winters'], color: '#7cc46a' },
    { group: 'C', name: 'Subtropical Monsoon', code: 'Cwa', key: 'C = temperate, w = dry winters, a = long, hot summers', rainfall: 'High in summer, low or absent in winter', temperature: 'Very hot to cool', seasons: 'Hot wet season & cool dry season; rarely a 3-season variant (mild dry winter, short very hot dry summer, hot wet season)', environment: ['Scrub forest, grassland', 'Good for agriculture', 'Rice, nuts, wheat, cotton, tobacco, ranching', 'Can support high populations'], examples: 'North-east India', location: ['Poleward third of the Hadley cell to equatorward third of the Ferrel cell', 'In regions affected by monsoon circulation', 'Transition away from humid subtropical (Cfa)'], comments: ['Less widespread than humid subtropical (Cfa)'], color: '#8fbf55' },
    { group: 'C', name: 'Hot-Summer Mediterranean', code: 'Csa', key: 'C = temperate, s = dry summers, a = long, hot summer', rainfall: 'Low or absent in summer, moderate in winter', temperature: 'Hot to mild', seasons: 'Hot dry summer & mild wet winter', environment: ['Shrubland: scrub & hardy grasses', 'Patches of bare earth or rock', 'Grapes, olives, citrus, figs, wheat'], examples: 'The Mediterranean', location: ['Equatorward half of the Ferrel cell', 'Poleward of hot deserts (BWh) and hot steppes (BSh)', 'Along cold-current (western) coasts only'], comments: [], color: '#c9b13c' },
    { group: 'C', name: 'Warm-Summer Mediterranean', code: 'Csb', key: 'C = temperate, s = dry summers, b = long, warm summer', rainfall: 'Low or absent in summer, heavy in winter', temperature: 'Warm to cool', seasons: 'Warm dry summer & cool wet winter', environment: ['Coniferous forests: redwoods, sequoias', 'Eucalyptus forests', 'Grapes, olives, figs, citrus, wheat'], examples: 'Pacific Northwest US', location: ['Equatorward half of the Ferrel cell', 'Poleward transition away from hot-summer Mediterranean (Csa)', 'Along cold-current coasts only'], comments: ['Stormy winters, superb summers', 'Less common, cooler version of Csa'], color: '#a8a93e' },
    { group: 'C', name: 'Oceanic (maritime west coast)', code: 'Cfb', key: 'C = temperate, f = wet year round, b = long, warm summers', rainfall: 'Moderate to high, year round; occasional winter snow', temperature: 'Warm to cool', seasons: 'Classic four seasons', environment: ['Thick mixed coniferous & deciduous woodland', 'In places, temperate rainforest: moss, ferns', 'Archetypal "countryside"', 'Great for agriculture', 'Apples, strawberries, wheat, grapes'], examples: 'Great Britain & Ireland', location: ['Poleward half of the Ferrel cell', 'Along warm-current coasts'], comments: ['Unreliable summers, stormy winters', 'Overcast'], color: '#3f9e7a' },
    { group: 'C', name: 'Subpolar Oceanic', code: 'Cfc', key: 'C = temperate, f = wet year round, c = short, cold summers', rainfall: 'Moderate to high, year round; occasional winter snow', temperature: 'Cool, year round', seasons: '"Perpetual autumn"', environment: ['Coniferous forests'], examples: 'Scottish Highlands', location: ['Poleward half of the Ferrel cell', 'Along warm-current coasts only', 'Poleward of oceanic (Cfb) or at high elevation'], comments: ['Very stormy, overcast', 'Cooler version of oceanic (Cfb)'], color: '#3a8a8a' },
    { group: 'B', name: 'Cold Desert', code: 'BWk', key: 'B = arid, W = desert, k = cold', rainfall: 'Very low, year round', temperature: 'Warm/hot summer, cool/cold winter', seasons: 'Hotter then colder', environment: ['Very limited or absent vegetation'], examples: 'Gobi Desert', location: ['In the Ferrel cell: continental interiors, rain shadows, at elevation', 'At elevation within the hot desert zone'], comments: ['Desolate, inhospitable'], color: '#c98f63' },
    { group: 'B', name: 'Cold Steppe', code: 'BSk', key: 'B = arid, S = steppe, k = cold', rainfall: 'Low, year round', temperature: 'Warm/hot summer, cool/cold winter', seasons: 'Hotter then colder', environment: ['Scrub, hardy grasses', 'Poor agricultural land', 'Grazing livestock can be viable'], examples: 'Andes fringes', location: ['In the Ferrel cell: continental interiors, rain shadows, at elevation', 'At elevation within the hot desert (BWh) zone', 'Transition away from cold deserts (BWk)'], comments: ['Classic horse/steppe lands'], color: '#c4a77a' },
    { group: 'D', name: 'Humid Continental', code: 'Dfa / Dfb', key: 'D = continental, f = wet year round, a = long hot summer, b = long warm summer', rainfall: 'Fairly low, year round; snowy winters', temperature: 'Dfa: hot to cold · Dfb: warm to cold', seasons: 'Classic four seasons', environment: ['Prairie & steppe', 'Deciduous & coniferous forests', 'Grasslands fringing semi-arid climates', 'Uniform pine forests fringing subarctic climates', 'Good for agriculture: wheat, corn, soy, barley'], examples: 'Midwest US', location: ['Poleward half of the Ferrel cell', 'Continental interiors'], comments: ['Wide seasonal temperature ranges', 'Most common continental climate type'], color: '#4f86b8' },
    { group: 'D', name: 'Continental Monsoon', code: 'Dwa / Dwb', key: 'D = continental, w = dry winter, a = long hot summers, b = long warm summer', rainfall: 'Moderate to high in summer, light snow in winter', temperature: 'Dwa: hot to cold · Dwb: warm to cold', seasons: 'Four seasons with a wet summer', environment: ['Prairie & steppe grass', 'Deciduous & coniferous forests', 'Grasslands fringing semi-arid climates', 'Uniform pine forests fringing subarctic climates', 'Wheat, corn, soy, barley'], examples: 'Korea', location: ['Ferrel-cell regions subject to monsoon circulation'], comments: ['Monsoon version of humid continental (Dfa/Dfb)'], color: '#5b7fc4' },
    { group: 'D', name: 'Continental Mediterranean', code: 'Dsa / Dsb', key: 'D = continental, s = dry summers, a = long hot summers, b = long warm summers', rainfall: 'Moderate in winter, low to absent in summer', temperature: 'Dsa: hot to cold · Dsb: warm to cold', seasons: 'Hot & dry, then snowy & cold', environment: ['Steppe grass & shrub'], examples: 'Anatolia', location: ['In the Ferrel cell, transition from Mediterranean into adjoining high-altitude regions'], comments: ['Rare high-altitude form of the Mediterranean climate'], color: '#7a7ec0' },
    { group: 'D', name: 'Subarctic', code: 'Dfc / Dfd', key: 'D = continental, f = wet year round, c = short cold summer, d = short cold summer & very cold long winter', rainfall: 'Low, year round; snowy winters', temperature: 'Dfc: warm to cold · Dfd: warm to very cold', seasons: 'Short summer, long dark winters', environment: ['Boreal forest (taiga): larch, fir, pine, spruce', 'Equatorward: mixed woodland', 'Fringing arid areas: grassland', 'Swamps & bogs, permafrost', 'Little to no farming'], examples: 'Siberia', location: ['Poleward half of the Ferrel cell to equatorward half of the polar cell', 'Continental interiors', 'Isolated alpine regions'], comments: ['Very wide seasonal temperature range', 'Lowest biodiversity on the planet', 'Dfc is the most common subarctic climate'], color: '#3f6a9e' },
    { group: 'D', name: 'Subarctic Monsoon', code: 'Dwc / Dwd', key: 'D = continental, w = dry winters, c = short cold summers, d = short cold summers & very long cold winters', rainfall: 'Fairly low in summer, light snow in winter', temperature: 'Dwc: warm to cold · Dwd: warm to very cold', seasons: 'Short summer, long dark winter', environment: ['Boreal forest (taiga): larch, fir, pine, spruce', 'Equatorward: mixed woodland', 'Swamps & bogs, permafrost', 'Little to no farming'], examples: 'Eastern Siberia', location: ['Poleward half of the Ferrel cell to equatorward half of the polar cell', 'Continental interiors subject to monsoon circulation', 'Isolated alpine regions'], comments: ['Very wide temperature range', 'Furthest extent of monsoon circulation', 'Same as Dfc/Dfd but with dry winters'], color: '#4a5e9a' },
    { group: 'D', name: 'Dry-Summer Subarctic', code: 'Dsc / Dsd', key: 'D = continental, s = dry summer, c = short cold summer, d = short cold summers & very cold long winter', rainfall: 'Very low in summer, snow in winter', temperature: 'Dsc: warm to cold · Dsd: warm to very cold', seasons: 'Short summer, long dark winter', environment: ['Boreal forest (taiga): larch, fir, pine, spruce', 'Swamps & bogs, permafrost', 'Little to no farming'], examples: 'Isolated areas of the Canadian Rockies', location: ['Equatorward half of the polar cell', 'Continental interiors', 'Isolated alpine regions'], comments: ['Very wide temperature range', 'Very rare climate type', 'Same as Dfc/Dfd but the dry season is in summer'], color: '#5a5f8a' },
    { group: 'E', name: 'Tundra', code: 'ET', key: 'E = polar, T = tundra', rainfall: 'Low, year round', temperature: 'Cool to (very) cold', seasons: 'Short summer & long dark winter', environment: ['Treeless', 'Lichen, moss, hardy grasses', 'Permafrost', 'Lakes, bogs, swamps in flat areas', 'No farming'], examples: 'North-eastern Canada', location: ['In the polar cell', 'High-altitude regions worldwide (alpine meadows)', 'Fringing polar ice-cap climates'], comments: ['Bleak & treeless wastes', 'Marginal habitability'], color: '#8aa3a8' },
    { group: 'E', name: 'Ice Cap', code: 'EF', key: 'E = polar, F = ice cap', rainfall: 'Low to absent, year round', temperature: 'Cold to extremely cold', seasons: 'Perpetual winter', environment: ['No vegetation', 'Ice sheets kilometres thick'], examples: 'Antarctica', location: ['In the polar cell, poleward of tundra', 'In continental interiors', 'High-altitude regions worldwide'], comments: ['Most hostile climate zone'], color: '#d8e4e6' },
  ];

  const CLIMATE_GROUPS = {
    A: 'Tropical', B: 'Arid', C: 'Temperate', D: 'Continental', E: 'Polar',
  };

  const api = { defaultWorld, blankBody, CLIMATE_ZONES, CLIMATE_GROUPS, newId: id };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.data = api; }
})(typeof window !== 'undefined' ? window : globalThis);
