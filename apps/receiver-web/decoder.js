import { c16SymbolsToBytes } from '../../packages/optical-codec/src/symbol-codec.js';
import { getDataCellCoordinates, V1_G16_C16 } from '../../packages/optical-codec/src/profiles.js';

const FINDERS = Object.freeze({
  TL: [[1, 1], [1, 0]],
  TR: [[1, 0], [1, 1]],
  BL: [[1, 1], [0, 1]],
  BR: [[0, 1], [1, 1]],
});

const ROTATIONS = [0, 90, 180, 270];

function mapCell(x, y, rotation, gridSize) {
  switch (rotation) {
    case 0: return { x, y };
    case 90: return { x: gridSize - 1 - y, y: x };
    case 180: return { x: gridSize - 1 - x, y: gridSize - 1 - y };
    case 270: return { x: y, y: gridSize - 1 - x };
    default: throw new RangeError(`Unsupported rotation ${rotation}`);
  }
}

function sampleCellRgb(imageData, logicalX, logicalY, rotation, profile = V1_G16_C16) {
  const mapped = mapCell(logicalX, logicalY, rotation, profile.gridSize);
  const cell = profile.cellSize;
  const inset = Math.max(2, Math.floor(cell * 0.28));
  const startX = (mapped.x * cell) + inset;
  const startY = (mapped.y * cell) + inset;
  const endX = ((mapped.x + 1) * cell) - inset;
  const endY = ((mapped.y + 1) * cell) - inset;
  const { data, width } = imageData;

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = ((y * width) + x) * 4;
      r += data[offset];
      g += data[offset + 1];
      b += data[offset + 2];
      count += 1;
    }
  }

  return [r / count, g / count, b / count];
}

function luminance(rgb) {
  return (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2]);
}

function finderCells(profile = V1_G16_C16) {
  const last = profile.gridSize - 1;
  return [
    { corner: 'TL', x0: 0, y0: 0 },
    { corner: 'TR', x0: last - 1, y0: 0 },
    { corner: 'BL', x0: 0, y0: last - 1 },
    { corner: 'BR', x0: last - 1, y0: last - 1 },
  ];
}

export function scoreRotation(imageData, rotation, profile = V1_G16_C16) {
  const dark = [];
  const light = [];

  for (const finder of finderCells(profile)) {
    const pattern = FINDERS[finder.corner];
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        const rgb = sampleCellRgb(
          imageData,
          finder.x0 + dx,
          finder.y0 + dy,
          rotation,
          profile,
        );
        (pattern[dy][dx] ? dark : light).push(luminance(rgb));
      }
    }
  }

  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const darkMean = mean(dark);
  const lightMean = mean(light);
  const separation = lightMean - darkMean;
  const score = separation + ((255 - Math.abs(255 - lightMean)) * 0.12) + ((255 - darkMean) * 0.12);
  return { rotation, score, darkMean, lightMean, separation };
}

export function detectOrientation(imageData, profile = V1_G16_C16) {
  const candidates = ROTATIONS.map((rotation) => scoreRotation(imageData, rotation, profile));
  candidates.sort((a, b) => b.score - a.score);
  return { ...candidates[0], candidates };
}

function chromaVector(rgb) {
  const total = Math.max(1, rgb[0] + rgb[1] + rgb[2]);
  const brightness = total / (255 * 3);
  return [
    rgb[0] / total,
    rgb[1] / total,
    rgb[2] / total,
    brightness * 0.12,
  ];
}

function squaredDistance(a, b) {
  let value = 0;
  for (let i = 0; i < a.length; i += 1) {
    const diff = a[i] - b[i];
    value += diff * diff;
  }
  return value;
}

export function buildCalibration(imageData, rotation, profile = V1_G16_C16) {
  return Array.from({ length: profile.symbolCount }, (_, symbol) => {
    const rgb = sampleCellRgb(imageData, symbol, profile.calibrationRow, rotation, profile);
    return { symbol, rgb, vector: chromaVector(rgb) };
  });
}

export function classifyRgb(rgb, calibration) {
  const vector = chromaVector(rgb);
  const ranked = calibration
    .map((reference) => ({
      symbol: reference.symbol,
      distance: squaredDistance(vector, reference.vector),
    }))
    .sort((a, b) => a.distance - b.distance);

  const best = ranked[0];
  const second = ranked[1];
  const confidence = second.distance <= 1e-12
    ? 0
    : Math.max(0, Math.min(1, 1 - (best.distance / second.distance)));

  return {
    symbol: best.symbol,
    confidence,
    distance: best.distance,
    secondDistance: second.distance,
    rgb,
  };
}

/**
 * Recover one logical C16 symbol from spatially interleaved repeated copies.
 * 2-of-3 majority corrects one symbol error. If all three disagree, choose the
 * classification with the smallest normalized centroid distance and report it
 * as uncorrectable so diagnostics show channel quality honestly.
 */
export function recoverRepeatedClassifications(classifications, profile = V1_G16_C16) {
  const repetition = profile.repetition ?? 1;
  const logicalCount = profile.dataSymbolCapacity;
  if (classifications.length !== logicalCount * repetition) {
    throw new RangeError('Repeated classification count does not match profile');
  }

  const symbols = new Uint8Array(logicalCount);
  let disagreementGroups = 0;
  let correctedGroups = 0;
  let uncorrectableGroups = 0;

  for (let i = 0; i < logicalCount; i += 1) {
    const copies = [];
    for (let copy = 0; copy < repetition; copy += 1) {
      copies.push(classifications[i + (copy * logicalCount)]);
    }

    const counts = new Map();
    for (const item of copies) counts.set(item.symbol, (counts.get(item.symbol) ?? 0) + 1);
    const rankedCounts = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const [majoritySymbol, majorityCount] = rankedCounts[0];

    if (counts.size > 1) disagreementGroups += 1;

    if (majorityCount >= Math.floor(repetition / 2) + 1) {
      symbols[i] = majoritySymbol;
      if (counts.size > 1) correctedGroups += 1;
    } else {
      uncorrectableGroups += 1;
      const best = copies.reduce((a, b) => (a.distance <= b.distance ? a : b));
      symbols[i] = best.symbol;
    }
  }

  return { symbols, disagreementGroups, correctedGroups, uncorrectableGroups };
}

export function decodeRectifiedRoi(roiCanvas, profile = V1_G16_C16) {
  if (!(roiCanvas instanceof HTMLCanvasElement)) {
    throw new TypeError('decodeRectifiedRoi expects a canvas');
  }
  if (roiCanvas.width !== profile.logicalSize || roiCanvas.height !== profile.logicalSize) {
    throw new RangeError(`ROI canvas must be ${profile.logicalSize}×${profile.logicalSize}`);
  }

  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, roiCanvas.width, roiCanvas.height);
  const orientation = detectOrientation(imageData, profile);

  if (orientation.separation < 55) {
    throw new Error(`Finder contrast too low (${orientation.separation.toFixed(1)})`);
  }

  const calibration = buildCalibration(imageData, orientation.rotation, profile);
  const dataCoordinates = getDataCellCoordinates(profile)
    .slice(0, profile.encodedSymbolCapacity);
  const classifications = [];
  let confidenceSum = 0;
  let minimumConfidence = 1;

  dataCoordinates.forEach(({ x, y }) => {
    const rgb = sampleCellRgb(imageData, x, y, orientation.rotation, profile);
    const classified = classifyRgb(rgb, calibration);
    classifications.push(classified);
    confidenceSum += classified.confidence;
    minimumConfidence = Math.min(minimumConfidence, classified.confidence);
  });

  const recovery = recoverRepeatedClassifications(classifications, profile);
  const envelope = c16SymbolsToBytes(recovery.symbols);
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const packetLength = view.getUint16(0, false);

  if (packetLength < 1 || packetLength > profile.maxPacketBytes) {
    throw new Error(`Invalid decoded packet length ${packetLength}`);
  }

  return {
    packetBytes: envelope.slice(
      profile.lengthPrefixBytes,
      profile.lengthPrefixBytes + packetLength,
    ),
    rotation: orientation.rotation,
    finderSeparation: orientation.separation,
    averageConfidence: confidenceSum / classifications.length,
    minimumConfidence,
    calibration,
    repetition: profile.repetition,
    repetitionDisagreements: recovery.disagreementGroups,
    repetitionCorrections: recovery.correctedGroups,
    repetitionUncorrectable: recovery.uncorrectableGroups,
  };
}
