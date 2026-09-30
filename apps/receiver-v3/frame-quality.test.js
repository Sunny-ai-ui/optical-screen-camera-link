import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreV3FrameQuality, shouldDecodeObservation } from './frame-quality.js';

test('quality scorer rewards strong timing, resolution and confidence', () => {
  const strong = scoreV3FrameQuality({ timingSeparation: 80, signatureSeparation: 35, pixelsPerCell: 16, averageConfidence: 0.9 });
  const weak = scoreV3FrameQuality({ timingSeparation: 25, signatureSeparation: 8, pixelsPerCell: 5, averageConfidence: 0.2 });
  assert.ok(strong > weak);
  assert.equal(shouldDecodeObservation(strong), true);
  assert.equal(shouldDecodeObservation(weak), false);
});
