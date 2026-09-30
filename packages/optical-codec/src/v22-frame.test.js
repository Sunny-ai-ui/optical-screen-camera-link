import test from 'node:test';
import assert from 'node:assert/strict';

import { V22_S8_C8_B4_R3 } from './profiles.js';
import {
  decodeS8C8B4Frame,
  encodeS8C8B4Frame,
  joinS8C8B4Byte,
  splitS8C8B4Byte,
} from './v22-frame.js';

test('V2.2 maps every byte to shape, colour and background without loss', () => {
  for (let value = 0; value <= 255; value += 1) {
    const parts = splitS8C8B4Byte(value);
    assert.equal(joinS8C8B4Byte(parts.shapeId, parts.colorIndex, parts.backgroundIndex), value);
  }
});

test('V2.2 frame round-trips a maximum-size packet', () => {
  const packet = Uint8Array.from({ length: V22_S8_C8_B4_R3.maxPacketBytes }, (_, i) => (i * 37 + 11) & 0xFF);
  const frame = encodeS8C8B4Frame(packet);
  assert.deepEqual(decodeS8C8B4Frame(frame), packet);
});

test('V2.2 component-wise R3 recovers different errors in separate copies', () => {
  const packet = Uint8Array.from([0x4F, 0x53, 0x22, 0xA7, 0x19, 0xFE]);
  const frame = encodeS8C8B4Frame(packet);

  const copies = frame.cells.flat().filter((cell) => cell.kind === 's8c8b4-data' && cell.logicalByteIndex === 2);
  assert.equal(copies.length, 3);

  copies[0].shapeId = (copies[0].shapeId + 1) & 7;
  copies[1].colorIndex = (copies[1].colorIndex + 1) & 7;
  copies[2].backgroundIndex = (copies[2].backgroundIndex + 1) & 3;

  assert.deepEqual(decodeS8C8B4Frame(frame), packet);
});

test('V2.2 profile carries one logical byte per cell before R3', () => {
  assert.equal(V22_S8_C8_B4_R3.bitsPerPhysicalCell, 8);
  assert.equal(V22_S8_C8_B4_R3.shapeCount * V22_S8_C8_B4_R3.colorCount * V22_S8_C8_B4_R3.backgroundCount, 256);
  assert.equal(V22_S8_C8_B4_R3.dataByteCapacity, 58);
  assert.equal(V22_S8_C8_B4_R3.encodedByteCapacity, 174);
  assert.equal(V22_S8_C8_B4_R3.recommendedProtocolPayloadBytes, 42);
});
