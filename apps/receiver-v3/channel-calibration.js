function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p)));
  return sorted[index];
}

function avg(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

/**
 * Learns receiver-side channel characteristics from successful optical observations.
 * It intentionally does not change the wire format or per-frame colour/shape references.
 */
export class ChannelCalibrator {
  constructor({ windowSize = 48, readySamples = 10 } = {}) {
    this.windowSize = windowSize;
    this.readySamples = readySamples;
    this.reset();
  }

  reset() {
    this.samples = [];
    this.decodeSuccesses = 0;
    this.decodeFailures = 0;
  }

  addObservation({
    timingSeparation = 0,
    signatureSeparation = 0,
    averageShapeConfidence = 0,
    averageColorConfidence = 0,
    averageConfidence = 0,
    pixelsPerCell = 0,
    frameQuality = 0,
  } = {}) {
    const sample = {
      timingSeparation: Math.max(0, Number(timingSeparation) || 0),
      signatureSeparation: Math.max(0, Number(signatureSeparation) || 0),
      averageShapeConfidence: clamp(averageShapeConfidence, 0, 1),
      averageColorConfidence: clamp(averageColorConfidence, 0, 1),
      averageConfidence: clamp(averageConfidence, 0, 1),
      pixelsPerCell: Math.max(0, Number(pixelsPerCell) || 0),
      frameQuality: clamp(frameQuality, 0, 1),
    };
    this.samples.push(sample);
    if (this.samples.length > this.windowSize) this.samples.shift();
    return this.summary();
  }

  addDecodeResult(success) {
    if (success) this.decodeSuccesses += 1;
    else this.decodeFailures += 1;
    return this.summary();
  }

  minimumFrameQuality() {
    if (this.samples.length < this.readySamples) return 0.42;
    const q20 = percentile(this.samples.map((item) => item.frameQuality), 0.20);
    return clamp(q20 * 0.82, 0.34, 0.58);
  }

  summary() {
    const timing = this.samples.map((item) => item.timingSeparation);
    const signature = this.samples.map((item) => item.signatureSeparation);
    const shape = this.samples.map((item) => item.averageShapeConfidence);
    const colour = this.samples.map((item) => item.averageColorConfidence);
    const confidence = this.samples.map((item) => item.averageConfidence);
    const pixels = this.samples.map((item) => item.pixelsPerCell);
    const frameQuality = this.samples.map((item) => item.frameQuality);
    const decodeTotal = this.decodeSuccesses + this.decodeFailures;
    return {
      state: this.samples.length >= this.readySamples ? 'ready' : 'learning',
      samples: this.samples.length,
      readySamples: this.readySamples,
      minimumFrameQuality: this.minimumFrameQuality(),
      timingP20: percentile(timing, 0.20),
      timingMedian: percentile(timing, 0.50),
      signatureP20: percentile(signature, 0.20),
      signatureMedian: percentile(signature, 0.50),
      shapeConfidence: avg(shape),
      colourConfidence: avg(colour),
      averageConfidence: avg(confidence),
      pixelsPerCell: percentile(pixels, 0.50),
      frameQuality: avg(frameQuality),
      decodeSuccessRate: decodeTotal ? this.decodeSuccesses / decodeTotal : 0,
      decodeSamples: decodeTotal,
    };
  }
}
