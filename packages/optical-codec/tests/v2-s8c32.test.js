import test from 'node:test';
import assert from 'node:assert/strict';

import { C32 } from '../../constellation/src/c32.js';
import { encodePacket, FRAME_TYPES } from '../../protocol/src/index.js';
import {
  V2_S8_C32_R3,
  decodeS8C32Frame,
  encodeS8C32Frame,
  joinS8C32Byte,
  splitS8C32Byte,
} from '../src/index.js';

test('C32 contains 32 distinct nominal colours', () => {
  assert.equal(C32.length, 32);
  const unique = new Set(C32.map((entry) => entry.rgb.join(',')));
  assert.equal(unique.size, 32);
});

test('S8C32 split/join round-trips all 256 byte values', () => {
  for (let value = 0; value < 256; value += 1) {
    const { shapeId, colorIndex } = splitS8C32Byte(value);
    assert.equal(joinS8C32Byte(shapeId, colorIndex), value);
  }
});

test('protocol packet survives ideal V2 S8C32 frame round-trip', () => {
  const payload = new TextEncoder().encode('SHAPE COLOR OPTICAL');
  const packet = encodePacket({
    frameType: FRAME_TYPES.DATA,
    sessionId: 4321,
    sequence: 7,
    payload,
  });
  assert.ok(packet.length <= V2_S8_C32_R3.maxPacketBytes);
  const frame = encodeS8C32Frame(packet);
  const recovered = decodeS8C32Frame(frame);
  assert.deepEqual(recovered, packet);
});

test('V2 frame carries live shape, colour and profile calibration', () => {
  const packet = encodePacket({
    frameType: FRAME_TYPES.DATA,
    sessionId: 99,
    sequence: 0,
    payload: new Uint8Array([1, 2, 3]),
  });
  const frame = encodeS8C32Frame(packet);
  const flat = frame.cells.flat();
  assert.equal(flat.filter((cell) => cell.kind === 'shape-calibration').length, 8);
  assert.equal(flat.filter((cell) => cell.kind === 'color-calibration').length, 32);
  assert.equal(
    flat.filter((cell) => cell.kind === 'profile-signature').length,
    V2_S8_C32_R3.profileSignatureBits.length,
  );
  assert.equal(flat.filter((cell) => cell.kind === 's8c32-data').length, 159);
});
