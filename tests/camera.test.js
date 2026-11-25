/* The map viewer's camera: screen ↔ planet, grabbing (across the poles too), zoom, fling. Run with: npm test */
const test = require('node:test');
const assert = require('node:assert/strict');
const Cam = require('../js/camera.js');
const S = require('../js/sphere.js');

const close = (p, q, tol, msg) => assert.ok(p && q && S.distance(p, q) < tol, `${msg}: ${JSON.stringify(p)} vs ${JSON.stringify(q)}`);

test('screen and planet agree, on the globe and the flat map, near and far', () => {
  for (const projection of ['globe', 'flat']) for (const alt of [null, 0.01, 0.5]) {
    const cam = Cam.create({ w: 1667, h: 1013, lat: 35, lon: 170, projection, alt });
    for (const [x, y] of [[833, 506], [100, 120], [1500, 900], [840, 30]]) {
      const p = Cam.pick(cam, x, y);
      if (!p) continue;
      const s = Cam.toScreen(cam, ...p);
      assert.ok(s[2] && Math.hypot(s[0] - x, s[1] - y) < 1e-6 * 1667 + 1e-6, `${projection} alt ${alt}: (${x}, ${y}) → ${s}`);
    }
  }
  // the default globe fills 0.46 of the short side; north is up; the far side is hidden
  const cam = Cam.create({ w: 1667, h: 1013, lat: 0, lon: 0 });
  const rim = Cam.toScreen(cam, 0, 89.999);
  assert.ok(Math.abs(rim[0] - 1667 / 2 - 0.46 * 1013) < 30, `rim at ${rim[0]}`);
  assert.ok(Cam.toScreen(cam, 10, 0)[1] < Cam.toScreen(cam, 0, 0)[1], 'north is up');
  assert.ok(Cam.toScreen(cam, 0, 10)[0] > Cam.toScreen(cam, 0, 0)[0], 'east is right');
  assert.equal(Cam.toScreen(cam, 0, 180)[2], false, 'the far side is hidden');
  assert.equal(Cam.pick(cam, 5, 5), null, 'off the globe');
});

test('the grabbed place stays under the pointer, north up, across both poles', () => {
  for (const dir of [1, -1]) {
    const cam = Cam.create({ w: 1200, h: 800, lat: 60 * dir, lon: 30, alt: 1.5 });
    const x0 = 600, y0 = 400 + 60 * dir, place = Cam.pick(cam, x0, y0);
    const g = Cam.grab(cam, x0, y0);
    let maxLat = 0;
    // drag the place a long way down (north pole) or up (south pole), in small steps, then sideways
    for (let k = 1; k <= 180; k++) {
      const x = x0 + (k > 140 ? (k - 140) * 3 : 0), y = y0 + dir * Math.min(k, 140) * 4;
      Cam.drag(cam, g, x, y, k * 16);
      close(Cam.pick(cam, x, y), place, 1e-6, `step ${k}`);
      maxLat = Math.max(maxLat, dir * cam.lat);
      if (Math.abs(cam.lat) < 89) assert.equal(cam.heading, 0, 'north up');
    }
    assert.ok(maxLat > 90, `crossed the pole (lat reached ${maxLat})`);
    // let go: the view turns north up about its centre
    const centre = Cam.pick(cam, 600, 400);
    Cam.release(cam, g, 10000);
    for (let k = 0; k < 100 && Cam.step(cam, 16);) k++;
    assert.equal(cam.heading, 0);
    assert.ok(Math.abs(cam.lat) <= 90);
    close(Cam.pick(cam, 600, 400), centre, 1e-6, 'the centre stays');
    assert.ok(Cam.toScreen(cam, cam.lat - 1, cam.lon)[1] > 400, 'north up again');
  }
});

test('grabbing off the globe takes its rim; grabbing at the pole itself', () => {
  const cam = Cam.create({ w: 1000, h: 1000, lat: 89.9, lon: 0 });
  const g = Cam.grab(cam, 500, 500);
  for (let k = 1; k < 50; k++) Cam.drag(cam, g, 500 + k * 7, 500 - k * 5, k * 16);
  assert.ok(Number.isFinite(cam.lat) && Number.isFinite(cam.lon));
  const g2 = Cam.grab(cam, 2, 2);
  Cam.drag(cam, g2, 300, 300, 0);
  assert.ok(Number.isFinite(cam.lat) && Number.isFinite(cam.lon));
});

test('zoom keeps the place under the pointer, within its limits', () => {
  for (const projection of ['globe', 'flat']) {
    const cam = Cam.create({ w: 1667, h: 1013, lat: 10, lon: -40, projection });
    // (the whole flat map is centred on the equator: zoom in a little before holding a place)
    if (projection === 'flat') for (let k = 0; k < 8; k++) Cam.zoomAt(cam, 1100, 400, 0.9);
    const place = Cam.pick(cam, 1100, 400);
    for (let k = 0; k < 200; k++) {
      Cam.zoomAt(cam, 1100, 400, 0.9);
      close(Cam.pick(cam, 1100, 400), place, 1e-5, `${projection} zoom ${k}`);
    }
    assert.equal(cam.alt, Cam.MIN_ALT, 'stops at the closest');
    for (let k = 0; k < 300; k++) Cam.zoomAt(cam, 1100, 400, 1.2);
    assert.equal(cam.alt, Cam.limits(cam)[1], 'and at the farthest');
  }
});

test('the flat map pans, wraps in longitude and stays within the poles', () => {
  const cam = Cam.create({ w: 1000, h: 500, projection: 'flat', lat: 0, lon: 0 });
  assert.deepEqual(Cam.pick(cam, 500, 250).map((v) => +v.toFixed(6)), [0, 0]);
  close(Cam.pick(cam, 0.001, 250), [0, -180], 0.01, 'whole width');
  Cam.zoomAt(cam, 500, 250, 0.25);
  const g = Cam.grab(cam, 500, 250);
  for (let k = 1; k <= 60; k++) Cam.drag(cam, g, 500 - k * 40, 250, k * 16);   // far east, over the date line
  assert.ok(cam.lon >= -180 && cam.lon < 180);
  Cam.drag(cam, g, 500, 5000, 2000);                                           // far south
  assert.ok(Cam.pick(cam, 500, 0)[0] <= 90 + 1e-9, 'no sky above the pole');
});

test('a fling carries on and slows to a stop; a slow release does not', () => {
  const cam = Cam.create({ w: 1000, h: 800 });
  const g = Cam.grab(cam, 500, 400);
  for (let k = 0; k <= 6; k++) Cam.drag(cam, g, 500 + k * 30, 400, 1000 + k * 10);
  Cam.release(cam, g, 1060);
  const lon0 = cam.lon; let n = 0;
  while (Cam.step(cam, 16) && n < 1000) n++;
  assert.ok(n > 10 && n < 1000, `${n} frames`);
  assert.ok(Math.abs(cam.lon - lon0) > 5, 'it turned on');
  const g2 = Cam.grab(cam, 500, 400);
  Cam.drag(cam, g2, 510, 400, 2000);
  Cam.release(cam, g2, 2500);
  assert.equal(Cam.step(cam, 16), false);
});

test('resizing keeps the default view; switching projection keeps the centre', () => {
  const cam = Cam.create({ w: 800, h: 640, lat: 30, lon: 60 });
  Cam.resize(cam, 1600, 900);
  assert.ok(Math.abs(cam.alt - Cam.fitAlt(cam)) < 1e-12);
  Cam.setProjection(cam, 'flat'); Cam.resize(cam, 1600, 800);
  close(Cam.pick(cam, 0.001, 400), [0, -180 + 60], 0.5, 'the whole map, centred on 60°');
  Cam.setProjection(cam, 'globe');
  assert.ok(Math.abs(cam.lon - 60) < 1e-9);
});

test('zoomed in on the flat map, shapes keep their proportions and the grabbed place stays put', () => {
  const cam = Cam.create({ w: 1200, h: 800, projection: 'flat', lat: 60, lon: 20 });
  cam.alt = Cam.altForSpan(cam, 10); cam.auto = false; cam.lat = 60; Cam.resize(cam, 1200, 800);
  assert.ok(Math.abs(Cam.stretch(cam) - Math.cos(60 * Math.PI / 180)) < 0.01, `stretch ${Cam.stretch(cam)}`);
  // a degree east is as long on screen as a degree's worth of km north
  const a = Cam.toScreen(cam, 60, 20), b = Cam.toScreen(cam, 60, 21), c = Cam.toScreen(cam, 60.5, 20);
  assert.ok(Math.abs((b[0] - a[0]) - 2 * Math.cos(60 * Math.PI / 180) * (a[1] - c[1])) < 0.5);
  const place = Cam.pick(cam, 300, 200), g = Cam.grab(cam, 300, 200);
  for (let k = 1; k <= 40; k++) { Cam.drag(cam, g, 300 + k * 9, 200 + k * 7, k * 16); close(Cam.pick(cam, 300 + k * 9, 200 + k * 7), place, 1e-6, `step ${k}`); }
  // the whole map: no stretch
  const whole = Cam.create({ w: 1200, h: 600, projection: 'flat' });
  assert.equal(Cam.stretch(whole), 1);
});

test('eased zoom, pinch and panning keep their places', () => {
  for (const projection of ['globe', 'flat']) {
    const cam = Cam.create({ w: 1000, h: 700, lat: 30, lon: 10, projection, minAlt: 0.0005 });
    if (projection === 'flat') { cam.alt = Cam.altForSpan(cam, 60); cam.auto = false; }
    const place = Cam.pick(cam, 700, 300);
    Cam.zoomBy(cam, 700, 300, 0.25);
    let n = 0; while (Cam.step(cam, 16) && n < 200) n++;
    assert.ok(n > 5 && n < 200);
    close(Cam.pick(cam, 700, 300), place, 1e-5, `${projection} zoomBy`);
    // two fingers spread from (400, 300)-(600, 400) to (300, 250)-(700, 450), the midpoint moving
    const mid = Cam.pick(cam, 500, 350), g = Cam.grab(cam, 500, 350);
    Cam.pinch(cam, g, 520, 360, Math.hypot(200, 100) / Math.hypot(400, 200));
    close(Cam.pick(cam, 520, 360), mid, 1e-6, `${projection} pinch`);
    // the closest it goes is the viewer's own limit
    for (let k = 0; k < 200; k++) Cam.zoomAt(cam, 500, 350, 0.8);
    assert.equal(cam.alt, 0.0005);
    const c0 = Cam.pick(cam, 500, 350);
    Cam.panBy(cam, 100, 0);
    close(Cam.pick(cam, 600, 350), c0, 1e-6, `${projection} panBy`);
  }
});
