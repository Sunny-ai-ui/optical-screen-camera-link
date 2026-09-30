import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePacket } from '../../protocol/src/packet.js';
import { createFountainTransfer, FountainReassembler, parseDropletPayload } from '../src/index.js';

function pseudoRandomBytes(length) {
  const bytes = new Uint8Array(length);
  let x = 0x12345678;
  for (let i = 0; i < length; i += 1) {
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    bytes[i] = x & 0xFF;
  }
  return bytes;
}

test('fountain transfer roundtrips text', () => {
  const transfer = createFountainTransfer('hello resilient optical world', { packetPayloadBytes: 80, sessionId: 123 });
  const receiver = new FountainReassembler();
  for (const packet of transfer.packets) {
    const status = receiver.addPacket(packet);
    if (status.complete) break;
  }
  assert.equal(receiver.getText(), 'hello resilient optical world');
});

test('fountain can recover when selected systematic droplets are missing', () => {
  const data = pseudoRandomBytes(900);
  const transfer = createFountainTransfer(data, { packetPayloadBytes: 120, overheadRatio: 2.5, sessionId: 77 });
  const missing = new Set([1, 4, 7]);
  const receiver = new FountainReassembler();
  for (const packet of transfer.packets) {
    const droplet = parseDropletPayload(decodePacket(packet).payload);
    if (droplet.dropletId < transfer.sourceBlockCount && missing.has(droplet.dropletId)) continue;
    const status = receiver.addPacket(packet);
    if (status.complete) break;
  }
  assert.deepEqual(receiver.getData(), data);
});

test('fountain accepts droplets out of order and ignores exact duplicates', () => {
  const transfer = createFountainTransfer(pseudoRandomBytes(300), { packetPayloadBytes: 90, overheadRatio: 1.5, sessionId: 88 });
  const receiver = new FountainReassembler();
  const reversed = transfer.packets.slice().reverse();
  receiver.addPacket(reversed[0]);
  const duplicate = receiver.addPacket(reversed[0]);
  assert.equal(duplicate.event, 'duplicate');
  for (const packet of reversed.slice(1)) {
    const status = receiver.addPacket(packet);
    if (status.complete) break;
  }
  assert.ok(receiver.status().complete);
});

test('fountain metadata parser reconstructs deterministic index set', () => {
  const transfer = createFountainTransfer(pseudoRandomBytes(500), { packetPayloadBytes: 100, overheadRatio: 1, sessionId: 99 });
  const mixedPacket = transfer.packets[transfer.sourceBlockCount + 2];
  const parsedA = parseDropletPayload(decodePacket(mixedPacket).payload);
  const parsedB = parseDropletPayload(decodePacket(mixedPacket).payload);
  assert.deepEqual(parsedA.indices, parsedB.indices);
  assert.equal(parsedA.degree, parsedA.indices.length);
});
