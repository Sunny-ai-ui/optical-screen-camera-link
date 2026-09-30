import test from 'node:test';
import assert from 'node:assert/strict';

import { V2_S8_C32_R3 } from '../../packages/optical-codec/src/profiles.js';
import { splitS8C32Byte } from '../../packages/optical-codec/src/shapes.js';
import { recoverS8C32Copies } from './v2-decoder.js';

function classified(value, shapeDistance = 0.001, colorDistance = 0.001) {
  const { shapeId, colorIndex } = splitS8C32Byte(value);
  return { shapeId, colorIndex, shapeDistance, colorDistance };
}

test('component-wise R3 fixes shape and colour errors in different copies', () => {
  const profile = V2_S8_C32_R3;
  const items = new Array(profile.encodedByteCapacity);

  for (let i = 0; i < profile.dataByteCapacity; i += 1) {
    const value = (i * 37) & 0xFF;
    for (let copy = 0; copy < profile.repetition; copy += 1) {
      items[i + (copy * profile.dataByteCapacity)] = classified(value);
    }
  }

  const logicalIndex = 11;
  const expected = (logicalIndex * 37) & 0xFF;
  const expectedParts = splitS8C32Byte(expected);

  // Copy 0: wrong shape but correct colour.
  items[logicalIndex] = {
    shapeId: (expectedParts.shapeId + 1) % 8,
    colorIndex: expectedParts.colorIndex,
    shapeDistance: 0.010,
    colorDistance: 0.001,
  };

  // Copy 1: correct shape but wrong colour.
  items[logicalIndex + profile.dataByteCapacity] = {
    shapeId: expectedParts.shapeId,
    colorIndex: (expectedParts.colorIndex + 1) % 32,
    shapeDistance: 0.001,
    colorDistance: 0.010,
  };

  // Copy 2 stays fully correct. No complete-byte majority exists, but each
  // component has a 2-of-3 majority and must reconstruct the exact byte.
  const recovered = recoverS8C32Copies(items, profile);
  assert.equal(recovered.bytes[logicalIndex], expected);
  assert.equal(recovered.shapeCorrections, 1);
  assert.equal(recovered.colorCorrections, 1);
  assert.equal(recovered.shapeUncorrectable, 0);
  assert.equal(recovered.colorUncorrectable, 0);
});
