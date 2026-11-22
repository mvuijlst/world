/*
 * Plates: the supercontinent, drawn as Artifexian does in GPlates (Worldbuilder's Log 10):
 * cratons, the continental crust round them, the rifts that will open it, and the rifts that fail.
 * Drawn on a globe here; exported to and imported from GPlates through the server (pyGPlates).
 */
(function () {
  'use strict';
  const { h, panel, fmt, replace, icon, info, toast } = WS.ui;
  const S = WS.sphere;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  const KINDS = {
    craton: { label: 'Craton', plural: 'Cratons', closed: true, gplates: 'Craton', help: 'An old, stable core of continental crust (a shield). Draw several: each becomes the heart of a plate.' },
    crust: { label: 'Continental crust', plural: 'Continental crust', closed: true, gplates: 'ContinentalCrust', help: 'Younger continental crust welded round the cratons. Together it makes the supercontinent.' },
    rift: { label: 'Rift', plural: 'Rifts', closed: false, gplates: 'ContinentalRift', help: 'A line along which the supercontinent will split. Rifts tend to run between cratons, not through them.' },
    failed: { label: 'Failed rift', plural: 'Failed rifts', closed: false, gplates: 'ContinentalRift', help: 'A rift arm that stops opening (an aulacogen), usually the third arm at a triple junction on a rift.' },
  };
  // distinct plate colours, readable in both themes
  const PALETTE = ['#d9822b', '#2a9d8f', '#c0392b', '#7d5ba6', '#6a994e', '#3a86c8', '#b5838d', '#c9a227', '#4f7c7a', '#9c6644'];
  const colourOf = (plates, id) => { const i = plates.findIndex((p) => p.id === id); return i < 0 ? '#888888' : plates[i].colour || PALETTE[i % PALETTE.length]; };
  const hexA = (hx, a) => { const n = parseInt(hx.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
  let fid = 0;
  const newId = () => `f${Date.now().toString(36)}${(fid++).toString(36)}`;

  function stats(P, radiusKm) {
    const of = (k) => P.features.filter((f) => f.kind === k);
    const crust = S.coverage([...of('crust'), ...of('craton')].map((f) => f.coords));
    const cratons = S.coverage(of('craton').map((f) => f.coords));
    const length = (k) => of(k).reduce((s, f) => s + f.coords.slice(1).reduce((t, p, i) => t + S.distance(f.coords[i], p), 0), 0) * Math.PI / 180 * radiusKm;
    return { crust, cratons, land: crust * (29 / 41), rift: length('rift'), failed: length('failed'), counts: { craton: of('craton').length, crust: of('crust').length, rift: of('rift').length, failed: of('failed').length } };
  }

  WS.defineStep({
    id: 'plates', title: 'Plates', code: '00_LITHOSPHERE/PLATES', strip: 'Supercontinent & rifts',
    blurb: 'Draw the supercontinent: its cratons, its crust, and the rifts that will break it up.',
    lede: [
      'Following Artifexian’s Worldbuilder’s Log 10 (GPlates: the Supercontinent): begin with one supercontinent. Draw its cratons, the ancient stable cores, then the younger continental crust that welds them together. Earth’s continental crust covers about 40 % of the planet, of which roughly 29 % stands above the sea.',
      'Then draw the rifts where the supercontinent will tear apart, running between the cratons, and a few failed rifts branching off them at triple junctions. Everything can go to and from GPlates desktop, so you can carry on there or here.',
    ],
    build(ctx) {
      const u = (ctx.ui.plates = ctx.ui.plates || { lat: 20, lon: 10, zoom: 1, tool: 'look', draft: [], selected: null, plate: null });
      const P = () => ctx.world.plates;
      const host = h('div', { class: 'scene-host globe-host' });
      const hint = h('div', { class: 'scene-status mono' });
      const toolsHost = h('div');
      const listHost = h('div');
      const statsHost = h('div');
      const gplatesHost = h('div');
      let server = null; // null unknown, false absent, {version} present

      const el = h('div', { class: 'grid two' },
        h('div', { class: 'stack-gap' },
          panel('Draw', { ticks: true, tag: 'TOOLS' }, toolsHost),
          panel('Plates & features', { tag: 'INVENTORY' }, listHost),
          panel('GPlates', { tag: 'IMPORT · EXPORT' }, gplatesHost)),
        h('div', { class: 'stack-gap' },
          panel('Globe', { tag: 'DRAG TO TURN · WHEEL TO ZOOM', flush: true }, host, h('div', { class: 'viz-caption' }, hint)),
          statsHost));

      // ── canvas ──
      const cv = h('canvas', { class: 'scene-canvas', tabindex: 0, role: 'application', 'aria-label': 'Globe editor: draw cratons, crust and rifts' });
      host.appendChild(cv);
      const g = cv.getContext('2d');
      const fit = () => {
        const w = host.clientWidth || 600, hh = Math.round(clamp(w * 0.82, 320, Math.max(360, window.innerHeight * 0.75)));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        cv.style.height = `${hh}px`; cv.width = Math.round(w * dpr); cv.height = Math.round(hh * dpr);
        draw();
      };
      const ro = new ResizeObserver(fit);

      const proj = () => {
        const W = cv.width, H = cv.height;
        return S.orthographic(u.lat, u.lon, Math.min(W, H) * 0.44 * u.zoom, W / 2, H / 2);
      };

      function pathOf(pr, coords, closed) {
        const pts = S.densify(coords, closed, 2).map((p) => pr.project(p));
        g.beginPath();
        pts.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])));
        if (closed) g.closePath();
        return pts;
      }

      let cursor = null; // [lat, lon] under the pointer while drawing
      function draw() {
        if (!cv.width) return;
        const W = cv.width, H = cv.height, dpr = W / (cv.clientWidth || W);
        const pr = proj(), R = Math.min(W, H) * 0.44 * u.zoom;
        const col = { bg: css('--bg'), line: css('--line'), faint: css('--line-faint'), soft: css('--line-soft'), teal: css('--teal'), amber: css('--amber'), red: css('--red'), text: css('--text'), muted: css('--muted') };
        g.fillStyle = col.bg; g.fillRect(0, 0, W, H);
        // ocean
        g.save();
        g.beginPath(); g.arc(W / 2, H / 2, R, 0, 2 * Math.PI);
        g.fillStyle = document.documentElement.dataset.theme === 'pulp' ? '#cfdcd6' : '#0b1d24'; g.fill();
        g.clip();
        // graticule
        g.lineWidth = dpr;
        for (let lat = -60; lat <= 60; lat += 30) {
          pathOf(pr, Array.from({ length: 73 }, (_, i) => [lat, -180 + i * 5]), false);
          g.strokeStyle = lat === 0 ? col.soft : col.faint; g.stroke();
        }
        for (let lon = -180; lon < 180; lon += 30) { pathOf(pr, Array.from({ length: 37 }, (_, i) => [-90 + i * 5, lon]), false); g.strokeStyle = col.faint; g.stroke(); }
        const plates = P().plates;
        const order = { crust: 0, craton: 1, rift: 2, failed: 3 };
        const feats = P().features.slice().sort((a, b) => order[a.kind] - order[b.kind]);
        for (const f of feats) {
          const c = colourOf(plates, f.plateId);
          const kind = KINDS[f.kind];
          if (kind.closed && f.coords.length >= 3) {
            pathOf(pr, f.coords, true);
            g.fillStyle = hexA(c, f.kind === 'craton' ? 0.75 : 0.35); g.fill();
            g.strokeStyle = c; g.lineWidth = (f.kind === 'craton' ? 1.6 : 1.2) * dpr; g.stroke();
            if (f.kind === 'craton') { // a hatch, so cratons read as cratons in any colour
              g.save(); pathOf(pr, f.coords, true); g.clip();
              g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = dpr;
              for (let x = -H; x < W; x += 9 * dpr) { g.beginPath(); g.moveTo(x, H); g.lineTo(x + H, 0); g.stroke(); }
              g.restore();
            }
          } else if (!kind.closed && f.coords.length >= 2) {
            pathOf(pr, f.coords, false);
            g.strokeStyle = col.red; g.lineWidth = (f.kind === 'rift' ? 3 : 2) * dpr;
            g.setLineDash(f.kind === 'failed' ? [7 * dpr, 5 * dpr] : []); g.stroke(); g.setLineDash([]);
          }
          if (u.selected === f.id) {
            if (f.coords.length >= 2) { pathOf(pr, f.coords, kind.closed); g.strokeStyle = col.teal; g.lineWidth = 2.4 * dpr; g.stroke(); }
            for (const p of f.coords) { const q = pr.project(p); if (!q[2]) continue; g.fillStyle = col.bg; g.strokeStyle = col.teal; g.lineWidth = 2 * dpr; g.beginPath(); g.arc(q[0], q[1], 5 * dpr, 0, 2 * Math.PI); g.fill(); g.stroke(); }
          }
        }
        // the shape being drawn
        if (u.draft.length) {
          const pts = cursor ? [...u.draft, cursor] : u.draft;
          pathOf(pr, pts, false);
          g.strokeStyle = col.amber; g.lineWidth = 2 * dpr; g.setLineDash([5 * dpr, 4 * dpr]); g.stroke(); g.setLineDash([]);
          u.draft.forEach((p, i) => { const q = pr.project(p); g.fillStyle = i === 0 ? col.amber : col.bg; g.strokeStyle = col.amber; g.beginPath(); g.arc(q[0], q[1], (i === 0 ? 6 : 4) * dpr, 0, 2 * Math.PI); g.fill(); g.stroke(); });
        }
        g.restore();
        // rim and labels
        g.strokeStyle = col.line; g.lineWidth = 1.5 * dpr; g.beginPath(); g.arc(W / 2, H / 2, R, 0, 2 * Math.PI); g.stroke();
        g.font = `${12 * dpr}px ${css('--font-mono') || 'monospace'}`;
        for (const f of P().features) {
          if (!f.name || f.coords.length < 2) continue;
          const at = KINDS[f.kind].closed ? S.latLon(S.centroid(f.coords)) : f.coords[Math.floor(f.coords.length / 2)];
          const q = pr.project(at); if (!q[2]) continue;
          g.fillStyle = col.text; g.fillText(f.name, q[0] + 4 * dpr, q[1]);
        }
        hint.textContent = hintText();
      }
      function hintText() {
        if (u.tool === 'look') return u.selected ? 'Drag a handle to move a point · Delete removes the shape · drag elsewhere to turn the globe' : 'Tap a shape to select it · drag to turn the globe · choose a tool to draw';
        const k = KINDS[u.tool];
        if (!u.draft.length) return `${k.label}: tap the globe to place the first point`;
        return k.closed ? `${u.draft.length} points · tap the first point or press Enter to close · Backspace undoes · Esc cancels` : `${u.draft.length} points · double-tap or press Enter to finish · Backspace undoes · Esc cancels`;
      }

      // ── editing ──
      function commitDraft() {
        const tool = u.tool, k = KINDS[tool];
        const pts = u.draft.slice();
        u.draft = []; cursor = null;
        if ((k.closed && pts.length < 3) || (!k.closed && pts.length < 2)) { draw(); return; }
        ctx.mutate((w) => {
          const Pw = w.plates;
          let plateId = null;
          if (tool === 'craton') {
            plateId = Pw.nextPlate++;
            Pw.plates.push({ id: plateId, name: `Plate ${plateId}`, colour: PALETTE[Pw.plates.length % PALETTE.length] });
            // crust drawn before any craton was on no plate: the first craton inside it adopts it
            const mid = S.latLon(S.centroid(pts));
            for (const f of Pw.features) if (f.kind === 'crust' && !Pw.plates.some((q) => q.id === f.plateId) && S.contains(f.coords, mid)) f.plateId = plateId;
          } else {
            // the plate of the craton under the first point, else the chosen plate, else plate 0
            const host2 = Pw.features.find((f) => f.kind === 'craton' && S.contains(f.coords, pts[0])) || Pw.features.find((f) => f.kind === 'crust' && S.contains(f.coords, pts[0]));
            plateId = host2 ? host2.plateId : (u.plate ?? (Pw.plates[0] ? Pw.plates[0].id : 0));
          }
          const n = Pw.features.filter((f) => f.kind === tool).length + 1;
          const f = { id: newId(), kind: tool, plateId, name: `${k.label} ${n}`, coords: pts.map(([a, b]) => [+a.toFixed(4), +b.toFixed(4)]) };
          Pw.features.push(f);
          u.selected = f.id;
        });
        renderSide();
        draw();
      }
      function removeSelected() {
        if (!u.selected) return;
        ctx.mutate((w) => {
          const f = w.plates.features.find((x) => x.id === u.selected);
          w.plates.features = w.plates.features.filter((x) => x.id !== u.selected);
          // a craton's plate goes when nothing is left on it
          if (f && !w.plates.features.some((x) => x.plateId === f.plateId)) w.plates.plates = w.plates.plates.filter((p) => p.id !== f.plateId);
        });
        u.selected = null; renderSide(); draw();
      }
      function pick(x, y) {
        const pr = proj(), at = pr.invert(x, y);
        if (!at) return null;
        const dpr = cv.width / cv.clientWidth, R = Math.min(cv.width, cv.height) * 0.44 * u.zoom;
        const tol = (10 * dpr / R) * 180 / Math.PI;                               // 10 px in degrees
        const lines = P().features.filter((f) => !KINDS[f.kind].closed && f.coords.length >= 2).map((f) => [S.distanceToLine(at, f.coords), f]).filter(([d]) => d < tol).sort((a, b) => a[0] - b[0]);
        if (lines.length) return lines[0][1];
        const polys = P().features.filter((f) => KINDS[f.kind].closed && S.contains(f.coords, at)).sort((a, b) => S.areaFraction(a.coords) - S.areaFraction(b.coords));
        return polys[0] || null;
      }

      // pointer: drag turns the globe (or moves a handle), a tap adds a point or selects
      const pts = new Map(); let gesture = null, lastTap = 0, lastXY = [0, 0];
      const local = (e) => { const r = cv.getBoundingClientRect(), dpr = cv.width / r.width; return [(e.clientX - r.left) * dpr, (e.clientY - r.top) * dpr]; };
      cv.addEventListener('pointerdown', (e) => {
        cv.focus({ preventScroll: true });
        cv.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, local(e));
        if (pts.size === 2) { const [a, b] = [...pts.values()]; gesture = { pinch: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: u.zoom }; return; }
        const [x, y] = local(e);
        gesture = { x, y, lat: u.lat, lon: u.lon, moved: false, handle: null };
        if (u.tool === 'look' && u.selected) {
          const f = P().features.find((q) => q.id === u.selected), pr = proj(), dpr = cv.width / cv.clientWidth;
          if (f) f.coords.forEach((p, i) => { const q = pr.project(p); if (q[2] && Math.hypot(q[0] - x, q[1] - y) < 12 * dpr) gesture.handle = i; });
        }
      });
      cv.addEventListener('pointermove', (e) => {
        const [x, y] = local(e);
        if (u.draft.length && !pts.size) { cursor = proj().invert(x, y); draw(); }
        if (!pts.has(e.pointerId) || !gesture) return;
        pts.set(e.pointerId, [x, y]);
        if (gesture.pinch !== undefined && pts.size === 2) { const [a, b] = [...pts.values()]; u.zoom = clamp(gesture.zoom * Math.hypot(a[0] - b[0], a[1] - b[1]) / gesture.pinch, 0.6, 8); draw(); return; }
        const dpr = cv.width / cv.clientWidth;
        if (Math.hypot(x - gesture.x, y - gesture.y) > 4 * dpr) gesture.moved = true;
        if (!gesture.moved) return;
        if (gesture.handle !== null) {
          const at = proj().invert(x, y);
          if (at) { const f = P().features.find((q) => q.id === u.selected); if (f) { f.coords[gesture.handle] = [+at[0].toFixed(4), +at[1].toFixed(4)]; draw(); } }
          return;
        }
        const R = Math.min(cv.width, cv.height) * 0.44 * u.zoom, k = (180 / Math.PI) / R;
        u.lon = ((gesture.lon - (x - gesture.x) * k / Math.max(0.2, Math.cos(u.lat * Math.PI / 180))) + 540) % 360 - 180;
        u.lat = clamp(gesture.lat + (y - gesture.y) * k, -89, 89);
        draw();
      });
      const release = (e) => {
        if (!pts.has(e.pointerId)) return;
        pts.delete(e.pointerId);
        const gst = gesture;
        if (pts.size) return;
        gesture = null;
        if (!gst || gst.pinch !== undefined) return;
        if (gst.handle !== null && gst.moved) { ctx.set('plates.features', P().features); renderSide(); return; }
        if (gst.moved) return;
        const [x, y] = local(e), now = Date.now();
        if (u.tool === 'look') { const f = pick(x, y); u.selected = f ? f.id : null; renderSide(); draw(); return; }
        const at = proj().invert(x, y);
        if (!at) return;
        const k = KINDS[u.tool], pr = proj(), dpr = cv.width / cv.clientWidth;
        if (k.closed && u.draft.length >= 3) { const q = pr.project(u.draft[0]); if (Math.hypot(q[0] - x, q[1] - y) < 12 * dpr) { commitDraft(); return; } }
        // a double tap (quick, and on the same spot) finishes a line
        if (!k.closed && u.draft.length >= 2 && now - lastTap < 400 && Math.hypot(x - lastXY[0], y - lastXY[1]) < 10 * dpr) { commitDraft(); lastTap = 0; return; }
        u.draft.push(at); lastTap = now; lastXY = [x, y]; draw();
      };
      cv.addEventListener('pointerup', release);
      cv.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); gesture = null; });
      cv.addEventListener('wheel', (e) => { e.preventDefault(); u.zoom = clamp(u.zoom * Math.exp(-e.deltaY * 0.0012), 0.6, 8); draw(); }, { passive: false });
      cv.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && u.draft.length) { e.preventDefault(); commitDraft(); }
        else if (e.key === 'Escape') { u.draft = []; cursor = null; draw(); }
        else if (e.key === 'Backspace' && u.draft.length) { e.preventDefault(); u.draft.pop(); draw(); }
        else if ((e.key === 'Delete' || e.key === 'Backspace') && u.selected) { e.preventDefault(); removeSelected(); }
      });
      cv.style.touchAction = 'none'; cv.style.cursor = 'crosshair';

      // ── side panels ──
      function renderTools() {
        const btn = (tool, label, swatch) => h('button', {
          type: 'button', class: ['btn small tool-btn', u.tool === tool && 'active'], 'aria-pressed': String(u.tool === tool),
          onclick: () => { u.tool = tool; u.draft = []; cursor = null; renderTools(); draw(); cv.focus({ preventScroll: true }); },
        }, swatch, label);
        const sw = (style) => h('i', { class: 'tool-swatch', style });
        const plates = P().plates;
        const plateSel = h('select', { class: 'sel', id: 'plate-for-new', 'aria-label': 'Plate for new crust and rifts' },
          h('option', { value: '' }, 'automatic (the craton underneath)'),
          plates.map((p) => h('option', { value: p.id, selected: u.plate === p.id }, `${p.id} · ${p.name}`)));
        plateSel.addEventListener('change', () => { u.plate = plateSel.value === '' ? null : Number(plateSel.value); });
        replace(toolsHost,
          h('div', { class: 'btn-row' },
            btn('look', 'Select / turn', null),
            btn('craton', 'Craton', sw({ background: PALETTE[0] })),
            btn('crust', 'Crust', sw({ background: hexA(PALETTE[0], 0.4), border: `1px solid ${PALETTE[0]}` })),
            btn('rift', 'Rift', sw({ background: 'var(--red)', height: '3px' })),
            btn('failed', 'Failed rift', sw({ background: 'repeating-linear-gradient(90deg, var(--red) 0 5px, transparent 5px 8px)', height: '3px' }))),
          h('p', { class: 'muted', style: { fontSize: '13.5px', margin: '10px 0' } }, u.tool === 'look' ? 'Choose a tool, then tap points on the globe. Each craton starts a plate of its own; crust and rifts join the plate of the craton they start on.' : KINDS[u.tool].help),
          u.tool !== 'look' ? h('div', { class: 'btn-row' },
            h('button', { class: 'btn small primary', type: 'button', onclick: commitDraft }, 'Finish shape'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { u.draft.pop(); draw(); } }, 'Undo point'),
            h('button', { class: 'btn small', type: 'button', onclick: () => { u.draft = []; cursor = null; draw(); } }, 'Cancel')) : null,
          plates.length ? h('div', { class: 'field', style: { marginTop: '12px' } }, h('label', { class: 'field-label', for: 'plate-for-new' }, 'Plate for new crust & rifts'), plateSel) : null);
      }

      function renderList() {
        const Pw = P();
        if (!Pw.features.length) { replace(listHost, h('p', { class: 'muted' }, 'Nothing drawn yet. Start with a craton.')); return; }
        const plateOpts = (sel) => Pw.plates.map((p) => h('option', { value: p.id, selected: p.id === sel }, `${p.id}`));
        const rows = Pw.plates.map((pl) => {
          const name = h('input', { class: 'txt', value: pl.name, 'aria-label': `Name of plate ${pl.id}` });
          name.addEventListener('change', () => { pl.name = name.value || `Plate ${pl.id}`; ctx.set('plates.plates', Pw.plates); renderTools(); });
          const feats = Pw.features.filter((f) => f.plateId === pl.id);
          return h('div', { class: 'plate-block' },
            h('div', { class: 'plate-head' }, h('i', { class: 'plate-chip', style: { background: colourOf(Pw.plates, pl.id) } }), h('span', { class: 'mono' }, String(pl.id)), name),
            feats.map((f) => featureRow(f, plateOpts)));
        });
        const loose = Pw.features.filter((f) => !Pw.plates.some((p) => p.id === f.plateId));
        replace(listHost, rows, loose.length ? h('div', { class: 'plate-block' }, h('div', { class: 'plate-head' }, h('span', { class: 'muted' }, 'Not on a plate')), loose.map((f) => featureRow(f, plateOpts))) : null);
      }
      function featureRow(f, plateOpts) {
        const name = h('input', { class: 'txt', value: f.name, 'aria-label': `${KINDS[f.kind].label} name` });
        name.addEventListener('change', () => { f.name = name.value; ctx.set('plates.features', P().features); draw(); });
        const sel = h('select', { class: 'sel', 'aria-label': `Plate of ${f.name}` }, plateOpts(f.plateId));
        sel.addEventListener('change', () => { f.plateId = Number(sel.value); ctx.set('plates.features', P().features); renderList(); draw(); });
        const area = KINDS[f.kind].closed ? `${fmt.num(S.areaFraction(f.coords) * 100, 1)} %` : `${fmt.int(f.coords.slice(1).reduce((t, p, i) => t + S.distance(f.coords[i], p), 0) * Math.PI / 180 * ctx.d.planet.radiusKm)} km`;
        return h('div', { class: ['feature-row', u.selected === f.id && 'selected'] },
          h('button', { type: 'button', class: 'btn small', title: 'Show on the globe', 'aria-label': `Select ${f.name}`, onclick: () => { u.selected = f.id; u.tool = 'look'; const c = S.latLon(S.centroid(f.coords)); u.lat = clamp(c[0], -89, 89); u.lon = c[1]; renderTools(); renderList(); draw(); } }, KINDS[f.kind].label),
          name, f.kind === 'craton' ? h('span', { class: 'muted mono' }, String(f.plateId)) : sel, h('span', { class: 'mono t-amber' }, area),
          h('button', { type: 'button', class: 'btn small danger', 'aria-label': `Delete ${f.name}`, onclick: () => { u.selected = f.id; removeSelected(); } }, icon('x')));
      }

      function renderStats() {
        const st = stats(P(), ctx.d.planet.radiusKm);
        const popLand = ctx.world.population.land;
        replace(statsHost, h('div', { class: 'readouts' },
          [['Continental crust', `${fmt.num(st.crust * 100, 1)} %`, 'of the surface · Earth ≈ 40 %', 'Union of all crust and cratons, measured on the sphere.'],
            ['Cratons', `${fmt.num(st.cratons * 100, 1)} %`, `${st.counts.craton} drawn`, null],
            ['Land, estimated', `${fmt.num(st.land * 100, 1)} %`, 'crust × 29/41, Earth’s share above the sea', 'On Earth about 29 % of the surface is land on about 41 % continental crust: the rest is flooded shelf.'],
            ['Rifts', `${fmt.int(st.rift)} km`, `${st.counts.rift} rifts · ${st.counts.failed} failed (${fmt.int(st.failed)} km)`, null]]
            .map(([l, v, sub, tip]) => h('div', { class: 'readout' }, h('div', { class: 'lbl' }, l, info(tip)), h('div', { class: 'val' }, v), h('div', { class: 'sub' }, sub)))),
          st.crust > 0 ? h('div', { class: 'btn-row', style: { marginTop: '10px' } },
            h('button', { class: 'btn small', type: 'button', onclick: () => { ctx.mutate((w) => { w.population.land = +(st.land * 100).toFixed(1); }); toast(`Population land set to ${fmt.num(st.land * 100, 1)} %`); } }, `Use ${fmt.num(st.land * 100, 1)} % as land on Population`),
            h('span', { class: 'muted', style: { fontSize: '13px', alignSelf: 'center' } }, `now ${fmt.num(popLand, 1)} %`)) : null);
      }

      // ── GPlates ──
      async function checkServer() {
        if (location.protocol === 'file:') { server = false; return; }
        try { const r = await fetch('api/plates/status'); const j = await r.json(); server = j && j.available ? j : false; } catch { server = false; }
      }
      function download(blob, name) {
        const a = h('a', { href: URL.createObjectURL(blob), download: name });
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      }
      const safeName = () => (ctx.world.name || 'world').replace(/[^\w-]+/g, '_');
      function geojson() {
        const Pw = P();
        return {
          type: 'FeatureCollection',
          features: Pw.features.filter((f) => f.coords.length >= (KINDS[f.kind].closed ? 3 : 2)).map((f) => ({
            type: 'Feature',
            properties: { name: f.name, kind: f.kind, PLATEID1: f.plateId, plate: (Pw.plates.find((p) => p.id === f.plateId) || {}).name || '', gplates: KINDS[f.kind].gplates },
            geometry: KINDS[f.kind].closed
              ? { type: 'Polygon', coordinates: [[...f.coords, f.coords[0]].map(([la, lo]) => [lo, la])] }
              : { type: 'LineString', coordinates: f.coords.map(([la, lo]) => [lo, la]) },
          })),
        };
      }
      function takeIn(features, plates, how) {
        if (!features.length) { toast(`${how}: no cratons, crust or rifts found`); return; }
        if (P().features.length && !confirm(`Add ${features.length} shapes from ${how} to the ones already drawn?`)) return;
        ctx.mutate((w) => {
          const Pw = w.plates;
          for (const p of plates) if (!Pw.plates.some((q) => q.id === p.id)) Pw.plates.push({ id: p.id, name: p.name || `Plate ${p.id}`, colour: PALETTE[Pw.plates.length % PALETTE.length] });
          for (const f of features) {
            if (!Pw.plates.some((q) => q.id === f.plateId)) Pw.plates.push({ id: f.plateId, name: `Plate ${f.plateId}`, colour: PALETTE[Pw.plates.length % PALETTE.length] });
            Pw.features.push({ id: newId(), kind: f.kind, plateId: f.plateId, name: f.name || KINDS[f.kind].label, coords: f.coords });
          }
          Pw.nextPlate = Math.max(Pw.nextPlate, ...Pw.plates.map((p) => p.id + 1));
        }, { structural: true });
        toast(`${how}: ${features.length} shapes added`);
      }
      async function exportGplates() {
        try {
          const r = await fetch('api/plates/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: ctx.world.name, plates: P().plates, features: P().features }) });
          if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `HTTP ${r.status}`); }
          download(await r.blob(), `${safeName()}-gplates.zip`);
        } catch (err) { toast(`Export failed: ${err.message}`); }
      }
      async function importFile(file) {
        try {
          if (/\.(geo)?json$/i.test(file.name)) {
            const gj = JSON.parse(await file.text());
            const feats = (gj.features || []).map((f) => {
              const p = f.properties || {}, geom = f.geometry || {};
              const kind = KINDS[p.kind] ? p.kind : geom.type === 'Polygon' ? (/craton/i.test(p.gplates || p.TYPE || '') ? 'craton' : 'crust') : 'rift';
              const ring = geom.type === 'Polygon' ? geom.coordinates[0].slice(0, -1) : geom.type === 'LineString' ? geom.coordinates : null;
              return ring ? { kind, plateId: Number(p.PLATEID1 ?? p.plateId ?? 0), name: p.name || p.NAME, coords: ring.map(([lo, la]) => [la, lo]) } : null;
            }).filter(Boolean);
            takeIn(feats, [], file.name);
            return;
          }
          const fd = new FormData(); fd.append('file', file);
          const r = await fetch('api/plates/import', { method: 'POST', body: fd });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
          takeIn(j.features, j.plates, file.name);
          if (j.skipped) toast(`${j.skipped} other GPlates features were left out`);
        } catch (err) { toast(`Import failed: ${err.message}`); }
      }
      function renderGplates() {
        const fileIn = h('input', { type: 'file', accept: '.gpml,.gpmlz,.geojson,.json', class: 'sr-only', id: 'plates-import' });
        fileIn.addEventListener('change', () => { const f = fileIn.files && fileIn.files[0]; if (f) importFile(f); fileIn.value = ''; });
        const has = P().features.length > 0;
        replace(gplatesHost,
          h('p', { class: 'muted', style: { fontSize: '13.5px', marginBottom: '10px' } },
            server ? `Through the server’s pyGPlates ${server.version}: a .zip with a .gpml feature file and a .rot rotation file (every plate fixed for now) that GPlates desktop opens as they are.`
              : server === false ? 'GPlates files are made by the WorldSmith server (world.yusupov.cloud). Here you can still save and load GeoJSON, which GPlates also reads.' : 'Checking the server…'),
          h('div', { class: 'btn-row' },
            h('button', { class: 'btn small primary', type: 'button', disabled: !server || !has, onclick: exportGplates }, icon('download'), 'Export for GPlates'),
            h('label', { class: 'btn small', for: 'plates-import', tabindex: 0, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } } }, icon('upload'), server ? 'Import .gpml / GeoJSON' : 'Import GeoJSON'),
            fileIn,
            h('button', { class: 'btn small', type: 'button', disabled: !has, onclick: () => download(new Blob([JSON.stringify(geojson(), null, 1)], { type: 'application/geo+json' }), `${safeName()}-plates.geojson`) }, icon('download'), 'GeoJSON')),
          h('p', { class: 'muted', style: { fontSize: '12.5px', marginTop: '10px' } }, 'In GPlates: File → Open Feature Collection, pick both files; the cratons, crust and rifts come in as Craton, ContinentalCrust and ContinentalRift features on their plate IDs.'));
      }

      function renderSide() { renderTools(); renderList(); renderStats(); }

      return {
        el,
        update() {
          renderSide(); renderGplates();
          if (!ro._on) { ro.observe(host); ro._on = true; } else draw();
          if (server === null) checkServer().then(renderGplates);
        },
        destroy() { ro.disconnect(); },
      };
    },
    checks(w, d) {
      const P = w.plates, out = [];
      if (!P || !P.features.length) return [{ level: 'info', text: 'No supercontinent drawn yet.' }];
      const st = stats(P, d.planet.radiusKm);
      if (st.counts.craton < 2) out.push({ level: 'warn', text: 'A supercontinent is several cratons welded together: draw at least two.' });
      if (st.crust < 0.2 || st.crust > 0.55) out.push({ level: 'warn', text: `Continental crust covers ${fmt.num(st.crust * 100, 1)} % of the surface; Earth’s is about 40 %.` });
      else out.push({ level: 'ok', text: `Continental crust covers ${fmt.num(st.crust * 100, 1)} % of the surface (Earth ≈ 40 %).` });
      const crust = P.features.filter((f) => f.kind === 'crust');
      for (const c of P.features.filter((f) => f.kind === 'craton')) {
        if (crust.length && !c.coords.every((p) => crust.some((k) => S.contains(k.coords, p)))) out.push({ level: 'warn', text: `${c.name} pokes out of the continental crust: cratons sit inside it.` });
      }
      const rifts = P.features.filter((f) => f.kind === 'rift');
      if (!rifts.length) out.push({ level: 'info', text: 'No rifts yet: draw where the supercontinent will split.' });
      for (const f of P.features.filter((x) => x.kind === 'failed')) {
        const touches = rifts.some((r) => Math.min(S.distanceToLine(f.coords[0], r.coords), S.distanceToLine(f.coords[f.coords.length - 1], r.coords)) < 3);
        if (!touches) out.push({ level: 'warn', text: `${f.name} doesn’t start on a rift: failed rifts branch off one at a triple junction.` });
      }
      for (const r of rifts) {
        const through = P.features.filter((c) => c.kind === 'craton' && r.coords.some((p) => S.contains(c.coords, p)));
        if (through.length) out.push({ level: 'info', text: `${r.name} runs through ${through.map((c) => c.name).join(', ')}: rifts usually skirt cratons.` });
      }
      return out;
    },
  });
})();
