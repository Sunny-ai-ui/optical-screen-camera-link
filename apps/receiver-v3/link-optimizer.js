import { V3_PROFILE_ORDER } from './adaptive-link.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function profileIndex(profileId) {
  const index = V3_PROFILE_ORDER.indexOf(profileId);
  return index < 0 ? 0 : index;
}

function profileAt(index) {
  return V3_PROFILE_ORDER[Math.max(0, Math.min(V3_PROFILE_ORDER.length - 1, index))];
}

const BASE_DWELL = Object.freeze({
  'V3-G32-S4-C4-RS15-11': 700,
  'V3-G48-S4-C4-RS15-11': 900,
  'V3-G64-S4-C4-RS15-11': 1200,
});

/**
 * Produces a conservative sender recommendation from receiver measurements.
 * The current optical link is one-way, so these settings are recommendations,
 * not remote commands.
 */
export function optimizeLink({ profileId, linkStatus = {}, calibration = {}, fountainProgress = 0 } = {}) {
  const score = clamp(linkStatus.score ?? 0, 0, 1);
  const successRate = clamp(calibration.decodeSuccessRate ?? 0, 0, 1);
  const confidence = clamp(calibration.averageConfidence ?? 0, 0, 1);
  const agreementScore = score * 0.55 + successRate * 0.25 + confidence * 0.20;
  const currentIndex = profileIndex(profileId);

  let recommendedProfileId = profileId || profileAt(0);
  let dwellMultiplier = 1;
  let overheadRatio = 1.0;
  let mode = 'balanced';

  if (agreementScore >= 0.88 && (calibration.decodeSamples ?? 0) >= 8) {
    recommendedProfileId = profileAt(currentIndex + 1);
    dwellMultiplier = 0.82;
    overheadRatio = 0.55;
    mode = 'fast-stable';
  } else if (agreementScore >= 0.74) {
    dwellMultiplier = 0.95;
    overheadRatio = 0.75;
    mode = 'stable';
  } else if (agreementScore >= 0.58) {
    dwellMultiplier = 1.12;
    overheadRatio = 1.0;
    mode = 'robust';
  } else {
    recommendedProfileId = profileAt(currentIndex - 1);
    dwellMultiplier = 1.35;
    overheadRatio = 1.5;
    mode = 'recovery';
  }

  if (fountainProgress > 0.8 && agreementScore >= 0.72) overheadRatio = Math.min(overheadRatio, 0.75);

  const baseDwell = BASE_DWELL[recommendedProfileId] ?? 1000;
  const recommendedDwellMs = Math.round(clamp(baseDwell * dwellMultiplier, 400, 2200) / 50) * 50;

  return {
    mode,
    score: clamp(agreementScore, 0, 1),
    recommendedProfileId,
    recommendedDwellMs,
    recommendedFountainOverhead: Math.round(overheadRatio * 100) / 100,
  };
}
