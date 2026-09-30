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
  recoverV3PacketFromSymbols,
  recoverV3PacketFromSymbolsWithAlternates,
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


test('V3 selective retry rescues a failed RS block using runner-up optical symbols', () => {
  const profile = V3_G32_S4_C4_RS;
  const packet = makeBytes(220);
  const frame = encodeV3Frame(packet, profile);
  const coordinates = getV3DataCellCoordinates(profile);
  const original = Uint8Array.from(coordinates, ({ x, y }) => frame.cells[y][x].value);
  const damaged = original.slice();
  const alternates = damaged.slice();
  const confidences = new Float32Array(damaged.length).fill(0.92);
  const alternateConfidences = new Float32Array(damaged.length);
  const block = 7;

  // Three wrong symbols in one RS(15,11) codeword exceed the normal
  // two-error budget. Runner-up symbols point back to the correct values.
  for (const [n, position] of [1, 5, 11].entries()) {
    const index = position * profile.rsCodewordCount + block;
    damaged[index] = original[index] ^ (n + 1);
    alternates[index] = original[index];
    // Keep primary confidence above the erasure threshold so the baseline
    // decoder sees three unknown errors and must fail.
    confidences[index] = 0.55 + n * 0.02;
    alternateConfidences[index] = 0.80;
  }

  assert.throws(
    () => recoverV3PacketFromSymbols(damaged, profile, confidences),
    (error) => error.code === 'RS16_UNCORRECTABLE' && error.blockIndex === block,
  );

  const recovered = recoverV3PacketFromSymbolsWithAlternates(
    damaged,
    profile,
    confidences,
    alternates,
    alternateConfidences,
  );
  assert.deepEqual([...recovered.packetBytes], [...packet]);
  assert.ok(recovered.selectiveRetryAttempts > 0);
  assert.deepEqual(recovered.rescuedBlocks, [block]);
});
