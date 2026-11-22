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
