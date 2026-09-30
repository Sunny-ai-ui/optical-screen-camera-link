function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

/** Derive conservative decoder gates from the learned physical channel. */
export function deriveDecoderTuning(calibration = null) {
  if (!calibration || calibration.state !== 'ready') {
    return { timingMinimum: 30, signatureMinimum: 10, confidenceScale: 1 };
  }
  return {
    timingMinimum: clamp((calibration.timingP20 || calibration.timingMedian || 30) * 0.58, 20, 36),
    signatureMinimum: clamp((calibration.signatureP20 || calibration.signatureMedian || 10) * 0.58, 6, 14),
    confidenceScale: clamp(0.72 + (calibration.decodeSuccessRate || 0) * 0.38, 0.72, 1.10),
  };
}

/**
 * Penalize a whole observation when its confidence falls well below the
 * channel's learned normal level. This feeds more honest confidence to RS
 * erasure selection without changing the wire format.
 */
export function calibrateObservationConfidences(observation, calibration = null) {
  if (!observation?.confidences) return observation;
  if (!calibration || calibration.state !== 'ready') {
    return { ...observation, calibrationConfidenceScale: 1, channelConfidenceRatio: 1 };
  }

  const expectedShape = Math.max(0.2, calibration.shapeConfidence || 0.2);
  const expectedColour = Math.max(0.2, calibration.colourConfidence || 0.2);
  const shapeRatio = clamp((observation.averageShapeConfidence || 0) / expectedShape, 0.55, 1.20);
  const colourRatio = clamp((observation.averageColorConfidence || 0) / expectedColour, 0.55, 1.20);
  const channelConfidenceRatio = Math.min(shapeRatio, colourRatio);

  // v0.4.3 deliberately stops multiplying every cell by one global factor.
  // The optical classifier already produces per-cell confidence, and a global
  // penalty was turning locally good cells into erasures when one region of the
  // screen was weak. Keep the channel ratio as a diagnostic only.
  return {
    ...observation,
    calibrationConfidenceScale: 1,
    channelConfidenceRatio,
  };
}
