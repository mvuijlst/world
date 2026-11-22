/* Plate rotations against pyGPlates 1.0.0's own results. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../js/rotation.js');

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

// the same model as in pyGPlates: 101 relative to 0, 102 relative to 101 (ages in Ma, angles in degrees)
const plates = [
  { id: 101, fixed: 0, rotations: [{ age: 950, lat: 10, lon: 40, angle: 12 }, { age: 900, lat: -20, lon: 120, angle: 30 }] },
  { id: 102, fixed: 101, rotations: [{ age: 900, lat: 45, lon: -30, angle: 20 }] },
];
// pyGPlates: RotationModel.get_rotation(age, plate) * PointOnSphere(15, 25)
const REF = {
  101: { 975: [13.449186, 24.59606], 950: [11.866508, 24.359084], 925: [-0.779655, 20.397591], 900: [-12.725754, 14.628476] },
  102: { 975: [16.675373, 27.201774], 950: [18.886949, 28.716061], 925: [9.03364, 27.779962], 900: [-0.818402, 25.91627] },
};

test('reconstructions match pyGPlates (interpolation and plate chains)', () => {
  const m = R.model(plates, 1000);
  for (const id of [101, 102]) for (const [age, [lat, lon]] of Object.entries(REF[id])) {
    const [got] = m.reconstruct(id, [[15, 25]], Number(age));
    near(got[0], lat, 1e-5, `${id} @ ${age} lat`);
    near(got[1], lon, 1e-5, `${id} @ ${age} lon`);
  }
  // at the start age every plate is where it was drawn
  const [s] = m.reconstruct(102, [[15, 25]], 1000);
  near(s[0], 15, 1e-9, 'start lat'); near(s[1], 25, 1e-9, 'start lon');
  // unreconstruct undoes reconstruct
  const [back] = m.unreconstruct(102, m.reconstruct(102, [[15, 25]], 925), 925);
  near(back[0], 15, 1e-9, 'round trip lat'); near(back[1], 25, 1e-9, 'round trip lon');
});

test('poles and angles round-trip', () => {
  const q = R.fromPole(-20, 120, 30);
  const p = R.toPole(q);
  near(p.lat, -20, 1e-9, 'lat'); near(p.lon, 120, 1e-9, 'lon'); near(p.angle, 30, 1e-9, 'angle');
  const neg = R.toPole(R.fromPole(10, 40, -12));
  near(neg.angle, 12, 1e-9, 'negative angle becomes the opposite pole'); near(neg.lat, -10, 1e-9, 'opposite pole lat');
});

test('plate speed in cm/yr', () => {
  // 1° about a pole 90° away in 1 Myr on Earth: 111.2 km/Myr = 11.12 cm/yr
  const m = R.model([{ id: 1, fixed: 0, rotations: [{ age: 99, lat: 90, lon: 0, angle: 1 }] }], 100);
  near(R.speed(m, 1, [0, 0], 100, 99, 6371), 11.119, 0.01, 'equatorial speed');
});

test('spreading: isochrons sit on both flanks, symmetric, the ridge in between', () => {
  // right plate rotates 20° away about the north pole over 100 Myr; rift along lon 0
  const m = R.model([{ id: 1, fixed: 0, rotations: [] }, { id: 2, fixed: 0, rotations: [{ age: 900, lat: 90, lon: 0, angle: 20 }] }], 1000);
  const rift = [[-30, 0], [0, 0], [30, 0]];
  const s = R.spreading(m, rift, 1, 2, 1000, 900, 10);
  assert.equal(s.isochrons.length, 10);
  // crust made at 990 Ma formed on the ridge, then 1° out (half of the 2° opened in 10 Myr)
  const oldest = s.isochrons[0];
  near(oldest.left[1][1], 1, 1e-6, 'oldest crust on the left flank stays where it formed');
  near(oldest.right[1][1], 19, 1e-6, 'its twin on the right flank rides 18° further with the right plate');
  near(s.edgeR[1][1], 20, 1e-6, 'the right edge of the rift has moved 20°');
  near(s.ridge[1][1], 10, 1e-6, 'ridge halfway');
  const flow = s.flowlines[1];
  assert.equal(flow.left.length, 10);
});

test('spreading stops while the plates close again', () => {
  // opens 20° by 900 Ma, closes back to 10° by 800 Ma
  const m = R.model([{ id: 1, fixed: 0, rotations: [] }, { id: 2, fixed: 0, rotations: [{ age: 900, lat: 90, lon: 0, angle: 20 }, { age: 800, lat: 90, lon: 0, angle: 10 }] }], 1000);
  const s = R.spreading(m, [[-30, 0], [0, 0], [30, 0]], 1, 2, 1000, 800, 10);
  assert.equal(s.isochrons.length, 10, 'crust made only while opening');
  assert.ok(Math.max(...s.isochrons.map((i) => i.age)) === 990 && Math.min(...s.isochrons.map((i) => i.age)) === 900);
  near(s.ridge[1][1], 10, 1e-6, 'the ridge stays where it stopped');
  near(s.edgeR[1][1], 10, 1e-6, 'the right plate has come back to 10°');
});
