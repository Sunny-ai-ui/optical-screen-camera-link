import test from 'node:test';
import assert from 'node:assert/strict';

import { crc32 } from '../../fec/src/crc32.js';
import {
  FRAME_TYPES,
  PacketError,
  TransferReassembler,
  createTransferPackets,
  decodePacket,
  encodePacket,
} from '../src/index.js';

test('CRC32 matches standard check vector', () => {
  const bytes = new TextEncoder().encode('123456789');
  assert.equal(crc32(bytes), 0xCBF43926);
});

test('packet encode/decode preserves fields and payload', () => {
  const payload = new Uint8Array([1, 2, 3, 4, 250]);
  const encoded = encodePacket({
    frameType: FRAME_TYPES.DATA,
    sessionId: 0x1234,
    sequence: 7,
    payload,
  });

  const decoded = decodePacket(encoded);
  assert.equal(decoded.version, 1);
  assert.equal(decoded.frameType, FRAME_TYPES.DATA);
  assert.equal(decoded.sessionId, 0x1234);
  assert.equal(decoded.sequence, 7);
  assert.deepEqual(decoded.payload, payload);
});

test('single-byte corruption is rejected by packet CRC', () => {
  const encoded = encodePacket({
    frameType: FRAME_TYPES.DATA,
    sessionId: 99,
    sequence: 0,
    payload: new TextEncoder().encode('hello'),
  });

  const corrupt = encoded.slice();
  corrupt[10] ^= 0x01;

  assert.throws(
    () => decodePacket(corrupt),
    (error) => error instanceof PacketError && error.code === 'CRC_MISMATCH',
  );
});

test('multi-packet UTF-8 transfer reconstructs exactly', () => {
  const source = 'Optical link test: Hello world! नमस्ते 🌈📷';
  const transfer = createTransferPackets(source, {
    sessionId: 4242,
    chunkSize: 7,
  });

  const receiver = new TransferReassembler();
  for (const packet of transfer.packets) {
    receiver.addPacket(packet);
  }

  assert.equal(receiver.status().complete, true);
  assert.equal(receiver.getText(), source);
  assert.equal(receiver.getData().length, new TextEncoder().encode(source).length);
});

test('out-of-order DATA packets complete after END and missing packet arrive', () => {
  const source = new TextEncoder().encode('abcdefghijklmnopqrstuvwxyz0123456789');
  const transfer = createTransferPackets(source, {
    sessionId: 55,
    chunkSize: 5,
  });

  const dataPackets = transfer.packets.slice(0, -1);
  const endPacket = transfer.packets.at(-1);
  const receiver = new TransferReassembler();

  receiver.addPacket(dataPackets[3]);
  receiver.addPacket(dataPackets[0]);
  receiver.addPacket(endPacket);
  receiver.addPacket(dataPackets[1]);
  receiver.addPacket(dataPackets[2]);
  for (let i = 4; i < dataPackets.length; i += 1) {
    receiver.addPacket(dataPackets[i]);
  }

  assert.equal(receiver.status().complete, true);
  assert.deepEqual(receiver.getData(), source);
});

test('identical duplicate DATA packets are tolerated and counted', () => {
  const transfer = createTransferPackets('duplicate-test', {
    sessionId: 88,
    chunkSize: 5,
  });

  const receiver = new TransferReassembler();
  receiver.addPacket(transfer.packets[0]);
  receiver.addPacket(transfer.packets[0]);
  for (const packet of transfer.packets.slice(1)) {
    receiver.addPacket(packet);
  }

  assert.equal(receiver.status().complete, true);
  assert.equal(receiver.status().duplicates, 1);
  assert.equal(receiver.getText(), 'duplicate-test');
});

test('empty transfer completes using only END packet', () => {
  const transfer = createTransferPackets(new Uint8Array(0), { sessionId: 7 });
  assert.equal(transfer.dataPacketCount, 0);
  assert.equal(transfer.packets.length, 1);

  const receiver = new TransferReassembler();
  receiver.addPacket(transfer.packets[0]);

  assert.equal(receiver.status().complete, true);
  assert.equal(receiver.getData().length, 0);
});

test('packets from another session are rejected', () => {
  const a = createTransferPackets('AAA', { sessionId: 1, chunkSize: 2 });
  const b = createTransferPackets('BBB', { sessionId: 2, chunkSize: 2 });
  const receiver = new TransferReassembler();

  receiver.addPacket(a.packets[0]);
  assert.throws(
    () => receiver.addPacket(b.packets[0]),
    (error) => error instanceof PacketError && error.code === 'SESSION_MISMATCH',
  );
});
