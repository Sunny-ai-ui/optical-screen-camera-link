import { createTransferPackets } from '../../packages/protocol/src/index.js';
import { createFountainTransfer } from '../../packages/fountain/src/index.js';
import {
  V1_G16_C16,
  V2_S8_C32_R3,
  V21_S8_C16_R3,
  V22_S8_C8_B4_R3,
  V3_G32_S4_C4_RS,
  V3_G48_S4_C4_RS,
  V3_G64_S4_C4_RS,
  encodeOpticalFrame,
  encodeS8C32Frame,
  encodeS8C16Frame,
  encodeS8C8B4Frame,
  encodeV3Frame,
  renderOpticalFrameSvg,
} from '../../packages/optical-codec/src/index.js';
import { describeFrameDwell, resolveFrameDwellMs } from './adaptive-dwell.js';
import { encodePayload } from '../../packages/payload-codec/src/index.js';

const message = document.querySelector('#message');
const profileSelect = document.querySelector('#profile');
const frameHost = document.querySelector('#frameHost');
const stats = document.querySelector('#stats');
const generateButton = document.querySelector('#generate');
const previousButton = document.querySelector('#previous');
const nextButton = document.querySelector('#next');
const playButton = document.querySelector('#play');
const rateSelect = document.querySelector('#rate');
const transportSelect = document.querySelector('#transport');
const redundancySelect = document.querySelector('#redundancy');
const fullscreenButton = document.querySelector('#fullscreen');

let transfer = null;
let frames = [];
let currentIndex = 0;
let timer = null;
let activeProfile = V3_G32_S4_C4_RS;
let visualVariant = 0;
let payloadInfo = null;

function selectedProfile() {
  if (profileSelect.value === 'v1') return V1_G16_C16;
  if (profileSelect.value === 'v21') return V21_S8_C16_R3;
  if (profileSelect.value === 'v22') return V22_S8_C8_B4_R3;
  if (profileSelect.value === 'v2') return V2_S8_C32_R3;
  if (profileSelect.value === 'v3b') return V3_G48_S4_C4_RS;
  if (profileSelect.value === 'v3d') return V3_G64_S4_C4_RS;
  return V3_G32_S4_C4_RS;
}

function isV3Profile(profile) {
  return profile.version === 30 && profile.modulation === 'S4C4-RS15-11';
}

function encoderForProfile(profile) {
  if (isV3Profile(profile)) return encodeV3Frame;
  if (profile.id === V22_S8_C8_B4_R3.id) return encodeS8C8B4Frame;
  if (profile.id === V21_S8_C16_R3.id) return encodeS8C16Frame;
  if (profile.id === V2_S8_C32_R3.id) return encodeS8C32Frame;
  return encodeOpticalFrame;
}

function isLegacyHybridProfile(profile) {
  return [V22_S8_C8_B4_R3.id, V21_S8_C16_R3.id, V2_S8_C32_R3.id].includes(profile.id);
}

function stopPlayback() {
  if (timer) clearInterval(timer);
  timer = null;
  playButton.textContent = 'Play';
}

function currentRateLabel() {
  return describeFrameDwell(rateSelect.value, activeProfile);
}

function activeTransportMode() {
  return isV3Profile(activeProfile) && transportSelect.value === 'fountain' ? 'fountain' : 'classic';
}


function renderCurrentFrame() {
  if (!frames.length) {
    frameHost.textContent = 'Generate a frame to begin.';
    stats.textContent = '';
    return;
  }

  const v3 = isV3Profile(activeProfile);
  frameHost.innerHTML = renderOpticalFrameSvg(frames[currentIndex], {
    scale: v3 ? 1 : 2,
    borderWidth: v3 ? 6 : 4,
    showGrid: false,
    visualVariant: isLegacyHybridProfile(activeProfile) ? visualVariant : 0,
  });

  const inputBytes = new TextEncoder().encode(message.value).length;
  const fountain = transfer.mode === 'fountain';
  stats.innerHTML = [
    `Profile: ${activeProfile.id}`,
    `Transport: ${fountain ? 'Fountain' : 'Classic'}`,
    `Input: ${inputBytes} bytes`,
    payloadInfo ? `Payload: ${payloadInfo.codec}${payloadInfo.enveloped ? ' + SHA-256' : ' + CRC32'}` : null,
    payloadInfo && payloadInfo.enveloped ? `Payload bytes: ${payloadInfo.envelopeBytes} (${payloadInfo.originalBytes} original)` : null,
    payloadInfo && payloadInfo.enveloped ? `SHA-256: ${payloadInfo.sha256.slice(0, 12)}…` : null,
    `Frame: ${currentIndex + 1}/${frames.length}`,
    `Session: ${transfer.sessionId}`,
    fountain ? `Source blocks: ${transfer.sourceBlockCount}` : `DATA packets: ${transfer.dataPacketCount}`,
    fountain ? `Droplets: ${transfer.dropletCount}` : `Chunk: ${transfer.chunkSize} bytes`,
    fountain ? `Block: ${transfer.blockSize} bytes` : null,
    fountain ? `Redundancy: ${Math.round(transfer.overheadRatio * 100)}%` : null,
    `Rate: ${currentRateLabel()}`,
    v3 ? `Grid: ${activeProfile.gridSize}×${activeProfile.gridSize}` : null,
    v3 ? `Cell: ${activeProfile.cellSize}px logical` : null,
    v3 ? `Protected envelope: ${activeProfile.dataByteCapacity} bytes` : null,
    v3 ? `RS: (${activeProfile.rsN},${activeProfile.rsK}) · corrects ${activeProfile.rsCorrectableSymbols}/block` : null,
    isLegacyHybridProfile(activeProfile) ? `Visual variant: ${visualVariant}` : null,
  ].filter(Boolean).map((value) => `<span class="tag">${value}</span>`).join('');
}

async function generateFrames() {
  stopPlayback();
  generateButton.disabled = true;
  activeProfile = selectedProfile();
  const encodeFrame = encoderForProfile(activeProfile);
  const transportMode = activeTransportMode();
  try {
    payloadInfo = await encodePayload(message.value);
  } finally {
    generateButton.disabled = false;
  }
  transfer = transportMode === 'fountain'
    ? createFountainTransfer(payloadInfo.bytes, {
        packetPayloadBytes: activeProfile.recommendedProtocolPayloadBytes,
        overheadRatio: Number(redundancySelect?.value ?? 1.0),
      })
    : createTransferPackets(payloadInfo.bytes, {
        chunkSize: activeProfile.recommendedProtocolPayloadBytes,
      });
  frames = transfer.packets.map((packet) => encodeFrame(packet, activeProfile));
  currentIndex = 0;
  visualVariant = 0;
  renderCurrentFrame();
}

function advanceFrame(step = 1) {
  if (!frames.length) return;
  currentIndex = (currentIndex + step + frames.length) % frames.length;
  if (isLegacyHybridProfile(activeProfile)) visualVariant = (visualVariant + 1) & 0xFFFF;
  renderCurrentFrame();
}

async function startPlayback() {
  if (!frames.length) await void generateFrames();
  stopPlayback();
  playButton.textContent = 'Stop';
  const interval = resolveFrameDwellMs(rateSelect.value, activeProfile);
  timer = setInterval(() => advanceFrame(1), interval);
}

generateButton.addEventListener('click', () => { void generateFrames(); });
profileSelect.addEventListener('change', () => { void generateFrames(); });
transportSelect.addEventListener('change', () => { void generateFrames(); });
redundancySelect?.addEventListener('change', () => { void generateFrames(); });
previousButton.addEventListener('click', () => { stopPlayback(); advanceFrame(-1); });
nextButton.addEventListener('click', () => { stopPlayback(); advanceFrame(1); });
playButton.addEventListener('click', () => { if (timer) stopPlayback(); else void startPlayback(); });
rateSelect.addEventListener('change', () => {
  const wasPlaying = Boolean(timer);
  if (wasPlaying) void startPlayback();
  else renderCurrentFrame();
});
fullscreenButton.addEventListener('click', async () => {
  try {
    if (!document.fullscreenElement) await frameHost.requestFullscreen();
    else await document.exitFullscreen();
  } catch (error) {
    console.error('Fullscreen failed', error);
  }
});

document.addEventListener('fullscreenchange', () => {
  fullscreenButton.textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen Frame';
});

generateFrames();
