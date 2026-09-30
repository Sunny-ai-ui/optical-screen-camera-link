import { getV3Color, joinV3Nibble } from '../../packages/constellation/src/v3.js';
import { V3_G64_S4_C4_RS, getV3DataCellCoordinates } from '../../packages/optical-codec/src/profiles.js';
import { recoverV3PacketFromSymbolsWithAlternates } from '../../packages/optical-codec/src/v3-frame.js';

function mapPixel(x, y, rotation, size) {
  switch (rotation) {
    case 0: return { x, y };
    case 90: return { x: size - 1 - y, y: x };
    case 180: return { x: size - 1 - x, y: size - 1 - y };
    case 270: return { x: y, y: size - 1 - x };
    default: throw new RangeError(`Unsupported rotation ${rotation}`);
  }
}

export function sampleRegion(imageData, x0, y0, x1, y1, rotation = 0) {
  let r = 0; let g = 0; let b = 0; let count = 0;
  const size = imageData.width;
  const sx0 = Math.max(0, Math.floor(x0));
  const sy0 = Math.max(0, Math.floor(y0));
  const sx1 = Math.min(size, Math.ceil(x1));
  const sy1 = Math.min(size, Math.ceil(y1));
  for (let y = sy0; y < sy1; y += 1) {
    for (let x = sx0; x < sx1; x += 1) {
      const mapped = mapPixel(x, y, rotation, size);
      const offset = ((mapped.y * imageData.width) + mapped.x) * 4;
      r += imageData.data[offset];
      g += imageData.data[offset + 1];
      b += imageData.data[offset + 2];
      count += 1;
    }
  }
  if (!count) return [0, 0, 0];
  return [r / count, g / count, b / count];
}

export function samplePointBilinear(imageData, x, y, rotation = 0) {
  const size = imageData.width;
  const clampedX = Math.max(0, Math.min(size - 1.001, x));
  const clampedY = Math.max(0, Math.min(size - 1.001, y));
  const x0 = Math.floor(clampedX);
  const y0 = Math.floor(clampedY);
  const x1 = Math.min(size - 1, x0 + 1);
  const y1 = Math.min(size - 1, y0 + 1);
  const fx = clampedX - x0;
  const fy = clampedY - y0;
  const pixel = (px, py) => {
    const mapped = mapPixel(px, py, rotation, size);
    const offset = ((mapped.y * imageData.width) + mapped.x) * 4;
    return [imageData.data[offset], imageData.data[offset + 1], imageData.data[offset + 2]];
  };
  const a = pixel(x0, y0);
  const b = pixel(x1, y0);
  const c = pixel(x0, y1);
  const d = pixel(x1, y1);
  return [0, 1, 2].map((channel) => {
    const top = a[channel] * (1 - fx) + b[channel] * fx;
    const bottom = c[channel] * (1 - fx) + d[channel] * fx;
    return top * (1 - fy) + bottom * fy;
  });
}

function sampleRegionBilinear(imageData, x0, y0, x1, y1, rotation = 0, samplesPerAxis = 4) {
  const width = Math.max(0.001, x1 - x0);
  const height = Math.max(0.001, y1 - y0);
  const values = [];
  for (let gy = 0; gy < samplesPerAxis; gy += 1) {
    for (let gx = 0; gx < samplesPerAxis; gx += 1) {
      values.push(samplePointBilinear(
        imageData,
        x0 + ((gx + 0.5) / samplesPerAxis) * width,
        y0 + ((gy + 0.5) / samplesPerAxis) * height,
        rotation,
      ));
    }
  }
  return [0, 1, 2].map((channel) => mean(values.map((rgb) => rgb[channel])));
}

function trimmedMean(values, trimFraction = 0.15) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const trim = Math.min(Math.floor(sorted.length * trimFraction), Math.floor((sorted.length - 1) / 2));
  const kept = sorted.slice(trim, sorted.length - trim);
  return mean(kept);
}

export function luma(rgb) {
  return (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2]);
}

export function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function coarseCellLuma(imageData, cellX, cellY, rotation, cellSize = 4, dx = 0, dy = 0) {
  const x = (cellX * cellSize) + dx;
  const y = (cellY * cellSize) + dy;
  const pad = Math.max(0.6, cellSize * 0.24);
  return luma(sampleRegion(imageData, x + pad, y + pad, x + cellSize - pad, y + cellSize - pad, rotation));
}

function scoreCoarseRotation(imageData, rotation, dx, dy, profile = V3_G64_S4_C4_RS) {
  const dark = [];
  const light = [];
  const cellSize = imageData.width / profile.gridSize;
  const last = profile.gridSize - 1;

  for (let x = 0; x < profile.gridSize; x += 2) {
    dark.push(coarseCellLuma(imageData, x, 0, rotation, cellSize, dx, dy));
    dark.push(coarseCellLuma(imageData, x, last, rotation, cellSize, dx, dy));
    if (x + 1 < profile.gridSize) {
      light.push(coarseCellLuma(imageData, x + 1, 0, rotation, cellSize, dx, dy));
      light.push(coarseCellLuma(imageData, x + 1, last, rotation, cellSize, dx, dy));
    }
  }
  for (let y = 2; y < last; y += 2) {
    dark.push(coarseCellLuma(imageData, 0, y, rotation, cellSize, dx, dy));
    dark.push(coarseCellLuma(imageData, last, y, rotation, cellSize, dx, dy));
    if (y + 1 < last) {
      light.push(coarseCellLuma(imageData, 0, y + 1, rotation, cellSize, dx, dy));
      light.push(coarseCellLuma(imageData, last, y + 1, rotation, cellSize, dx, dy));
    }
  }
  const timingSeparation = mean(light) - mean(dark);

  const sigDark = [];
  const sigLight = [];
  profile.profileSignatureBits.forEach((bit, index) => {
    const value = coarseCellLuma(
      imageData,
      profile.profileSignatureStartX + index,
      profile.calibrationRow,
      rotation,
      cellSize,
      dx,
      dy,
    );
    (bit ? sigDark : sigLight).push(value);
  });
  const signatureSeparation = mean(sigLight) - mean(sigDark);
  return {
    rotation,
    dx,
    dy,
    timingSeparation,
    signatureSeparation,
    score: timingSeparation + signatureSeparation * 1.5,
  };
}

export function detectV3Coarse(roiCanvas, profile = V3_G64_S4_C4_RS) {
  if (!(roiCanvas instanceof HTMLCanvasElement)) throw new TypeError('detectV3Coarse expects a canvas');
  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, roiCanvas.width, roiCanvas.height);
  const results = [];
  for (const rotation of [0, 90, 180, 270]) {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) results.push(scoreCoarseRotation(imageData, rotation, dx, dy, profile));
    }
  }
  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  return {
    ...best,
    // Dedicated V3 receiver: the four external locators already identify an
    // optical frame, so the coarse gate should reject obvious bad geometry but
    // should not block the native-resolution decoder merely because a 4px/cell
    // preview has modest contrast.
    isV3: best.timingSeparation > 24 && best.signatureSeparation > 8,
  };
}

function sampleTimingCell(imageData, cellX, cellY, rotation, dx, dy, profile) {
  const baseX = cellX * profile.cellSize + dx;
  const baseY = cellY * profile.cellSize + dy;
  const pad = profile.cellSize * 0.24;
  return luma(sampleRegionBilinear(
    imageData,
    baseX + pad,
    baseY + pad,
    baseX + profile.cellSize - pad,
    baseY + profile.cellSize - pad,
    rotation,
    4,
  ));
}

function scoreTimingPhase(imageData, rotation, dx, dy, profile) {
  const dark = [];
  const light = [];
  const last = profile.gridSize - 1;
  for (let x = 0; x < profile.gridSize; x += 1) {
    const top = sampleTimingCell(imageData, x, 0, rotation, dx, dy, profile);
    const bottom = sampleTimingCell(imageData, x, last, rotation, dx, dy, profile);
    ((x & 1) === 0 ? dark : light).push(top, bottom);
  }
  for (let y = 1; y < last; y += 1) {
    const left = sampleTimingCell(imageData, 0, y, rotation, dx, dy, profile);
    const right = sampleTimingCell(imageData, last, y, rotation, dx, dy, profile);
    ((y & 1) === 0 ? dark : light).push(left, right);
  }
  return mean(light) - mean(dark);
}

function findBestPhase(imageData, rotation, profile) {
  let best = { dx: 0, dy: 0, separation: -Infinity, rank: -Infinity };
  const consider = (dx, dy) => {
    const separation = scoreTimingPhase(imageData, rotation, dx, dy, profile);
    // Broad timing cells can create a flat score plateau. Prefer the smallest
    // correction inside that plateau so we do not drift toward a cell edge.
    const rank = separation - (Math.abs(dx) + Math.abs(dy)) * 0.12;
    if (rank > best.rank) best = { dx, dy, separation, rank };
  };
  for (let dy = -3; dy <= 3; dy += 1) {
    for (let dx = -3; dx <= 3; dx += 1) consider(dx, dy);
  }
  // Sub-pixel refinement matters once cells become small in camera space.
  // The bilinear sampler makes quarter-pixel phase estimates meaningful.
  const coarse = { ...best };
  for (let dy = coarse.dy - 0.75; dy <= coarse.dy + 0.7501; dy += 0.25) {
    for (let dx = coarse.dx - 0.75; dx <= coarse.dx + 0.7501; dx += 0.25) consider(dx, dy);
  }
  return { dx: best.dx, dy: best.dy, separation: best.separation };
}

function colorVector(rgb) {
  const total = Math.max(1, rgb[0] + rgb[1] + rgb[2]);
  return [rgb[0] / total, rgb[1] / total, rgb[2] / total];
}

function squaredDistance(a, b) {
  let total = 0;
  for (let i = 0; i < a.length; i += 1) total += (a[i] - b[i]) ** 2;
  return total;
}

function normalize(values) {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0));
  if (norm < 1e-8) return values.map(() => 0);
  return values.map((value) => value / norm);
}

function rgbDistance(a, b) {
  return Math.sqrt(((a[0] - b[0]) ** 2) + ((a[1] - b[1]) ** 2) + ((a[2] - b[2]) ** 2));
}

export function sampleSolidCell(imageData, cellX, cellY, rotation, phase, profile) {
  const x = cellX * profile.cellSize + phase.dx;
  const y = cellY * profile.cellSize + phase.dy;
  return sampleRegionBilinear(imageData, x + 2, y + 2, x + profile.cellSize - 2, y + profile.cellSize - 2, rotation, 5);
}

function sampleChromaticBackground(imageData, cellX, cellY, rotation, phase, profile) {
  const baseX = cellX * profile.cellSize + phase.dx;
  const baseY = cellY * profile.cellSize + phase.dy;
  const samplesPerAxis = profile.cellSize >= 20 ? 7 : 5;
  const inner = Math.max(1, profile.cellSize * 0.08);
  const span = Math.max(1, profile.cellSize - inner * 2);
  const candidates = [];

  for (let gy = 0; gy < samplesPerAxis; gy += 1) {
    for (let gx = 0; gx < samplesPerAxis; gx += 1) {
      const rgb = samplePointBilinear(
        imageData,
        baseX + inner + ((gx + 0.5) / samplesPerAxis) * span,
        baseY + inner + ((gy + 0.5) / samplesPerAxis) * span,
        rotation,
      );
      const maximum = Math.max(...rgb);
      const minimum = Math.min(...rgb);
      const chroma = maximum - minimum;
      const brightness = Math.max(1, (rgb[0] + rgb[1] + rgb[2]) / 3);
      const saturation = chroma / brightness;
      if (luma(rgb) > 18 && saturation > 0.12) candidates.push({ rgb, saturation });
    }
  }

  candidates.sort((a, b) => b.saturation - a.saturation);
  const keep = Math.max(6, Math.ceil(candidates.length * 0.55));
  const selected = candidates.slice(0, keep);
  if (!selected.length) return sampleSolidCell(imageData, cellX, cellY, rotation, phase, profile);
  return [0, 1, 2].map((channel) => trimmedMean(selected.map((item) => item.rgb[channel]), 0.10));
}

export function buildColorCalibration(imageData, rotation, phase, profile) {
  const references = Array.from({ length: profile.colorCount }, (_, colorIndex) => {
    const rgb = sampleSolidCell(
      imageData,
      profile.colorCalibrationStartX + colorIndex,
      profile.calibrationRow,
      rotation,
      phase,
      profile,
    );
    return { colorIndex, rgb };
  });
  const measuredMean = [0, 1, 2].map((channel) => mean(references.map((item) => item.rgb[channel])));
  const nominalMean = [0, 1, 2].map((channel) => mean(Array.from({ length: profile.colorCount }, (_, index) => getV3Color(index).rgb[channel])));
  const gains = measuredMean.map((value, channel) => Math.max(0.55, Math.min(1.8, nominalMean[channel] / Math.max(1, value))));
  return references.map((reference) => {
    const normalizedRgb = reference.rgb.map((value, channel) => value * gains[channel]);
    return { ...reference, normalizedRgb, vector: colorVector(normalizedRgb), gains };
  });
}

function classifyColor(rgb, calibration) {
  const gains = calibration[0]?.gains ?? [1, 1, 1];
  const normalizedRgb = rgb.map((value, channel) => value * gains[channel]);
  const vector = colorVector(normalizedRgb);
  const ranked = calibration.map((reference) => ({
    colorIndex: reference.colorIndex,
    distance: squaredDistance(vector, reference.vector),
    referenceRgb: reference.rgb,
  })).sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const second = ranked[1];
  const marginConfidence = second.distance <= 1e-12 ? 0 : Math.max(0, Math.min(1, 1 - best.distance / second.distance));
  const fitConfidence = 1 / (1 + best.distance * 18);
  const confidence = Math.max(0, Math.min(1, marginConfidence * 0.72 + fitConfidence * 0.28));
  const secondFitConfidence = 1 / (1 + second.distance * 18);
  return {
    ...best,
    confidence,
    marginConfidence,
    secondColorIndex: second.colorIndex,
    secondConfidence: Math.max(0, Math.min(1, secondFitConfidence * (1 - marginConfidence * 0.5))),
  };
}

function sampleBrightBackground(imageData, cellX, cellY, rotation, phase, profile) {
  const baseX = cellX * profile.cellSize + phase.dx;
  const baseY = cellY * profile.cellSize + phase.dy;
  const pixels = [];
  for (let y = 0; y < profile.cellSize; y += 1) {
    for (let x = 0; x < profile.cellSize; x += 1) {
      const rgb = sampleRegion(imageData, baseX + x, baseY + y, baseX + x + 1, baseY + y + 1, rotation);
      pixels.push({ rgb, luma: luma(rgb) });
    }
  }
  pixels.sort((a, b) => b.luma - a.luma);
  const selected = pixels.slice(0, Math.max(8, Math.floor(pixels.length * 0.35)));
  return [0, 1, 2].map((channel) => trimmedMean(selected.map((item) => item.rgb[channel])));
}

function extractShapeFeature(imageData, cellX, cellY, rotation, phase, backgroundRgb, profile) {
  const baseX = cellX * profile.cellSize + phase.dx;
  const baseY = cellY * profile.cellSize + phase.dy;
  const grid = 5;
  const module = profile.cellSize / grid;
  const values = [];
  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const rgb = sampleRegionBilinear(
        imageData,
        baseX + gx * module,
        baseY + gy * module,
        baseX + (gx + 1) * module,
        baseY + (gy + 1) * module,
        rotation,
        2,
      );
      values.push(rgbDistance(rgb, backgroundRgb) / 442);
    }
  }
  return normalize(values);
}

export function buildShapeCalibration(imageData, rotation, phase, profile) {
  return Array.from({ length: profile.shapeCount }, (_, shapeId) => {
    const x = profile.shapeCalibrationStartX + shapeId;
    const y = profile.calibrationRow;
    const background = sampleBrightBackground(imageData, x, y, rotation, phase, profile);
    return { shapeId, feature: extractShapeFeature(imageData, x, y, rotation, phase, background, profile) };
  });
}

function classifyShape(feature, calibration) {
  const ranked = calibration.map((reference) => ({
    shapeId: reference.shapeId,
    distance: squaredDistance(feature, reference.feature),
  })).sort((a, b) => a.distance - b.distance);
  const best = ranked[0];
  const second = ranked[1];
  const marginConfidence = second.distance <= 1e-12 ? 0 : Math.max(0, Math.min(1, 1 - best.distance / second.distance));
  const fitConfidence = 1 / (1 + best.distance * 4);
  const confidence = Math.max(0, Math.min(1, marginConfidence * 0.75 + fitConfidence * 0.25));
  const secondFitConfidence = 1 / (1 + second.distance * 4);
  return {
    ...best,
    confidence,
    marginConfidence,
    secondShapeId: second.shapeId,
    secondConfidence: Math.max(0, Math.min(1, secondFitConfidence * (1 - marginConfidence * 0.5))),
  };
}

export function classifyDataCell(imageData, x, y, rotation, phase, profile, colorCalibration, shapeCalibration) {
  const localBackground = sampleChromaticBackground(imageData, x, y, rotation, phase, profile);
  const color = classifyColor(localBackground, colorCalibration);
  const shapeFeature = extractShapeFeature(imageData, x, y, rotation, phase, localBackground, profile);
  const shape = classifyShape(shapeFeature, shapeCalibration);
  const confidence = Math.min(shape.confidence, color.confidence);
  const shapeAlternativeConfidence = Math.min(shape.secondConfidence, color.confidence);
  const colorAlternativeConfidence = Math.min(color.secondConfidence, shape.confidence);
  const alternateSymbol = shapeAlternativeConfidence >= colorAlternativeConfidence
    ? joinV3Nibble(shape.secondShapeId, color.colorIndex)
    : joinV3Nibble(shape.shapeId, color.secondColorIndex);
  const alternateConfidence = Math.max(shapeAlternativeConfidence, colorAlternativeConfidence);

  return {
    symbol: joinV3Nibble(shape.shapeId, color.colorIndex),
    shapeId: shape.shapeId,
    colorId: color.colorIndex,
    shapeConfidence: shape.confidence,
    colorConfidence: color.confidence,
    confidence,
    alternateSymbol,
    alternateConfidence,
    phaseDx: phase.dx,
    phaseDy: phase.dy,
  };
}

export function minimumCalibrationSeparation(calibration, key) {
  let minimum = Infinity;
  for (let i = 0; i < calibration.length; i += 1) {
    for (let j = i + 1; j < calibration.length; j += 1) {
      minimum = Math.min(minimum, Math.sqrt(squaredDistance(calibration[i][key], calibration[j][key])));
    }
  }
  return Number.isFinite(minimum) ? minimum : 0;
}

function scoreHighResSignature(imageData, rotation, phase, profile) {
  const dark = [];
  const light = [];
  profile.profileSignatureBits.forEach((bit, index) => {
    const rgb = sampleSolidCell(
      imageData,
      profile.profileSignatureStartX + index,
      profile.calibrationRow,
      rotation,
      phase,
      profile,
    );
    (bit ? dark : light).push(luma(rgb));
  });
  return mean(light) - mean(dark);
}

export function observeV3ImageData(imageData, rotation = 0, profile = V3_G64_S4_C4_RS, tuning = null) {
  if (!imageData || !Number.isInteger(imageData.width) || !Number.isInteger(imageData.height) || !imageData.data) {
    throw new TypeError('observeV3ImageData expects ImageData-like input');
  }
  if (imageData.width !== profile.logicalSize || imageData.height !== profile.logicalSize) {
    throw new Error(`V3 ROI must be ${profile.logicalSize}×${profile.logicalSize}`);
  }

  const phase = findBestPhase(imageData, rotation, profile);
  const timingMinimum = Number.isFinite(tuning?.timingMinimum) ? tuning.timingMinimum : 30;
  if (phase.separation < timingMinimum) throw new Error(`V3 timing contrast too low (${phase.separation.toFixed(1)} < ${timingMinimum.toFixed(1)})`);
  const signatureSeparation = scoreHighResSignature(imageData, rotation, phase, profile);
  const signatureMinimum = Number.isFinite(tuning?.signatureMinimum) ? tuning.signatureMinimum : 10;
  if (signatureSeparation < signatureMinimum) throw new Error(`V3 signature too weak (${signatureSeparation.toFixed(1)} < ${signatureMinimum.toFixed(1)})`);

  const colorCalibration = buildColorCalibration(imageData, rotation, phase, profile);
  const shapeCalibration = buildShapeCalibration(imageData, rotation, phase, profile);
  const coordinates = getV3DataCellCoordinates(profile);
  const symbols = new Uint8Array(profile.encodedSymbolCapacity);
  const shapeIds = new Uint8Array(profile.encodedSymbolCapacity);
  const colorIds = new Uint8Array(profile.encodedSymbolCapacity);
  const confidences = new Float32Array(profile.encodedSymbolCapacity);
  const shapeConfidences = new Float32Array(profile.encodedSymbolCapacity);
  const colorConfidences = new Float32Array(profile.encodedSymbolCapacity);
  const alternateSymbols = new Uint8Array(profile.encodedSymbolCapacity);
  const alternateConfidences = new Float32Array(profile.encodedSymbolCapacity);
  const cellResults = coordinates.map(({ x, y }) => (
    classifyDataCell(imageData, x, y, rotation, phase, profile, colorCalibration, shapeCalibration)
  ));

  // Only refine the weakest cells. This bounds CPU cost on phones while still
  // compensating for residual local warp / LCD-camera phase error.
  const refineLimit = Math.min(96, Math.max(24, Math.ceil(coordinates.length * 0.12)));
  const refinementCandidates = cellResults
    .map((result, index) => ({ index, confidence: result.confidence }))
    .filter((item) => item.confidence < 0.46)
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, refineLimit);
  const localOffsets = [
    [-0.75, 0],
    [0.75, 0],
    [0, -0.75],
    [0, 0.75],
  ];
  let refinedCells = 0;

  for (const { index } of refinementCandidates) {
    const { x, y } = coordinates[index];
    let best = cellResults[index];
    for (const [dx, dy] of localOffsets) {
      const candidate = classifyDataCell(
        imageData,
        x,
        y,
        rotation,
        { dx: phase.dx + dx, dy: phase.dy + dy },
        profile,
        colorCalibration,
        shapeCalibration,
      );
      const bestScore = best.confidence + best.alternateConfidence * 0.08;
      const candidateScore = candidate.confidence + candidate.alternateConfidence * 0.08 - 0.005;
      if (candidateScore > bestScore) best = candidate;
    }
    if (best.phaseDx !== phase.dx || best.phaseDy !== phase.dy) refinedCells += 1;
    cellResults[index] = best;
  }

  let colorConfidenceSum = 0;
  let shapeConfidenceSum = 0;
  let lowConfidenceCells = 0;
  cellResults.forEach((result, index) => {
    symbols[index] = result.symbol;
    shapeIds[index] = result.shapeId;
    colorIds[index] = result.colorId;
    shapeConfidences[index] = result.shapeConfidence;
    colorConfidences[index] = result.colorConfidence;
    confidences[index] = result.confidence;
    alternateSymbols[index] = result.alternateSymbol;
    alternateConfidences[index] = result.alternateConfidence;
    colorConfidenceSum += result.colorConfidence;
    shapeConfidenceSum += result.shapeConfidence;
    if (result.confidence < 0.34) lowConfidenceCells += 1;
  });

  const averageColorConfidence = colorConfidenceSum / coordinates.length;
  const averageShapeConfidence = shapeConfidenceSum / coordinates.length;
  const averageConfidence = (averageColorConfidence + averageShapeConfidence) / 2;
  const colorCalibrationSeparation = minimumCalibrationSeparation(colorCalibration, 'vector');
  const shapeCalibrationSeparation = minimumCalibrationSeparation(shapeCalibration, 'feature');

  return {
    profileId: profile.id,
    rotation,
    symbols,
    shapeIds,
    colorIds,
    confidences,
    shapeConfidences,
    colorConfidences,
    alternateSymbols,
    alternateConfidences,
    refinedCellRate: refinedCells / coordinates.length,
    timingSeparation: phase.separation,
    signatureSeparation,
    phaseX: phase.dx,
    phaseY: phase.dy,
    averageColorConfidence,
    averageShapeConfidence,
    averageConfidence,
    lowConfidenceCellRate: lowConfidenceCells / coordinates.length,
    colorCalibrationSeparation,
    shapeCalibrationSeparation,
  };
}

export function observeV3Roi(roiCanvas, rotation = 0, profile = V3_G64_S4_C4_RS, tuning = null) {
  if (!(roiCanvas instanceof HTMLCanvasElement)) throw new TypeError('observeV3Roi expects a canvas');
  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  return observeV3ImageData(ctx.getImageData(0, 0, roiCanvas.width, roiCanvas.height), rotation, profile, tuning);
}

export function decodeV3Observation(observation, profile = V3_G64_S4_C4_RS) {
  if (!observation || observation.profileId !== profile.id) throw new Error(`Expected observation for ${profile.id}`);
  let recovered;
  try {
    recovered = recoverV3PacketFromSymbolsWithAlternates(
      observation.symbols,
      profile,
      observation.confidences,
      observation.alternateSymbols,
      observation.alternateConfidences,
    );
  } catch (error) {
    const coordinates = getV3DataCellCoordinates(profile);
    const failedBlockCells = Number.isInteger(error.blockIndex)
      ? Array.from({ length: profile.rsN }, (_, position) => {
          const physicalIndex = position * profile.rsCodewordCount + error.blockIndex;
          const coordinate = coordinates[physicalIndex];
          return {
            position,
            physicalIndex,
            x: coordinate?.x ?? null,
            y: coordinate?.y ?? null,
            confidence: observation.confidences?.[physicalIndex] ?? null,
            alternateSymbol: observation.alternateSymbols?.[physicalIndex] ?? null,
            alternateConfidence: observation.alternateConfidences?.[physicalIndex] ?? null,
          };
        })
      : [];
    error.v3Diagnostics = {
      timingSeparation: observation.timingSeparation,
      signatureSeparation: observation.signatureSeparation,
      phaseX: observation.phaseX,
      phaseY: observation.phaseY,
      rotation: observation.rotation,
      averageColorConfidence: observation.averageColorConfidence,
      averageShapeConfidence: observation.averageShapeConfidence,
      averageConfidence: observation.averageConfidence,
      lowConfidenceCellRate: observation.lowConfidenceCellRate,
      colorCalibrationSeparation: observation.colorCalibrationSeparation,
      shapeCalibrationSeparation: observation.shapeCalibrationSeparation,
      refinedCellRate: observation.refinedCellRate,
      selectiveRetryAttempts: error.selectiveRetryAttempts ?? 0,
      rescuedBlocks: error.rescuedBlocks ?? [],
      failedBlockCells,
    };
    throw error;
  }

  return {
    profileId: profile.id,
    packetBytes: recovered.packetBytes,
    correctedSymbols: recovered.correctedSymbols,
    erasuresUsed: recovered.erasuresUsed,
    rsBlocksDecoded: recovered.blocksDecoded,
    packetLength: recovered.packetLength,
    timingSeparation: observation.timingSeparation,
    signatureSeparation: observation.signatureSeparation,
    phaseX: observation.phaseX,
    phaseY: observation.phaseY,
    rotation: observation.rotation,
    averageColorConfidence: observation.averageColorConfidence,
    averageShapeConfidence: observation.averageShapeConfidence,
    averageConfidence: observation.averageConfidence,
    lowConfidenceCellRate: observation.lowConfidenceCellRate,
    colorCalibrationSeparation: observation.colorCalibrationSeparation,
    shapeCalibrationSeparation: observation.shapeCalibrationSeparation,
    refinedCellRate: observation.refinedCellRate,
    selectiveRetryAttempts: recovered.selectiveRetryAttempts ?? 0,
    rescuedBlocks: recovered.rescuedBlocks ?? [],
  };
}

export function decodeV3Roi(roiCanvas, rotation = 0, profile = V3_G64_S4_C4_RS) {
  return decodeV3Observation(observeV3Roi(roiCanvas, rotation, profile), profile);
}

export const V3_NOMINAL_COLORS = Object.freeze(Array.from({ length: 4 }, (_, index) => getV3Color(index)));
