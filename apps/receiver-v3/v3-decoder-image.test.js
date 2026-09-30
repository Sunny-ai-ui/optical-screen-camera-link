import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeV3Frame } from '../../packages/optical-codec/src/v3-frame.js';
import { V3_G32_S4_C4_RS } from '../../packages/optical-codec/src/profiles.js';
import { getV3Color, getV3Shape, v3Luminance } from '../../packages/constellation/src/v3.js';
import { decodeV3Observation, observeV3ImageData } from './v3-decoder.js';

function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }
function shifted(rgb) { return [clamp(rgb[0] * 0.82 + 13), clamp(rgb[1] * 1.08 + 5), clamp(rgb[2] * 1.18)]; }

function setPixel(data, width, x, y, rgb) {
  const i = ((y * width) + x) * 4;
  data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
}

function renderFrame(frame) {
  const { logicalSize: width, cellSize } = frame;
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y += 1) for (let x = 0; x < width; x += 1) setPixel(data, width, x, y, shifted([216, 216, 216]));
  for (const row of frame.cells) {
    for (const cell of row) {
      let background = [216, 216, 216];
      if (cell.kind === 'finder' || cell.kind === 'profile-signature' || cell.kind === 'v3-timing') background = cell.dark ? [0, 0, 0] : [255, 255, 255];
      else if (cell.kind === 'v3-color-calibration' || cell.kind === 'v3-data') background = getV3Color(cell.colorIndex).rgb;
      else if (cell.kind === 'v3-shape-calibration') background = [184, 184, 184];
      const bg = shifted(background);
      const x0 = Math.round(cell.x * cellSize); const y0 = Math.round(cell.y * cellSize);
      const x1 = Math.round((cell.x + 1) * cellSize); const y1 = Math.round((cell.y + 1) * cellSize);
      for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) setPixel(data, width, x, y, bg);
      if (cell.kind === 'v3-shape-calibration' || cell.kind === 'v3-data') {
        const shape = getV3Shape(cell.shapeId);
        const glyph = cell.kind === 'v3-data' && v3Luminance(background) < 135 ? [255, 255, 255] : [5, 5, 5];
        const fg = shifted(glyph);
        const module = cellSize / 3;
        shape.mask.forEach((maskRow, gy) => [...maskRow].forEach((bit, gx) => {
          if (bit !== '1') return;
          const sx0 = Math.round(cell.x * cellSize + gx * module);
          const sy0 = Math.round(cell.y * cellSize + gy * module);
          const sx1 = Math.round(cell.x * cellSize + (gx + 1) * module);
          const sy1 = Math.round(cell.y * cellSize + (gy + 1) * module);
          for (let y = sy0; y < sy1; y += 1) for (let x = sx0; x < sx1; x += 1) setPixel(data, width, x, y, fg);
        }));
      }
    }
  }
  return { width, height: width, data };
}

test('V3 image decoder survives a consistent camera-like channel colour shift', () => {
  const packet = Uint8Array.from({ length: 120 }, (_, i) => (i * 29 + 17) & 0xFF);
  const frame = encodeV3Frame(packet, V3_G32_S4_C4_RS);
  const observation = observeV3ImageData(renderFrame(frame), 0, V3_G32_S4_C4_RS);
  const decoded = decodeV3Observation(observation, V3_G32_S4_C4_RS);
  assert.deepEqual([...decoded.packetBytes], [...packet]);
  assert.ok(observation.averageColorConfidence > 0.65);
  assert.ok(observation.averageShapeConfidence > 0.45);
});
