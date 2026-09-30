import { V22_S8_C8_B4_R3, getDataCellCoordinates } from '../../packages/optical-codec/src/profiles.js';
import { joinS8C8B4Byte } from '../../packages/optical-codec/src/v22-frame.js';
import { detectOrientation } from './decoder.js';

function mapPixel(x, y, rotation, size) {
  switch (rotation) {
    case 0: return { x, y };
    case 90: return { x: size - 1 - y, y: x };
    case 180: return { x: size - 1 - x, y: size - 1 - y };
    case 270: return { x: y, y: size - 1 - x };
    default: throw new RangeError(`Unsupported rotation ${rotation}`);
  }
}

function sampleLogicalRegion(imageData, x0, y0, x1, y1, rotation, size) {
  let r = 0; let g = 0; let b = 0; let count = 0;
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const mapped = mapPixel(x, y, rotation, size);
      const offset = ((mapped.y * imageData.width) + mapped.x) * 4;
      r += imageData.data[offset];
      g += imageData.data[offset + 1];
      b += imageData.data[offset + 2];
      count += 1;
    }
  }
  return [r / count, g / count, b / count];
}

function luma(rgb) {
  return (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2]);
}

function rgbDistance(a, b) {
  const dr = a[0] - b[0]; const dg = a[1] - b[1]; const db = a[2] - b[2];
  return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
}

function sampleCellBackground(imageData, cellX, cellY, rotation, profile = V22_S8_C8_B4_R3) {
  const baseX = cellX * profile.cellSize;
  const baseY = cellY * profile.cellSize;
  const patches = [
    [baseX + 1, baseY + 1, baseX + 3, baseY + 3],
    [baseX + 13, baseY + 1, baseX + 15, baseY + 3],
    [baseX + 1, baseY + 13, baseX + 3, baseY + 15],
    [baseX + 13, baseY + 13, baseX + 15, baseY + 15],
  ];
  const samples = patches.map(([x0, y0, x1, y1]) =>
    sampleLogicalRegion(imageData, x0, y0, x1, y1, rotation, profile.logicalSize));
  return [0, 1, 2].map((channel) => samples.reduce((sum, rgb) => sum + rgb[channel], 0) / samples.length);
}

function normalizeVector(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + (value * value), 0));
  if (norm < 1e-8) return values.map(() => 0);
  return values.map((value) => value / norm);
}

function squaredDistance(a, b) {
  return a.reduce((sum, value, index) => sum + ((value - b[index]) ** 2), 0);
}

function colorVector(rgb) {
  const total = Math.max(1, rgb[0] + rgb[1] + rgb[2]);
  return [rgb[0] / total, rgb[1] / total, rgb[2] / total];
}

function buildColorCalibration(imageData, rotation, profile = V22_S8_C8_B4_R3) {
  return Array.from({ length: profile.colorCount }, (_, colorIndex) => {
    const x = profile.colorCalibrationStartX + colorIndex;
    const y = profile.channelCalibrationRow;
    const baseX = x * profile.cellSize;
    const baseY = y * profile.cellSize;
    const rgb = sampleLogicalRegion(imageData, baseX + 4, baseY + 4, baseX + 12, baseY + 12, rotation, profile.logicalSize);
    return { colorIndex, vector: colorVector(rgb), rgb };
  });
}

function classifyColor(rgb, calibration) {
  const vector = colorVector(rgb);
  const ranked = calibration.map((reference) => ({
    colorIndex: reference.colorIndex,
    distance: squaredDistance(vector, reference.vector),
  })).sort((a, b) => a.distance - b.distance);
  const best = ranked[0]; const second = ranked[1];
  const confidence = second.distance <= 1e-12 ? 0 : Math.max(0, Math.min(1, 1 - (best.distance / second.distance)));
  return { ...best, confidence };
}

function buildBackgroundCalibration(imageData, rotation, profile = V22_S8_C8_B4_R3) {
  return Array.from({ length: profile.backgroundCount }, (_, backgroundIndex) => {
    const x = profile.backgroundCalibrationStartX + backgroundIndex;
    const y = profile.channelCalibrationRow;
    const rgb = sampleCellBackground(imageData, x, y, rotation, profile);
    return { backgroundIndex, value: luma(rgb), rgb };
  });
}

function classifyBackground(rgb, calibration) {
  const value = luma(rgb);
  const ranked = calibration.map((reference) => ({
    backgroundIndex: reference.backgroundIndex,
    distance: Math.abs(value - reference.value),
  })).sort((a, b) => a.distance - b.distance);
  const best = ranked[0]; const second = ranked[1];
  const confidence = second.distance <= 1e-9 ? 0 : Math.max(0, Math.min(1, 1 - (best.distance / second.distance)));
  return { ...best, confidence };
}

// V2.2 shapes are extracted by RGB distance from the locally measured neutral
// background. This is less dependent on glyph luminance than a luma-only mask.
function extractShapeFeature(imageData, cellX, cellY, rotation, profile = V22_S8_C8_B4_R3) {
  const background = sampleCellBackground(imageData, cellX, cellY, rotation, profile);
  const baseX = cellX * profile.cellSize;
  const baseY = cellY * profile.cellSize;
  const values = [];
  for (let gy = 0; gy < 5; gy += 1) {
    for (let gx = 0; gx < 5; gx += 1) {
      const x0 = baseX + 3 + (gx * 2);
      const y0 = baseY + 3 + (gy * 2);
      const rgb = sampleLogicalRegion(imageData, x0, y0, x0 + 2, y0 + 2, rotation, profile.logicalSize);
      values.push(rgbDistance(rgb, background) / 442);
    }
  }
  return normalizeVector(values);
}

function buildShapeCalibration(imageData, rotation, profile = V22_S8_C8_B4_R3) {
  return Array.from({ length: profile.shapeCount }, (_, shapeId) => ({
    shapeId,
    feature: extractShapeFeature(imageData, profile.shapeCalibrationStartX + shapeId, profile.shapeCalibrationRow, rotation, profile),
  }));
}

function classifyShape(feature, calibration) {
  const ranked = calibration.map((reference) => ({
    shapeId: reference.shapeId,
    distance: squaredDistance(feature, reference.feature),
  })).sort((a, b) => a.distance - b.distance);
  const best = ranked[0]; const second = ranked[1];
  const confidence = second.distance <= 1e-12 ? 0 : Math.max(0, Math.min(1, 1 - (best.distance / second.distance)));
  return { ...best, confidence };
}

// Background and halo are neutral, while the foreground glyph is saturated.
// Selecting the most chromatic pixels lets us measure colour without knowing
// the current visual-variant shape permutation.
function sampleForegroundColor(imageData, cellX, cellY, rotation, profile = V22_S8_C8_B4_R3) {
  const baseX = cellX * profile.cellSize;
  const baseY = cellY * profile.cellSize;
  const candidates = [];
  for (let y = baseY + 2; y < baseY + 14; y += 1) {
    for (let x = baseX + 2; x < baseX + 14; x += 1) {
      const mapped = mapPixel(x, y, rotation, profile.logicalSize);
      const offset = ((mapped.y * imageData.width) + mapped.x) * 4;
      const rgb = [imageData.data[offset], imageData.data[offset + 1], imageData.data[offset + 2]];
      const max = Math.max(...rgb); const min = Math.min(...rgb);
      const chroma = max - min;
      if (chroma >= 28) candidates.push({ rgb, chroma });
    }
  }
  candidates.sort((a, b) => b.chroma - a.chroma);
  const selected = candidates.slice(0, 48);
  if (!selected.length) return sampleCellBackground(imageData, cellX, cellY, rotation, profile);
  return [0, 1, 2].map((channel) => selected.reduce((sum, item) => sum + item.rgb[channel], 0) / selected.length);
}

function sampleSolidCellLuma(imageData, cellX, cellY, rotation, profile = V22_S8_C8_B4_R3) {
  const baseX = cellX * profile.cellSize;
  const baseY = cellY * profile.cellSize;
  return luma(sampleLogicalRegion(imageData, baseX + 4, baseY + 4, baseX + 12, baseY + 12, rotation, profile.logicalSize));
}

export function scoreV22Signature(imageData, rotation, profile = V22_S8_C8_B4_R3) {
  const dark = []; const light = [];
  profile.profileSignatureBits.forEach((bit, index) => {
    const value = sampleSolidCellLuma(imageData, profile.profileSignatureStartX + index, profile.profileSignatureRow, rotation, profile);
    (bit ? dark : light).push(value);
  });
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const darkMean = mean(dark); const lightMean = mean(light);
  return { separation: lightMean - darkMean, darkMean, lightMean };
}

export function detectV22Profile(roiCanvas, profile = V22_S8_C8_B4_R3) {
  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, roiCanvas.width, roiCanvas.height);
  const orientation = detectOrientation(imageData, profile);
  const signature = scoreV22Signature(imageData, orientation.rotation, profile);
  return {
    isV22: signature.separation > 75 && signature.darkMean < 135 && signature.lightMean > 150,
    orientation,
    signature,
  };
}

function componentVote(copies, key, distanceKey) {
  const counts = new Map();
  for (const copy of copies) counts.set(copy[key], (counts.get(copy[key]) ?? 0) + 1);
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [value, count] = ranked[0];
  if (count >= 2) return { value, corrected: counts.size > 1, uncorrectable: false };
  const best = copies.reduce((a, b) => (a[distanceKey] <= b[distanceKey] ? a : b));
  return { value: best[key], corrected: false, uncorrectable: true };
}

export function recoverS8C8B4Copies(classifications, profile = V22_S8_C8_B4_R3) {
  if (classifications.length !== profile.encodedByteCapacity) throw new RangeError('V2.2 classification count mismatch');
  const bytes = new Uint8Array(profile.dataByteCapacity);
  let shapeCorrections = 0; let colorCorrections = 0; let backgroundCorrections = 0;
  let shapeUncorrectable = 0; let colorUncorrectable = 0; let backgroundUncorrectable = 0;

  for (let i = 0; i < bytes.length; i += 1) {
    const copies = Array.from({ length: profile.repetition }, (_, copy) => classifications[i + (copy * bytes.length)]);
    const shape = componentVote(copies, 'shapeId', 'shapeDistance');
    const color = componentVote(copies, 'colorIndex', 'colorDistance');
    const background = componentVote(copies, 'backgroundIndex', 'backgroundDistance');
    if (shape.corrected) shapeCorrections += 1;
    if (color.corrected) colorCorrections += 1;
    if (background.corrected) backgroundCorrections += 1;
    if (shape.uncorrectable) shapeUncorrectable += 1;
    if (color.uncorrectable) colorUncorrectable += 1;
    if (background.uncorrectable) backgroundUncorrectable += 1;
    bytes[i] = joinS8C8B4Byte(shape.value, color.value, background.value);
  }

  return {
    bytes,
    shapeCorrections,
    colorCorrections,
    backgroundCorrections,
    shapeUncorrectable,
    colorUncorrectable,
    backgroundUncorrectable,
  };
}

export function decodeS8C8B4Roi(roiCanvas, profile = V22_S8_C8_B4_R3) {
  if (!(roiCanvas instanceof HTMLCanvasElement)) throw new TypeError('decodeS8C8B4Roi expects a canvas');
  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, roiCanvas.width, roiCanvas.height);
  const orientation = detectOrientation(imageData, profile);
  if (orientation.separation < 55) throw new Error(`Finder contrast too low (${orientation.separation.toFixed(1)})`);
  const signature = scoreV22Signature(imageData, orientation.rotation, profile);
  if (signature.separation < 75) throw new Error(`V2.2 profile signature too weak (${signature.separation.toFixed(1)})`);

  const shapeCalibration = buildShapeCalibration(imageData, orientation.rotation, profile);
  const colorCalibration = buildColorCalibration(imageData, orientation.rotation, profile);
  const backgroundCalibration = buildBackgroundCalibration(imageData, orientation.rotation, profile);
  const coordinates = getDataCellCoordinates(profile).slice(0, profile.encodedByteCapacity);
  const classifications = [];
  let shapeConfidenceSum = 0; let colorConfidenceSum = 0; let backgroundConfidenceSum = 0;

  coordinates.forEach(({ x, y }) => {
    const backgroundRgb = sampleCellBackground(imageData, x, y, orientation.rotation, profile);
    const background = classifyBackground(backgroundRgb, backgroundCalibration);
    const shape = classifyShape(extractShapeFeature(imageData, x, y, orientation.rotation, profile), shapeCalibration);
    const color = classifyColor(sampleForegroundColor(imageData, x, y, orientation.rotation, profile), colorCalibration);
    classifications.push({
      shapeId: shape.shapeId,
      colorIndex: color.colorIndex,
      backgroundIndex: background.backgroundIndex,
      shapeDistance: shape.distance,
      colorDistance: color.distance,
      backgroundDistance: background.distance,
      shapeConfidence: shape.confidence,
      colorConfidence: color.confidence,
      backgroundConfidence: background.confidence,
    });
    shapeConfidenceSum += shape.confidence;
    colorConfidenceSum += color.confidence;
    backgroundConfidenceSum += background.confidence;
  });

  const recovery = recoverS8C8B4Copies(classifications, profile);
  const envelope = recovery.bytes;
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const packetLength = view.getUint16(0, false);
  if (packetLength < 1 || packetLength > profile.maxPacketBytes) throw new Error(`Invalid decoded V2.2 packet length ${packetLength}`);

  return {
    profileId: profile.id,
    packetBytes: envelope.slice(profile.lengthPrefixBytes, profile.lengthPrefixBytes + packetLength),
    rotation: orientation.rotation,
    finderSeparation: orientation.separation,
    signatureSeparation: signature.separation,
    averageConfidence: ((shapeConfidenceSum + colorConfidenceSum + backgroundConfidenceSum) / 3) / classifications.length,
    averageShapeConfidence: shapeConfidenceSum / classifications.length,
    averageColorConfidence: colorConfidenceSum / classifications.length,
    averageBackgroundConfidence: backgroundConfidenceSum / classifications.length,
    shapeCorrections: recovery.shapeCorrections,
    colorCorrections: recovery.colorCorrections,
    backgroundCorrections: recovery.backgroundCorrections,
    shapeUncorrectable: recovery.shapeUncorrectable,
    colorUncorrectable: recovery.colorUncorrectable,
    backgroundUncorrectable: recovery.backgroundUncorrectable,
  };
}
