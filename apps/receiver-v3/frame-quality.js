export function scoreV3FrameQuality({ timingSeparation = 0, signatureSeparation = 0, pixelsPerCell = 0, averageConfidence = 0, lowConfidenceCellRate = 0 } = {}) {
  const timing = Math.max(0, Math.min(1, (timingSeparation - 20) / 80));
  const signature = Math.max(0, Math.min(1, (signatureSeparation - 6) / 50));
  const resolution = Math.max(0, Math.min(1, (pixelsPerCell - 5) / 15));
  const confidence = Math.max(0, Math.min(1, averageConfidence));
  const ambiguityPenalty = Math.max(0, Math.min(0.20, lowConfidenceCellRate * 0.25));
  return Math.max(0, Math.min(1, timing * 0.28 + signature * 0.18 + resolution * 0.20 + confidence * 0.34 - ambiguityPenalty));
}

export function shouldDecodeObservation(quality, minimum = 0.42, tolerance = 0) {
  const slack = Number.isFinite(tolerance) ? Math.max(0, tolerance) : 0;
  return Number.isFinite(quality) && quality + slack >= minimum;
}

