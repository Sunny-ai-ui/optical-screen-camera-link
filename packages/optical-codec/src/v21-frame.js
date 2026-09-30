import { getDataCellCoordinates, V21_S8_C16_R3 } from './profiles.js';

const FINDER_PATTERNS = Object.freeze({
  TL: [[1, 1], [1, 0]],
  TR: [[1, 0], [1, 1]],
  BL: [[1, 1], [0, 1]],
  BR: [[0, 1], [1, 1]],
});

function emptyCells(profile) {
  return Array.from({ length: profile.gridSize }, (_, y) =>
    Array.from({ length: profile.gridSize }, (_, x) => ({ x, y, kind: 'guard' })),
  );
}

function placeFinder(cells, corner, x0, y0) {
  const pattern = FINDER_PATTERNS[corner];
  for (let dy = 0; dy < 2; dy += 1) {
    for (let dx = 0; dx < 2; dx += 1) {
      cells[y0 + dy][x0 + dx] = {
        x: x0 + dx,
        y: y0 + dy,
        kind: 'finder',
        corner,
        dark: pattern[dy][dx] === 1,
      };
    }
  }
}

function fillPadding(envelope, packetLength) {
  let state = (0x51A7C3D9 ^ (packetLength * 0x45D9F3B)) >>> 0;
  for (let i = 0; i < envelope.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    envelope[i] = state & 0xFF;
  }
}

export function bytesTo7BitSymbols(bytes, symbolCount) {
  const symbols = new Uint8Array(symbolCount);
  const totalBits = bytes.length * 8;
  for (let symbolIndex = 0; symbolIndex < symbolCount; symbolIndex += 1) {
    let value = 0;
    for (let bit = 0; bit < 7; bit += 1) {
      const sourceBit = (symbolIndex * 7) + bit;
      value <<= 1;
      if (sourceBit < totalBits) {
        const byte = bytes[sourceBit >>> 3];
        value |= (byte >>> (7 - (sourceBit & 7))) & 1;
      } else {
        value |= ((symbolIndex * 13 + bit * 7 + 3) >>> 1) & 1;
      }
    }
    symbols[symbolIndex] = value;
  }
  return symbols;
}

export function sevenBitSymbolsToBytes(symbols, byteCount) {
  const bytes = new Uint8Array(byteCount);
  const totalBits = byteCount * 8;
  for (let bitIndex = 0; bitIndex < totalBits; bitIndex += 1) {
    const symbolIndex = Math.floor(bitIndex / 7);
    const symbolBit = bitIndex % 7;
    const bit = (symbols[symbolIndex] >>> (6 - symbolBit)) & 1;
    bytes[bitIndex >>> 3] |= bit << (7 - (bitIndex & 7));
  }
  return bytes;
}

function repeatSymbols(symbols, repetition) {
  const encoded = new Uint8Array(symbols.length * repetition);
  for (let copy = 0; copy < repetition; copy += 1) {
    encoded.set(symbols, copy * symbols.length);
  }
  return encoded;
}

export function encodeS8C16Frame(packetBytes, profile = V21_S8_C16_R3) {
  if (!(packetBytes instanceof Uint8Array)) {
    throw new TypeError('encodeS8C16Frame expects packet bytes as Uint8Array');
  }
  if (packetBytes.length > profile.maxPacketBytes) {
    throw new RangeError(`Packet is ${packetBytes.length} bytes; ${profile.id} allows at most ${profile.maxPacketBytes}`);
  }

  const envelope = new Uint8Array(profile.dataByteCapacity);
  fillPadding(envelope, packetBytes.length);
  const view = new DataView(envelope.buffer);
  view.setUint16(0, packetBytes.length, false);
  envelope.set(packetBytes, profile.lengthPrefixBytes);

  const logical = bytesTo7BitSymbols(envelope, profile.logicalSymbolCapacity);
  const repeated = repeatSymbols(logical, profile.repetition);

  const cells = emptyCells(profile);
  const last = profile.gridSize - 1;
  placeFinder(cells, 'TL', 0, 0);
  placeFinder(cells, 'TR', last - 1, 0);
  placeFinder(cells, 'BL', 0, last - 1);
  placeFinder(cells, 'BR', last - 1, last - 1);

  for (let shapeId = 0; shapeId < profile.shapeCount; shapeId += 1) {
    const x = profile.shapeCalibrationStartX + shapeId;
    const y = profile.shapeCalibrationRow;
    cells[y][x] = { x, y, kind: 'shape-calibration', shapeId };
  }

  profile.profileSignatureBits.forEach((bit, index) => {
    const x = profile.profileSignatureStartX + index;
    const y = profile.profileSignatureRow;
    cells[y][x] = { x, y, kind: 'profile-signature', dark: bit === 1 };
  });

  for (let colorIndex = 0; colorIndex < profile.colorCount; colorIndex += 1) {
    const x = colorIndex;
    const y = profile.colorCalibrationRows[0];
    cells[y][x] = { x, y, kind: 'color-calibration-16', colorIndex };
  }

  const coordinates = getDataCellCoordinates(profile);
  coordinates.slice(0, repeated.length).forEach(({ x, y }, index) => {
    const value = repeated[index];
    cells[y][x] = {
      x,
      y,
      kind: 's8c16-data',
      value,
      shapeId: value >>> 4,
      colorIndex: value & 0x0F,
      logicalSymbolIndex: index % profile.logicalSymbolCapacity,
      copyIndex: Math.floor(index / profile.logicalSymbolCapacity),
    };
  });

  return {
    version: 21,
    modulation: profile.modulation,
    profileId: profile.id,
    logicalSize: profile.logicalSize,
    cellSize: profile.cellSize,
    gridSize: profile.gridSize,
    packetLength: packetBytes.length,
    cells,
  };
}

function majority(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function decodeS8C16Frame(frame, profile = V21_S8_C16_R3) {
  if (!frame || frame.profileId !== profile.id) throw new Error(`Expected optical profile ${profile.id}`);
  const coordinates = getDataCellCoordinates(profile).slice(0, profile.encodedSymbolCapacity);
  const physical = coordinates.map(({ x, y }) => {
    const cell = frame.cells?.[y]?.[x];
    if (!cell || cell.kind !== 's8c16-data') throw new Error(`Missing V2.1 data cell at ${x},${y}`);
    return cell;
  });

  const logical = new Uint8Array(profile.logicalSymbolCapacity);
  for (let i = 0; i < logical.length; i += 1) {
    const copies = Array.from({ length: profile.repetition }, (_, copy) =>
      physical[i + (copy * logical.length)],
    );
    const shapeId = majority(copies.map((cell) => cell.shapeId));
    const colorIndex = majority(copies.map((cell) => cell.colorIndex));
    logical[i] = (shapeId << 4) | colorIndex;
  }

  const envelope = sevenBitSymbolsToBytes(logical, profile.dataByteCapacity);
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const packetLength = view.getUint16(0, false);
  if (packetLength < 1 || packetLength > profile.maxPacketBytes) {
    throw new Error(`Decoded packet length ${packetLength} exceeds profile capacity`);
  }
  return envelope.slice(profile.lengthPrefixBytes, profile.lengthPrefixBytes + packetLength);
}
