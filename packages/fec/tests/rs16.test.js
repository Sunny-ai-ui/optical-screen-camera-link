import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RS16_K,
  RS16_N,
  rs16Encode,
  rs16Decode,
  rs16Syndromes,
} from '../src/rs16.js';

function sampleData(seed = 1) {
  const data = new Uint8Array(RS16_K);
  let state = seed >>> 0;
  for (let i = 0; i < data.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[i] = state & 0x0F;
  }
  return data;
}

test('RS16 encoded codewords have zero syndromes', () => {
  for (let seed = 1; seed <= 32; seed += 1) {
    const data = sampleData(seed);
    const codeword = rs16Encode(data);
    assert.equal(codeword.length, RS16_N);
    assert.deepEqual([...rs16Syndromes(codeword)], [0, 0, 0, 0]);
    assert.deepEqual([...codeword.slice(0, RS16_K)], [...data]);
  }
});

test('RS16 corrects one arbitrary symbol error', () => {
  const data = sampleData(42);
  const clean = rs16Encode(data);
  for (let position = 0; position < RS16_N; position += 1) {
    const damaged = clean.slice();
    damaged[position] ^= ((position * 5 + 3) % 15) + 1;
    const decoded = rs16Decode(damaged);
    assert.deepEqual([...decoded.data], [...data]);
    assert.equal(decoded.correctedSymbols, 1);
  }
});

test('RS16 corrects two arbitrary symbol errors', () => {
  for (let seed = 5; seed < 15; seed += 1) {
    const data = sampleData(seed);
    const clean = rs16Encode(data);
    const first = seed % RS16_N;
    const second = (seed * 7 + 4) % RS16_N;
    if (first === second) continue;
    const damaged = clean.slice();
    damaged[first] ^= ((seed + 2) % 15) + 1;
    damaged[second] ^= ((seed * 3 + 1) % 15) + 1;
    const decoded = rs16Decode(damaged);
    assert.deepEqual([...decoded.data], [...data]);
    assert.equal(decoded.correctedSymbols, 2);
  }
});

test('RS16 clean decode does not report corrections', () => {
  const data = sampleData(99);
  const decoded = rs16Decode(rs16Encode(data));
  assert.deepEqual([...decoded.data], [...data]);
  assert.equal(decoded.correctedSymbols, 0);
});
