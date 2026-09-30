import test from 'node:test';
import assert from 'node:assert/strict';
import { fuseV3Observations, observationAgreement, TemporalObservationStore } from './temporal-fusion.js';

function observation(symbols, confidence = 0.9, profileId = 'P') {
  const values = Uint8Array.from(symbols);
  const shapeIds = Uint8Array.from(values, (v) => v >>> 2);
  const colorIds = Uint8Array.from(values, (v) => v & 3);
  const confidences = Float32Array.from(values, () => confidence);
  return {
    profileId,
    rotation: 0,
    symbols: values,
    shapeIds,
    colorIds,
    confidences,
    shapeConfidences: Float32Array.from(confidences),
    colorConfidences: Float32Array.from(confidences),
    timingSeparation: 60,
    signatureSeparation: 30,
    averageConfidence: confidence,
    averageShapeConfidence: confidence,
    averageColorConfidence: confidence,
    phaseX: 0,
    phaseY: 0,
  };
}

test('temporal fusion corrects one low-confidence conflicting observation', () => {
  const a = observation([9, 6, 3], 0.9);
  const b = observation([9, 6, 3], 0.85);
  const c = observation([5, 6, 3], 0.15);
  const fused = fuseV3Observations([a, b, c]);
  assert.deepEqual(Array.from(fused.symbols), [9, 6, 3]);
  assert.ok(fused.confidences[0] > 0.7);
});

test('shape and colour are fused independently', () => {
  const a = observation([0b1001], 0.9);
  const b = observation([0b1010], 0.9);
  b.colorConfidences[0] = 0.05;
  const c = observation([0b0101], 0.9);
  c.shapeConfidences[0] = 0.05;
  const fused = fuseV3Observations([a, b, c]);
  assert.equal(fused.symbols[0], 0b1001);
});

test('agreement falls for a probable sender-frame transition', () => {
  const a = observation([1, 1, 1, 1], 0.9);
  const b = observation([14, 14, 14, 14], 0.9);
  assert.ok(observationAgreement(a, b) < 0.1);
});

test('temporal store never mixes observations across profile changes', () => {
  const store = new TemporalObservationStore({ maxObservations: 4 });
  assert.equal(store.add(observation([1, 2], 0.9, 'A'), 0).count, 1);
  assert.equal(store.add(observation([1, 2], 0.9, 'A'), 10).count, 2);
  assert.equal(store.add(observation([1, 2], 0.9, 'B'), 20).count, 1);
});

test('temporal store starts a new group on low symbol agreement', () => {
  const store = new TemporalObservationStore({ minAgreement: 0.7 });
  store.add(observation([1, 1, 1, 1]), 0);
  const result = store.add(observation([15, 15, 15, 15]), 10);
  assert.equal(result.transition, true);
  assert.equal(result.count, 1);
});

import { encodePacket } from '../../packages/protocol/src/packet.js';
import { FRAME_TYPES } from '../../packages/protocol/src/constants.js';
import { V3_G32_S4_C4_RS, getV3DataCellCoordinates } from '../../packages/optical-codec/src/profiles.js';
import { encodeV3Frame, recoverV3PacketFromSymbols } from '../../packages/optical-codec/src/v3-frame.js';

function observationFromFrame(frame, profile) {
  const coords = getV3DataCellCoordinates(profile);
  const symbols = Uint8Array.from(coords, ({ x, y }) => frame.cells[y][x].value);
  const obs = observation(symbols, 0.92, profile.id);
  return obs;
}

test('temporal fusion recovers a packet when separate camera observations each exceed one RS block error budget', () => {
  const profile = V3_G32_S4_C4_RS;
  const packet = encodePacket({ frameType: FRAME_TYPES.DATA, sessionId: 42, sequence: 3, payload: new TextEncoder().encode('temporal fusion') });
  const frame = encodeV3Frame(packet, profile);
  const observations = [observationFromFrame(frame, profile), observationFromFrame(frame, profile), observationFromFrame(frame, profile)];
  const block = 0;
  const badPositions = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
  observations.forEach((obs, obsIndex) => {
    for (const symbolPosition of badPositions[obsIndex]) {
      const index = symbolPosition * profile.rsCodewordCount + block;
      obs.symbols[index] ^= 0x0f;
      obs.shapeIds[index] = obs.symbols[index] >>> 2;
      obs.colorIds[index] = obs.symbols[index] & 3;
      obs.confidences[index] = 0.75;
      obs.shapeConfidences[index] = 0.75;
      obs.colorConfidences[index] = 0.75;
    }
  });

  let degraded = 0;
  for (const obs of observations) {
    try {
      const single = recoverV3PacketFromSymbols(obs.symbols, profile, obs.confidences);
      if (!Buffer.from(single.packetBytes).equals(Buffer.from(packet))) degraded += 1;
    } catch {
      degraded += 1;
    }
  }
  assert.ok(degraded >= 1, 'at least one individual observation should be unusable or incorrect');
  const fused = fuseV3Observations(observations);
  const recovered = recoverV3PacketFromSymbols(fused.symbols, profile, fused.confidences);
  assert.deepEqual(recovered.packetBytes, packet);
});

test('temporal store can extend its lifetime for slow decoders', () => {
  const store = new TemporalObservationStore({ maxObservations: 6, maxAgeMs: 1200 });
  store.configure({ maxAgeMs: 7000 });
  for (let i = 0; i < 6; i += 1) {
    const result = store.add(observation([1, 2, 3, 4]), i * 900);
    assert.equal(result.count, i + 1);
  }
});

test('temporal fusion preserves calibration diagnostics', () => {
  const a = observation([1, 2, 3], 0.9);
  const b = observation([1, 2, 3], 0.9);
  a.colorCalibrationSeparation = 0.31;
  b.colorCalibrationSeparation = 0.29;
  a.shapeCalibrationSeparation = 1.02;
  b.shapeCalibrationSeparation = 0.98;
  a.lowConfidenceCellRate = 0.04;
  b.lowConfidenceCellRate = 0.02;
  const fused = fuseV3Observations([a, b]);
  assert.ok(Math.abs(fused.colorCalibrationSeparation - 0.30) < 1e-9);
  assert.ok(Math.abs(fused.shapeCalibrationSeparation - 1.00) < 1e-9);
  assert.ok(Math.abs(fused.lowConfidenceCellRate - 0.03) < 1e-9);
});
