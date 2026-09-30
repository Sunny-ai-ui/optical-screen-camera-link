const PROFILE_ORDER = ['V3-G32-S4-C4-RS15-11', 'V3-G48-S4-C4-RS15-11', 'V3-G64-S4-C4-RS15-11'];

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function profileIndex(profileId) {
  const index = PROFILE_ORDER.indexOf(profileId);
  return index < 0 ? 0 : index;
}

function nextLower(profileId) {
  return PROFILE_ORDER[Math.max(0, profileIndex(profileId) - 1)];
}

function nextHigher(profileId) {
  return PROFILE_ORDER[Math.min(PROFILE_ORDER.length - 1, profileIndex(profileId) + 1)];
}

export function classifyLinkSample({
  profileId,
  frameQuality = 0,
  cellAgreement = 0,
  averageConfidence = 0,
  pixelsPerCell = 0,
  correctedSymbols = 0,
  erasuresUsed = 0,
  rsBlocks = 0,
  decoded = false,
} = {}) {
  const quality = clamp01(frameQuality);
  const agreement = clamp01(cellAgreement);
  const confidence = clamp01(averageConfidence);
  const pxTarget = profileId?.includes('G64') ? 8 : profileId?.includes('G48') ? 10 : 12;
  const resolution = clamp01(pixelsPerCell / pxTarget);
  const correctionLoad = rsBlocks > 0 ? clamp01((correctedSymbols + erasuresUsed * 0.5) / Math.max(1, rsBlocks * 2)) : 0;
  const decodeBonus = decoded ? 1 : 0;
  const score = clamp01(
    quality * 0.26
    + agreement * 0.22
    + confidence * 0.22
    + resolution * 0.16
    + decodeBonus * 0.14
    - correctionLoad * 0.16
  );
  return { score, correctionLoad, resolution };
}

export function evidenceTargetForScore(score) {
  if (score >= 0.88) return 1;
  if (score >= 0.76) return 2;
  if (score >= 0.64) return 3;
  if (score >= 0.52) return 4;
  return 6;
}

export class AdaptiveLinkController {
  constructor({ windowSize = 12, upgradeStreak = 8, downgradeStreak = 3, lockedProfileId = null } = {}) {
    this.windowSize = windowSize;
    this.upgradeStreakNeeded = upgradeStreak;
    this.downgradeStreakNeeded = downgradeStreak;
    this.lockedProfileId = lockedProfileId;
    this.reset();
  }

  reset() {
    this.samples = [];
    this.goodStreak = 0;
    this.badStreak = 0;
    this.lastRecommendation = null;
  }

  add(sample) {
    const classified = classifyLinkSample(sample);
    const item = { ...sample, ...classified };
    this.samples.push(item);
    if (this.samples.length > this.windowSize) this.samples.shift();

    if (classified.score >= 0.82 && sample.decoded) {
      this.goodStreak += 1;
      this.badStreak = 0;
    } else if (classified.score < 0.50 || sample.rsFailed) {
      this.badStreak += 1;
      this.goodStreak = 0;
    } else {
      this.goodStreak = Math.max(0, this.goodStreak - 1);
      this.badStreak = Math.max(0, this.badStreak - 1);
    }

    return this.status(sample.profileId);
  }

  status(profileId = this.samples.at(-1)?.profileId ?? PROFILE_ORDER[0]) {
    if (this.lockedProfileId) profileId = this.lockedProfileId;
    const average = this.samples.length
      ? this.samples.reduce((sum, item) => sum + item.score, 0) / this.samples.length
      : 0;
    const evidenceTarget = evidenceTargetForScore(average);
    let recommendation = 'hold';
    let recommendedProfileId = profileId;

    if (this.lockedProfileId) {
      recommendation = 'hold';
      recommendedProfileId = this.lockedProfileId;
    } else if (this.badStreak >= this.downgradeStreakNeeded && profileIndex(profileId) > 0) {
      recommendation = 'fallback';
      recommendedProfileId = nextLower(profileId);
    } else if (this.goodStreak >= this.upgradeStreakNeeded && profileIndex(profileId) < PROFILE_ORDER.length - 1) {
      recommendation = 'upgrade';
      recommendedProfileId = nextHigher(profileId);
    }

    this.lastRecommendation = recommendation;
    return {
      score: clamp01(average),
      evidenceTarget,
      recommendation,
      recommendedProfileId,
      goodStreak: this.goodStreak,
      badStreak: this.badStreak,
      samples: this.samples.length,
    };
  }
}

export const V3_PROFILE_ORDER = Object.freeze([...PROFILE_ORDER]);
