import {
  M9_RENDER_LAYOUT,
  M9_TILE_GRID,
  decodeM9HeaderBits,
  decodeM9TileSymbols,
  getM9TileDataCoordinates,
} from '../../packages/optical-codec/src/index.js';
import {
  buildColorCalibration,
  buildShapeCalibration,
  classifyDataCell,
  luma,
  mean,
  sampleRegion,
  sampleSolidCell,
} from '../receiver-v3/v3-decoder.js';

const TILE_PROFILE = Object.freeze({
  id: 'M9-TILE-S4C4-RS15-11',
  logicalSize: M9_RENDER_LAYOUT.tileSize,
  cellSize: M9_RENDER_LAYOUT.tileCellSize,
  gridSize: M9_TILE_GRID,
  colorCount: 4,
  shapeCount: 4,
  calibrationRow: 0,
  colorCalibrationStartX: 2,
  shapeCalibrationStartX: 7,
});

function mapRotatedPoint(x, y, rotation, size) {
  switch (rotation) {
    case 0: return { x, y };
    case 90: return { x: size - 1 - y, y: x };
    case 180: return { x: size - 1 - x, y: size - 1 - y };
    case 270: return { x: y, y: size - 1 - x };
    default: throw new RangeError(`Unsupported rotation ${rotation}`);
  }
}

function readHeaderRow(imageData, rotation, row) {
  const layout = M9_RENDER_LAYOUT;
  const width = layout.headerModule * 40;
  const startX = Math.floor((layout.logicalSize - width) / 2);
  const startY = layout.headerOriginY + row * (layout.headerModule + layout.headerRowGap);
  const lumas = [];
  const pad = layout.headerModule * 0.22;
  for (let index = 0; index < 40; index += 1) {
    const x = startX + index * layout.headerModule;
    const rgb = sampleRegion(
      imageData,
      x + pad,
      startY + pad,
      x + layout.headerModule - pad,
      startY + layout.headerModule - pad,
      rotation,
    );
    lumas.push(luma(rgb));
  }
  const sorted = [...lumas].sort((a, b) => a - b);
  const dark = mean(sorted.slice(0, 10));
  const light = mean(sorted.slice(-10));
  const threshold = (dark + light) / 2;
  const bits = Uint8Array.from(lumas, (value) => (value < threshold ? 1 : 0));
  return { bits, contrast: light - dark };
}

export function detectM9Header(imageData) {
  const candidates = [];
  for (const rotation of [0, 90, 180, 270]) {
    const decodedRows = [];
    let contrast = 0;
    for (let row = 0; row < 2; row += 1) {
      const sampled = readHeaderRow(imageData, rotation, row);
      contrast += sampled.contrast;
      try {
        decodedRows.push(decodeM9HeaderBits(sampled.bits));
      } catch {
        decodedRows.push(null);
      }
    }
    const valid = decodedRows.filter(Boolean);
    if (!valid.length) continue;
    const header = valid.length === 2
      && valid[0].frameId === valid[1].frameId
      && valid[0].packetLength === valid[1].packetLength
      ? valid[0]
      : valid[0];
    candidates.push({ ...header, rotation, contrast: contrast / 2, rowsValid: valid.length });
  }
  candidates.sort((a, b) => (b.rowsValid - a.rowsValid) || (b.contrast - a.contrast));
  if (!candidates.length) {
    const error = new Error('M9 header not found');
    error.code = 'M9_HEADER_NOT_FOUND';
    throw error;
  }
  return candidates[0];
}

function cropTile(imageData, tileIndex, rotation) {
  const layout = M9_RENDER_LAYOUT;
  const col = tileIndex % 3;
  const row = Math.floor(tileIndex / 3);
  const originX = layout.tileOriginX + col * (layout.tileSize + layout.tileGap);
  const originY = layout.tileOriginY + row * (layout.tileSize + layout.tileGap);
  const size = layout.tileSize;
  const data = new Uint8ClampedArray(size * size * 4);

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const source = mapRotatedPoint(originX + x, originY + y, rotation, imageData.width);
      const sx = Math.max(0, Math.min(imageData.width - 1, Math.round(source.x)));
      const sy = Math.max(0, Math.min(imageData.height - 1, Math.round(source.y)));
      const sourceOffset = ((sy * imageData.width) + sx) * 4;
      const targetOffset = ((y * size) + x) * 4;
      data[targetOffset] = imageData.data[sourceOffset];
      data[targetOffset + 1] = imageData.data[sourceOffset + 1];
      data[targetOffset + 2] = imageData.data[sourceOffset + 2];
      data[targetOffset + 3] = 255;
    }
  }
  return { width: size, height: size, data };
}

function timingCells() {
  const cells = [];
  const last = M9_TILE_GRID - 1;
  const topAllowed = new Set([0, 1, 6, 11, 12]);
  for (let x = 0; x <= last; x += 1) {
    if (topAllowed.has(x)) cells.push({ x, y: 0, dark: (x & 1) === 0 });
    cells.push({ x, y: last, dark: (x & 1) === 0 });
  }
  for (let y = 1; y < last; y += 1) {
    cells.push({ x: 0, y, dark: (y & 1) === 0 });
    cells.push({ x: last, y, dark: (y & 1) === 0 });
  }
  return cells;
}

const TILE_TIMING_CELLS = timingCells();

function timingScore(imageData, phase) {
  const dark = [];
  const light = [];
  for (const cell of TILE_TIMING_CELLS) {
    const value = luma(sampleSolidCell(imageData, cell.x, cell.y, 0, phase, TILE_PROFILE));
    (cell.dark ? dark : light).push(value);
  }
  return mean(light) - mean(dark);
}

function bestTilePhase(imageData) {
  let best = { dx: 0, dy: 0, score: -Infinity };
  const consider = (dx, dy) => {
    const score = timingScore(imageData, { dx, dy }) - (Math.abs(dx) + Math.abs(dy)) * 0.1;
    if (score > best.score) best = { dx, dy, score };
  };
  for (let dy = -2; dy <= 2; dy += 1) {
    for (let dx = -2; dx <= 2; dx += 1) consider(dx, dy);
  }
  const coarse = { ...best };
  for (let dy = coarse.dy - 0.5; dy <= coarse.dy + 0.5001; dy += 0.25) {
    for (let dx = coarse.dx - 0.5; dx <= coarse.dx + 0.5001; dx += 0.25) consider(dx, dy);
  }
  return { dx: best.dx, dy: best.dy, separation: best.score };
}

export function decodeM9TileImageData(imageData, tileIndex) {
  const phase = bestTilePhase(imageData);
  if (phase.separation < 24) {
    const error = new Error(`M9 tile ${tileIndex} timing too weak (${phase.separation.toFixed(1)})`);
    error.code = 'M9_TILE_TIMING';
    throw error;
  }

  const colorCalibration = buildColorCalibration(imageData, 0, phase, TILE_PROFILE);
  const shapeCalibration = buildShapeCalibration(imageData, 0, phase, TILE_PROFILE);
  const marker = classifyDataCell(
    imageData,
    6,
    6,
    0,
    phase,
    TILE_PROFILE,
    colorCalibration,
    shapeCalibration,
  );
  if (marker.symbol !== tileIndex) {
    const error = new Error(`M9 tile marker mismatch: expected ${tileIndex}, got ${marker.symbol}`);
    error.code = 'M9_TILE_MARKER';
    throw error;
  }

  const coordinates = getM9TileDataCoordinates();
  const symbols = new Uint8Array(coordinates.length);
  let confidenceSum = 0;
  coordinates.forEach(({ x, y }, index) => {
    const result = classifyDataCell(
      imageData,
      x,
      y,
      0,
      phase,
      TILE_PROFILE,
      colorCalibration,
      shapeCalibration,
    );
    symbols[index] = result.symbol;
    confidenceSum += result.confidence;
  });

  const decoded = decodeM9TileSymbols(symbols, tileIndex);
  return {
    ...decoded,
    timingSeparation: phase.separation,
    phaseX: phase.dx,
    phaseY: phase.dy,
    averageConfidence: confidenceSum / coordinates.length,
  };
}

export function decodeM9Observation(imageData, unresolvedTileIndexes = null) {
  if (!imageData || imageData.width !== M9_RENDER_LAYOUT.logicalSize || imageData.height !== M9_RENDER_LAYOUT.logicalSize) {
    throw new Error('M9 ROI must be 768×768');
  }
  const header = detectM9Header(imageData);
  const targets = Array.isArray(unresolvedTileIndexes)
    ? unresolvedTileIndexes
    : Array.from({ length: 9 }, (_, index) => index);
  const decodedTiles = [];
  const failures = [];
  for (const tileIndex of targets) {
    try {
      const tileImage = cropTile(imageData, tileIndex, header.rotation);
      const decoded = decodeM9TileImageData(tileImage, tileIndex);
      if (decoded.frameId !== header.frameId) {
        failures.push({ tileIndex, code: 'M9_FRAME_ID_MISMATCH' });
        continue;
      }
      decodedTiles.push(decoded);
    } catch (error) {
      failures.push({ tileIndex, code: error.code ?? 'M9_TILE_DECODE', message: error.message });
    }
  }
  return { header, decodedTiles, failures };
}
