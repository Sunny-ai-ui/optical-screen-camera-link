// Five-by-five high-contrast glyph masks. Each module renders as a 2×2 block
// inside a 16×16 optical cell, leaving untouched corner patches for colour
// measurement. The receiver learns the captured shape templates every frame.
//
// Important: none of the data glyphs should resemble the black/white/black
// quiet-zone fiducials. Earlier V2 used a ring as shape 0; zero padding then
// produced many miniature locator-like symbols and could steal corner lock.
export const S8_SHAPES = Object.freeze([
  Object.freeze({ name: 't', mask: Object.freeze(['11111', '00100', '00100', '00100', '00100']) }),
  Object.freeze({ name: 'x', mask: Object.freeze(['10001', '01010', '00100', '01010', '10001']) }),
  Object.freeze({ name: 'plus', mask: Object.freeze(['00100', '00100', '11111', '00100', '00100']) }),
  Object.freeze({ name: 'diamond', mask: Object.freeze(['00100', '01010', '10001', '01010', '00100']) }),
  Object.freeze({ name: 'horizontal-bars', mask: Object.freeze(['11111', '00000', '11111', '00000', '11111']) }),
  Object.freeze({ name: 'vertical-bars', mask: Object.freeze(['10101', '10101', '10101', '10101', '10101']) }),
  Object.freeze({ name: 'left-bracket', mask: Object.freeze(['11100', '10000', '10000', '10000', '11100']) }),
  Object.freeze({ name: 'stair', mask: Object.freeze(['11000', '01100', '00110', '00011', '10001']) }),
]);

export function getS8Shape(shapeId) {
  if (!Number.isInteger(shapeId) || shapeId < 0 || shapeId >= S8_SHAPES.length) {
    throw new RangeError('S8 shape id must be an integer from 0 to 7');
  }
  return S8_SHAPES[shapeId];
}

export function splitS8C32Byte(value) {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new RangeError('S8C32 value must be one byte');
  }
  return {
    shapeId: value >>> 5,
    colorIndex: value & 0x1F,
  };
}

export function joinS8C32Byte(shapeId, colorIndex) {
  if (!Number.isInteger(shapeId) || shapeId < 0 || shapeId > 7) {
    throw new RangeError('shapeId must be 0..7');
  }
  if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex > 31) {
    throw new RangeError('colorIndex must be 0..31');
  }
  return (shapeId << 5) | colorIndex;
}
