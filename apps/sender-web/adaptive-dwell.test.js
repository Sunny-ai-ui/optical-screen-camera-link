import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFrameDwellMs } from './adaptive-dwell.js';

test('auto dwell becomes more conservative as V3 density rises', () => {
  const g32 = resolveFrameDwellMs('auto', { id: 'V3-G32-S4-C4-RS15-11' });
  const g48 = resolveFrameDwellMs('auto', { id: 'V3-G48-S4-C4-RS15-11' });
  const g64 = resolveFrameDwellMs('auto', { id: 'V3-G64-S4-C4-RS15-11' });
  assert.ok(g32 < g48);
  assert.ok(g48 < g64);
});

test('manual dwell remains under user control', () => {
  assert.equal(resolveFrameDwellMs('500', { id: 'V3-G64-S4-C4-RS15-11' }), 500);
});
