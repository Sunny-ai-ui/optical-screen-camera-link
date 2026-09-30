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
  if (!observation?.confidences || !calibration || calibration.state !== 'ready') return observation;
  const expectedShape = Math.max(0.2, calibration.shapeConfidence || 0.2);
  const expectedColour = Math.max(0.2, calibration.colourConfidence || 0.2);
  const shapeRatio = clamp((observation.averageShapeConfidence || 0) / expectedShape, 0.55, 1.08);
  const colourRatio = clamp((observation.averageColorConfidence || 0) / expectedColour, 0.55, 1.08);
  const globalScale = Math.min(shapeRatio, colourRatio);
  if (globalScale >= 0.995) return observation;

  const shapeConfidences = new Float32Array(observation.shapeConfidences.length);
  const colorConfidences = new Float32Array(observation.colorConfidences.length);
  const confidences = new Float32Array(observation.confidences.length);
  let shapeSum = 0;
  let colourSum = 0;
  let combinedSum = 0;
  for (let i = 0; i < confidences.length; i += 1) {
    shapeConfidences[i] = clamp(observation.shapeConfidences[i] * shapeRatio, 0, 1);
    colorConfidences[i] = clamp(observation.colorConfidences[i] * colourRatio, 0, 1);
    confidences[i] = Math.min(shapeConfidences[i], colorConfidences[i]);
    shapeSum += shapeConfidences[i];
    colourSum += colorConfidences[i];
    combinedSum += confidences[i];
  }
  return {
    ...observation,
    shapeConfidences,
    colorConfidences,
    confidences,
    averageShapeConfidence: shapeSum / Math.max(1, confidences.length),
    averageColorConfidence: colourSum / Math.max(1, confidences.length),
    averageConfidence: combinedSum / Math.max(1, confidences.length),
    calibrationConfidenceScale: globalScale,
  };
}
