import test from 'node:test';
import assert from 'node:assert/strict';

import { FRAME_TYPES, decodePacket, encodePacket } from '../../protocol/src/index.js';
import {
  V1_G16_C16,
  bytesToC16Symbols,
  c16SymbolsToBytes,
  decodeOpticalFrame,
  encodeOpticalFrame,
  renderOpticalFrameSvg,
} from '../src/index.js';

test('C16 nibble codec round-trips all 256 byte values', () => {
  const source = Uint8Array.from({ length: 256 }, (_, index) => index);
  const symbols = bytesToC16Symbols(source);
  assert.equal(symbols.length, 512);
  const restored = c16SymbolsToBytes(symbols);
  assert.deepEqual(restored, source);
});

test('protocol packet survives ideal optical frame round-trip', () => {
  const packet = encodePacket({
    frameType: FRAME_TYPES.DATA,
    sessionId: 0x2244,
    sequence: 3,
    payload: new TextEncoder().encode('HELLO OPTICAL'),
  });

  const opticalFrame = encodeOpticalFrame(packet);
  const restoredPacket = decodeOpticalFrame(opticalFrame);
  assert.deepEqual(restoredPacket, packet);

  const decoded = decodePacket(restoredPacket);
  assert.equal(new TextDecoder().decode(decoded.payload), 'HELLO OPTICAL');
});

test('every C16 reference symbol appears in the calibration row', () => {
  const packet = encodePacket({
    frameType: FRAME_TYPES.DATA,
    sessionId: 1,
    sequence: 0,
    payload: new Uint8Array([1, 2, 3]),
  });
  const frame = encodeOpticalFrame(packet);
  const symbols = frame.cells[V1_G16_C16.calibrationRow].map((cell) => cell.symbol);
  assert.deepEqual(symbols, Array.from({ length: 16 }, (_, index) => index));
});

test('oversized protocol packet is rejected by the optical profile', () => {
  const oversized = new Uint8Array(V1_G16_C16.maxPacketBytes + 1);
  assert.throws(() => encodeOpticalFrame(oversized), /allows at most/);
});

test('SVG renderer produces a 256x256 logical optical ROI', () => {
  const packet = encodePacket({
    frameType: FRAME_TYPES.DATA,
    sessionId: 2,
    sequence: 0,
    payload: new TextEncoder().encode('SVG'),
  });
  const svg = renderOpticalFrameSvg(encodeOpticalFrame(packet));
  assert.match(svg, /<svg/);
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.match(svg, /width="256" height="256"/);
});
