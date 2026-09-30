import test from 'node:test';
import assert from 'node:assert/strict';

import { C16 } from '../../packages/constellation/src/c16.js';
import { classifyRgb, detectOrientation } from './decoder.js';

function cameraTransform(rgb) {
  return [
    Math.min(255, (rgb[0] * 0.82) + 17),
    Math.min(255, (rgb[1] * 1.03) + 6),
    Math.min(255, (rgb[2] * 0.91) + 11),
  ];
}

test('C16 nearest-centroid decoder tolerates a consistent screen-camera colour shift', () => {
  const calibration = C16.map(({ symbol, rgb }) => {
    const observed = cameraTransform(rgb);
    const total = observed[0] + observed[1] + observed[2];
    return {
      symbol,
      rgb: observed,
      vector: [
        observed[0] / total,
        observed[1] / total,
        observed[2] / total,
        (total / (255 * 3)) * 0.12,
      ],
    };
  });

  for (const reference of C16) {
    const observed = cameraTransform(reference.rgb).map((value, channel) => (
      Math.max(0, Math.min(255, value + ((reference.symbol + channel) % 3) - 1))
    ));
    const result = classifyRgb(observed, calibration);
    assert.equal(result.symbol, reference.symbol, `failed symbol ${reference.symbol}`);
  }
});

function blankImageData(width = 256, height = 256, value = 128) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function paintCell(imageData, cellX, cellY, value) {
  const cellSize = 16;
  for (let y = cellY * cellSize; y < (cellY + 1) * cellSize; y += 1) {
    for (let x = cellX * cellSize; x < (cellX + 1) * cellSize; x += 1) {
      const offset = ((y * imageData.width) + x) * 4;
      imageData.data[offset] = value;
      imageData.data[offset + 1] = value;
      imageData.data[offset + 2] = value;
    }
  }
}

test('finder patterns identify the upright optical-frame orientation', () => {
  const image = blankImageData();
  const patterns = {
    TL: [[1, 1], [1, 0]],
    TR: [[1, 0], [1, 1]],
    BL: [[1, 1], [0, 1]],
    BR: [[0, 1], [1, 1]],
  };
  const positions = {
    TL: [0, 0],
    TR: [14, 0],
    BL: [0, 14],
    BR: [14, 14],
  };

  for (const [corner, pattern] of Object.entries(patterns)) {
    const [x0, y0] = positions[corner];
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        paintCell(image, x0 + dx, y0 + dy, pattern[dy][dx] ? 5 : 250);
      }
    }
  }

  const result = detectOrientation(image);
  assert.equal(result.rotation, 0);
  assert.ok(result.separation > 200);
});
