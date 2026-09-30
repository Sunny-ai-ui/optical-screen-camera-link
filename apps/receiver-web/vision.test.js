import test from 'node:test';
import assert from 'node:assert/strict';

import { getV1FiducialCenters } from '../../packages/optical-codec/src/fiducials.js';
import {
  computePointHomography,
  computeSquareToQuadHomography,
  detectFiducialsFromImageData,
  getCenteredGuideRect,
  mapPerspectivePoint,
  validateCornerQuad,
} from './vision.js';

test('centered guide is square and centered in a landscape frame', () => {
  const guide = getCenteredGuideRect(640, 480, 0.82);
  assert.equal(guide.width, 393);
  assert.equal(guide.height, 393);
  assert.equal(guide.x, 123);
  assert.equal(guide.y, 43);
});

test('centered guide uses the smaller dimension in portrait', () => {
  const guide = getCenteredGuideRect(360, 640, 0.8);
  assert.deepEqual(guide, { x: 36, y: 176, width: 288, height: 288 });
});

test('invalid guide coverage is rejected', () => {
  assert.throws(() => getCenteredGuideRect(640, 480, 0));
  assert.throws(() => getCenteredGuideRect(640, 480, 1.1));
});

test('V1 quiet-zone fiducials do not overlap the 256x256 logical ROI', () => {
  assert.deepEqual(getV1FiducialCenters(), [
    { name: 'TL', x: 12, y: 12 },
    { name: 'TR', x: 292, y: 12 },
    { name: 'BR', x: 292, y: 292 },
    { name: 'BL', x: 12, y: 292 },
  ]);
});

test('square-to-quad homography maps all four output corners correctly', () => {
  const corners = [
    { x: 100, y: 50 },
    { x: 500, y: 70 },
    { x: 470, y: 390 },
    { x: 120, y: 420 },
  ];
  const size = 304;
  const h = computeSquareToQuadHomography(corners, size);
  const samples = [[0, 0], [size - 1, 0], [size - 1, size - 1], [0, size - 1]];
  samples.forEach(([u, v], index) => {
    const mapped = mapPerspectivePoint(h, u, v);
    assert.ok(Math.abs(mapped.x - corners[index].x) < 1e-6);
    assert.ok(Math.abs(mapped.y - corners[index].y) < 1e-6);
  });
});

test('point homography maps known fiducial centres to source detections', () => {
  const target = getV1FiducialCenters().map(({ x, y }) => ({ x, y }));
  const source = [
    { x: 80, y: 35 },
    { x: 430, y: 60 },
    { x: 400, y: 330 },
    { x: 95, y: 355 },
  ];
  const h = computePointHomography(target, source);
  target.forEach((point, index) => {
    const mapped = mapPerspectivePoint(h, point.x, point.y);
    assert.ok(Math.abs(mapped.x - source[index].x) < 1e-6);
    assert.ok(Math.abs(mapped.y - source[index].y) < 1e-6);
  });
});

test('corner quad validation rejects degenerate selections', () => {
  assert.equal(validateCornerQuad([
    { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
  ]), true);
  assert.equal(validateCornerQuad([
    { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 20, y: 0 }, { x: 30, y: 0 },
  ]), false);
});

function syntheticImage(width, height, background = 105) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const o = i * 4;
    data[o] = background;
    data[o + 1] = background;
    data[o + 2] = background;
    data[o + 3] = 255;
  }

  const fillSquare = (cx, cy, size, value) => {
    const half = Math.floor(size / 2);
    for (let y = cy - half; y < cy + half; y += 1) {
      for (let x = cx - half; x < cx + half; x += 1) {
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const o = ((y * width) + x) * 4;
        data[o] = value;
        data[o + 1] = value;
        data[o + 2] = value;
      }
    }
  };

  const bullseye = (cx, cy, size = 20) => {
    fillSquare(cx, cy, size, 0);
    fillSquare(cx, cy, Math.round(size * (10 / 18)), 255);
    fillSquare(cx, cy, Math.max(4, Math.round(size * (4 / 18))), 0);
  };

  return { width, height, data, bullseye };
}

test('automatic detector finds and orders four synthetic optical locators', () => {
  const image = syntheticImage(320, 240);
  const expected = [
    { x: 60, y: 40 },
    { x: 260, y: 50 },
    { x: 250, y: 200 },
    { x: 55, y: 190 },
  ];
  expected.forEach((point) => image.bullseye(point.x, point.y, 20));

  const detection = detectFiducialsFromImageData(image);
  assert.ok(detection, 'expected four-locator detection');
  assert.equal(detection.corners.length, 4);
  detection.corners.forEach((point, index) => {
    assert.ok(Math.hypot(point.x - expected[index].x, point.y - expected[index].y) <= 8,
      `locator ${index} should be near expected position`);
  });
});
