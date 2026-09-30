import test from 'node:test';
import assert from 'node:assert/strict';

import { V1_G16_C16 } from '../../packages/optical-codec/src/profiles.js';
import { recoverRepeatedClassifications } from './decoder.js';

function classified(symbol, confidence = 0.95, distance = 0.001) {
  return { symbol, confidence, distance, secondDistance: 0.02, rgb: [0, 0, 0] };
}

test('triple repetition corrects one corrupted copy per logical symbol', () => {
  const logicalCount = V1_G16_C16.dataSymbolCapacity;
  const repetition = V1_G16_C16.repetition;
  const items = new Array(logicalCount * repetition);

  for (let i = 0; i < logicalCount; i += 1) {
    const expected = i % 16;
    for (let copy = 0; copy < repetition; copy += 1) {
      items[i + (copy * logicalCount)] = classified(expected);
    }
  }

  // Corrupt one spatial copy for several independent logical symbols.
  items[3] = classified(12, 0.80, 0.006);
  items[17 + logicalCount] = classified(2, 0.75, 0.008);
  items[41 + (2 * logicalCount)] = classified(10, 0.70, 0.010);

  const recovered = recoverRepeatedClassifications(items, V1_G16_C16);
  for (let i = 0; i < logicalCount; i += 1) {
    assert.equal(recovered.symbols[i], i % 16);
  }
  assert.equal(recovered.correctedGroups, 3);
  assert.equal(recovered.uncorrectableGroups, 0);
});

test('all-three disagreement is reported as uncorrectable', () => {
  const logicalCount = V1_G16_C16.dataSymbolCapacity;
  const repetition = V1_G16_C16.repetition;
  const items = new Array(logicalCount * repetition);
  for (let i = 0; i < logicalCount; i += 1) {
    for (let copy = 0; copy < repetition; copy += 1) {
      items[i + (copy * logicalCount)] = classified(i % 16);
    }
  }

  items[5] = classified(1, 0.90, 0.005);
  items[5 + logicalCount] = classified(2, 0.80, 0.008);
  items[5 + (2 * logicalCount)] = classified(3, 0.70, 0.010);

  const recovered = recoverRepeatedClassifications(items, V1_G16_C16);
  assert.equal(recovered.uncorrectableGroups, 1);
});
