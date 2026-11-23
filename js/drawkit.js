/*
 * The drawing kit: everything about the world's surface as files to draw on, all in the same
 * equirectangular projection and size, so they stack in an image editor or vector program.
 *   - vector outlines (coast, lakes) traced from the map's cells (marching squares);
 *   - rivers as lines, their width by their flow;
 *   - PNG layers (relief, heightmap, land mask, biomes, climate zones) and SVG layers;
 *   - a ZIP of it all, with a read-me for the scale and the keys.
 * The tracing and SVG are pure functions (they run in Node); the PNGs need a browser canvas.
 */
(function (root) {
  'use strict';
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  /*
   * Lines where a field crosses a level (marching squares between the cells' centres; longitude
   * wraps), as polylines of [x, y] in cell units (x 0..W, y 0..H). A closed outline repeats its first point.
   */
  function contours(values, W, H, level = 0) {
    const v = (i, j) => values[j * W + (((i % W) + W) % W)] - level;
    const segs = [];                                                 // [edgeA, edgeB]
    // edges: horizontal 'h' between (i, j) and (i + 1, j); vertical 'v' between (i, j) and (i, j + 1)
    const pt = new Map();
    const edgePoint = (key, a, b, x0, y0, dx, dy) => { if (!pt.has(key)) { const t = clamp(a / (a - b), 0, 1); pt.set(key, [x0 + dx * t, y0 + dy * t]); } return key; };
    for (let j = 0; j < H - 1; j++) for (let i = 0; i < W; i++) {
      const a = v(i, j), b = v(i + 1, j), c = v(i + 1, j + 1), d = v(i, j + 1);
      const code = (a > 0 ? 8 : 0) | (b > 0 ? 4 : 0) | (c > 0 ? 2 : 0) | (d > 0 ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const i1 = (i + 1) % W, x = i + 0.5, y = j + 0.5;
      const top = () => edgePoint(`h${j * W + i}`, a, b, x, y, 1, 0);
      const right = () => edgePoint(`v${j * W + i1}`, b, c, x + 1, y, 0, 1);
      const bottom = () => edgePoint(`h${(j + 1) * W + i}`, d, c, x, y + 1, 1, 0);
      const left = () => edgePoint(`v${j * W + i}`, a, d, x, y, 0, 1);
      const centre = (a + b + c + d) / 4 > 0;
      switch (code) {
        case 1: case 14: segs.push([left(), bottom()]); break;
        case 2: case 13: segs.push([bottom(), right()]); break;
        case 3: case 12: segs.push([left(), right()]); break;
        case 4: case 11: segs.push([top(), right()]); break;
        case 6: case 9: segs.push([top(), bottom()]); break;
        case 7: case 8: segs.push([left(), top()]); break;
        case 5: if (centre) { segs.push([left(), top()], [bottom(), right()]); } else { segs.push([left(), bottom()], [top(), right()]); } break;
        case 10: if (centre) { segs.push([left(), bottom()], [top(), right()]); } else { segs.push([left(), top()], [bottom(), right()]); } break;
        default: break;
      }
    }
    // chain the segments through the edges they share
    const at = new Map();
    segs.forEach(([p, q], s) => { for (const e of [p, q]) { if (!at.has(e)) at.set(e, []); at.get(e).push(s); } });
    const used = new Uint8Array(segs.length), lines = [];
    const walk = (s, from) => {
      const keys = [from];
      let cur = s, e = from;
      while (cur >= 0 && !used[cur]) {
        used[cur] = 1;
        const [p, q] = segs[cur], next = p === e ? q : p;
        keys.push(next);
        cur = (at.get(next) || []).find((t) => !used[t]) ?? -1;
        e = next;
      }
      return keys;
    };
    // open lines first (from an edge with one segment), then the rings
    for (const [e, list] of at) if (list.length === 1 && !used[list[0]]) lines.push(walk(list[0], e));
    for (let s = 0; s < segs.length; s++) if (!used[s]) lines.push(walk(s, segs[s][0]));
    return lines.map((keys) => keys.map((k) => pt.get(k)));
  }

  /* Corner-cutting, keeping a line's ends (a ring stays closed). */
  function chaikin(p) {
    if (p.length < 3) return p;
    const closed = p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1], out = closed ? [] : [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    if (closed) out.push(out[0]); else out.push(p[p.length - 1]);
    return out;
  }

  /* Make a line continuous across the map's edge (x may run past 0 or W), for smoothing. */
  function unwrap(p, W) {
    const out = [p[0].slice()];
    for (let i = 1; i < p.length; i++) { let x = p[i][0]; const px = out[i - 1][0]; while (x - px > W / 2) x -= W; while (px - x > W / 2) x += W; out.push([x, p[i][1]]); }
    return out;
  }

  /* Cut a line where it crosses the map's edge (a jump of more than half the width). */
  function cutAtEdge(p, W) {
    const out = [];
    let cur = [];
    for (const q of p) {
      const x = ((q[0] % W) + W) % W, r = [x, q[1]];
      if (cur.length && Math.abs(x - cur[cur.length - 1][0]) > W / 2) { if (cur.length > 1) out.push(cur); cur = []; }
      cur.push(r);
    }
    if (cur.length > 1) out.push(cur);
    return out;
  }

  const f2 = (x) => Math.round(x * 100) / 100;
  const pathD = (p) => `M${p.map(([x, y]) => `${f2(x)} ${f2(y)}`).join('L')}`;

  /* The coast (where the map crosses sea level) and the lakes' shores, as paths in map pixels. */
  function outlines(map, bio) {
    const { W, H } = map;
    const coast = contours(map.z, W, H, 0).map((p) => chaikin(unwrap(p, W))).flatMap((p) => cutAtEdge(p, W));
    let lakes = [];
    if (bio && bio.lake) {
      const lk = Float32Array.from(bio.lake, (v) => (v ? 1 : 0));
      lakes = contours(lk, W, H, 0.5).map((p) => chaikin(unwrap(p, W))).flatMap((p) => cutAtEdge(p, W));
    }
    return { coast, lakes };
  }

  /* Rivers as paths in map pixels, with a stroke width by flow. */
  function riverPaths(bio, W, H) {
    const out = [];
    for (const rv of bio.rivers) {
      const q = rv.q.reduce((a, b) => Math.max(a, b), 0);
      const p = rv.pts.map(([la, lo]) => [((lo + 180) / 360) * W, ((90 - la) / 180) * H]);
      for (const part of cutAtEdge(p, W)) out.push({ d: pathD(part), width: f2((0.35 + 0.55 * Math.log10(1 + q / bio.minFlow)) * (W / 720)), flow: Math.round(q) });
    }
    return out;
  }

  /* The vector layers as SVG documents (Inkscape layers in the combined one). */
  function svgs(map, bio, opts = {}) {
    const { W, H } = map, ol = outlines(map, bio), rivers = bio ? riverPaths(bio, W, H) : [];
    const head = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n`;
    const sw = f2(Math.max(0.4, W / 1200));
    const layer = (id, label, body) => `<g id="${id}" inkscape:groupmode="layer" inkscape:label="${label}">\n${body}\n</g>\n`;
    const coast = `<g fill="none" stroke="#1d2a36" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round">\n${ol.coast.map((p) => `<path d="${pathD(p)}"/>`).join('\n')}\n</g>`;
    const lakes = `<g fill="none" stroke="#2f6fae" stroke-width="${f2(sw * 0.8)}" stroke-linejoin="round">\n${ol.lakes.map((p) => `<path d="${pathD(p)}"/>`).join('\n')}\n</g>`;
    const riv = `<g fill="none" stroke="#2f6fae" stroke-linejoin="round" stroke-linecap="round">\n${rivers.map((r) => `<path d="${r.d}" stroke-width="${r.width}" data-flow="${r.flow}"/>`).join('\n')}\n</g>`;
    // a graticule every 30° (the equator and the tropics' and polar circles' latitudes if given)
    const lines = [];
    for (let lo = -180; lo <= 180; lo += 30) { const x = f2(((lo + 180) / 360) * W); lines.push(`<path d="M${x} 0V${H}"/>`); }
    for (let la = -60; la <= 60; la += 30) { const y = f2(((90 - la) / 180) * H); lines.push(`<path d="M0 ${y}H${W}"/>`); }
    for (const la of opts.circles || []) for (const s of [1, -1]) { const y = f2(((90 - s * la) / 180) * H); lines.push(`<path d="M0 ${y}H${W}" stroke-dasharray="${f2(sw * 6)} ${f2(sw * 4)}"/>`); }
    const grid = `<g fill="none" stroke="#7a8794" stroke-width="${f2(sw * 0.6)}" opacity="0.6">\n${lines.join('\n')}\n</g>`;
    return {
      coastline: `${head}${coast}\n</svg>\n`,
      rivers: `${head}${riv}\n</svg>\n`,
      drawing: `${head}${layer('graticule', 'Graticule', grid)}${layer('coast', 'Coast', coast)}${layer('lakes', 'Lakes', lakes)}${layer('rivers', 'Rivers', riv)}</svg>\n`,
      counts: { coast: ol.coast.length, lakes: ol.lakes.length, rivers: rivers.length },
    };
  }

  // ── files ──
  const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (bytes) => { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = crcT[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

  /* A ZIP (stored, not compressed: the PNGs already are) of [{name, data: Uint8Array}]. */
  function zip(files) {
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), data = f.data, crc = crc32(data);
      const lh = new Uint8Array(30 + name.length), dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0x0800, true); dv.setUint16(8, 0, true);
      dv.setUint16(10, dosTime, true); dv.setUint16(12, dosDate, true); dv.setUint32(14, crc, true); dv.setUint32(18, data.length, true); dv.setUint32(22, data.length, true);
      dv.setUint16(26, name.length, true); dv.setUint16(28, 0, true); lh.set(name, 30);
      const ch = new Uint8Array(46 + name.length), cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, dosTime, true); cv.setUint16(14, dosDate, true); cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, name.length, true); cv.setUint32(42, offset, true); ch.set(name, 46);
      parts.push(lh, data); central.push(ch);
      offset += lh.length + data.length;
    }
    const size = central.reduce((s, c) => s + c.length, 0), end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, size, true); ev.setUint32(16, offset, true);
    const out = new Uint8Array(offset + size + 22);
    let o = 0; for (const p of [...parts, ...central, end]) { out.set(p, o); o += p.length; }
    return out;
  }

  /* A 16-bit greyscale PNG of values 0..65535 (needs the browser's CompressionStream). */
  async function png16(W, H, values) {
    const chunk = (type, data) => {
      const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
      dv.setUint32(0, data.length); for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
      out.set(data, 8); dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
      return out;
    };
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
    dv.setUint32(0, W); dv.setUint32(4, H); ihdr[8] = 16; ihdr[9] = 0;
    const raw = new Uint8Array(H * (1 + W * 2));
    for (let j = 0; j < H; j++) { const o = j * (1 + W * 2); for (let i = 0; i < W; i++) { const v = values[j * W + i]; raw[o + 1 + i * 2] = v >> 8; raw[o + 2 + i * 2] = v & 255; } }
    const z = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
    return new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', z), chunk('IEND', new Uint8Array(0))], { type: 'image/png' });
  }

  // ── colours for the PNG layers (RGBA, W × H) ──
  const ramp = (stops, x) => { if (x <= stops[0][0]) return stops[0][1]; for (let i = 1; i < stops.length; i++) if (x <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (x - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * t); } return stops[stops.length - 1][1]; };
  const SEA = [[0, [178, 226, 232]], [200, [140, 202, 222]], [1000, [98, 162, 206]], [3000, [60, 114, 172]], [5000, [36, 76, 132]], [7000, [22, 46, 92]], [11000, [10, 20, 50]]];
  const LAND = [[0, [92, 146, 86]], [200, [118, 166, 94]], [500, [168, 188, 118]], [1000, [204, 182, 122]], [2000, [172, 132, 92]], [3500, [138, 110, 96]], [5000, [214, 208, 202]], [8000, [255, 255, 255]]];
  const hex = (h2) => [1, 3, 5].map((i) => parseInt(h2.slice(i, i + 2), 16));

  function rgba(W, H, colour) {
    const px = new Uint8ClampedArray(W * H * 4);
    for (let k = 0; k < W * H; k++) { const c = colour(k); px[k * 4] = c[0]; px[k * 4 + 1] = c[1]; px[k * 4 + 2] = c[2]; px[k * 4 + 3] = c[3] ?? 255; }
    return px;
  }
  /* Atlas colours, shaded by the slope (light from the north-west). */
  function reliefRGBA(map) {
    const { W, H, z } = map, f = map.planet?.factor ?? 1, cellM = (2 * Math.PI * (map.planet?.radiusKm ?? 6371) * 1000) / W;
    return rgba(W, H, (k) => {
      const i = k % W, j = (k - i) / W, v = z[k];
      let c = v > 0 ? ramp(LAND, v * f) : ramp(SEA, -v);
      if (v > 0) {
        const cosl = Math.max(0.05, Math.cos(((90 - ((j + 0.5) * 180) / H) * Math.PI) / 180));
        const e = Math.max(0, z[j * W + ((i + 1) % W)]), w = Math.max(0, z[j * W + ((i + W - 1) % W)]), n = Math.max(0, z[Math.max(0, j - 1) * W + i]), s = Math.max(0, z[Math.min(H - 1, j + 1) * W + i]);
        const shade = clamp(1 + 14 * f * (-((e - w) / (2 * cellM * cosl)) * 0.7 + ((n - s) / (2 * cellM)) * 0.7), 0.55, 1.35);
        c = c.map((x) => x * shade);
      }
      return c;
    });
  }
  const maskRGBA = (map) => rgba(map.W, map.H, (k) => (map.z[k] > 0 ? [255, 255, 255] : [0, 0, 0]));
  function biomesRGBA(map, bio) {
    return rgba(map.W, map.H, (k) => {
      if (map.z[k] <= 0) return bio.seaIce && bio.seaIce[k] ? [236, 242, 246] : map.z[k] > -200 ? [52, 92, 138] : [34, 66, 110];
      if (bio.lake[k]) return bio.lake[k] === 1 ? [64, 124, 186] : [176, 204, 204];
      return hex(bio.biomes[bio.biome[k] - 1]?.[2] || '#888888');
    });
  }
  /* Climate zones on the map's cells (each land cell takes the nearest climate cell on land). */
  function zonesRGBA(map, clim) {
    const { W, H } = map, cW = clim.W, cH = clim.H;
    const near = (k) => {
      const i = Math.floor(((k % W) * cW) / W), j = Math.min(cH - 1, Math.floor((Math.floor(k / W) * cH) / H)), q0 = j * cW + i;
      if (clim.land[q0]) return q0;
      for (let r = 1; r <= 2; r++) for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) { const jj = j + dj; if (jj < 0 || jj >= cH) continue; const q = jj * cW + ((i + di + cW) % cW); if (clim.land[q]) return q; }
      return q0;
    };
    return rgba(W, H, (k) => (map.z[k] > 0 ? hex(clim.zones[clim.zone[near(k)] - 1]?.[1] || '#888888') : clim.iceMap && clim.iceMap[k] ? [236, 242, 246] : [34, 66, 110]));
  }

  /*
   * The whole kit as a ZIP blob (in the browser). w: the world (its name); map, clim, bio: the built
   * map, climate and rivers & biomes; info: {radiusKm, gravity, tilt} for the read-me.
   */
  async function kit(w, map, clim, bio, info = {}) {
    const { W, H } = map, enc = new TextEncoder(), files = [], base = (w.name || 'world').replace(/[^\w-]+/g, '_');
    const pngOf = (px) => new Promise((resolve) => {
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
      cv.getContext('2d').putImageData(new ImageData(px, W, H), 0, 0);
      cv.toBlob(async (b) => resolve(new Uint8Array(await b.arrayBuffer())), 'image/png');
    });
    const lo = Math.floor(map.deepest.m), hi = Math.ceil(map.highest.m), span = Math.max(1, hi - lo);
    const hv = new Uint16Array(map.z.length); for (let k = 0; k < hv.length; k++) hv[k] = Math.round(((map.z[k] - lo) / span) * 65535);
    files.push({ name: '1-relief.png', data: await pngOf(reliefRGBA(map)) });
    files.push({ name: '2-height-16bit.png', data: new Uint8Array(await (await png16(W, H, hv)).arrayBuffer()) });
    files.push({ name: '3-land-mask.png', data: await pngOf(maskRGBA(map)) });
    if (bio) files.push({ name: '4-biomes.png', data: await pngOf(biomesRGBA(map, bio)) });
    if (clim) files.push({ name: '5-climate-zones.png', data: await pngOf(zonesRGBA(map, clim)) });
    const tilt = Math.abs(info.tilt ?? 23.5) > 90 ? 180 - Math.abs(info.tilt) : Math.abs(info.tilt ?? 23.5);
    const s = svgs(map, bio, { circles: tilt > 0.5 && tilt < 89.5 ? [tilt, 90 - tilt] : [] });
    files.push({ name: '6-coastline.svg', data: enc.encode(s.coastline) });
    if (bio) files.push({ name: '7-rivers.svg', data: enc.encode(s.rivers) });
    files.push({ name: '8-drawing.svg', data: enc.encode(s.drawing) });
    const R = info.radiusKm ?? map.planet?.radiusKm ?? 6371, kmPx = (2 * Math.PI * R) / W;
    const present = (list, share) => list.map((x, i) => [x, share ? share[i] : 1]).filter(([, v]) => v > 0);
    const lines = [
      `${w.name || 'World'}: drawing kit`, '',
      `All layers: equirectangular, ${W} × ${H} pixels, longitude -180° at the left edge to 180° at the right, latitude 90° at the top to -90° at the bottom (${(360 / W).toFixed(3)}° a pixel).`,
      `Scale: ${kmPx.toFixed(1)} km a pixel along the equator (and north-south everywhere); east-west a pixel shrinks with the cosine of the latitude. Planet radius ${Math.round(R)} km.`,
      'Stack the PNGs and SVGs at the same size and they line up.', '',
      '1-relief.png         atlas colours, shaded from the north-west',
      `2-height-16bit.png   heights: 0 = ${lo} m, 65535 = ${hi} m; sea level = ${Math.round((-lo / span) * 65535)}`,
      '3-land-mask.png      land white, sea black (for selections)',
      bio ? '4-biomes.png         biomes, lakes (fresh blue, salt pale), winter sea ice' : null,
      clim ? '5-climate-zones.png  Köppen climate zones' : null,
      '6-coastline.svg      the coast as vector paths (pixel units, same size)',
      bio ? `7-rivers.svg         rivers of ${Math.round(bio.minFlow)} m³/s or more, wider with their flow (data-flow in m³/s)` : null,
      `8-drawing.svg        layers for a vector program: graticule (every 30°${tilt > 0.5 && tilt < 89.5 ? `; dashed: the tropics and polar circles at ${tilt.toFixed(1)}° and ${(90 - tilt).toFixed(1)}°` : ''}), coast, lakes, rivers`,
      '',
      bio ? 'Biomes:' : null,
      ...(bio ? present(bio.biomes, bio.stats.biomeShare).map(([[, name, col], v]) => `  ${col}  ${name} (${Math.round(v * 100)} % of the land)`) : []),
      '',
      clim ? 'Climate zones (Köppen):' : null,
      ...(clim ? (() => { const seen = new Set(); for (let k = 0; k < clim.zone.length; k++) if (clim.zone[k]) seen.add(clim.zone[k]); return [...seen].sort((a, b) => a - b).map((z) => `  ${clim.zones[z - 1][1]}  ${clim.zones[z - 1][0]}`); })() : []),
      '', 'Made with WorldSmith.',
    ].filter((x) => x !== null);
    files.push({ name: 'README.txt', data: enc.encode(lines.join('\r\n') + '\r\n') });
    return { blob: new Blob([zip(files.map((f) => ({ name: `${base}/${f.name}`, data: f.data })))], { type: 'application/zip' }), name: `${base}-drawing-kit.zip`, files: files.map((f) => f.name) };
  }

  const api = { contours, outlines, riverPaths, svgs, zip, crc32, png16, reliefRGBA, maskRGBA, biomesRGBA, zonesRGBA, kit };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.WS = root.WS || {}; root.WS.drawkit = api; }
})(typeof window !== 'undefined' ? window : globalThis);
