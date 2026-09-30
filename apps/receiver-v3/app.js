import { decodePacket, FRAME_TYPES, FRAME_TYPE_NAMES, PacketError, TransferReassembler } from '../../packages/protocol/src/index.js';
import { V3_G32_S4_C4_RS, V3_PROFILES } from '../../packages/optical-codec/src/profiles.js';
import { describeCameraError, listVideoInputs, openCameraWithFallback } from '../receiver-web/camera.js';
import { drawVideoFrame, drawAutoFiducialOverlay, extractLogicalRoi, rectifyFiducials } from '../receiver-web/vision.js';
import { estimateV3CameraPixelsPerCell, rectifyV3LogicalRoi, trackOrAcquireV3Fiducials } from './vision-v3.js';
import { detectV3Coarse, decodeV3Observation, decodeV3Roi, observeV3Roi } from './v3-decoder.js';
import { TemporalObservationStore } from './temporal-fusion.js';
import { scoreV3FrameQuality, shouldDecodeObservation } from './frame-quality.js';
import { AdaptiveLinkController } from './adaptive-link.js';
import { FountainReassembler } from '../../packages/fountain/src/index.js';
import { ChannelCalibrator } from './channel-calibration.js';
import { optimizeLink } from './link-optimizer.js';
import { calibrateObservationConfidences, deriveDecoderTuning } from './decoder-tuning.js';
import { decodePayload } from '../../packages/payload-codec/src/index.js';
import {
  computeBusyLoopDelayMs,
  computeTemporalWindowMs,
  ProfileLockController,
  progressiveEvidenceTarget,
  qualityGateTolerance,
} from './receiver-policy.js';

const video = document.querySelector('#camera');
const sourceCanvas = document.querySelector('#sourceCanvas');
const highSourceCanvas = document.querySelector('#highSourceCanvas');
const coarseRectified = document.querySelector('#coarseRectified');
const coarseRoi = document.querySelector('#coarseRoi');
const v3Roi = document.querySelector('#v3Roi');
const startButton = document.querySelector('#startCamera');
const stopButton = document.querySelector('#stopCamera');
const resetButton = document.querySelector('#resetTransfer');
const saveDebugButton = document.querySelector('#saveDebug');
const refreshButton = document.querySelector('#refreshCameras');
const cameraSelect = document.querySelector('#cameraSelect');
const toggleDebug = document.querySelector('#toggleDebug');
const debugPanel = document.querySelector('#debugPanel');
const cameraState = document.querySelector('#cameraState');
const trackingState = document.querySelector('#trackingState');
const decodeState = document.querySelector('#decodeState');
const transferState = document.querySelector('#transferState');
const cameraError = document.querySelector('#cameraError');
const metricsHost = document.querySelector('#metrics');
const output = document.querySelector('#output');
const logHost = document.querySelector('#log');

let stream = null;
let running = false;
let loopTimer = null;
let lastDetection = null;
let detectorMisses = 0;
let coarseMisses = 0;
let activeProfile = null;
let receiver = new TransferReassembler();
let fountainReceiver = new FountainReassembler();
let transportMode = 'waiting';
let seenPackets = new Set();
let lastCompletedSession = null;
let metrics = createMetrics();
const receiverMode = new URLSearchParams(location.search).get('mode') === 'legacy' ? 'legacy' : 'temporal';
let temporalStore = new TemporalObservationStore();
let decoderWorker = null;
let adaptiveLink = new AdaptiveLinkController();
let channelCalibrator = new ChannelCalibrator();
let profileLock = new ProfileLockController({ switchStreak: 4 });
let decoderBusy = false;
let workerRequestId = 0;
const workerRequests = new Map();

function createMetrics() {
  return {
    profileId: activeProfile?.id ?? 'Auto-detecting V3',
    captureFrames: 0,
    globalAcquires: 0,
    trackedFrames: 0,
    detectorMisses: 0,
    coarseLocks: 0,
    opticalAttempts: 0,
    opticalDecodes: 0,
    rsRejects: 0,
    protocolRejects: 0,
    crcRejects: 0,
    acceptedUniquePackets: 0,
    duplicates: 0,
    pixelsPerCell: 0,
    timingSeparation: 0,
    signatureSeparation: 0,
    phaseX: 0,
    phaseY: 0,
    rotation: 0,
    colorConfidence: 0,
    shapeConfidence: 0,
    averageConfidence: 0,
    lastRsCorrected: 0,
    lastRsErasures: 0,
    totalRsCorrected: 0,
    totalRsErasures: 0,
    lastRsBlocks: 0,
    lastRsFailedBlock: null,
    firstAcceptedAt: null,
    completedAt: null,
    observationCount: 0,
    temporalAttempts: 0,
    temporalSuccesses: 0,
    temporalTransitions: 0,
    cellAgreement: 0,
    frameQuality: 0,
    workerSkips: 0,
    decoderLatencyMs: 0,
    linkQuality: 0,
    transportMode: 'waiting',
    fountainDroplets: 0,
    fountainSourceBlocks: 0,
    fountainRecoveredBlocks: 0,
    fountainProgress: 0,
    evidenceTarget: 2,
    progressiveEvidenceTarget: 2,
    temporalWindowMs: 0,
    qualityGateTolerance: 0,
    linkRecommendation: 'hold',
    recommendedProfileId: '—',
    goodLinkStreak: 0,
    badLinkStreak: 0,
    calibrationState: 'learning',
    calibrationSamples: 0,
    learnedQualityThreshold: 0.42,
    calibratedTiming: 0,
    calibratedSignature: 0,
    calibratedDecodeRate: 0,
    optimizerMode: 'learning',
    optimizedDwellMs: 0,
    optimizedOverhead: 1,
    optimizedProfileId: '—',
    decoderTimingGate: 30,
    decoderSignatureGate: 10,
    calibrationConfidenceScale: 1,
    lowConfidenceCellRate: 0,
    colorCalibrationSeparation: 0,
    shapeCalibrationSeparation: 0,
    refinedCellRate: 0,
    rsSelectiveRetries: 0,
    rsRescuedBlocks: '—',
    payloadCodec: '—',
    payloadIntegrity: '—',
    payloadOriginalBytes: 0,
    lastError: '',
  };
}

function log(message) {
  const row = document.createElement('div');
  row.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logHost.prepend(row);
  while (logHost.children.length > 35) logHost.lastElementChild.remove();
}

function setPill(element, text, kind = 'neutral') {
  element.textContent = text;
  element.dataset.kind = kind;
}

function showCameraError(info = null) {
  if (!info) {
    cameraError.hidden = true;
    cameraError.innerHTML = '';
    return;
  }
  cameraError.hidden = false;
  cameraError.innerHTML = `<strong>${info.title}</strong><span>${info.detail}</span><code>${info.technical}</code>`;
}

function applyV3Diagnostics(diag) {
  if (!diag) return;
  if (Number.isFinite(diag.timingSeparation)) metrics.timingSeparation = diag.timingSeparation;
  if (Number.isFinite(diag.signatureSeparation)) metrics.signatureSeparation = diag.signatureSeparation;
  if (Number.isFinite(diag.phaseX)) metrics.phaseX = diag.phaseX;
  if (Number.isFinite(diag.phaseY)) metrics.phaseY = diag.phaseY;
  if (Number.isFinite(diag.rotation)) metrics.rotation = diag.rotation;
  if (Number.isFinite(diag.averageColorConfidence)) metrics.colorConfidence = diag.averageColorConfidence;
  if (Number.isFinite(diag.averageShapeConfidence)) metrics.shapeConfidence = diag.averageShapeConfidence;
  if (Number.isFinite(diag.averageConfidence)) metrics.averageConfidence = diag.averageConfidence;
  if (Number.isFinite(diag.lowConfidenceCellRate)) metrics.lowConfidenceCellRate = diag.lowConfidenceCellRate;
  if (Number.isFinite(diag.colorCalibrationSeparation)) metrics.colorCalibrationSeparation = diag.colorCalibrationSeparation;
  if (Number.isFinite(diag.shapeCalibrationSeparation)) metrics.shapeCalibrationSeparation = diag.shapeCalibrationSeparation;
  if (Number.isFinite(diag.refinedCellRate)) metrics.refinedCellRate = diag.refinedCellRate;
  if (Number.isFinite(diag.selectiveRetryAttempts)) metrics.rsSelectiveRetries = diag.selectiveRetryAttempts;
  if (Array.isArray(diag.rescuedBlocks)) metrics.rsRescuedBlocks = diag.rescuedBlocks.length ? diag.rescuedBlocks.join(',') : '—';
}

function currentTransportStatus() {
  if (transportMode === 'fountain') return fountainReceiver.status();
  return receiver.status();
}

function renderMetrics() {
  const status = currentTransportStatus();
  let usefulBps = 0;
  if (status.complete && status.totalBytes !== null && metrics.firstAcceptedAt !== null) {
    const end = metrics.completedAt ?? performance.now();
    const seconds = Math.max(0.001, (end - metrics.firstAcceptedAt) / 1000);
    usefulBps = Math.round((status.totalBytes * 8) / seconds);
  }
  const values = [
    ['Profile', metrics.profileId],
    ['Camera samples', metrics.captureFrames],
    ['Global acquires', metrics.globalAcquires],
    ['Locally tracked', metrics.trackedFrames],
    ['Tracker misses', metrics.detectorMisses],
    ['V3 coarse locks', metrics.coarseLocks],
    ['Camera px / cell', metrics.pixelsPerCell ? metrics.pixelsPerCell.toFixed(1) : '—'],
    ['Receiver mode', receiverMode],
    ['Optical attempts', metrics.opticalAttempts],
    ['Observation group', metrics.observationCount],
    ['Frame quality', `${(metrics.frameQuality * 100).toFixed(1)}%`],
    ['Cell agreement', `${(metrics.cellAgreement * 100).toFixed(1)}%`],
    ['Temporal attempts', metrics.temporalAttempts],
    ['Temporal successes', metrics.temporalSuccesses],
    ['Frame transitions', metrics.temporalTransitions],
    ['Worker skips', metrics.workerSkips],
    ['Decode latency', metrics.decoderLatencyMs ? `${metrics.decoderLatencyMs.toFixed(0)} ms` : '—'],
    ['Link quality', `${(metrics.linkQuality * 100).toFixed(1)}%`],
    ['Transport', metrics.transportMode],
    ['Payload codec', metrics.payloadCodec],
    ['Payload integrity', metrics.payloadIntegrity],
    ['Fountain droplets', metrics.fountainDroplets || '—'],
    ['Recovered source blocks', metrics.fountainSourceBlocks ? `${metrics.fountainRecoveredBlocks}/${metrics.fountainSourceBlocks}` : '—'],
    ['Fountain progress', metrics.fountainSourceBlocks ? `${(metrics.fountainProgress * 100).toFixed(1)}%` : '—'],
    ['Evidence target', metrics.evidenceTarget],
    ['RS first-attempt target', metrics.progressiveEvidenceTarget],
    ['Temporal evidence window', metrics.temporalWindowMs ? `${(metrics.temporalWindowMs / 1000).toFixed(1)} s` : '—'],
    ['Quality-gate tolerance', `${(metrics.qualityGateTolerance * 100).toFixed(1)}%`],
    ['Adaptive action', metrics.linkRecommendation],
    ['Recommended profile', metrics.recommendedProfileId],
    ['Good/bad streak', `${metrics.goodLinkStreak}/${metrics.badLinkStreak}`],
    ['Calibration', `${metrics.calibrationState} · ${metrics.calibrationSamples} samples`],
    ['Learned quality gate', `${(metrics.learnedQualityThreshold * 100).toFixed(0)}%`],
    ['Cal timing/signature', `${metrics.calibratedTiming.toFixed(1)} / ${metrics.calibratedSignature.toFixed(1)}`],
    ['Cal decode success', `${(metrics.calibratedDecodeRate * 100).toFixed(1)}%`],
    ['Optimizer mode', metrics.optimizerMode],
    ['Suggested sender dwell', metrics.optimizedDwellMs ? `${metrics.optimizedDwellMs} ms` : '—'],
    ['Suggested fountain extra', `${Math.round(metrics.optimizedOverhead * 100)}%`],
    ['Optimized profile', metrics.optimizedProfileId],
    ['Decoder timing gate', metrics.decoderTimingGate.toFixed(1)],
    ['Decoder signature gate', metrics.decoderSignatureGate.toFixed(1)],
    ['Calibration confidence scale', metrics.calibrationConfidenceScale.toFixed(2)],
    ['Low-confidence cells', `${(metrics.lowConfidenceCellRate * 100).toFixed(1)}%`],
    ['Colour calibration separation', metrics.colorCalibrationSeparation.toFixed(3)],
    ['Shape calibration separation', metrics.shapeCalibrationSeparation.toFixed(3)],
    ['Locally refined cells', `${(metrics.refinedCellRate * 100).toFixed(1)}%`],
    ['RS selective retries', metrics.rsSelectiveRetries],
    ['RS rescued blocks', metrics.rsRescuedBlocks],
    ['Optical decodes', metrics.opticalDecodes],
    ['RS frame rejects', metrics.rsRejects],
    ['Protocol rejects', metrics.protocolRejects],
    ['CRC rejects', metrics.crcRejects],
    ['Unique packets', metrics.acceptedUniquePackets],
    ['Timing contrast', metrics.timingSeparation.toFixed(1)],
    ['Signature contrast', metrics.signatureSeparation.toFixed(1)],
    ['Fine phase', `${metrics.phaseX}, ${metrics.phaseY}px`],
    ['Shape confidence', `${(metrics.shapeConfidence * 100).toFixed(1)}%`],
    ['Colour confidence', `${(metrics.colorConfidence * 100).toFixed(1)}%`],
    ['Avg confidence', `${(metrics.averageConfidence * 100).toFixed(1)}%`],
    ['RS corrected / frame', metrics.lastRsCorrected],
    ['RS erasures / frame', metrics.lastRsErasures],
    ['RS corrected total', metrics.totalRsCorrected],
    ['RS erasures total', metrics.totalRsErasures],
    ['RS blocks decoded', metrics.lastRsBlocks],
    ['Failed RS block', metrics.lastRsFailedBlock ?? '—'],
    ['Rotation', `${metrics.rotation}°`],
    ['Useful rate', usefulBps ? `${usefulBps} bps` : '—'],
  ];
  metricsHost.innerHTML = values.map(([label, value]) => `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`).join('');
}

function resetTransfer(reason = 'manual reset') {
  receiver = new TransferReassembler();
  fountainReceiver = new FountainReassembler();
  transportMode = 'waiting';
  seenPackets = new Set();
  temporalStore.reset();
  adaptiveLink.reset();
  channelCalibrator.reset();
  profileLock.reset();
  lastCompletedSession = null;
  const preserved = {
    profileId: metrics.profileId,
    captureFrames: metrics.captureFrames,
    globalAcquires: metrics.globalAcquires,
    trackedFrames: metrics.trackedFrames,
    detectorMisses: metrics.detectorMisses,
  };
  metrics = createMetrics();
  Object.assign(metrics, preserved);
  output.textContent = 'Waiting for a complete V3 transfer…';
  setPill(decodeState, 'No V3 packet yet');
  setPill(transferState, 'Waiting');
  log(`Transfer reset (${reason}).`);
  renderMetrics();
}

function switchProfile(profile) {
  if (!profile || activeProfile?.id === profile.id) return;
  const previous = activeProfile?.id ?? 'none';
  activeProfile = profile;
  metrics.profileId = profile.id;
  receiver = new TransferReassembler();
  fountainReceiver = new FountainReassembler();
  transportMode = 'waiting';
  seenPackets.clear();
  temporalStore = createTemporalStore(profile);
  adaptiveLink.reset();
  channelCalibrator.reset();
  profileLock.reset();
  lastCompletedSession = null;
  metrics.firstAcceptedAt = null;
  metrics.completedAt = null;
  output.textContent = 'Waiting for a complete V3 transfer…';
  setPill(transferState, 'Waiting');
  log(`V3 density lock: ${previous} → ${profile.id}`);
}

function probeAdaptiveProfile(canvas) {
  const profiles = activeProfile
    ? [activeProfile, ...V3_PROFILES.filter((profile) => profile.id !== activeProfile.id)]
    : V3_PROFILES;
  const results = profiles.map((profile) => ({ ...detectV3Coarse(canvas, profile), profile }));
  const current = activeProfile ? results.find((result) => result.profile.id === activeProfile.id) : null;
  if (current?.isV3) return current;
  const valid = results.filter((result) => result.isV3).sort((a, b) => b.score - a.score);
  if (valid.length) return valid[0];
  return results.sort((a, b) => b.score - a.score)[0];
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function saveDebugSnapshot() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  v3Roi.toBlob((blob) => {
    if (blob) downloadBlob(blob, `v3-roi-${stamp}.png`);
  }, 'image/png');
  const snapshot = {
    timestamp: new Date().toISOString(),
    receiverMode,
    activeProfile: activeProfile?.id ?? null,
    metrics: { ...metrics },
    transfer: currentTransportStatus(),
    temporalObservationCount: temporalStore.observations?.length ?? 0,
    channelCalibration: channelCalibrator.summary(),
    linkOptimization: optimizeLink({ profileId: activeProfile?.id, linkStatus: adaptiveLink.status(activeProfile?.id), calibration: channelCalibrator.summary(), fountainProgress: metrics.fountainProgress }),
  };
  downloadBlob(new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' }), `v3-debug-${stamp}.json`);
  log('Saved V3 ROI and receiver diagnostics snapshot.');
}

function createTemporalStore(profile = activeProfile) {
  if (!profile) return new TemporalObservationStore();
  const identityIndices = [];
  const identityBlocks = Math.min(12, profile.rsCodewordCount);
  for (let position = 0; position < profile.rsN; position += 1) {
    for (let block = 0; block < identityBlocks; block += 1) identityIndices.push(position * profile.rsCodewordCount + block);
  }
  return new TemporalObservationStore({ maxObservations: 6, maxAgeMs: 1300, minAgreement: 0.62, identityIndices });
}

function ensureDecoderWorker() {
  if (receiverMode === 'legacy' || decoderWorker || typeof Worker === 'undefined') return;
  decoderWorker = new Worker('./v3-decoder-worker.js', { type: 'module' });
  decoderWorker.onmessage = (event) => {
    const request = workerRequests.get(event.data?.id);
    if (!request) return;
    workerRequests.delete(event.data.id);
    decoderBusy = false;
    if (event.data.ok) request.resolve(event.data.observation);
    else request.reject(Object.assign(new Error(event.data?.error?.message || 'V3 worker failed'), event.data?.error || {}));
  };
  decoderWorker.onerror = (event) => {
    decoderBusy = false;
    for (const request of workerRequests.values()) request.reject(new Error(event.message || 'V3 worker failed'));
    workerRequests.clear();
    decoderWorker?.terminate();
    decoderWorker = null;
    log('Decoder worker unavailable; temporal receiver will use main-thread observation fallback.');
  };
}

function observeInWorker(canvas, rotation, profile) {
  ensureDecoderWorker();
  const tuning = deriveDecoderTuning(channelCalibrator.summary());
  metrics.decoderTimingGate = tuning.timingMinimum;
  metrics.decoderSignatureGate = tuning.signatureMinimum;
  if (!decoderWorker) return Promise.resolve(observeV3Roi(canvas, rotation, profile, tuning));
  if (decoderBusy) return Promise.resolve(null);
  decoderBusy = true;
  const id = ++workerRequestId;
  const imageData = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => {
    workerRequests.set(id, { resolve, reject });
    decoderWorker.postMessage({ id, imageData, rotation, profileId: profile.id, tuning }, [imageData.data.buffer]);
  });
}

function applyAdaptiveStatus(status) {
  if (!status) return;
  metrics.linkQuality = status.score;
  metrics.evidenceTarget = status.evidenceTarget;
  metrics.linkRecommendation = status.recommendation;
  metrics.recommendedProfileId = status.recommendedProfileId;
  metrics.goodLinkStreak = status.goodStreak;
  metrics.badLinkStreak = status.badStreak;
}


function applyCalibrationStatus(summary, profileId = activeProfile?.id) {
  if (!summary) return;
  metrics.calibrationState = summary.state;
  metrics.calibrationSamples = summary.samples;
  metrics.learnedQualityThreshold = summary.minimumFrameQuality;
  metrics.calibratedTiming = summary.timingMedian;
  metrics.calibratedSignature = summary.signatureMedian;
  metrics.calibratedDecodeRate = summary.decodeSuccessRate;
  const linkStatus = adaptiveLink.status(profileId);
  const optimization = optimizeLink({
    profileId,
    linkStatus,
    calibration: summary,
    fountainProgress: metrics.fountainProgress,
  });
  metrics.optimizerMode = optimization.mode;
  metrics.optimizedDwellMs = optimization.recommendedDwellMs;
  metrics.optimizedOverhead = optimization.recommendedFountainOverhead;
  metrics.optimizedProfileId = optimization.recommendedProfileId;
}

function processTemporalObservation(observation, profile) {
  const priorCalibration = channelCalibrator.summary();
  const calibratedObservation = calibrateObservationConfidences(observation, priorCalibration);
  metrics.calibrationConfidenceScale = calibratedObservation.calibrationConfidenceScale ?? 1;
  const quality = scoreV3FrameQuality({
    ...calibratedObservation,
    pixelsPerCell: metrics.pixelsPerCell,
  });
  metrics.frameQuality = quality;
  const calibration = channelCalibrator.addObservation({
    ...observation,
    pixelsPerCell: metrics.pixelsPerCell,
    frameQuality: quality,
  });
  observation = calibratedObservation;
  applyCalibrationStatus(calibration, profile.id);
  const learnedMinimum = calibration.minimumFrameQuality;
  const gateTolerance = qualityGateTolerance(calibration.state);
  metrics.qualityGateTolerance = gateTolerance;
  if (!shouldDecodeObservation(quality, learnedMinimum, gateTolerance)) {
    applyAdaptiveStatus(adaptiveLink.add({
      profileId: profile.id,
      frameQuality: quality,
      cellAgreement: 0,
      averageConfidence: observation.averageConfidence ?? 0,
      pixelsPerCell: metrics.pixelsPerCell,
      decoded: false,
      rsFailed: false,
    }));
    setPill(decodeState, `Weak observation ${(quality * 100).toFixed(0)}%`, 'working');
    return false;
  }

  const preStatus = adaptiveLink.status(profile.id);
  const evidenceTarget = Math.max(1, Math.min(6, preStatus.evidenceTarget));
  const firstAttemptTarget = progressiveEvidenceTarget({
    evidenceTarget,
    frameQuality: quality,
    learnedMinimum,
    averageConfidence: observation.averageConfidence ?? 0,
  });
  const temporalWindowMs = computeTemporalWindowMs({
    decoderLatencyMs: metrics.decoderLatencyMs,
    evidenceTarget,
  });
  temporalStore.configure({ maxAgeMs: temporalWindowMs, maxObservations: 6 });
  metrics.evidenceTarget = evidenceTarget;
  metrics.progressiveEvidenceTarget = firstAttemptTarget;
  metrics.temporalWindowMs = temporalWindowMs;

  const group = temporalStore.add(observation);
  metrics.observationCount = group.count;
  metrics.temporalTransitions = temporalStore.transitions;
  metrics.cellAgreement = group.fused.cellAgreement ?? group.agreement;
  applyV3Diagnostics(group.fused);

  const canTry = group.count >= firstAttemptTarget || (quality >= 0.90 && group.count >= Math.min(2, firstAttemptTarget));
  if (!canTry) {
    setPill(decodeState, `Collecting evidence ${group.count}/${firstAttemptTarget} · window ${(temporalWindowMs / 1000).toFixed(1)}s`, 'working');
    return false;
  }

  metrics.temporalAttempts += 1;
  try {
    const optical = decodeV3Observation(group.fused, profile);
    applyV3Diagnostics(optical);
    metrics.opticalDecodes += 1;
    metrics.temporalSuccesses += group.count > 1 ? 1 : 0;
    metrics.lastRsCorrected = optical.correctedSymbols;
    metrics.lastRsErasures = optical.erasuresUsed ?? 0;
    metrics.totalRsCorrected += optical.correctedSymbols;
    metrics.totalRsErasures += optical.erasuresUsed ?? 0;
    metrics.lastRsBlocks = optical.rsBlocksDecoded;
    metrics.lastRsFailedBlock = null;
    acceptProtocolPacket(optical.packetBytes, optical);
    applyAdaptiveStatus(adaptiveLink.add({
      profileId: profile.id,
      frameQuality: quality,
      cellAgreement: group.fused.cellAgreement ?? group.agreement,
      averageConfidence: group.fused.averageConfidence ?? 0,
      pixelsPerCell: metrics.pixelsPerCell,
      correctedSymbols: optical.correctedSymbols ?? 0,
      erasuresUsed: optical.erasuresUsed ?? 0,
      rsBlocks: optical.rsBlocksDecoded ?? 0,
      decoded: true,
      rsFailed: false,
    }));
    metrics.lastError = '';
    applyCalibrationStatus(channelCalibrator.addDecodeResult(true), profile.id);
    temporalStore.reset();
    metrics.observationCount = 0;
    return true;
  } catch (error) {
    metrics.lastError = error.message;
    applyV3Diagnostics(error.v3Diagnostics);
    const rsFailed = error.code === 'RS16_UNCORRECTABLE';
    applyCalibrationStatus(channelCalibrator.addDecodeResult(false), profile.id);
    applyAdaptiveStatus(adaptiveLink.add({
      profileId: profile.id,
      frameQuality: quality,
      cellAgreement: group.fused.cellAgreement ?? group.agreement,
      averageConfidence: group.fused.averageConfidence ?? 0,
      pixelsPerCell: metrics.pixelsPerCell,
      decoded: false,
      rsFailed,
    }));
    if (rsFailed) {
      metrics.rsRejects += 1;
      metrics.lastRsFailedBlock = error.blockIndex ?? 'unknown';
      setPill(decodeState, `RS needs more evidence · ${group.count}/${metrics.evidenceTarget}`, 'working');
    } else {
      setPill(decodeState, `Fusing observations · ${group.count}/${metrics.evidenceTarget}`, 'working');
    }
    return false;
  }
}

async function refreshCameraList(preferredDeviceId = '') {
  try {
    const devices = await listVideoInputs(navigator.mediaDevices);
    const previous = preferredDeviceId || cameraSelect.value;
    cameraSelect.innerHTML = '';
    if (!devices.length) {
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'No camera detected';
      cameraSelect.append(option);
      cameraSelect.disabled = true;
      return;
    }
    devices.forEach((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      cameraSelect.append(option);
    });
    cameraSelect.disabled = false;
    if (previous && devices.some((device) => device.deviceId === previous)) cameraSelect.value = previous;
  } catch (error) {
    log(`Unable to list cameras: ${error.message}`);
  }
}

async function startCamera() {
  if (running) return;
  startButton.disabled = true;
  showCameraError(null);
  setPill(cameraState, 'Requesting camera…', 'working');
  try {
    if (!window.isSecureContext) {
      const error = new Error('This page is not in a secure context');
      error.name = 'SecurityError';
      throw error;
    }
    const selectedDeviceId = cameraSelect.value || '';
    const opened = await openCameraWithFallback(navigator.mediaDevices, selectedDeviceId, (label) => setPill(cameraState, `Trying ${label}…`, 'working'));
    stream = opened.stream;
    video.srcObject = stream;
    await video.play();
    running = true;
    stopButton.disabled = false;
    const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
    await refreshCameraList(settings.deviceId || selectedDeviceId);
    lastDetection = null;
    detectorMisses = 0;
    coarseMisses = 0;
    setPill(cameraState, `${video.videoWidth}×${video.videoHeight} active`, 'good');
    setPill(trackingState, 'Acquiring 4 locators', 'working');
    ensureDecoderWorker();
    log(`V3 camera started via ${opened.attempt}; ${receiverMode} receiver enabled.`);
    scheduleLoop(0);
  } catch (error) {
    if (stream) for (const track of stream.getTracks()) track.stop();
    stream = null;
    video.srcObject = null;
    startButton.disabled = false;
    stopButton.disabled = true;
    const info = describeCameraError(error);
    setPill(cameraState, info.title, 'bad');
    showCameraError(info);
    log(`Camera failed: ${info.technical}`);
  }
}

function stopCamera() {
  running = false;
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = null;
  if (stream) for (const track of stream.getTracks()) track.stop();
  stream = null;
  video.srcObject = null;
  lastDetection = null;
  startButton.disabled = false;
  stopButton.disabled = true;
  setPill(cameraState, 'Stopped');
  setPill(trackingState, 'No frame');
  log('Camera stopped.');
}

function nextLoopDelay() {
  if (receiverMode !== 'temporal') return 650;
  if (decoderBusy) return computeBusyLoopDelayMs(metrics.decoderLatencyMs);
  return 90;
}

function scheduleLoop(delay = nextLoopDelay()) {
  if (!running) return;
  loopTimer = setTimeout(processFrame, delay);
}

function packetKey(packet) {
  return `${packet.sessionId}:${packet.frameType}:${packet.sequence}`;
}

async function finalizeRecoveredPayload(data, incomingMode, status) {
  setPill(transferState, 'Transfer recovered · verifying payload…', 'working');
  try {
    const payload = await decodePayload(data);
    metrics.payloadCodec = payload.codec;
    metrics.payloadIntegrity = payload.verified === true ? 'SHA-256 verified' : 'transport CRC32';
    metrics.payloadOriginalBytes = payload.originalBytes;
    output.textContent = payload.text;
    setPill(
      transferState,
      `Complete · ${payload.originalBytes} original bytes · ${incomingMode} · ${metrics.payloadIntegrity}`,
      'good',
    );
    log(
      `V3 ${incomingMode} transfer ${status.sessionId} complete: ${data.length} transport bytes → ${payload.originalBytes} original bytes; ${metrics.payloadIntegrity}.`,
    );
  } catch (error) {
    metrics.payloadIntegrity = 'verification failed';
    metrics.lastError = error.message;
    output.textContent = 'Recovered transport bytes, but payload verification failed.';
    setPill(transferState, 'Payload verification failed', 'bad');
    log(`Payload verification failed: ${error.message}`);
  }
  renderMetrics();
}

function acceptProtocolPacket(packetBytes, opticalResult) {
  let decoded;
  try {
    decoded = decodePacket(packetBytes);
  } catch (error) {
    metrics.protocolRejects += 1;
    if (error instanceof PacketError && error.code === 'CRC_MISMATCH') metrics.crcRejects += 1;
    throw error;
  }

  const incomingMode = decoded.frameType === FRAME_TYPES.FOUNTAIN ? 'fountain' : 'classic';
  const activeSessionId = transportMode === 'fountain' ? fountainReceiver.sessionId : receiver.sessionId;
  if (activeSessionId !== null && activeSessionId !== decoded.sessionId) {
    receiver.reset();
    fountainReceiver.reset();
    seenPackets.clear();
    lastCompletedSession = null;
    metrics.firstAcceptedAt = null;
    metrics.completedAt = null;
    transportMode = 'waiting';
    log(`New session ${decoded.sessionId}; previous incomplete session cleared.`);
  }

  if (transportMode !== 'waiting' && transportMode !== incomingMode) {
    throw new PacketError('TRANSPORT_MODE_MISMATCH', `Active ${transportMode} session cannot accept ${incomingMode} packet`);
  }
  transportMode = incomingMode;
  metrics.transportMode = incomingMode;

  const key = packetKey(decoded);
  if (seenPackets.has(key)) {
    metrics.duplicates += 1;
    setPill(decodeState, `Repeat ${FRAME_TYPE_NAMES[decoded.frameType]} #${decoded.sequence}`);
    return;
  }

  if (metrics.firstAcceptedAt === null) metrics.firstAcceptedAt = performance.now();
  const status = incomingMode === 'fountain'
    ? fountainReceiver.addPacket(packetBytes)
    : receiver.addPacket(packetBytes);
  seenPackets.add(key);
  metrics.acceptedUniquePackets += 1;
  setPill(decodeState, `${FRAME_TYPE_NAMES[decoded.frameType]} #${decoded.sequence} · RS fixed ${opticalResult.correctedSymbols}`, 'good');

  if (incomingMode === 'fountain') {
    metrics.fountainDroplets = status.uniqueDroplets;
    metrics.fountainSourceBlocks = status.sourceBlockCount ?? 0;
    metrics.fountainRecoveredBlocks = status.recoveredSourceBlocks;
    metrics.fountainProgress = status.progress ?? 0;
  }

  if (status.complete) {
    if (lastCompletedSession !== status.sessionId) {
      lastCompletedSession = status.sessionId;
      metrics.completedAt = performance.now();
      const data = incomingMode === 'fountain' ? fountainReceiver.getData() : receiver.getData();
      void finalizeRecoveredPayload(data, incomingMode, status);
    }
  } else if (incomingMode === 'fountain') {
    const expected = status.sourceBlockCount ?? '?';
    setPill(transferState, `Fountain ${status.sessionId} · ${status.recoveredSourceBlocks}/${expected} blocks · ${status.uniqueDroplets} droplets`, 'working');
  } else {
    const expected = status.expectedDataPackets === null ? '?' : status.expectedDataPackets;
    setPill(transferState, `Session ${status.sessionId} · ${status.receivedDataPackets}/${expected} DATA`, 'working');
  }
}

async function processFrame() {
  let scheduledEarly = false;
  if (!running || video.readyState < 2) {
    scheduleLoop();
    return;
  }

  try {
    metrics.captureFrames += 1;
    drawVideoFrame(video, sourceCanvas);
    const detection = trackOrAcquireV3Fiducials(sourceCanvas, lastDetection);
    if (!detection) {
      detectorMisses += 1;
      metrics.detectorMisses += 1;
      if (detectorMisses >= 3) lastDetection = null;
      setPill(trackingState, 'Searching 4 locators', 'working');
      drawAutoFiducialOverlay(sourceCanvas, null, 'searching');
      renderMetrics();
      scheduleLoop();
      return;
    }

    detectorMisses = 0;
    lastDetection = detection;
    if (detection.mode === 'tracked') {
      metrics.trackedFrames += 1;
      setPill(trackingState, '4 locators tracked', 'good');
    } else {
      metrics.globalAcquires += 1;
      setPill(trackingState, '4 locators acquired', 'working');
    }

    rectifyFiducials(sourceCanvas, coarseRectified, detection.corners);
    extractLogicalRoi(coarseRectified, coarseRoi);
    const probe = probeAdaptiveProfile(coarseRoi);
    if (!probe?.isV3) {
      coarseMisses += 1;
      if (coarseMisses >= 3) lastDetection = null;
      setPill(decodeState, 'V3 density/signature not clean', 'working');
      drawAutoFiducialOverlay(sourceCanvas, detection, 'found');
      if (probe) {
        metrics.rotation = probe.rotation;
        metrics.timingSeparation = probe.timingSeparation;
        metrics.signatureSeparation = probe.signatureSeparation;
      }
      renderMetrics();
      scheduleLoop();
      return;
    }

    const lockDecision = profileLock.consider(probe, activeProfile?.id ?? null);
    if (!lockDecision.accepted) {
      const candidate = lockDecision.candidateProfileId?.replace('V3-', '').replace('-S4-C4-RS15-11', '') ?? 'unknown';
      setPill(decodeState, `Confirming ${candidate} density ${lockDecision.candidateStreak}/4`, 'working');
      drawAutoFiducialOverlay(sourceCanvas, detection, 'found');
      renderMetrics();
      scheduleLoop();
      return;
    }
    if (!activeProfile || lockDecision.switched) switchProfile(probe.profile);
    const profile = activeProfile ?? V3_G32_S4_C4_RS;
    coarseMisses = 0;
    metrics.coarseLocks += 1;
    metrics.profileId = profile.id;
    metrics.rotation = probe.rotation;
    metrics.pixelsPerCell = estimateV3CameraPixelsPerCell(video, sourceCanvas, detection, profile);
    if (metrics.pixelsPerCell < 8) setPill(trackingState, `Move closer · ${metrics.pixelsPerCell.toFixed(1)} px/cell`, 'working');

    rectifyV3LogicalRoi(video, sourceCanvas, detection, highSourceCanvas, v3Roi, profile);
    metrics.opticalAttempts += 1;

    let decodedOk = false;
    if (receiverMode === 'legacy') {
      try {
        const optical = decodeV3Roi(v3Roi, probe.rotation, profile);
        metrics.opticalDecodes += 1;
        applyV3Diagnostics(optical);
        metrics.lastRsCorrected = optical.correctedSymbols;
        metrics.lastRsErasures = optical.erasuresUsed ?? 0;
        metrics.totalRsCorrected += optical.correctedSymbols;
        metrics.totalRsErasures += optical.erasuresUsed ?? 0;
        metrics.lastRsBlocks = optical.rsBlocksDecoded;
        metrics.lastRsFailedBlock = null;
        acceptProtocolPacket(optical.packetBytes, optical);
        metrics.lastError = '';
        decodedOk = true;
      } catch (error) {
        metrics.lastError = error.message;
        applyV3Diagnostics(error.v3Diagnostics);
        if (error.code === 'RS16_UNCORRECTABLE') metrics.rsRejects += 1;
        setPill(decodeState, 'Waiting for cleaner V3 frame', 'working');
      }
    } else if (decoderBusy) {
      metrics.workerSkips += 1;
      setPill(decodeState, `Decoder busy · buffered evidence ${metrics.observationCount}`, 'working');
    } else {
      const started = performance.now();
      try {
        // Start the worker first so nextLoopDelay() can use the busy state and
        // measured decoder latency instead of creating a 90 ms skip storm.
        const observationPromise = observeInWorker(v3Roi, probe.rotation, profile);
        scheduleLoop();
        scheduledEarly = true;
        const observation = await observationPromise;
        metrics.decoderLatencyMs = performance.now() - started;
        if (observation) decodedOk = processTemporalObservation(observation, profile);
      } catch (error) {
        decoderBusy = false;
        metrics.lastError = error.message;
        setPill(decodeState, 'Observation decoder error', 'bad');
      }
    }

    drawAutoFiducialOverlay(sourceCanvas, detection, decodedOk ? 'decoded' : 'found');
  } catch (error) {
    metrics.lastError = error.message;
    setPill(decodeState, 'V3 frame-processing error', 'bad');
    log(`V3 processing error: ${error.message}`);
  }

  renderMetrics();
  if (!scheduledEarly) scheduleLoop();
}

startButton.addEventListener('click', startCamera);
stopButton.addEventListener('click', stopCamera);
resetButton.addEventListener('click', () => resetTransfer());
saveDebugButton.addEventListener('click', saveDebugSnapshot);
refreshButton.addEventListener('click', () => refreshCameraList());
cameraSelect.addEventListener('change', () => {
  if (running) {
    stopCamera();
    startCamera();
  }
});
toggleDebug.addEventListener('change', () => { debugPanel.hidden = !toggleDebug.checked; });
navigator.mediaDevices?.addEventListener?.('devicechange', () => refreshCameraList());
window.addEventListener('beforeunload', stopCamera);

resetTransfer('initial state');
refreshCameraList();
