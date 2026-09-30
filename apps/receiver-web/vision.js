import { getV1FiducialCenters } from '../../packages/optical-codec/src/fiducials.js';

export const CAPTURE_MAX_WIDTH = 640;
export const RECTIFIED_SIZE = 304;
export const QUIET_ZONE = 24;
export const LOGICAL_SIZE = 256;
export const DEFAULT_GUIDE_COVERAGE = 0.82;

/** Draw the current camera frame into a modest-size processing canvas. */
export function drawVideoFrame(video, canvas, maxWidth = CAPTURE_MAX_WIDTH) {
  const sourceWidth = video.videoWidth || 1280;
  const sourceHeight = video.videoHeight || 720;
  const scale = Math.min(1, maxWidth / sourceWidth);
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(video, 0, 0, width, height);
  return { width, height, scale };
}

// Retained as a fallback/debug helper.
export function getCenteredGuideRect(width, height, coverage = DEFAULT_GUIDE_COVERAGE) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError('Guide dimensions must be positive numbers');
  }
  if (!Number.isFinite(coverage) || coverage <= 0 || coverage > 1) {
    throw new RangeError('Guide coverage must be > 0 and <= 1');
  }

  const side = Math.max(1, Math.floor(Math.min(width, height) * coverage));
  const x = Math.floor((width - side) / 2);
  const y = Math.floor((height - side) / 2);
  return { x, y, width: side, height: side };
}

export function rectifyGuide(sourceCanvas, rectifiedCanvas, guide = null) {
  const rect = guide ?? getCenteredGuideRect(sourceCanvas.width, sourceCanvas.height);
  rectifiedCanvas.width = RECTIFIED_SIZE;
  rectifiedCanvas.height = RECTIFIED_SIZE;
  const ctx = rectifiedCanvas.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.clearRect(0, 0, RECTIFIED_SIZE, RECTIFIED_SIZE);
  ctx.drawImage(
    sourceCanvas,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    RECTIFIED_SIZE,
    RECTIFIED_SIZE,
  );
  return rect;
}

function solveLinearSystem(rows) {
  const matrix = rows.map((row) => row.slice());
  const size = matrix.length;

  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    if (Math.abs(matrix[pivot][column]) < 1e-10) {
      throw new Error('Points cannot form a stable perspective transform');
    }
    [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];

    const divisor = matrix[column][column];
    for (let c = column; c <= size; c += 1) matrix[column][c] /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      if (Math.abs(factor) < 1e-14) continue;
      for (let c = column; c <= size; c += 1) {
        matrix[row][c] -= factor * matrix[column][c];
      }
    }
  }

  return matrix.map((row) => row[size]);
}

/** Compute a projective mapping from target points to source points. */
export function computePointHomography(targetPoints, sourcePoints) {
  if (!Array.isArray(targetPoints) || !Array.isArray(sourcePoints)
    || targetPoints.length !== 4 || sourcePoints.length !== 4) {
    throw new RangeError('Four target and four source points are required');
  }

  const rows = [];
  for (let i = 0; i < 4; i += 1) {
    const { x: u, y: v } = targetPoints[i];
    const { x, y } = sourcePoints[i];
    if (![u, v, x, y].every(Number.isFinite)) throw new TypeError('Point coordinates must be finite');
    rows.push([u, v, 1, 0, 0, 0, -x * u, -x * v, x]);
    rows.push([0, 0, 0, u, v, 1, -y * u, -y * v, y]);
  }
  return solveLinearSystem(rows);
}

/** Compute a projective mapping from an output square to a source quad. */
export function computeSquareToQuadHomography(corners, size = RECTIFIED_SIZE) {
  const max = size - 1;
  return computePointHomography([
    { x: 0, y: 0 },
    { x: max, y: 0 },
    { x: max, y: max },
    { x: 0, y: max },
  ], corners);
}

export function mapPerspectivePoint(h, u, v) {
  const denominator = (h[6] * u) + (h[7] * v) + 1;
  if (Math.abs(denominator) < 1e-10) return null;
  return {
    x: ((h[0] * u) + (h[1] * v) + h[2]) / denominator,
    y: ((h[3] * u) + (h[4] * v) + h[5]) / denominator,
  };
}

export function validateCornerQuad(corners) {
  if (!Array.isArray(corners) || corners.length !== 4) return false;
  let twiceArea = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    if (![a?.x, a?.y, b?.x, b?.y].every(Number.isFinite)) return false;
    twiceArea += (a.x * b.y) - (b.x * a.y);
  }
  return Math.abs(twiceArea) > 1500;
}

function warpWithHomography(sourceCanvas, rectifiedCanvas, h) {
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const source = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  rectifiedCanvas.width = RECTIFIED_SIZE;
  rectifiedCanvas.height = RECTIFIED_SIZE;
  const outputCtx = rectifiedCanvas.getContext('2d', { willReadFrequently: true });
  const output = outputCtx.createImageData(RECTIFIED_SIZE, RECTIFIED_SIZE);

  for (let v = 0; v < RECTIFIED_SIZE; v += 1) {
    for (let u = 0; u < RECTIFIED_SIZE; u += 1) {
      const point = mapPerspectivePoint(h, u, v);
      if (!point) continue;
      const sx = Math.round(point.x);
      const sy = Math.round(point.y);
      if (sx < 0 || sy < 0 || sx >= source.width || sy >= source.height) continue;

      const sourceOffset = ((sy * source.width) + sx) * 4;
      const targetOffset = ((v * RECTIFIED_SIZE) + u) * 4;
      output.data[targetOffset] = source.data[sourceOffset];
      output.data[targetOffset + 1] = source.data[sourceOffset + 1];
      output.data[targetOffset + 2] = source.data[sourceOffset + 2];
      output.data[targetOffset + 3] = 255;
    }
  }

  outputCtx.putImageData(output, 0, 0);
}

/** Manual quad warp retained as a debug fallback. */
export function rectifyQuad(sourceCanvas, rectifiedCanvas, corners) {
  if (!validateCornerQuad(corners)) throw new Error('The four corners are too small or invalid');
  const h = computeSquareToQuadHomography(corners, RECTIFIED_SIZE);
  warpWithHomography(sourceCanvas, rectifiedCanvas, h);
  return h;
}

/**
 * Perspective-correct using the four automatically detected fiducial CENTRES.
 * The target centres are known exactly, so the full 304×304 frame is recovered
 * without asking the user to touch any corners.
 */
export function rectifyFiducials(sourceCanvas, rectifiedCanvas, corners) {
  if (!validateCornerQuad(corners)) throw new Error('Detected fiducial quad is invalid');
  const targets = getV1FiducialCenters(RECTIFIED_SIZE, QUIET_ZONE)
    .map(({ x, y }) => ({ x, y }));
  const h = computePointHomography(targets, corners);
  warpWithHomography(sourceCanvas, rectifiedCanvas, h);
  return h;
}

function buildGrayIntegral(imageData) {
  const { width, height, data } = imageData;
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y += 1) {
    let rowSum = 0;
    for (let x = 1; x <= width; x += 1) {
      const offset = ((((y - 1) * width) + (x - 1)) * 4);
      const gray = (0.2126 * data[offset]) + (0.7152 * data[offset + 1]) + (0.0722 * data[offset + 2]);
      rowSum += gray;
      integral[(y * stride) + x] = integral[((y - 1) * stride) + x] + rowSum;
    }
  }

  return { integral, stride, width, height };
}

function boxStats(ii, cx, cy, size) {
  const half = size / 2;
  const x0 = Math.max(0, Math.floor(cx - half));
  const y0 = Math.max(0, Math.floor(cy - half));
  const x1 = Math.min(ii.width, Math.ceil(cx + half));
  const y1 = Math.min(ii.height, Math.ceil(cy + half));
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  const sum = ii.integral[(y1 * ii.stride) + x1]
    - ii.integral[(y0 * ii.stride) + x1]
    - ii.integral[(y1 * ii.stride) + x0]
    + ii.integral[(y0 * ii.stride) + x0];
  return { sum, area, mean: sum / area };
}

function scoreBullseye(ii, cx, cy, outerSize) {
  const outer = boxStats(ii, cx, cy, outerSize);
  const middle = boxStats(ii, cx, cy, outerSize * (10 / 18));
  const core = boxStats(ii, cx, cy, outerSize * (4 / 18));

  const outerRingArea = Math.max(1, outer.area - middle.area);
  const middleRingArea = Math.max(1, middle.area - core.area);
  const outerRing = (outer.sum - middle.sum) / outerRingArea;
  const middleRing = (middle.sum - core.sum) / middleRingArea;
  const center = core.mean;
  const darkMean = (outerRing * 0.68) + (center * 0.32);
  const contrast = middleRing - darkMean;

  if (middleRing < 120 || outerRing > 175 || center > 180) return null;
  if (middleRing - outerRing < 35 || middleRing - center < 35 || contrast < 48) return null;

  return { score: contrast, outerRing, middleRing, center };
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function orderFourPoints(points) {
  const sums = points.map((p) => p.x + p.y);
  const diffs = points.map((p) => p.x - p.y);
  const minIndex = (values) => values.indexOf(Math.min(...values));
  const maxIndex = (values) => values.indexOf(Math.max(...values));
  const indexes = [minIndex(sums), maxIndex(diffs), maxIndex(sums), minIndex(diffs)];
  if (new Set(indexes).size !== 4) return null;
  return indexes.map((index) => points[index]); // TL, TR, BR, BL
}

function polygonArea(points) {
  let twiceArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twiceArea += (a.x * b.y) - (b.x * a.y);
  }
  return Math.abs(twiceArea) / 2;
}

function selectBestFiducialQuad(peaks, width, height) {
  const candidates = peaks.slice(0, 18);
  const frameArea = width * height;
  let best = null;

  for (let a = 0; a < candidates.length - 3; a += 1) {
    for (let b = a + 1; b < candidates.length - 2; b += 1) {
      for (let c = b + 1; c < candidates.length - 1; c += 1) {
        for (let d = c + 1; d < candidates.length; d += 1) {
          const raw = [candidates[a], candidates[b], candidates[c], candidates[d]];
          const sizes = raw.map((p) => p.size);
          const sizeRatio = Math.max(...sizes) / Math.max(1, Math.min(...sizes));
          if (sizeRatio > 2.1) continue;

          const ordered = orderFourPoints(raw);
          if (!ordered) continue;
          const area = polygonArea(ordered);
          if (area < frameArea * 0.035) continue;

          const sides = [
            pointDistance(ordered[0], ordered[1]),
            pointDistance(ordered[1], ordered[2]),
            pointDistance(ordered[2], ordered[3]),
            pointDistance(ordered[3], ordered[0]),
          ];
          const minSide = Math.min(...sides);
          const maxSide = Math.max(...sides);
          if (minSide < Math.max(...sizes) * 3.2 || maxSide / Math.max(1, minSide) > 4.8) continue;

          const oppositePenalty = Math.abs(Math.log(sides[0] / sides[2]))
            + Math.abs(Math.log(sides[1] / sides[3]));
          const averageDetectorScore = raw.reduce((sum, p) => sum + p.score, 0) / 4;
          const normalizedArea = Math.min(0.7, area / frameArea);
          const score = averageDetectorScore + (normalizedArea * 90)
            - (oppositePenalty * 16) - ((sizeRatio - 1) * 18);

          if (!best || score > best.score) {
            best = { corners: ordered.map(({ x, y }) => ({ x, y })), score, area, raw };
          }
        }
      }
    }
  }

  return best;
}

/**
 * Detect the four black/white/black quiet-zone fiducials from ordinary RGBA data.
 * Uses integral-image nested-square scoring, so no OpenCV/WASM is needed.
 */
export function detectFiducialsFromImageData(imageData) {
  const ii = buildGrayIntegral(imageData);
  const minDim = Math.min(ii.width, ii.height);
  const maxMarker = Math.max(10, Math.min(64, Math.floor(minDim * 0.15)));
  const baseSizes = [8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64];
  const sizes = baseSizes.filter((size) => size <= maxMarker);
  const raw = [];

  for (const size of sizes) {
    const half = size / 2;
    const step = Math.max(2, Math.round(size * 0.27));
    for (let y = Math.ceil(half); y < ii.height - half; y += step) {
      for (let x = Math.ceil(half); x < ii.width - half; x += step) {
        const scored = scoreBullseye(ii, x, y, size);
        if (scored) raw.push({ x, y, size, ...scored });
      }
    }
  }

  raw.sort((a, b) => b.score - a.score);
  const peaks = [];
  for (const candidate of raw.slice(0, 400)) {
    const overlaps = peaks.some((peak) => (
      pointDistance(candidate, peak) < Math.max(candidate.size, peak.size) * 0.72
    ));
    if (!overlaps) peaks.push(candidate);
    if (peaks.length >= 24) break;
  }

  const best = selectBestFiducialQuad(peaks, ii.width, ii.height);
  if (!best) return null;
  return {
    corners: best.corners,
    score: best.score,
    area: best.area,
    candidates: peaks,
    markerSizes: best.raw.map((point) => point.size),
  };
}

export function detectFrameFiducials(sourceCanvas) {
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  return detectFiducialsFromImageData(imageData);
}

export function eventToCanvasPoint(canvas, event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

export function extractLogicalRoi(rectifiedCanvas, roiCanvas) {
  roiCanvas.width = LOGICAL_SIZE;
  roiCanvas.height = LOGICAL_SIZE;
  const ctx = roiCanvas.getContext('2d', { willReadFrequently: true });
  ctx.clearRect(0, 0, LOGICAL_SIZE, LOGICAL_SIZE);
  ctx.drawImage(
    rectifiedCanvas,
    QUIET_ZONE,
    QUIET_ZONE,
    LOGICAL_SIZE,
    LOGICAL_SIZE,
    0,
    0,
    LOGICAL_SIZE,
    LOGICAL_SIZE,
  );
}

export function drawAutoFiducialOverlay(canvas, detection, state = 'searching') {
  const ctx = canvas.getContext('2d');
  ctx.save();
  const locked = state === 'decoded';
  const found = Boolean(detection?.corners?.length === 4);
  const stroke = locked ? '#00ff88' : found ? '#56b4ff' : '#ffd84a';
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = Math.max(3, Math.round(canvas.width / 220));

  if (found) {
    const corners = detection.corners;
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();
    corners.forEach((point, index) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(7, canvas.width / 100), 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `700 ${Math.max(12, Math.round(canvas.width / 45))}px system-ui, sans-serif`;
      ctx.fillText(['TL', 'TR', 'BR', 'BL'][index], point.x + 10, point.y - 9);
    });
  }

  const text = locked
    ? 'AUTO ALIGNED · DATA OK'
    : found ? '4 LOCATORS FOUND · DECODING' : 'SEARCHING FOR 4 OPTICAL LOCATORS';
  ctx.font = `700 ${Math.max(13, Math.round(canvas.width / 43))}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.strokeStyle = 'rgba(0,0,0,0.82)';
  ctx.lineWidth = 4;
  ctx.strokeText(text, canvas.width / 2, 10);
  ctx.fillStyle = stroke;
  ctx.fillText(text, canvas.width / 2, 10);
  ctx.restore();
}

// Manual overlay retained only for development/debugging.
export function drawCornerOverlay(canvas, corners, state = 'selecting') {
  const ctx = canvas.getContext('2d');
  const labels = ['TL', 'TR', 'BR', 'BL'];
  const locked = corners.length === 4;
  const stroke = state === 'decoded' ? '#00ff88' : locked ? '#56b4ff' : '#ffd84a';
  ctx.save();
  ctx.lineWidth = Math.max(3, Math.round(canvas.width / 220));
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  if (corners.length > 1) {
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i].x, corners[i].y);
    if (locked) ctx.closePath();
    ctx.stroke();
  }
  corners.forEach((point, index) => {
    ctx.beginPath();
    ctx.arc(point.x, point.y, Math.max(7, canvas.width / 90), 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `700 ${Math.max(13, Math.round(canvas.width / 40))}px system-ui, sans-serif`;
    ctx.fillText(labels[index], point.x + 12, point.y - 12);
  });
  ctx.restore();
}

export function drawGuideOverlay(canvas, guide, state = 'align') {
  const ctx = canvas.getContext('2d');
  const stroke = state === 'locked' ? '#00ff88' : '#ffd84a';
  ctx.save();
  ctx.lineWidth = Math.max(3, Math.round(canvas.width / 220));
  ctx.strokeStyle = stroke;
  ctx.setLineDash([10, 7]);
  ctx.strokeRect(guide.x, guide.y, guide.width, guide.height);
  ctx.restore();
}
