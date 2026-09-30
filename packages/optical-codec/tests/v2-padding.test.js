import test from 'node:test';
import assert from 'node:assert/strict';

import { V2_S8_C32_R3 } from '../src/profiles.js';
import { S8_SHAPES } from '../src/shapes.js';
import { decodeS8C32Frame, encodeS8C32Frame } from '../src/v2-frame.js';

test('V2 shape zero is not a locator-like ring', () => {
  assert.notEqual(S8_SHAPES[0].name, 'ring');
  assert.equal(S8_SHAPES[0].name, 't');
});

test('short V2 packets use mixed padding while preserving packet round-trip', () => {
  const packet = new Uint8Array([0x4f, 0x53, 0x01, 0x02, 0x12, 0x34, 0x00, 0x00, 0x00, 0x00, 0xaa, 0xbb, 0xcc, 0xdd]);
  const frame = encodeS8C32Frame(packet, V2_S8_C32_R3);
  const decoded = decodeS8C32Frame(frame, V2_S8_C32_R3);
  assert.deepEqual([...decoded], [...packet]);

  const firstCopy = [];
  for (let row = V2_S8_C32_R3.dataRowStart; row <= V2_S8_C32_R3.dataRowEnd; row += 1) {
    for (let x = 0; x < V2_S8_C32_R3.gridSize; x += 1) {
      const cell = frame.cells[row][x];
      if (cell?.kind === 's8c32-data' && cell.copyIndex === 0) firstCopy.push(cell.value);
    }
  }

  const used = V2_S8_C32_R3.lengthPrefixBytes + packet.length;
  const padding = firstCopy.slice(used);
  assert.ok(padding.length > 10, 'test should contain meaningful padding');
  assert.ok(new Set(padding).size >= 12, 'padding should be visually diverse, not a repeated zero symbol');
  assert.ok(padding.filter((value) => value === 0).length <= 1, 'padding should not create a field of 0x00 symbols');
});
