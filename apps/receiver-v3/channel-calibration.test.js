import test from 'node:test';
import assert from 'node:assert/strict';
import { ChannelCalibrator } from './channel-calibration.js';

test('channel calibrator learns a bounded observation acceptance threshold', () => {
  const calibration = new ChannelCalibrator({ readySamples: 5 });
  for (const quality of [0.72, 0.76, 0.81, 0.74, 0.79, 0.77]) {
    calibration.addObservation({ timingSeparation: 70, signatureSeparation: 32, averageShapeConfidence: 0.8, averageColorConfidence: 0.84, averageConfidence: 0.8, pixelsPerCell: 16, frameQuality: quality });
  }
  const status = calibration.summary();
  assert.equal(status.state, 'ready');
  assert.ok(status.minimumFrameQuality >= 0.34 && status.minimumFrameQuality <= 0.58);
  assert.ok(status.timingMedian >= 70);
});

test('channel calibrator tracks decode success rate', () => {
  const calibration = new ChannelCalibrator();
  calibration.addDecodeResult(true);
  calibration.addDecodeResult(true);
  calibration.addDecodeResult(false);
  assert.equal(calibration.summary().decodeSamples, 3);
  assert.ok(Math.abs(calibration.summary().decodeSuccessRate - 2 / 3) < 1e-9);
});
