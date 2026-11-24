/*
 * Builds a Region or a Close-up (region.js) off the page's thread: a closer map of part of the World
 * map, or of a Region, with its own drainage, valleys, lakes, rivers and biomes. See buildOff in
 * steps/region.js, which builds in the page where a worker cannot run (opened from file://).
 * In: {id, map (the world map's {W, H, z, planet, rivers: {recv, discharge}}, or a region's {W, H, z,
 * frame, water, lake, recv, flow, planet, rivers}), water (the world map's, or null), opts}. Out: {id, region} or {id, error}.
 */
/* global importScripts, WS */
importScripts('calc.js', 'sphere.js', 'rotation.js', 'supercontinent.js', 'worldmap.js', 'biomes.js', 'region.js');

self.onmessage = (e) => {
  const { id, map, water, opts } = e.data;
  try {
    const region = WS.region.build(map, water, opts);
    // (each buffer once: the climate and the water share theirs)
    const bufs = new Set([region.z, region.flow, region.recv, region.lake, region.biome, region.cut, ...Object.values(region.climate), ...Object.values(region.water), region.ice].filter((a) => a && a.buffer).map((a) => a.buffer));
    self.postMessage({ id, region }, [...bufs]);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
