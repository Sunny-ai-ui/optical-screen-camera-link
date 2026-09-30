import { joinV3Nibble } from '../../packages/constellation/src/v3.js';

function assertCompatible(observations) {
  if (!Array.isArray(observations) || observations.length === 0) throw new TypeError('At least one V3 observation is required');
  const profileId = observations[0].profileId;
  const length = observations[0].symbols.length;
  for (const observation of observations) {
    if (observation.profileId !== profileId) throw new Error('Cannot fuse different V3 profiles');
    if (observation.symbols.length !== length) throw new Error('Cannot fuse observations with different symbol counts');
  }
  return { profileId, length };
}

function weightedWinner(values, confidences, stateCount) {
  const scores = new Float64Array(stateCount);
  const support = new Uint16Array(stateCount);
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isInteger(value) || value < 0 || value >= stateCount) continue;
    const confidence = Number.isFinite(confidences[i]) ? Math.max(0, Math.min(1, confidences[i])) : 0;
    scores[value] += Math.max(0.01, confidence);
    support[value] += 1;
  }
  let best = 0;
  let second = 0;
  for (let i = 1; i < scores.length; i += 1) {
    if (scores[i] > scores[best]) {
      second = best;
      best = i;
    } else if (i !== best && scores[i] > scores[second]) {
      second = i;
    }
  }
  const total = scores.reduce((sum, value) => sum + value, 0);
  const margin = scores[best] - (scores[second] || 0);
  const confidence = total > 0 ? Math.max(0, Math.min(1, (scores[best] / total) * 0.7 + (margin / total) * 0.3)) : 0;
  return { value: best, confidence, support: support[best], score: scores[best] };
}

export function observationAgreement(a, b, indices = null) {
  if (!a || !b || a.profileId !== b.profileId || a.symbols.length !== b.symbols.length) return 0;
  let weightedMatches = 0;
  let weightedTotal = 0;
  const positions = indices ?? Array.from({ length: a.symbols.length }, (_, i) => i);
  for (const i of positions) {
    const weight = Math.max(0.05, Math.min(a.confidences?.[i] ?? 0, b.confidences?.[i] ?? 0));
    weightedTotal += weight;
    if (a.symbols[i] === b.symbols[i]) weightedMatches += weight;
  }
  return weightedTotal ? weightedMatches / weightedTotal : 0;
}

export function fuseV3Observations(observations) {
  const { profileId, length } = assertCompatible(observations);
  const symbols = new Uint8Array(length);
  const shapeIds = new Uint8Array(length);
  const colorIds = new Uint8Array(length);
  const shapeConfidences = new Float32Array(length);
  const colorConfidences = new Float32Array(length);
  const confidences = new Float32Array(length);
  let agreementSum = 0;

  for (let index = 0; index < length; index += 1) {
    const shapeValues = observations.map((item) => item.shapeIds?.[index] ?? (item.symbols[index] >>> 2));
    const colorValues = observations.map((item) => item.colorIds?.[index] ?? (item.symbols[index] & 0x03));
    const shapeWeights = observations.map((item) => item.shapeConfidences?.[index] ?? item.confidences?.[index] ?? 0);
    const colorWeights = observations.map((item) => item.colorConfidences?.[index] ?? item.confidences?.[index] ?? 0);
    const shape = weightedWinner(shapeValues, shapeWeights, 4);
    const color = weightedWinner(colorValues, colorWeights, 4);
    shapeIds[index] = shape.value;
    colorIds[index] = color.value;
    symbols[index] = joinV3Nibble(shape.value, color.value);
    shapeConfidences[index] = shape.confidence;
    colorConfidences[index] = color.confidence;
    confidences[index] = Math.min(shape.confidence, color.confidence);
    agreementSum += (shape.support + color.support) / (observations.length * 2);
  }

  const mean = (key) => observations.reduce((sum, item) => sum + (Number(item[key]) || 0), 0) / observations.length;
  return {
    profileId,
    rotation: observations[observations.length - 1].rotation,
    symbols,
    shapeIds,
    colorIds,
    shapeConfidences,
    colorConfidences,
    confidences,
    timingSeparation: mean('timingSeparation'),
    signatureSeparation: mean('signatureSeparation'),
    phaseX: Math.round(mean('phaseX')),
    phaseY: Math.round(mean('phaseY')),
    averageShapeConfidence: shapeConfidences.reduce((a, b) => a + b, 0) / length,
    averageColorConfidence: colorConfidences.reduce((a, b) => a + b, 0) / length,
    averageConfidence: confidences.reduce((a, b) => a + b, 0) / length,
    observationCount: observations.length,
    cellAgreement: agreementSum / length,
  };
}

export class TemporalObservationStore {
  constructor({ maxObservations = 6, maxAgeMs = 1200, minAgreement = 0.72, identityIndices = null } = {}) {
    this.maxObservations = maxObservations;
    this.maxAgeMs = maxAgeMs;
    this.minAgreement = minAgreement;
    this.identityIndices = identityIndices;
    this.reset();
  }

  reset() {
    this.observations = [];
    this.startedAt = null;
    this.profileId = null;
    this.transitions = 0;
  }

  add(observation, now = performance.now()) {
    if (!observation) throw new TypeError('Observation required');
    const expired = this.startedAt !== null && now - this.startedAt > this.maxAgeMs;
    const profileChanged = this.profileId && this.profileId !== observation.profileId;
    const agreement = this.observations.length ? observationAgreement(this.observations[this.observations.length - 1], observation, this.identityIndices) : 1;
    const transition = this.observations.length > 0 && agreement < this.minAgreement;
    if (expired || profileChanged || transition) {
      if (transition) this.transitions += 1;
      this.observations = [];
      this.startedAt = null;
    }
    if (this.startedAt === null) this.startedAt = now;
    this.profileId = observation.profileId;
    this.observations.push(observation);
    if (this.observations.length > this.maxObservations) this.observations.shift();
    return { count: this.observations.length, agreement, transition, fused: fuseV3Observations(this.observations) };
  }
}
