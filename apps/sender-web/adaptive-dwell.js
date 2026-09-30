export const V3_AUTO_DWELL_MS = Object.freeze({
  'V3-G32-S4-C4-RS15-11': 700,
  'V3-G48-S4-C4-RS15-11': 900,
  'V3-G64-S4-C4-RS15-11': 1200,
});

export function resolveFrameDwellMs(rateValue, profile) {
  if (rateValue !== 'auto') {
    const parsed = Number(rateValue);
    return Number.isFinite(parsed) && parsed >= 100 ? parsed : 1000;
  }
  return V3_AUTO_DWELL_MS[profile?.id] ?? 1000;
}

export function describeFrameDwell(rateValue, profile) {
  const dwell = resolveFrameDwellMs(rateValue, profile);
  if (rateValue === 'auto') return `Auto Reliable · ${dwell} ms/frame`;
  const fps = 1000 / dwell;
  return `${Number.isInteger(fps) ? fps : fps.toFixed(2)} fps`;
}
