import { getC16Color, rgbToCss } from '../../constellation/src/c16.js';
import { c32RgbToCss, getC32Color, relativeLuminance } from '../../constellation/src/c32.js';
import { getB4Background, getC8Color, luminance8, rgbToCss8 } from '../../constellation/src/c8b4.js';
import { getV3Color, getV3Shape, v3Luminance, v3RgbToCss } from '../../constellation/src/v3.js';
import { getV1FiducialCenters, V1_FIDUCIAL } from './fiducials.js';
import { getS8Shape } from './shapes.js';

function seededPermutation(length, variant, salt) {
  const values = Array.from({ length }, (_, index) => index);
  if (!variant) return values;
  let state = ((variant * 0x9E3779B1) ^ salt) >>> 0;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
  for (let i = values.length - 1; i > 0; i -= 1) {
    const j = next() % (i + 1);
    [values[i], values[j]] = [values[j], values[i]];
  }
  return values;
}

function visualMaps(variant = 0) {
  return {
    c16: seededPermutation(16, variant, 0xC016C016),
    c32: seededPermutation(32, variant, 0xC032C032),
    c8: seededPermutation(8, variant, 0xC008C008),
    b4: seededPermutation(4, variant, 0xB004B004),
    s8: seededPermutation(8, variant, 0x58085808),
  };
}

function displayedC16Index(logicalIndex, maps) { return maps.c16[logicalIndex] ?? logicalIndex; }
function displayedC32Index(logicalIndex, maps) { return maps.c32[logicalIndex] ?? logicalIndex; }
function displayedC8Index(logicalIndex, maps) { return maps.c8[logicalIndex] ?? logicalIndex; }
function displayedB4Index(logicalIndex, maps) { return maps.b4[logicalIndex] ?? logicalIndex; }
function displayedShapeId(logicalId, maps) { return maps.s8[logicalId] ?? logicalId; }

function fillForCell(cell, maps) {
  if (cell.kind === 'finder' || cell.kind === 'profile-signature' || cell.kind === 'v3-timing') {
    return cell.dark ? '#000000' : '#FFFFFF';
  }
  if (cell.kind === 'calibration' || cell.kind === 'data') return rgbToCss(getC16Color(cell.symbol).rgb);
  if (cell.kind === 'color-calibration-16' || cell.kind === 's8c16-data') {
    return rgbToCss(getC16Color(displayedC16Index(cell.colorIndex, maps)).rgb);
  }
  if (cell.kind === 'color-calibration' || cell.kind === 's8c32-data') {
    return c32RgbToCss(getC32Color(displayedC32Index(cell.colorIndex, maps)).rgb);
  }
  if (cell.kind === 'fg-color-calibration-8') return rgbToCss8(getC8Color(displayedC8Index(cell.colorIndex, maps)).rgb);
  if (cell.kind === 'background-calibration-4' || cell.kind === 's8c8b4-data') {
    return rgbToCss8(getB4Background(displayedB4Index(cell.backgroundIndex, maps)).rgb);
  }
  if (cell.kind === 'shape-calibration' || cell.kind === 'shape-calibration-22') return '#A8A8A8';
  if (cell.kind === 'v3-color-calibration' || cell.kind === 'v3-data') return v3RgbToCss(getV3Color(cell.colorIndex).rgb);
  if (cell.kind === 'v3-shape-calibration') return '#B8B8B8';
  if (cell.kind === 'v3-guard') return '#D8D8D8';
  return '#E8E8E8';
}

function renderFiducial(center, scale = 1) {
  const outer = V1_FIDUCIAL.outerSize * scale;
  const middle = V1_FIDUCIAL.middleSize * scale;
  const core = V1_FIDUCIAL.coreSize * scale;
  return [
    `<rect x="${center.x - (outer / 2)}" y="${center.y - (outer / 2)}" width="${outer}" height="${outer}" fill="#000000"/>`,
    `<rect x="${center.x - (middle / 2)}" y="${center.y - (middle / 2)}" width="${middle}" height="${middle}" fill="#FFFFFF"/>`,
    `<rect x="${center.x - (core / 2)}" y="${center.y - (core / 2)}" width="${core}" height="${core}" fill="#000000"/>`,
  ].join('');
}

function glyphFill(cell, maps) {
  if (cell.kind === 'shape-calibration') return '#000000';
  if (cell.kind === 'shape-calibration-22') return rgbToCss8(getC8Color(4).rgb);
  if (cell.kind === 's8c8b4-data') return rgbToCss8(getC8Color(displayedC8Index(cell.colorIndex, maps)).rgb);
  let rgb;
  if (cell.kind === 's8c16-data') rgb = getC16Color(displayedC16Index(cell.colorIndex, maps)).rgb;
  else rgb = getC32Color(displayedC32Index(cell.colorIndex, maps)).rgb;
  return relativeLuminance(rgb) >= 145 ? '#050505' : '#FFFFFF';
}

function renderHalo(shape, x, y, cellSize, haloFill) {
  const module = cellSize / 8;
  const glyphSize = module * 5;
  const offset = (cellSize - glyphSize) / 2;
  const dilated = new Set();
  shape.mask.forEach((row, gy) => {
    [...row].forEach((bit, gx) => {
      if (bit !== '1') return;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const hx = gx + dx;
          const hy = gy + dy;
          if (hx < -1 || hx > 5 || hy < -1 || hy > 5) continue;
          dilated.add(`${hx},${hy}`);
        }
      }
    });
  });
  return [...dilated].map((key) => {
    const [gx, gy] = key.split(',').map(Number);
    return `<rect x="${x + offset + (gx * module)}" y="${y + offset + (gy * module)}" width="${module}" height="${module}" fill="${haloFill}"/>`;
  }).join('');
}

function renderLegacyGlyph(cell, x, y, cellSize, maps) {
  if (!['shape-calibration', 'shape-calibration-22', 's8c16-data', 's8c32-data', 's8c8b4-data'].includes(cell.kind)) return '';
  const shape = getS8Shape(displayedShapeId(cell.shapeId, maps));
  const module = cellSize / 8;
  const glyphSize = module * 5;
  const offset = (cellSize - glyphSize) / 2;
  const fill = glyphFill(cell, maps);
  const parts = [];

  if (cell.kind === 's8c8b4-data') {
    const backgroundRgb = getB4Background(displayedB4Index(cell.backgroundIndex, maps)).rgb;
    parts.push(renderHalo(shape, x, y, cellSize, luminance8(backgroundRgb) >= 128 ? '#050505' : '#FFFFFF'));
  } else if (cell.kind === 'shape-calibration-22') {
    parts.push(renderHalo(shape, x, y, cellSize, '#050505'));
  }

  shape.mask.forEach((row, gy) => {
    [...row].forEach((bit, gx) => {
      if (bit !== '1') return;
      parts.push(`<rect x="${x + offset + (gx * module)}" y="${y + offset + (gy * module)}" width="${module}" height="${module}" fill="${fill}"/>`);
    });
  });
  return parts.join('');
}

function renderV3Glyph(cell, x, y, cellSize) {
  if (!['v3-shape-calibration', 'v3-data'].includes(cell.kind)) return '';
  const shape = getV3Shape(cell.shapeId);
  const maskHeight = shape.mask.length;
  const maskWidth = shape.mask[0].length;
  const moduleX = cellSize / maskWidth;
  const moduleY = cellSize / maskHeight;
  let fill = '#050505';
  if (cell.kind === 'v3-data') {
    const background = getV3Color(cell.colorIndex).rgb;
    fill = v3Luminance(background) >= 135 ? '#050505' : '#FFFFFF';
  }
  const parts = [];
  shape.mask.forEach((row, gy) => {
    [...row].forEach((bit, gx) => {
      if (bit !== '1') return;
      parts.push(`<rect x="${x + (gx * moduleX)}" y="${y + (gy * moduleY)}" width="${moduleX}" height="${moduleY}" fill="${fill}"/>`);
    });
  });
  return parts.join('');
}

export function renderOpticalFrameSvg(frame, options = {}) {
  const scale = options.scale ?? 2;
  const quietZone = options.quietZone ?? frame.quietZone ?? 24;
  const showGrid = options.showGrid ?? false;
  const borderWidth = options.borderWidth ?? (frame.version === 30 ? 6 : 4);
  const visualVariant = Number.isInteger(options.visualVariant) ? options.visualVariant : 0;
  const legacyHybrid = frame.version === 2 || frame.version === 21 || frame.version === 22;
  const maps = visualMaps(legacyHybrid ? visualVariant : 0);
  const total = frame.totalSize ?? (frame.logicalSize + (quietZone * 2));
  const displaySize = total * scale;
  const gridStroke = showGrid ? ' stroke="#FFFFFF" stroke-opacity="0.20" stroke-width="0.5"' : '';

  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${displaySize}" height="${displaySize}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges">`,
    `<rect width="${total}" height="${total}" fill="#FFFFFF"/>`,
    `<rect x="${quietZone}" y="${quietZone}" width="${frame.logicalSize}" height="${frame.logicalSize}" fill="#D8D8D8" stroke="#000000" stroke-width="${borderWidth}"/>`,
  ];

  const fiducialScale = frame.fiducialScale ?? 1;
  for (const center of getV1FiducialCenters(total, quietZone)) parts.push(renderFiducial(center, fiducialScale));

  for (const row of frame.cells) {
    for (const cell of row) {
      const x = quietZone + (cell.x * frame.cellSize);
      const y = quietZone + (cell.y * frame.cellSize);
      parts.push(`<rect x="${x}" y="${y}" width="${frame.cellSize}" height="${frame.cellSize}" fill="${fillForCell(cell, maps)}"${gridStroke}/>`);
      parts.push(renderLegacyGlyph(cell, x, y, frame.cellSize, maps));
      parts.push(renderV3Glyph(cell, x, y, frame.cellSize));
    }
  }
  parts.push('</svg>');
  return parts.join('');
}
