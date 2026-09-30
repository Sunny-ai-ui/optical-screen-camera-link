import { getV1FiducialCenters } from '../../packages/optical-codec/src/fiducials.js';
import { V3_G64_S4_C4_RS } from '../../packages/optical-codec/src/profiles.js';
import {
  computePointHomography,
  mapPerspectivePoint,
  detectFrameFiducials,
} from '../receiver-web/vision.js';

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
  if (middleRing < 112 || outerRing > 185 || center > 188) return null;
  if (middleRing - outerRing < 30 || middleRing - center < 30 || contrast < 42) return null;
  return { score: contrast, outerRing, middleRing, center };
}

function pointDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function polygonArea(points) {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    twice += (a.x * b.y) - (b.x * a.y);
  }
  return Math.abs(twice) / 2;
}

function validTrackedQuad(corners, width, height) {
  if (!corners || corners.length !== 4) return false;
  const area = polygonArea(corners);
  if (area < width * height * 0.035) return false;
  const sides = [
    pointDistance(corners[0], corners[1]),
    pointDistance(corners[1], corners[2]),
    pointDistance(corners[2], corners[3]),
    pointDistance(corners[3], corners[0]),
  ];
  const min = Math.min(...sides);
  const max = Math.max(...sides);
  if (min < 35 || max / Math.max(1, min) > 3.8) return false;
  const diagonalA = pointDistance(corners[0], corners[2]);
  const diagonalB = pointDistance(corners[1], corners[3]);
  if (Math.max(diagonalA, diagonalB) / Math.max(1, Math.min(diagonalA, diagonalB)) > 2.0) return false;
  return true;
}

function localTrack(imageData, previous) {
  if (!previous?.corners?.length || previous.corners.length !== 4) return null;
  const ii = buildGrayIntegral(imageData);
  const tracked = [];
  const markerSizes = [];
  let totalScore = 0;

  for (let index = 0; index < 4; index += 1) {
    const point = previous.corners[index];
    const previousSize = previous.markerSizes?.[index] ?? Math.max(12, imageData.width * 0.035);
    const radius = Math.max(14, previousSize * 1.8);
    const step = Math.max(2, Math.round(previousSize * 0.12));
    const sizes = [0.78, 0.9, 1.0, 1.12, 1.25]
      .map((factor) => Math.max(8, Math.round(previousSize * factor)));
    let best = null;

    for (const size of sizes) {
      for (let y = Math.max(size / 2, point.y - radius); y <= Math.min(ii.height - size / 2, point.y + radius); y += step) {
        for (let x = Math.max(size / 2, point.x - radius); x <= Math.min(ii.width - size / 2, point.x + radius); x += step) {
          const scored = scoreBullseye(ii, x, y, size);
          if (!scored) continue;
          const displacement = pointDistance(point, { x, y });
          const score = scored.score - (displacement / Math.max(1, radius)) * 18;
          if (!best || score > best.rank) best = { x, y, size, rank: score, score: scored.score };
        }
      }
    }

    if (!best) return null;
    tracked.push({ x: best.x, y: best.y });
    markerSizes.push(best.size);
    totalScore += best.score;
  }

  if (!validTrackedQuad(tracked, imageData.width, imageData.height)) return null;
  return {
    corners: tracked,
    markerSizes,
    area: polygonArea(tracked),
    score: totalScore / 4,
    mode: 'tracked',
  };
}

function smoothDetection(previous, next, alpha = 0.5) {
  if (!previous) return next;
  return {
    ...next,
    corners: next.corners.map((point, index) => ({
      x: previous.corners[index].x * (1 - alpha) + point.x * alpha,
      y: previous.corners[index].y * (1 - alpha) + point.y * alpha,
    })),
  };
}

export function trackOrAcquireV3Fiducials(sourceCanvas, previous = null) {
  const ctx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const imageData = ctx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  if (previous) {
    const tracked = localTrack(imageData, previous);
    if (tracked) return smoothDetection(previous, tracked, 0.48);
  }
  const acquired = detectFrameFiducials(sourceCanvas);
  return acquired ? { ...acquired, mode: 'global' } : null;
}

export function drawHighResolutionVideoFrame(video, canvas, maxWidth = 1440) {
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

function sampleBilinear(source, x, y, channel) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(source.width - 1, x0 + 1);
  const y1 = Math.min(source.height - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const offset = (xx, yy) => ((yy * source.width) + xx) * 4 + channel;
  const a = source.data[offset(x0, y0)] * (1 - fx) + source.data[offset(x1, y0)] * fx;
  const b = source.data[offset(x0, y1)] * (1 - fx) + source.data[offset(x1, y1)] * fx;
  return a * (1 - fy) + b * fy;
}

export function rectifyV3LogicalRoi(
  video,
  detectorCanvas,
  detection,
  highSourceCanvas,
  roiCanvas,
  profile = V3_G64_S4_C4_RS,
) {
  drawHighResolutionVideoFrame(video, highSourceCanvas);
  const scaleX = highSourceCanvas.width / detectorCanvas.width;
  const scaleY = highSourceCanvas.height / detectorCanvas.height;
  const sourceCorners = detection.corners.map((point) => ({ x: point.x * scaleX, y: point.y * scaleY }));
  const targets = getV1FiducialCenters(profile.totalSize, profile.quietZone).map(({ x, y }) => ({ x, y }));
  const h = computePointHomography(targets, sourceCorners);

  const sourceCtx = highSourceCanvas.getContext('2d', { willReadFrequently: true });
  const source = sourceCtx.getImageData(0, 0, highSourceCanvas.width, highSourceCanvas.height);
  roiCanvas.width = profile.logicalSize;
  roiCanvas.height = profile.logicalSize;
  const outputCtx = roiCanvas.getContext('2d', { willReadFrequently: true });
  const output = outputCtx.createImageData(profile.logicalSize, profile.logicalSize);

  for (let y = 0; y < profile.logicalSize; y += 1) {
    const v = y + profile.quietZone;
    for (let x = 0; x < profile.logicalSize; x += 1) {
      const u = x + profile.quietZone;
      const point = mapPerspectivePoint(h, u, v);
      if (!point || point.x < 0 || point.y < 0 || point.x >= source.width - 1 || point.y >= source.height - 1) continue;
      const target = ((y * profile.logicalSize) + x) * 4;
      output.data[target] = sampleBilinear(source, point.x, point.y, 0);
      output.data[target + 1] = sampleBilinear(source, point.x, point.y, 1);
      output.data[target + 2] = sampleBilinear(source, point.x, point.y, 2);
      output.data[target + 3] = 255;
    }
  }
  outputCtx.putImageData(output, 0, 0);
  return { highSourceWidth: highSourceCanvas.width, highSourceHeight: highSourceCanvas.height, scaleX, scaleY };
}

export function estimateV3CameraPixelsPerCell(video, detectorCanvas, detection, profile = V3_G64_S4_C4_RS) {
  if (!detection?.corners?.length) return 0;
  const scaleX = (video.videoWidth || detectorCanvas.width) / detectorCanvas.width;
  const scaleY = (video.videoHeight || detectorCanvas.height) / detectorCanvas.height;
  const scaled = detection.corners.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY }));
  const horizontal = (pointDistance(scaled[0], scaled[1]) + pointDistance(scaled[3], scaled[2])) / 2;
  const vertical = (pointDistance(scaled[0], scaled[3]) + pointDistance(scaled[1], scaled[2])) / 2;
  const fiducialSpan = profile.totalSize - profile.quietZone;
  const logicalScale = profile.logicalSize / fiducialSpan;
  return ((horizontal + vertical) / 2) * logicalScale / profile.gridSize;
}
