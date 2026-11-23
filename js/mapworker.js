/*
 * Builds the World map off the page's thread, so the page stays responsive while it works: the land
 * from the plates' history, its climate, then (unless switched off) glaciers and rivers carving it
 * with that climate's water, then the brush strokes. The same code as in the page (worldmap.js,
 * climate.js, biomes.js); see buildMap in steps/worldmap.js, which falls back to building in the page
 * where a worker cannot run (opened from file://).
 * In: {id, plates, settings, strokes, carve, iceAge, climPlanet, bioPlanet}. Out: {id, map} or {id, error}.
 */
/* global importScripts, WS */
importScripts('calc.js', 'sphere.js', 'rotation.js', 'supercontinent.js', 'worldmap.js', 'climate.js', 'biomes.js');

self.onmessage = (e) => {
  const { id, plates, settings, strokes, carve, iceAge, climPlanet, bioPlanet } = e.data;
  try {
    const M = WS.worldmap, K = WS.climate, B = WS.biomes;
    let map;
    if (!carve) {
      map = M.build(plates, { ...settings, carve: false, strokes });
      map.climate = { clim: K.build(map, climPlanet), pl: climPlanet, strokes: strokes.length };
    } else {
      map = M.build(plates, { ...settings, carve: false, strokes: [] });
      const clim = K.build(map, climPlanet);
      M.carveMap(map, { water: B.water(map, clim, bioPlanet), strokes, iceAge });
      map.climate = { clim, pl: climPlanet, strokes: strokes.length };
    }
    // (functions do not cross to the page; neither is needed there)
    delete map.at;
    if (map.carving) delete map.carving.wet;
    self.postMessage({ id, map });
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
