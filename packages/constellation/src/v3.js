// V3 intentionally uses a small, highly separated physical alphabet.
// Colour contributes 2 bits and shape contributes 2 bits: 4 bits/cell.

export const V3_COLORS = Object.freeze([
  Object.freeze({ id: 0, name: 'red', rgb: Object.freeze([232, 55, 46]) }),
  Object.freeze({ id: 1, name: 'green', rgb: Object.freeze([40, 205, 82]) }),
  Object.freeze({ id: 2, name: 'blue', rgb: Object.freeze([45, 105, 235]) }),
  Object.freeze({ id: 3, name: 'yellow', rgb: Object.freeze([245, 205, 35]) }),
]);

// Three-by-three masks. A V3 cell is 12 logical pixels, therefore every mask
// module is a large 4x4 logical block. At the ~8 camera-pixels/cell measured in
// the first physical test this gives roughly 2.5 camera pixels per module rather
// than ~1.3 pixels with the old 6x6 masks.
//
// The patterns deliberately use very different first-order geometry: a broad
// vertical bar, broad horizontal bar and the two diagonals. They are not font
// glyphs and do not depend on browser text rendering.
export const V3_SHAPES = Object.freeze([
  Object.freeze({
    id: 0,
    name: 'vertical',
    mask: Object.freeze(['010', '010', '010']),
  }),
  Object.freeze({
    id: 1,
    name: 'horizontal',
    mask: Object.freeze(['000', '111', '000']),
  }),
  Object.freeze({
    id: 2,
    name: 'diag-down',
    mask: Object.freeze(['100', '010', '001']),
  }),
  Object.freeze({
    id: 3,
    name: 'diag-up',
    mask: Object.freeze(['001', '010', '100']),
  }),
]);

export function getV3Color(index) {
  if (!Number.isInteger(index) || index < 0 || index >= V3_COLORS.length) {
    throw new RangeError('V3 colour index must be 0..3');
  }
  return V3_COLORS[index];
}

export function getV3Shape(index) {
  if (!Number.isInteger(index) || index < 0 || index >= V3_SHAPES.length) {
    throw new RangeError('V3 shape index must be 0..3');
  }
  return V3_SHAPES[index];
}

export function splitV3Nibble(value) {
  if (!Number.isInteger(value) || value < 0 || value > 15) throw new RangeError('V3 symbol must be a nibble');
  return { shapeId: value >>> 2, colorIndex: value & 0x03 };
}

export function joinV3Nibble(shapeId, colorIndex) {
  if (!Number.isInteger(shapeId) || shapeId < 0 || shapeId > 3) throw new RangeError('shapeId must be 0..3');
  if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex > 3) throw new RangeError('colorIndex must be 0..3');
  return (shapeId << 2) | colorIndex;
}

export function v3RgbToCss(rgb) {
  return `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
}

export function v3Luminance(rgb) {
  return (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2]);
}
