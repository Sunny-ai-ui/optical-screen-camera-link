function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

/**
 * Size the temporal observation lifetime from the measured optical-decoder cost.
 * Slow phones need several seconds to collect enough independent observations;
 * a fixed ~1.2 s lifetime makes high evidence targets unreachable.
 */
export function computeTemporalWindowMs({ decoderLatencyMs = 0, evidenceTarget = 4 } = {}) {
  const latency = clamp(decoderLatencyMs || 650, 250, 1600);
  const target = Math.round(clamp(evidenceTarget, 1, 6));
  // Leave room for target observations, capture scheduling jitter, and one retry.
  return Math.round(clamp((latency * (target + 1) * 1.28) + 450, 2200, 8500));
}

/** Small tolerance prevents learned-gate jitter from discarding otherwise useful evidence. */
export function qualityGateTolerance(calibrationState = 'learning') {
  return calibrationState === 'ready' ? 0.03 : 0.015;
}

/**
 * Start RS progressively when an observation is close to/above the learned gate.
 * If the first attempt fails, later observations remain in the group and retries
 * continue toward the full adaptive target.
 */
export function progressiveEvidenceTarget({
  evidenceTarget = 4,
  frameQuality = 0,
  learnedMinimum = 0.42,
  averageConfidence = 0,
} = {}) {
  let target = Math.round(clamp(evidenceTarget, 1, 6));
  const quality = clamp(frameQuality, 0, 1);
  const confidence = clamp(averageConfidence, 0, 1);

  if (quality >= learnedMinimum - 0.03 && confidence >= 0.62) target = Math.min(target, 4);
  if (quality >= learnedMinimum + 0.10 && confidence >= 0.76) target = Math.min(target, 3);
  return target;
}

/** Delay the next tracking/decode pass while the worker is occupied. */
export function computeBusyLoopDelayMs(decoderLatencyMs = 0) {
  const latency = clamp(decoderLatencyMs || 500, 250, 1600);
  return Math.round(clamp(latency * 0.82, 220, 900));
}

/**
 * Prevent a single noisy coarse signature from changing density. The receiver
 * remains one-way; this only stabilizes its local interpretation of the sender.
 */
export class ProfileLockController {
  constructor({ switchStreak = 4 } = {}) {
    this.switchStreak = Math.max(2, Math.round(switchStreak));
    this.reset();
  }

  reset() {
    this.candidateProfileId = null;
    this.candidateStreak = 0;
  }

  consider(probe, activeProfileId = null) {
    if (!probe?.isV3 || !probe?.profile?.id) {
      this.reset();
      return { accepted: false, switched: false, candidateStreak: 0, candidateProfileId: null };
    }

    const profileId = probe.profile.id;
    if (!activeProfileId) {
      this.reset();
      return { accepted: true, switched: true, profileId, candidateStreak: 0, candidateProfileId: null };
    }
    if (profileId === activeProfileId) {
      this.reset();
      return { accepted: true, switched: false, profileId, candidateStreak: 0, candidateProfileId: null };
    }

    if (this.candidateProfileId === profileId) this.candidateStreak += 1;
    else {
      this.candidateProfileId = profileId;
      this.candidateStreak = 1;
    }

    if (this.candidateStreak >= this.switchStreak) {
      this.reset();
      return { accepted: true, switched: true, profileId, candidateStreak: this.switchStreak, candidateProfileId: profileId };
    }
    return {
      accepted: false,
      switched: false,
      profileId: activeProfileId,
      candidateStreak: this.candidateStreak,
      candidateProfileId: profileId,
    };
  }
}
