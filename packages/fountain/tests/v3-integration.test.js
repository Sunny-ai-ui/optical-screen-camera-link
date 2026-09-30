import test from 'node:test';
import assert from 'node:assert/strict';
import { createFountainTransfer, FountainReassembler } from '../src/index.js';
import { encodeV3Frame, decodeV3Frame } from '../../optical-codec/src/v3-frame.js';
import { V3_G32_S4_C4_RS } from '../../optical-codec/src/profiles.js';

function bytes(length) {
  return Uint8Array.from({ length }, (_, i) => (i * 29 + 7) & 0xFF);
}

test('fountain droplets survive ideal V3 optical encode/decode and recover with frame loss', () => {
  const original = bytes(1400);
  const transfer = createFountainTransfer(original, {
    packetPayloadBytes: V3_G32_S4_C4_RS.recommendedProtocolPayloadBytes,
    overheadRatio: 1,
    sessionId: 4321,
  });
  const receiver = new FountainReassembler();

  for (let i = 0; i < transfer.packets.length; i += 1) {
    if (i % 5 === 1) continue; // 20% whole-frame loss
    const opticalFrame = encodeV3Frame(transfer.packets[i], V3_G32_S4_C4_RS);
    const decoded = decodeV3Frame(opticalFrame, V3_G32_S4_C4_RS);
    const status = receiver.addPacket(decoded.packetBytes);
    if (status.complete) break;
  }

  assert.equal(receiver.status().complete, true);
  assert.deepEqual(receiver.getData(), original);
});
