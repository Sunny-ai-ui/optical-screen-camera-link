export const V1_FIDUCIAL = Object.freeze({
  outerSize: 18,
  middleSize: 10,
  coreSize: 4,
});

/**
 * Fixed fiducial centres in the 304×304 optical frame.
 * The centres sit halfway through the 24px quiet zone so they never consume
 * logical data cells.
 */
export function getV1FiducialCenters(totalSize = 304, quietZone = 24) {
  const inset = quietZone / 2;
  const far = totalSize - inset;
  return [
    { name: 'TL', x: inset, y: inset },
    { name: 'TR', x: far, y: inset },
    { name: 'BR', x: far, y: far },
    { name: 'BL', x: inset, y: far },
  ];
}
