export const C16 = Object.freeze([
  { symbol: 0x0, name: 'red',     rgb: [230, 48, 48] },
  { symbol: 0x1, name: 'orange',  rgb: [235, 118, 30] },
  { symbol: 0x2, name: 'yellow',  rgb: [220, 196, 28] },
  { symbol: 0x3, name: 'lime',    rgb: [132, 205, 38] },
  { symbol: 0x4, name: 'green',   rgb: [32, 176, 68] },
  { symbol: 0x5, name: 'teal',    rgb: [26, 166, 138] },
  { symbol: 0x6, name: 'cyan',    rgb: [28, 188, 218] },
  { symbol: 0x7, name: 'sky',     rgb: [48, 128, 232] },
  { symbol: 0x8, name: 'blue',    rgb: [54, 68, 214] },
  { symbol: 0x9, name: 'violet',  rgb: [116, 58, 216] },
  { symbol: 0xA, name: 'magenta', rgb: [202, 54, 206] },
  { symbol: 0xB, name: 'pink',    rgb: [226, 66, 142] },
  { symbol: 0xC, name: 'brown',   rgb: [146, 82, 38] },
  { symbol: 0xD, name: 'olive',   rgb: [112, 118, 34] },
  { symbol: 0xE, name: 'slate',   rgb: [42, 112, 126] },
  { symbol: 0xF, name: 'purple',  rgb: [112, 38, 94] },
]);

export function getC16Color(symbol) {
  if (!Number.isInteger(symbol) || symbol < 0 || symbol > 15) {
    throw new RangeError('C16 symbol must be an integer from 0 to 15');
  }
  return C16[symbol];
}

export function rgbToCss(rgb) {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}
