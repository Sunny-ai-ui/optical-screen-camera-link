import test from 'node:test';
import assert from 'node:assert/strict';
import { AdaptiveLinkController, evidenceTargetForScore } from './adaptive-link.js';

test('evidence target decreases as measured link quality improves', () => {
  assert.equal(evidenceTargetForScore(0.9), 1);
  assert.equal(evidenceTargetForScore(0.8), 2);
  assert.equal(evidenceTargetForScore(0.7), 3);
  assert.equal(evidenceTargetForScore(0.55), 4);
  assert.equal(evidenceTargetForScore(0.2), 6);
});

test('controller recommends downgrade only after sustained poor evidence', () => {
  const controller = new AdaptiveLinkController({ downgradeStreak: 3 });
  let status;
  for (let i = 0; i < 2; i += 1) {
    status = controller.add({ profileId: 'V3-G64-S4-C4-RS15-11', frameQuality: 0.2, cellAgreement: 0.2, rsFailed: true });
    assert.equal(status.recommendation, 'hold');
  }
  status = controller.add({ profileId: 'V3-G64-S4-C4-RS15-11', frameQuality: 0.2, cellAgreement: 0.2, rsFailed: true });
  assert.equal(status.recommendation, 'fallback');
  assert.equal(status.recommendedProfileId, 'V3-G48-S4-C4-RS15-11');
});

test('controller recommends upgrade only after sustained clean decoding', () => {
  const controller = new AdaptiveLinkController({ upgradeStreak: 4 });
  let status;
  for (let i = 0; i < 4; i += 1) {
    status = controller.add({
      profileId: 'V3-G32-S4-C4-RS15-11',
      frameQuality: 0.98,
      cellAgreement: 0.98,
      averageConfidence: 0.98,
      pixelsPerCell: 18,
      decoded: true,
      rsBlocks: 10,
      correctedSymbols: 0,
      erasuresUsed: 0,
    });
  }
  assert.equal(status.recommendation, 'upgrade');
  assert.equal(status.recommendedProfileId, 'V3-G48-S4-C4-RS15-11');
});
