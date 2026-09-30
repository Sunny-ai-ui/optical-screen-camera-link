import { V21_S8_C16_R3, getDataCellCoordinates } from '../../packages/optical-codec/src/profiles.js';
import { sevenBitSymbolsToBytes } from '../../packages/optical-codec/src/v21-frame.js';
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

function sampleCellBackground(imageData, cellX, cellY, rotation, profile = V21_S8_C16_R3) {
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

function colorVector(rgb) {
  const total = Math.max(1, rgb[0] + rgb[1] + rgb[2]);
  return [rgb[0] / total, rgb[1] / total, rgb[2] / total, (luma(rgb) / 255) * 0.28];
}

function normalizeVector(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (norm < 1e-8) return values.map(() => 0);
  return values.map((value) => value / norm);
}

function squaredDistance(a, b) {
  return a.reduce((sum, value, index) => sum + ((value - b[index]) ** 2), 0);
}

function buildColorCalibration(imageData, rotation, profile = V21_S8_C16_R3) {
  return Array.from({ length: profile.colorCount }, (_, colorIndex) => {
    const rgb = sampleCellBackground(imageData, colorIndex, profile.colorCalibrationRows[0], rotation, profile);
    return { colorIndex, vector: colorVector(rgb) };
  });
}

function classifyColor(rgb, calibration) {
  const vector = colorVector(rgb);
  const ranked = calibration.map((reference) => ({
    colorIndex: reference.colorIndex,
    distance: squaredDistance(vector, reference.vector),
  })).sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const second = ranked[1];
  const confidence = second.distance <= 1e-12 ? 0 : Math.max(0, Math.min(1, 1 - best.distance / second.distance));
  return { ...best, confidence };
}

function extractShapeFeature(imageData, cellX, cellY, rotation, profile = V21_S8_C16_R3) {
  const background = sampleCellBackground(imageData, cellX, cellY, rotation, profile);
  const backgroundLuma = luma(background);
  const baseX = cellX * profile.cellSize;
  const baseY = cellY * profile.cellSize;
  const values = [];
  for (let gy = 0; gy < 5; gy += 1) {
    for (let gx = 0; gx < 5; gx += 1) {
      const x0 = baseX + 3 + gx * 2;
      const y0 = baseY + 3 + gy * 2;
      const rgb = sampleLogicalRegion(imageData, x0, y0, x0 + 2, y0 + 2, rotation, profile.logicalSize);
      values.push(Math.abs(luma(rgb) - backgroundLuma) / 255);
    }
  }
  return normalizeVector(values);
}

function buildShapeCalibration(imageData, rotation, profile = V21_S8_C16_R3) {
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
  const best = ranked[0];
  const second = ranked[1];
  const confidence = second.distance <= 1e-12 ? 0 : Math.max(0, Math.min(1, 1 - best.distance / second.distance));
  return { ...best, confidence };
}

function sampleSolidCellLuma(imageData, cellX, cellY, rotation, profile = V21_S8_C16_R3) {
  const baseX = cellX * profile.cellSize;
  const baseY = cellY * profile.cellSize;
  return luma(sampleLogicalRegion(imageData, baseX + 4, baseY + 4, baseX + 12, baseY + 12, rotation, profile.logicalSize));
}

export function scoreV21Signature(imageData, rotation, profile = V21_S8_C16_R3) {
  const dark = []; const light = [];
  profile.profileSignatureBits.forEach((bit, index) => {
    const value = sampleSolidCellLuma(imageData, profile.profileSignatureStartX + index, profile.profileSignatureRow, rotation, profile);
    (bit ? dark : light).push(value);
  });
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const darkMean = mean(dark); const lightMean = mean(light);
  return { separation: lightMean - darkMean, darkMean, lightMean };
}

export function detectV21Profile(roiCanvas, profile = V21_S8_C16_R3) {
  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, roiCanvas.width, roiCanvas.height);
  const orientation = detectOrientation(imageData, profile);
  const signature = scoreV21Signature(imageData, orientation.rotation, profile);
  return {
    isV21: signature.separation > 75 && signature.darkMean < 135 && signature.lightMean > 150,
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

export function recoverS8C16Copies(classifications, profile = V21_S8_C16_R3) {
  if (classifications.length !== profile.encodedSymbolCapacity) throw new RangeError('V2.1 classification count mismatch');
  const symbols = new Uint8Array(profile.logicalSymbolCapacity);
  let shapeCorrections = 0; let colorCorrections = 0; let shapeUncorrectable = 0; let colorUncorrectable = 0;
  for (let i = 0; i < symbols.length; i += 1) {
    const copies = Array.from({ length: profile.repetition }, (_, copy) =>
      classifications[i + copy * profile.logicalSymbolCapacity]);
    const shape = componentVote(copies, 'shapeId', 'shapeDistance');
    const color = componentVote(copies, 'colorIndex', 'colorDistance');
    if (shape.corrected) shapeCorrections += 1;
    if (color.corrected) colorCorrections += 1;
    if (shape.uncorrectable) shapeUncorrectable += 1;
    if (color.uncorrectable) colorUncorrectable += 1;
    symbols[i] = (shape.value << 4) | color.value;
  }
  return { symbols, shapeCorrections, colorCorrections, shapeUncorrectable, colorUncorrectable };
}

export function decodeS8C16Roi(roiCanvas, profile = V21_S8_C16_R3) {
  if (!(roiCanvas instanceof HTMLCanvasElement)) throw new TypeError('decodeS8C16Roi expects a canvas');
  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, roiCanvas.width, roiCanvas.height);
  const orientation = detectOrientation(imageData, profile);
  if (orientation.separation < 55) throw new Error(`Finder contrast too low (${orientation.separation.toFixed(1)})`);
  const signature = scoreV21Signature(imageData, orientation.rotation, profile);
  if (signature.separation < 75) throw new Error(`V2.1 profile signature too weak (${signature.separation.toFixed(1)})`);

  const colorCalibration = buildColorCalibration(imageData, orientation.rotation, profile);
  const shapeCalibration = buildShapeCalibration(imageData, orientation.rotation, profile);
  const coordinates = getDataCellCoordinates(profile).slice(0, profile.encodedSymbolCapacity);
  const classifications = [];
  let colorConfidenceSum = 0; let shapeConfidenceSum = 0;

  coordinates.forEach(({ x, y }) => {
    const color = classifyColor(sampleCellBackground(imageData, x, y, orientation.rotation, profile), colorCalibration);
    const shape = classifyShape(extractShapeFeature(imageData, x, y, orientation.rotation, profile), shapeCalibration);
    classifications.push({
      shapeId: shape.shapeId,
      colorIndex: color.colorIndex,
      shapeDistance: shape.distance,
      colorDistance: color.distance,
      shapeConfidence: shape.confidence,
      colorConfidence: color.confidence,
    });
    shapeConfidenceSum += shape.confidence;
    colorConfidenceSum += color.confidence;
  });

  const recovery = recoverS8C16Copies(classifications, profile);
  const envelope = sevenBitSymbolsToBytes(recovery.symbols, profile.dataByteCapacity);
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const packetLength = view.getUint16(0, false);
  if (packetLength < 1 || packetLength > profile.maxPacketBytes) throw new Error(`Invalid decoded V2.1 packet length ${packetLength}`);

  return {
    profileId: profile.id,
    packetBytes: envelope.slice(profile.lengthPrefixBytes, profile.lengthPrefixBytes + packetLength),
    rotation: orientation.rotation,
    finderSeparation: orientation.separation,
    signatureSeparation: signature.separation,
    averageConfidence: ((shapeConfidenceSum + colorConfidenceSum) / 2) / classifications.length,
    averageShapeConfidence: shapeConfidenceSum / classifications.length,
    averageColorConfidence: colorConfidenceSum / classifications.length,
    shapeCorrections: recovery.shapeCorrections,
    colorCorrections: recovery.colorCorrections,
    shapeUncorrectable: recovery.shapeUncorrectable,
    colorUncorrectable: recovery.colorUncorrectable,
  };
}
