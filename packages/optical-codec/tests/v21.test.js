import test from 'node:test';
import assert from 'node:assert/strict';

import {
  V21_S8_C16_R3,
  bytesTo7BitSymbols,
  sevenBitSymbolsToBytes,
  encodeS8C16Frame,
  decodeS8C16Frame,
} from '../src/index.js';

test('V2.1 seven-bit packing round trips a full envelope', () => {
  const input = Uint8Array.from({ length: V21_S8_C16_R3.dataByteCapacity }, (_, i) => (i * 73 + 19) & 0xFF);
  const symbols = bytesTo7BitSymbols(input, V21_S8_C16_R3.logicalSymbolCapacity);
  assert.equal(symbols.length, V21_S8_C16_R3.logicalSymbolCapacity);
  assert.ok([...symbols].every((value) => value >= 0 && value < 128));
  const output = sevenBitSymbolsToBytes(symbols, input.length);
  assert.deepEqual([...output], [...input]);
});

test('V2.1 ideal optical frame round trips packet bytes', () => {
  const packet = Uint8Array.from({ length: V21_S8_C16_R3.maxPacketBytes }, (_, i) => (i * 29 + 7) & 0xFF);
  const frame = encodeS8C16Frame(packet);
  assert.equal(frame.profileId, V21_S8_C16_R3.id);
  const decoded = decodeS8C16Frame(frame);
  assert.deepEqual([...decoded], [...packet]);
});
