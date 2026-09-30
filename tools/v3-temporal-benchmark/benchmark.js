import { encodePacket } from '../../packages/protocol/src/packet.js';
import { FRAME_TYPES } from '../../packages/protocol/src/constants.js';
import { V3_G32_S4_C4_RS, getV3DataCellCoordinates } from '../../packages/optical-codec/src/profiles.js';
import { encodeV3Frame, recoverV3PacketFromSymbols } from '../../packages/optical-codec/src/v3-frame.js';
import { fuseV3Observations } from '../../apps/receiver-v3/temporal-fusion.js';

const profile = V3_G32_S4_C4_RS;
const packet = encodePacket({
  frameType: FRAME_TYPES.DATA,
  sessionId: 2026,
  sequence: 1,
  payload: new TextEncoder().encode('V3.2 temporal receiver benchmark'),
});
const frame = encodeV3Frame(packet, profile);
const coordinates = getV3DataCellCoordinates(profile);

function makeObservation() {
  const symbols = Uint8Array.from(coordinates, ({ x, y }) => frame.cells[y][x].value);
  return {
    profileId: profile.id,
    rotation: 0,
    symbols,
    shapeIds: Uint8Array.from(symbols, (v) => v >>> 2),
    colorIds: Uint8Array.from(symbols, (v) => v & 3),
    confidences: Float32Array.from(symbols, () => 0.92),
    shapeConfidences: Float32Array.from(symbols, () => 0.92),
    colorConfidences: Float32Array.from(symbols, () => 0.92),
    timingSeparation: 70,
    signatureSeparation: 30,
    averageConfidence: 0.92,
    averageShapeConfidence: 0.92,
    averageColorConfidence: 0.92,
    phaseX: 0,
    phaseY: 0,
  };
}

const observations = [makeObservation(), makeObservation(), makeObservation()];
const damagedPositions = [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9, 10, 11]];
for (let o = 0; o < observations.length; o += 1) {
  for (const symbolPosition of damagedPositions[o]) {
    const index = symbolPosition * profile.rsCodewordCount;
    observations[o].symbols[index] ^= 0x0f;
    observations[o].shapeIds[index] = observations[o].symbols[index] >>> 2;
    observations[o].colorIds[index] = observations[o].symbols[index] & 3;
    observations[o].confidences[index] = 0.7;
    observations[o].shapeConfidences[index] = 0.7;
    observations[o].colorConfidences[index] = 0.7;
  }
}

const individual = observations.map((observation, index) => {
  try {
    const result = recoverV3PacketFromSymbols(observation.symbols, profile, observation.confidences);
    return { observation: index + 1, recovered: Buffer.from(result.packetBytes).equals(Buffer.from(packet)), corrected: result.correctedSymbols };
  } catch (error) {
    return { observation: index + 1, recovered: false, error: error.code || error.message };
  }
});

const fused = fuseV3Observations(observations);
const recovered = recoverV3PacketFromSymbols(fused.symbols, profile, fused.confidences);
console.log(JSON.stringify({
  profile: profile.id,
  individual,
  fused: {
    observations: fused.observationCount,
    cellAgreement: Number(fused.cellAgreement.toFixed(4)),
    averageConfidence: Number(fused.averageConfidence.toFixed(4)),
    recovered: Buffer.from(recovered.packetBytes).equals(Buffer.from(packet)),
    correctedSymbols: recovered.correctedSymbols,
  },
}, null, 2));
