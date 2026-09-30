import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeLink } from './link-optimizer.js';

test('optimizer recommends faster settings only for sustained strong link', () => {
  const result = optimizeLink({
    profileId: 'V3-G32-S4-C4-RS15-11',
    linkStatus: { score: 0.95 },
    calibration: { decodeSuccessRate: 1, averageConfidence: 0.94, decodeSamples: 12 },
  });
  assert.equal(result.mode, 'fast-stable');
  assert.equal(result.recommendedProfileId, 'V3-G48-S4-C4-RS15-11');
  assert.ok(result.recommendedFountainOverhead < 1);
});

test('optimizer falls back and adds redundancy on weak link', () => {
  const result = optimizeLink({
    profileId: 'V3-G64-S4-C4-RS15-11',
    linkStatus: { score: 0.25 },
    calibration: { decodeSuccessRate: 0.2, averageConfidence: 0.35, decodeSamples: 10 },
  });
  assert.equal(result.mode, 'recovery');
  assert.equal(result.recommendedProfileId, 'V3-G48-S4-C4-RS15-11');
  assert.equal(result.recommendedFountainOverhead, 1.5);
});


test('optimizer can tune dwell and redundancy while profile remains locked to G32', () => {
  const result = optimizeLink({
    profileId: 'V3-G32-S4-C4-RS15-11',
    lockedProfileId: 'V3-G32-S4-C4-RS15-11',
    linkStatus: { score: 0.96 },
    calibration: { decodeSuccessRate: 1, averageConfidence: 0.96, decodeSamples: 12 },
  });
  assert.equal(result.recommendedProfileId, 'V3-G32-S4-C4-RS15-11');
  assert.equal(result.mode, 'fast-stable');
  assert.ok(result.recommendedFountainOverhead < 1);
});
