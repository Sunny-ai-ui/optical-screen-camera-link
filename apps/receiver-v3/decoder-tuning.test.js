import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateObservationConfidences, deriveDecoderTuning } from './decoder-tuning.js';

test('decoder tuning remains conservative while calibration is learning', () => {
  assert.deepEqual(deriveDecoderTuning({ state: 'learning' }), { timingMinimum: 30, signatureMinimum: 10, confidenceScale: 1 });
});

test('decoder tuning derives bounded gates from a ready calibration', () => {
  const tuning = deriveDecoderTuning({ state: 'ready', timingP20: 80, signatureP20: 30, decodeSuccessRate: 0.9 });
  assert.equal(tuning.timingMinimum, 36);
  assert.equal(tuning.signatureMinimum, 14);
  assert.ok(tuning.confidenceScale > 1);
});

test('ready calibration preserves per-cell confidence and records channel ratio only', () => {
  const observation = {
    confidences: new Float32Array([0.6, 0.5]),
    shapeConfidences: new Float32Array([0.7, 0.6]),
    colorConfidences: new Float32Array([0.6, 0.5]),
    averageShapeConfidence: 0.65,
    averageColorConfidence: 0.55,
  };
  const calibrated = calibrateObservationConfidences(observation, {
    state: 'ready', shapeConfidence: 0.9, colourConfidence: 0.9,
  });
  assert.deepEqual([...calibrated.confidences], [...observation.confidences]);
  assert.equal(calibrated.calibrationConfidenceScale, 1);
  assert.ok(calibrated.channelConfidenceRatio < 1);
});
