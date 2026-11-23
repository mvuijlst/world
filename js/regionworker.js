/*
 * Builds a Region (region.js) off the page's thread: a closer map of part of the World map, with its
 * own drainage, valleys, lakes, rivers and biomes. See ensure in steps/region.js, which builds in the
 * page where a worker cannot run (opened from file://).
 * In: {id, map: {W, H, z, planet, rivers: {recv, discharge}}, water, opts}. Out: {id, region} or {id, error}.
 */
/* global importScripts, WS */
importScripts('calc.js', 'sphere.js', 'rotation.js', 'supercontinent.js', 'worldmap.js', 'biomes.js', 'region.js');

self.onmessage = (e) => {
  const { id, map, water, opts } = e.data;
  try {
    const region = WS.region.build(map, water, opts);
    const bufs = [region.z, region.flow, region.recv, region.lake, region.biome, region.cut, region.climate.Tw, region.climate.Tc, region.climate.P].map((a) => a.buffer);
    self.postMessage({ id, region }, bufs);
  } catch (err) {
    self.postMessage({ id, error: String((err && err.stack) || err) });
  }
};
