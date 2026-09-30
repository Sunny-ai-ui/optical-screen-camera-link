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

// Eight widely separated hue families × four saturation/value levels.
// The receiver learns all 32 measured centroids from every V2 frame, so the
// camera is never expected to reproduce these nominal RGB values exactly.
const LEVELS = Object.freeze([
  { name: 'vivid-bright', saturation: 0.88, value: 0.94 },
  { name: 'soft-bright', saturation: 0.58, value: 0.94 },
  { name: 'vivid-dark', saturation: 0.88, value: 0.60 },
  { name: 'soft-dark', saturation: 0.55, value: 0.66 },
]);

const HUES = Object.freeze([0, 45, 90, 135, 180, 225, 270, 315]);

export const C32 = Object.freeze(HUES.flatMap((hue, hueIndex) =>
  LEVELS.map((level, levelIndex) => {
    const index = (hueIndex * LEVELS.length) + levelIndex;
    return Object.freeze({
      index,
      hue,
      level: levelIndex,
      name: `h${hue}-${level.name}`,
      rgb: Object.freeze(hsvToRgb(hue, level.saturation, level.value)),
    });
  }),
));

export function getC32Color(index) {
  if (!Number.isInteger(index) || index < 0 || index >= C32.length) {
    throw new RangeError('C32 colour index must be an integer from 0 to 31');
  }
  return C32[index];
}

export function c32RgbToCss(rgb) {
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]})`;
}

export function relativeLuminance(rgb) {
  return (0.2126 * rgb[0]) + (0.7152 * rgb[1]) + (0.0722 * rgb[2]);
}
