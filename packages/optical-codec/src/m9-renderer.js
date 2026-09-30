import { getV3Color, getV3Shape, v3Luminance, v3RgbToCss } from '../../constellation/src/v3.js';
import { getV1FiducialCenters, V1_FIDUCIAL } from './fiducials.js';
import { M9_HEADER_BITS, M9_TILE_GRID } from './m9-frame.js';

export const M9_RENDER_LAYOUT = Object.freeze({
  totalSize: 912,
  quietZone: 72,
  logicalSize: 768,
  tileCellSize: 17,
  tileSize: M9_TILE_GRID * 17,
  tileGap: 18,
  tileOriginX: 34,
  tileOriginY: 60,
  headerModule: 13,
  headerOriginY: 10,
  headerRowGap: 4,
});

function renderFiducial(center, scale = 3) {
  const outer = V1_FIDUCIAL.outerSize * scale;
  const middle = V1_FIDUCIAL.middleSize * scale;
  const core = V1_FIDUCIAL.coreSize * scale;
  return [
    `<rect x="${center.x - outer / 2}" y="${center.y - outer / 2}" width="${outer}" height="${outer}" fill="#000"/>`,
    `<rect x="${center.x - middle / 2}" y="${center.y - middle / 2}" width="${middle}" height="${middle}" fill="#fff"/>`,
    `<rect x="${center.x - core / 2}" y="${center.y - core / 2}" width="${core}" height="${core}" fill="#000"/>`,
  ].join('');
}

function renderGlyph(shapeId, x, y, cellSize, fill) {
  const shape = getV3Shape(shapeId);
  const moduleX = cellSize / shape.mask[0].length;
  const moduleY = cellSize / shape.mask.length;
  const parts = [];
  shape.mask.forEach((row, gy) => {
    [...row].forEach((bit, gx) => {
      if (bit !== '1') return;
      parts.push(`<rect x="${x + gx * moduleX}" y="${y + gy * moduleY}" width="${moduleX}" height="${moduleY}" fill="${fill}"/>`);
    });
  });
  return parts.join('');
}

function renderCell(cell, x, y, size) {
  if (cell.kind === 'm9-timing') {
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${cell.dark ? '#000' : '#fff'}"/>`;
  }
  if (cell.kind === 'm9-color-calibration') {
    return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${v3RgbToCss(getV3Color(cell.colorIndex).rgb)}"/>`;
  }
  if (cell.kind === 'm9-shape-calibration') {
    return [
      `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#B8B8B8"/>`,
      renderGlyph(cell.shapeId, x, y, size, '#050505'),
    ].join('');
  }
  if (cell.kind === 'm9-data' || cell.kind === 'm9-marker') {
    const rgb = getV3Color(cell.colorIndex).rgb;
    const fill = v3RgbToCss(rgb);
    const glyph = v3Luminance(rgb) >= 135 ? '#050505' : '#fff';
    return [
      `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${fill}"/>`,
      renderGlyph(cell.shapeId, x, y, size, glyph),
      cell.kind === 'm9-marker'
        ? `<rect x="${x + 1}" y="${y + 1}" width="${size - 2}" height="${size - 2}" fill="none" stroke="#fff" stroke-width="1"/>`
        : '',
    ].join('');
  }
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="#D8D8D8"/>`;
}

function renderHeader(bits, quietZone, logicalSize) {
  if (!(bits instanceof Uint8Array) || bits.length !== M9_HEADER_BITS) return '';
  const { headerModule, headerOriginY, headerRowGap } = M9_RENDER_LAYOUT;
  const width = headerModule * bits.length;
  const startX = quietZone + Math.floor((logicalSize - width) / 2);
  const firstY = quietZone + headerOriginY;
  const secondY = firstY + headerModule + headerRowGap;
  const rows = [firstY, secondY];
  const parts = [];
  for (const y of rows) {
    bits.forEach((bit, index) => {
      const x = startX + index * headerModule;
      parts.push(`<rect x="${x}" y="${y}" width="${headerModule}" height="${headerModule}" fill="${bit ? '#000' : '#fff'}"/>`);
    });
  }
  return parts.join('');
}

export function renderM9SuperframeSvg(frame, options = {}) {
  if (!frame || frame.version !== 50 || !Array.isArray(frame.tiles) || frame.tiles.length !== 9) {
    throw new TypeError('renderM9SuperframeSvg expects an M9 superframe');
  }
  const layout = M9_RENDER_LAYOUT;
  const scale = options.scale ?? 1;
  const displaySize = layout.totalSize * scale;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${displaySize}" height="${displaySize}" viewBox="0 0 ${layout.totalSize} ${layout.totalSize}" shape-rendering="crispEdges">`,
    `<rect width="${layout.totalSize}" height="${layout.totalSize}" fill="#fff"/>`,
    `<rect x="${layout.quietZone}" y="${layout.quietZone}" width="${layout.logicalSize}" height="${layout.logicalSize}" fill="#ECECEC" stroke="#000" stroke-width="6"/>`,
  ];

  for (const center of getV1FiducialCenters(layout.totalSize, layout.quietZone)) parts.push(renderFiducial(center, 3));
  parts.push(renderHeader(frame.headerBits, layout.quietZone, layout.logicalSize));

  frame.tiles.forEach((tile, tileIndex) => {
    const col = tileIndex % 3;
    const row = Math.floor(tileIndex / 3);
    const originX = layout.quietZone + layout.tileOriginX + col * (layout.tileSize + layout.tileGap);
    const originY = layout.quietZone + layout.tileOriginY + row * (layout.tileSize + layout.tileGap);
    parts.push(`<rect x="${originX - 2}" y="${originY - 2}" width="${layout.tileSize + 4}" height="${layout.tileSize + 4}" fill="#fff" stroke="#111" stroke-width="2"/>`);
    for (const cellRow of tile.cells) {
      for (const cell of cellRow) {
        const x = originX + cell.x * layout.tileCellSize;
        const y = originY + cell.y * layout.tileCellSize;
        parts.push(renderCell(cell, x, y, layout.tileCellSize));
      }
    }
  });

  parts.push('</svg>');
  return parts.join('');
}
