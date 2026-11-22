/* Spherical geometry for the Plates step. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/sphere.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('areas of known shapes', () => {
  // the octant between the equator and two meridians 90° apart: 1/8 of the sphere
  near(S.areaFraction([[0, 0], [0, 90], [90, 0]]), 1 / 8, 1e-9, 'octant');
  // a lune-like quad 0..90 lon, 0..30 lat? use a spherical cap approximation: small square ~ flat
  const sq = [[-1, -1], [-1, 1], [1, 1], [1, -1]];
  near(S.areaFraction(sq), (2 * 2 * (Math.PI / 180) ** 2) / (4 * Math.PI), 1e-6, 'small square');
  // winding direction does not matter
  near(S.areaFraction(sq.slice().reverse()), S.areaFraction(sq), 1e-12, 'reversed');
});

test('point in polygon', () => {
  const box = [[10, 10], [10, 40], [40, 40], [40, 10]];
  assert.ok(S.contains(box, [25, 25]));
  assert.ok(!S.contains(box, [5, 25]));
  assert.ok(!S.contains(box, [-25, -155]));          // the far side of the world
  // across the antimeridian
  const wrap = [[-10, 170], [-10, -170], [10, -170], [10, 170]];
  assert.ok(S.contains(wrap, [0, 180]));
  assert.ok(!S.contains(wrap, [0, 0]));
});

test('coverage counts overlaps once and matches the area', () => {
  const a = [[0, 0], [0, 90], [90, 0]];
  near(S.coverage([a]), 1 / 8, 0.004, 'octant');
  near(S.coverage([a, a]), 1 / 8, 0.004, 'same octant twice');
  const b = [[0, 90], [0, 180], [90, 0]];
  near(S.coverage([a, b]), 1 / 4, 0.005, 'two octants');
});

test('great circles and distances', () => {
  near(S.distance([0, 0], [0, 90]), 90, 1e-9, 'quarter turn');
  const pts = S.arc([0, 0], [0, 90], 10);
  assert.equal(pts.length, 9);
  near(S.distanceToLine([10, 45], [[0, 0], [0, 90]]), 10, 1e-6, 'off the equator');
  near(S.distanceToLine([0, 120], [[0, 0], [0, 90]]), 30, 1e-6, 'beyond the end');
});

test('orthographic projection round-trips', () => {
  const P = S.orthographic(30, 20, 100, 200, 150);
  const [x, y, front] = P.project([35, 25]);
  assert.ok(front);
  const back = P.invert(x, y);
  near(back[0], 35, 1e-9, 'lat'); near(back[1], 25, 1e-9, 'lon');
  assert.equal(P.invert(200 + 101, 150), null);
  assert.deepEqual(P.project([30, 20]).slice(0, 2).map(Math.round), [200, 150]);
});

test('splitting a polygon along a line', () => {
  const box = [[0, 0], [0, 40], [40, 40], [40, 0]];
  const parts = S.splitPolygon(box, [[20, -10], [20, 50]]);
  assert.ok(parts, 'cut');
  const [a, b] = parts;
  const total = S.areaFraction(box);
  near(S.areaFraction(a) + S.areaFraction(b), total, total * 1e-6, 'areas add up');
  // one half holds the south, the other the north
  const south = [10, 20], north = [30, 20];
  assert.ok((S.contains(a, south) && S.contains(b, north)) || (S.contains(b, south) && S.contains(a, north)));
  // a bent cut through three line vertices
  const bent = S.splitPolygon(box, [[-5, 10], [20, 15], [20, 25], [45, 30]]);
  assert.ok(bent);
  near(S.areaFraction(bent[0]) + S.areaFraction(bent[1]), total, total * 1e-6, 'bent areas add up');
  // a line that misses
  assert.equal(S.splitPolygon(box, [[50, 50], [60, 60]]), null);
});

test('tracing on the globe: shapes behind it are clipped to the rim, not drawn across the disc', () => {
  const pr = S.orthographic(10, 0, 100, 0, 0);
  // a 2-D path recorder standing in for a canvas
  const record = () => {
    const pts = [];
    return {
      pts,
      moveTo: (x, y) => pts.push([x, y]), lineTo: (x, y) => pts.push([x, y]), closePath() {},
      arc(cx, cy, r, a0, a1) { const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 0.02)); for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } },
    };
  };
  const inside2d = (ring, [x, y]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const cap = (lat, lon, r) => Array.from({ length: 72 }, (_, k) => {
    const c = S.vec([lat, lon]), e = [-Math.sin(lon * Math.PI / 180), Math.cos(lon * Math.PI / 180), 0], n = [-c[2] * Math.cos(lon * Math.PI / 180), -c[2] * Math.sin(lon * Math.PI / 180), Math.cos(lat * Math.PI / 180)];
    const b = (k * 5 * Math.PI) / 180, d = (r * Math.PI) / 180;
    return S.latLon(c.map((v, i) => Math.cos(d) * v + Math.sin(d) * (Math.cos(b) * n[i] + Math.sin(b) * e[i])));
  });
  // caps that reach round the back of the globe, one over the far pole of the view
  for (const [lat, lon, r] of [[0, 150, 70], [-170 / 2, 60, 60], [40, 100, 45], [-5, 180, 80]]) {
    const ring = cap(lat, lon, r), g = record();
    pr.trace(g, S.densify(ring, true, 2), true);
    let wrong = 0, n = 0;
    for (let x = -99; x <= 99; x += 6) for (let y = -99; y <= 99; y += 6) {
      if (x * x + y * y > 97 * 97) continue;
      n++;
      const truth = S.contains(ring, pr.invert(x, y));
      if (truth !== (g.pts.length > 2 && inside2d(g.pts, [x, y]))) wrong++;
    }
    assert.ok(wrong / n < 0.02, `cap at ${lat},${lon} r ${r}: ${wrong} of ${n} wrong`);
  }
  // wholly behind: nothing drawn
  const g = record();
  pr.trace(g, S.densify(cap(-10, 180, 20), true, 2), true);
  assert.equal(g.pts.length, 0);
});
