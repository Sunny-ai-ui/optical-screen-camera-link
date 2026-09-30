import test from 'node:test';
import assert from 'node:assert/strict';
import { rs16Encode, rs16Decode } from '../src/rs16.js';

const DATA = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

function corrupt(codeword, edits) {
  const out = codeword.slice();
  for (const [position, delta] of edits) out[position] ^= delta;
  return out;
}

test('RS(15,11) recovers four known erasures', () => {
  const encoded = rs16Encode(DATA);
  const damaged = corrupt(encoded, [[0, 3], [4, 7], [9, 5], [14, 11]]);
  const decoded = rs16Decode(damaged, { erasures: [0, 4, 9, 14] });
  assert.deepEqual([...decoded.data], [...DATA]);
  assert.equal(decoded.correctedSymbols, 4);
});

test('RS(15,11) recovers two erasures plus one unknown error', () => {
  const encoded = rs16Encode(DATA);
  const damaged = corrupt(encoded, [[2, 6], [7, 9], [12, 5]]);
  const decoded = rs16Decode(damaged, { erasures: [2, 7] });
  assert.deepEqual([...decoded.data], [...DATA]);
  assert.equal(decoded.correctedSymbols, 3);
});
