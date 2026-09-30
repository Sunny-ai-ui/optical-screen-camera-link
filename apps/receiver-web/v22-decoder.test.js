import test from 'node:test';
import assert from 'node:assert/strict';

import { V22_S8_C8_B4_R3 } from '../../packages/optical-codec/src/profiles.js';
import { joinS8C8B4Byte, splitS8C8B4Byte } from '../../packages/optical-codec/src/v22-frame.js';
import { recoverS8C8B4Copies } from './v22-decoder.js';

test('V2.2 receiver votes shape, colour and background independently', () => {
  const logical = Uint8Array.from({ length: V22_S8_C8_B4_R3.dataByteCapacity }, (_, i) => (i * 29 + 7) & 0xFF);
  const classifications = [];

  for (let copy = 0; copy < 3; copy += 1) {
    for (let i = 0; i < logical.length; i += 1) {
      const parts = splitS8C8B4Byte(logical[i]);
      classifications.push({
        ...parts,
        shapeDistance: 0.01,
        colorDistance: 0.01,
        backgroundDistance: 0.01,
      });
    }
  }

  classifications[5].shapeId = (classifications[5].shapeId + 1) & 7;
  classifications[logical.length + 5].colorIndex = (classifications[logical.length + 5].colorIndex + 1) & 7;
  classifications[(logical.length * 2) + 5].backgroundIndex = (classifications[(logical.length * 2) + 5].backgroundIndex + 1) & 3;

  const recovered = recoverS8C8B4Copies(classifications);
  assert.deepEqual(recovered.bytes, logical);
  assert.ok(recovered.shapeCorrections >= 1);
  assert.ok(recovered.colorCorrections >= 1);
  assert.ok(recovered.backgroundCorrections >= 1);
  assert.equal(recovered.shapeUncorrectable, 0);
  assert.equal(recovered.colorUncorrectable, 0);
  assert.equal(recovered.backgroundUncorrectable, 0);
});
