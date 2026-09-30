import test from 'node:test';
import assert from 'node:assert/strict';
import { createFountainTransfer } from '../../fountain/src/index.js';
import {
  M9_PACKET_CAPACITY,
  M9_SHARD_BYTES,
  M9_TILE_COUNT,
  decodeM9HeaderBits,
  decodeM9TileSymbols,
  encodeM9HeaderBits,
  encodeM9Superframe,
  extractM9TileSymbols,
  recoverM9Packet,
} from '../src/index.js';

function makeBytes(length) {
  const bytes = new Uint8Array(length);
  let state = 0x51A7C0DE;
  for (let i = 0; i < length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[i] = state & 0xFF;
  }
  return bytes;
}

function decodeAll(frame) {
  return frame.tiles.map((tile, tileIndex) => (
    decodeM9TileSymbols(extractM9TileSymbols(tile), tileIndex)
  ));
}

test('M9 carries a full packet across nine simultaneously displayed tiles', () => {
  const packet = makeBytes(270);
  const frame = encodeM9Superframe(packet, { frameId: 77 });
  assert.equal(frame.tiles.length, M9_TILE_COUNT);
  const decoded = decodeAll(frame);
  const recovered = recoverM9Packet(decoded, packet.length);
  assert.equal(recovered.frameId, 77);
  assert.equal(recovered.recoveredTileIndex, null);
  assert.deepEqual([...recovered.packetBytes], [...packet]);
});

test('M9 parity tile reconstructs one missing data tile', () => {
  const packet = makeBytes(M9_PACKET_CAPACITY);
  const frame = encodeM9Superframe(packet, { frameId: 991 });
  const decoded = decodeAll(frame).filter((tile) => tile.tileIndex !== 3);
  const recovered = recoverM9Packet(decoded, packet.length);
  assert.equal(recovered.recoveredTileIndex, 3);
  assert.deepEqual([...recovered.packetBytes], [...packet]);
});

test('M9 fails cleanly when two data tiles are missing', () => {
  const packet = makeBytes(200);
  const frame = encodeM9Superframe(packet, { frameId: 12 });
  const decoded = decodeAll(frame).filter((tile) => ![2, 6].includes(tile.tileIndex));
  assert.throws(
    () => recoverM9Packet(decoded, packet.length),
    (error) => error.code === 'M9_TOO_MANY_MISSING_TILES',
  );
});

test('each M9 tile RS layer corrects two symbol errors in one codeword', () => {
  const packet = makeBytes(180);
  const frame = encodeM9Superframe(packet, { frameId: 5 });
  const tile = frame.tiles[4];
  const symbols = extractM9TileSymbols(tile);
  symbols[2] ^= 0x03;
  symbols[2 + 8] ^= 0x0C;
  const decoded = decodeM9TileSymbols(symbols, 4);
  assert.ok(decoded.correctedSymbols >= 2);
  assert.equal(decoded.shard.length, M9_SHARD_BYTES);
});

test('M9 tile CRC rejects post-RS corruption that lands outside correction budget', () => {
  const packet = makeBytes(180);
  const frame = encodeM9Superframe(packet, { frameId: 5 });
  const tile = frame.tiles[1];
  const symbols = extractM9TileSymbols(tile);
  // Damage three symbols in the same RS codeword. Depending on syndrome shape,
  // RS may throw directly or miscorrect; CRC16 must prevent silent acceptance.
  symbols[1] ^= 0x01;
  symbols[1 + 8] ^= 0x02;
  symbols[1 + 16] ^= 0x04;
  assert.throws(() => decodeM9TileSymbols(symbols, 1));
});


test('M9 global header round-trips frame identity and packet length with CRC8', () => {
  const bits = encodeM9HeaderBits(0xBEEF, 270);
  assert.equal(bits.length, 40);
  assert.deepEqual(decodeM9HeaderBits(bits), { frameId: 0xBEEF, packetLength: 270, version: 1 });
  const damaged = bits.slice();
  damaged[9] ^= 1;
  assert.throws(() => decodeM9HeaderBits(damaged), /CRC8/);
});


test('real fountain packets fit inside one M9 superframe', () => {
  const payload = makeBytes(4096);
  const transfer = createFountainTransfer(payload, {
    sessionId: 0x1234,
    packetPayloadBytes: 256,
    overheadRatio: 1,
  });
  assert.ok(transfer.packets.length > 1);
  for (const [index, packet] of transfer.packets.entries()) {
    assert.ok(packet.length <= M9_PACKET_CAPACITY);
    const frame = encodeM9Superframe(packet, { frameId: index });
    const recovered = recoverM9Packet(decodeAll(frame), packet.length);
    assert.deepEqual([...recovered.packetBytes], [...packet]);
  }
});

test('M9 tiles expose self-calibration and tile marker cells', () => {
  const frame = encodeM9Superframe(makeBytes(100), { frameId: 1 });
  frame.tiles.forEach((tile, tileIndex) => {
    assert.equal(tile.cells[0][2].kind, 'm9-color-calibration');
    assert.equal(tile.cells[0][7].kind, 'm9-shape-calibration');
    assert.equal(tile.cells[6][6].kind, 'm9-marker');
    assert.equal(tile.cells[6][6].value, tileIndex);
  });
});
