import test from 'node:test';
import assert from 'node:assert/strict';
import {
  V3_G32_S4_C4_RS,
  V3_G48_S4_C4_RS,
  V3_G64_S4_C4_RS,
  V3_PROFILES,
  encodeV3Frame,
  decodeV3Frame,
  getV3DataCellCoordinates,
} from '../src/index.js';
import { splitV3Nibble } from '../../constellation/src/v3.js';

function makeBytes(length) {
  const bytes = new Uint8Array(length);
  let state = 0x12345678;
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[i] = state & 0xFF;
  }
  return bytes;
}

test('V3 adaptive profiles expose expected capacities', () => {
  assert.equal(V3_G32_S4_C4_RS.dataByteCapacity, 308);
  assert.equal(V3_G48_S4_C4_RS.dataByteCapacity, 759);
  assert.equal(V3_G64_S4_C4_RS.dataByteCapacity, 1397);
  assert.equal(getV3DataCellCoordinates(V3_G32_S4_C4_RS).length, 840);
  assert.equal(getV3DataCellCoordinates(V3_G48_S4_C4_RS).length, 2070);
  assert.equal(getV3DataCellCoordinates(V3_G64_S4_C4_RS).length, 3810);
});

for (const profile of V3_PROFILES) {
  test(`${profile.id} round-trips its recommended protocol-sized packet`, () => {
    const packetLength = Math.min(profile.maxPacketBytes, profile.recommendedProtocolPayloadBytes + 14);
    const packet = makeBytes(packetLength);
    const frame = encodeV3Frame(packet, profile);
    const decoded = decodeV3Frame(frame, profile);
    assert.deepEqual([...decoded.packetBytes], [...packet]);
    assert.equal(decoded.correctedSymbols, 0);
  });

  test(`${profile.id} maximum packet capacity fits its RS envelope`, () => {
    const packet = makeBytes(profile.maxPacketBytes);
    const frame = encodeV3Frame(packet, profile);
    const decoded = decodeV3Frame(frame, profile);
    assert.deepEqual([...decoded.packetBytes], [...packet]);
  });
}

test('V3 RS interleaving corrects two damaged optical cells in one codeword', () => {
  const profile = V3_G32_S4_C4_RS;
  const packet = makeBytes(220);
  const frame = encodeV3Frame(packet, profile);
  const coordinates = getV3DataCellCoordinates(profile);
  const block = 5;
  const physicalIndexes = [block, profile.rsCodewordCount + block];

  for (const [errorIndex, physicalIndex] of physicalIndexes.entries()) {
    const { x, y } = coordinates[physicalIndex];
    const cell = frame.cells[y][x];
    const damaged = cell.value ^ (errorIndex === 0 ? 0x03 : 0x0C);
    const parts = splitV3Nibble(damaged);
    Object.assign(cell, { value: damaged, ...parts });
  }

  const decoded = decodeV3Frame(frame, profile);
  assert.deepEqual([...decoded.packetBytes], [...packet]);
  assert.ok(decoded.correctedSymbols >= 2);
});
