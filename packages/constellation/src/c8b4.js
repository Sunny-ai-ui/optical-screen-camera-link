function hsvToRgb(h, s, v) {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb1;
  if (hp < 1) rgb1 = [c, x, 0];
  else if (hp < 2) rgb1 = [x, c, 0];
  else if (hp < 3) rgb1 = [0, c, x];
  else if (hp < 4) rgb1 = [0, x, c];
  else if (hp < 5) rgb1 = [x, 0, c];
  else rgb1 = [c, 0, x];
  const m = v - c;
  return rgb1.map((channel) => Math.round((channel + m) * 255));
}

const HUES = Object.freeze([0, 45, 90, 135, 180, 225, 270, 315]);

// Eight saturated, evenly spaced hue families. The receiver learns the actual
// camera-space values from a live calibration row every frame.
export const C8 = Object.freeze(HUES.map((hue, index) => Object.freeze({
  index,
  hue,
  name: `h${hue}`,
  rgb: Object.freeze(hsvToRgb(hue, 0.88, 0.94)),
})));

// Four neutral levels carry two robust bits. They are deliberately far apart
// and are also measured live every frame, so exposure shifts are calibrated.
export const B4 = Object.freeze([
  Object.freeze({ index: 0, name: 'white', rgb: Object.freeze([245, 245, 245]) }),
  Object.freeze({ index: 1, name: 'light-grey', rgb: Object.freeze([185, 185, 185]) }),
  Object.freeze({ index: 2, name: 'dark-grey', rgb: Object.freeze([70, 70, 70]) }),
  Object.freeze({ index: 3, name: 'black', rgb: Object.freeze([15, 15, 15]) }),
]);

export function getC8Color(index) {
  if (!Number.isInteger(index) || index < 0 || index >= C8.length) {
    throw new RangeError('C8 colour index must be an integer from 0 to 7');
  }
  return C8[index];
}

export function getB4Background(index) {
  if (!Number.isInteger(index) || index < 0 || index >= B4.length) {
    throw new RangeError('B4 background index must be an integer from 0 to 3');
  }
  return B4[index];
}

export function rgbToCss8(rgb) {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

export function luminance8(rgb) {
  return (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2]);
}
