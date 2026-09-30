import { rs16Encode, rs16Decode } from '../../fec/src/rs16.js';
import { splitV3Nibble, joinV3Nibble } from '../../constellation/src/v3.js';

export const M9_TILE_GRID = 13;
export const M9_TILE_COUNT = 9;
export const M9_DATA_TILE_COUNT = 8;
export const M9_SHARD_BYTES = 40;
export const M9_TILE_ENVELOPE_BYTES = 44;
export const M9_RS_CODEWORDS = 8;
export const M9_TILE_SYMBOLS = M9_RS_CODEWORDS * 15;
export const M9_PACKET_CAPACITY = M9_DATA_TILE_COUNT * M9_SHARD_BYTES;
export const M9_TILE_MARKER = Object.freeze({ x: 6, y: 6 });

function crc16Ccitt(bytes) {
  let crc = 0xFFFF;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xFFFF;
    }
  }
  return crc;
}

function bytesToNibbles(bytes) {
  const out = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i += 1) {
    out[i * 2] = bytes[i] >>> 4;
    out[(i * 2) + 1] = bytes[i] & 0x0F;
  }
  return out;
}

function nibblesToBytes(nibbles) {
  if (nibbles.length % 2) throw new Error('M9 nibble stream must be byte aligned');
  const out = new Uint8Array(nibbles.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = ((nibbles[i * 2] & 0x0F) << 4) | (nibbles[(i * 2) + 1] & 0x0F);
  }
  return out;
}

function xorInto(target, source) {
  for (let i = 0; i < target.length; i += 1) target[i] ^= source[i];
}

export function getM9TileDataCoordinates() {
  const cells = [];
  for (let y = 1; y < M9_TILE_GRID - 1; y += 1) {
    for (let x = 1; x < M9_TILE_GRID - 1; x += 1) {
      if (x === M9_TILE_MARKER.x && y === M9_TILE_MARKER.y) continue;
      cells.push({ x, y });
    }
  }
  if (cells.length !== M9_TILE_SYMBOLS) throw new Error(`M9 layout expected ${M9_TILE_SYMBOLS} cells, got ${cells.length}`);
  return cells;
}

function interleaveRs(dataNibbles) {
  if (!(dataNibbles instanceof Uint8Array) || dataNibbles.length !== M9_RS_CODEWORDS * 11) {
    throw new TypeError('M9 tile must contain exactly 88 data nibbles');
  }
  const codewords = Array.from({ length: M9_RS_CODEWORDS }, (_, block) => (
    rs16Encode(dataNibbles.slice(block * 11, (block + 1) * 11))
  ));
  const symbols = new Uint8Array(M9_TILE_SYMBOLS);
  let index = 0;
  for (let position = 0; position < 15; position += 1) {
    for (let block = 0; block < M9_RS_CODEWORDS; block += 1) symbols[index++] = codewords[block][position];
  }
  return symbols;
}

function deinterleaveRs(symbols) {
  if (!(symbols instanceof Uint8Array) || symbols.length !== M9_TILE_SYMBOLS) {
    throw new TypeError(`M9 tile must contain ${M9_TILE_SYMBOLS} encoded symbols`);
  }
  const words = Array.from({ length: M9_RS_CODEWORDS }, () => new Uint8Array(15));
  let index = 0;
  for (let position = 0; position < 15; position += 1) {
    for (let block = 0; block < M9_RS_CODEWORDS; block += 1) words[block][position] = symbols[index++];
  }
  return words;
}

export function encodeM9Tile({ frameId, tileIndex, shard }) {
  if (!Number.isInteger(frameId) || frameId < 0 || frameId > 0xFFFF) throw new RangeError('frameId must be 0..65535');
  if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= M9_TILE_COUNT) throw new RangeError('tileIndex must be 0..8');
  if (!(shard instanceof Uint8Array) || shard.length !== M9_SHARD_BYTES) throw new TypeError(`shard must be ${M9_SHARD_BYTES} bytes`);

  const envelope = new Uint8Array(M9_TILE_ENVELOPE_BYTES);
  const view = new DataView(envelope.buffer);
  view.setUint16(0, frameId, false);
  envelope.set(shard, 2);
  const crc = crc16Ccitt(envelope.subarray(0, 42));
  view.setUint16(42, crc, false);

  const symbols = interleaveRs(bytesToNibbles(envelope));
  const cells = Array.from({ length: M9_TILE_GRID }, (_, y) =>
    Array.from({ length: M9_TILE_GRID }, (_, x) => {
      const border = x === 0 || y === 0 || x === M9_TILE_GRID - 1 || y === M9_TILE_GRID - 1;
      if (border) return { x, y, kind: 'm9-timing', dark: ((x + y + tileIndex) & 1) === 0 };
      return { x, y, kind: 'm9-guard' };
    }),
  );

  cells[M9_TILE_MARKER.y][M9_TILE_MARKER.x] = {
    x: M9_TILE_MARKER.x,
    y: M9_TILE_MARKER.y,
    kind: 'm9-marker',
    value: tileIndex,
    ...splitV3Nibble(tileIndex),
  };

  getM9TileDataCoordinates().forEach(({ x, y }, index) => {
    const value = symbols[index];
    cells[y][x] = {
      x, y, kind: 'm9-data', value, physicalSymbolIndex: index, ...splitV3Nibble(value),
    };
  });

  return { frameId, tileIndex, shard: shard.slice(), cells };
}

export function decodeM9TileSymbols(symbols, expectedTileIndex = null) {
  const words = deinterleaveRs(symbols);
  const recoveredNibbles = [];
  let correctedSymbols = 0;
  for (let blockIndex = 0; blockIndex < words.length; blockIndex += 1) {
    try {
      const decoded = rs16Decode(words[blockIndex]);
      recoveredNibbles.push(...decoded.data);
      correctedSymbols += decoded.correctedSymbols;
    } catch (error) {
      error.blockIndex = blockIndex;
      throw error;
    }
  }
  const envelope = nibblesToBytes(Uint8Array.from(recoveredNibbles));
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const expectedCrc = view.getUint16(42, false);
  const actualCrc = crc16Ccitt(envelope.subarray(0, 42));
  if (actualCrc !== expectedCrc) {
    const error = new Error('M9 tile CRC16 mismatch');
    error.code = 'M9_CRC_MISMATCH';
    throw error;
  }
  return {
    frameId: view.getUint16(0, false),
    tileIndex: expectedTileIndex,
    shard: envelope.slice(2, 42),
    correctedSymbols,
  };
}

export function splitPacketIntoM9Shards(packetBytes) {
  if (!(packetBytes instanceof Uint8Array)) throw new TypeError('packetBytes must be Uint8Array');
  if (packetBytes.length > M9_PACKET_CAPACITY) {
    throw new RangeError(`M9 superframe holds at most ${M9_PACKET_CAPACITY} packet bytes`);
  }
  const padded = new Uint8Array(M9_PACKET_CAPACITY);
  padded.set(packetBytes);
  const shards = Array.from({ length: M9_DATA_TILE_COUNT }, (_, index) => (
    padded.slice(index * M9_SHARD_BYTES, (index + 1) * M9_SHARD_BYTES)
  ));
  const parity = new Uint8Array(M9_SHARD_BYTES);
  for (const shard of shards) xorInto(parity, shard);
  return [...shards, parity];
}

export function encodeM9Superframe(packetBytes, { frameId = 0 } = {}) {
  const shards = splitPacketIntoM9Shards(packetBytes);
  return {
    version: 50,
    modulation: 'M9-S4C4-RS15-11',
    frameId,
    packetLength: packetBytes.length,
    packetCapacity: M9_PACKET_CAPACITY,
    tiles: shards.map((shard, tileIndex) => encodeM9Tile({ frameId, tileIndex, shard })),
  };
}

export function recoverM9Packet(decodedTiles, packetLength) {
  if (!Array.isArray(decodedTiles)) throw new TypeError('decodedTiles must be an array');
  if (!Number.isInteger(packetLength) || packetLength < 1 || packetLength > M9_PACKET_CAPACITY) {
    throw new RangeError('Invalid M9 packetLength');
  }
  const byIndex = new Map();
  let frameId = null;
  for (const tile of decodedTiles) {
    if (!tile || !Number.isInteger(tile.tileIndex) || tile.tileIndex < 0 || tile.tileIndex >= M9_TILE_COUNT) continue;
    if (!(tile.shard instanceof Uint8Array) || tile.shard.length !== M9_SHARD_BYTES) continue;
    if (frameId === null) frameId = tile.frameId;
    if (tile.frameId !== frameId) continue;
    byIndex.set(tile.tileIndex, tile.shard);
  }

  const missingData = [];
  for (let index = 0; index < M9_DATA_TILE_COUNT; index += 1) if (!byIndex.has(index)) missingData.push(index);
  if (missingData.length > 1) {
    const error = new Error(`M9 needs at least 7 data tiles plus parity, or all 8 data tiles; missing data tiles: ${missingData.join(',')}`);
    error.code = 'M9_TOO_MANY_MISSING_TILES';
    throw error;
  }

  if (missingData.length === 1) {
    const parity = byIndex.get(8);
    if (!parity) {
      const error = new Error('M9 parity tile is required to recover one missing data tile');
      error.code = 'M9_PARITY_REQUIRED';
      throw error;
    }
    const recovered = parity.slice();
    for (let index = 0; index < M9_DATA_TILE_COUNT; index += 1) {
      if (index === missingData[0]) continue;
      const shard = byIndex.get(index);
      if (!shard) throw new Error('M9 recovery requires every other data tile');
      xorInto(recovered, shard);
    }
    byIndex.set(missingData[0], recovered);
  }

  const padded = new Uint8Array(M9_PACKET_CAPACITY);
  for (let index = 0; index < M9_DATA_TILE_COUNT; index += 1) {
    const shard = byIndex.get(index);
    if (!shard) {
      const error = new Error(`M9 data tile ${index} missing`);
      error.code = 'M9_DATA_TILE_MISSING';
      throw error;
    }
    padded.set(shard, index * M9_SHARD_BYTES);
  }

  return { frameId, packetBytes: padded.slice(0, packetLength), recoveredTileIndex: missingData[0] ?? null };
}

export function extractM9TileSymbols(tile) {
  const symbols = new Uint8Array(M9_TILE_SYMBOLS);
  getM9TileDataCoordinates().forEach(({ x, y }, index) => {
    const cell = tile.cells?.[y]?.[x];
    if (!cell || cell.kind !== 'm9-data') throw new Error(`Missing M9 data cell at ${x},${y}`);
    symbols[index] = joinV3Nibble(cell.shapeId, cell.colorIndex);
  });
  return symbols;
}

export { crc16Ccitt as m9Crc16Ccitt };
