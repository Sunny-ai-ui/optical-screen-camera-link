import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBusyLoopDelayMs,
  computeTemporalWindowMs,
  ProfileLockController,
  progressiveEvidenceTarget,
  qualityGateTolerance,
} from './receiver-policy.js';

test('temporal window grows enough for slow-phone six-observation collection', () => {
  const windowMs = computeTemporalWindowMs({ decoderLatencyMs: 920, evidenceTarget: 6 });
  assert.ok(windowMs >= 6000, `expected >= 6000 ms, got ${windowMs}`);
  assert.ok(windowMs <= 8500);
});

test('progressive evidence allows an early four-observation RS attempt near the learned gate', () => {
  assert.equal(progressiveEvidenceTarget({ evidenceTarget: 6, frameQuality: 0.563, learnedMinimum: 0.57, averageConfidence: 0.684 }), 4);
  assert.equal(progressiveEvidenceTarget({ evidenceTarget: 6, frameQuality: 0.80, learnedMinimum: 0.57, averageConfidence: 0.82 }), 3);
});

test('ready calibration receives a small quality-gate tolerance', () => {
  assert.equal(qualityGateTolerance('ready'), 0.03);
  assert.equal(qualityGateTolerance('learning'), 0.015);
});

test('busy-loop delay follows measured decoder latency without skip storms', () => {
  assert.ok(computeBusyLoopDelayMs(738) >= 550);
  assert.ok(computeBusyLoopDelayMs(920) >= 700);
});

test('profile lock requires repeated evidence before changing density', () => {
  const lock = new ProfileLockController({ switchStreak: 4 });
  const probe = (id) => ({ isV3: true, profile: { id } });
  assert.equal(lock.consider(probe('G32'), null).accepted, true);
  for (let i = 1; i <= 3; i += 1) {
    const result = lock.consider(probe('G64'), 'G32');
    assert.equal(result.accepted, false);
    assert.equal(result.candidateStreak, i);
  }
  const switched = lock.consider(probe('G64'), 'G32');
  assert.equal(switched.accepted, true);
  assert.equal(switched.switched, true);
  assert.equal(switched.profileId, 'G64');
});
