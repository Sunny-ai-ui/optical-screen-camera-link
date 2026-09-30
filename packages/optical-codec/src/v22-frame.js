import { getDataCellCoordinates, V22_S8_C8_B4_R3 } from './profiles.js';

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
  let state = (0xB4227A31 ^ (packetLength * 0x45D9F3B)) >>> 0;
  for (let i = 0; i < envelope.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    envelope[i] = state & 0xFF;
  }
}

function repeatBytes(bytes, repetition) {
  const encoded = new Uint8Array(bytes.length * repetition);
  for (let copy = 0; copy < repetition; copy += 1) encoded.set(bytes, copy * bytes.length);
  return encoded;
}

export function splitS8C8B4Byte(value) {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new RangeError('S8C8B4 value must be one byte');
  return { shapeId: value >>> 5, colorIndex: (value >>> 2) & 0x07, backgroundIndex: value & 0x03 };
}

export function joinS8C8B4Byte(shapeId, colorIndex, backgroundIndex) {
  if (!Number.isInteger(shapeId) || shapeId < 0 || shapeId > 7) throw new RangeError('shapeId must be 0..7');
  if (!Number.isInteger(colorIndex) || colorIndex < 0 || colorIndex > 7) throw new RangeError('colorIndex must be 0..7');
  if (!Number.isInteger(backgroundIndex) || backgroundIndex < 0 || backgroundIndex > 3) throw new RangeError('backgroundIndex must be 0..3');
  return (shapeId << 5) | (colorIndex << 2) | backgroundIndex;
}

export function encodeS8C8B4Frame(packetBytes, profile = V22_S8_C8_B4_R3) {
  if (!(packetBytes instanceof Uint8Array)) throw new TypeError('encodeS8C8B4Frame expects Uint8Array');
  if (packetBytes.length > profile.maxPacketBytes) {
    throw new RangeError(`Packet is ${packetBytes.length} bytes; ${profile.id} allows at most ${profile.maxPacketBytes}`);
  }

  const envelope = new Uint8Array(profile.dataByteCapacity);
  fillPadding(envelope, packetBytes.length);
  const view = new DataView(envelope.buffer);
  view.setUint16(0, packetBytes.length, false);
  envelope.set(packetBytes, profile.lengthPrefixBytes);
  const repeated = repeatBytes(envelope, profile.repetition);

  const cells = emptyCells(profile);
  const last = profile.gridSize - 1;
  placeFinder(cells, 'TL', 0, 0);
  placeFinder(cells, 'TR', last - 1, 0);
  placeFinder(cells, 'BL', 0, last - 1);
  placeFinder(cells, 'BR', last - 1, last - 1);

  for (let shapeId = 0; shapeId < profile.shapeCount; shapeId += 1) {
    const x = profile.shapeCalibrationStartX + shapeId;
    const y = profile.shapeCalibrationRow;
    cells[y][x] = { x, y, kind: 'shape-calibration-22', shapeId };
  }

  profile.profileSignatureBits.forEach((bit, index) => {
    const x = profile.profileSignatureStartX + index;
    const y = profile.profileSignatureRow;
    cells[y][x] = { x, y, kind: 'profile-signature', dark: bit === 1 };
  });

  for (let colorIndex = 0; colorIndex < profile.colorCount; colorIndex += 1) {
    const x = profile.colorCalibrationStartX + colorIndex;
    const y = profile.channelCalibrationRow;
    cells[y][x] = { x, y, kind: 'fg-color-calibration-8', colorIndex };
  }

  for (let backgroundIndex = 0; backgroundIndex < profile.backgroundCount; backgroundIndex += 1) {
    const x = profile.backgroundCalibrationStartX + backgroundIndex;
    const y = profile.channelCalibrationRow;
    cells[y][x] = { x, y, kind: 'background-calibration-4', backgroundIndex };
  }

  const coordinates = getDataCellCoordinates(profile);
  coordinates.slice(0, repeated.length).forEach(({ x, y }, index) => {
    const value = repeated[index];
    const parts = splitS8C8B4Byte(value);
    cells[y][x] = {
      x, y, kind: 's8c8b4-data', value, ...parts,
      logicalByteIndex: index % profile.dataByteCapacity,
      copyIndex: Math.floor(index / profile.dataByteCapacity),
    };
  });

  return {
    version: 22,
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

export function decodeS8C8B4Frame(frame, profile = V22_S8_C8_B4_R3) {
  if (!frame || frame.profileId !== profile.id) throw new Error(`Expected optical profile ${profile.id}`);
  const coordinates = getDataCellCoordinates(profile).slice(0, profile.encodedByteCapacity);
  const physical = coordinates.map(({ x, y }) => {
    const cell = frame.cells?.[y]?.[x];
    if (!cell || cell.kind !== 's8c8b4-data') throw new Error(`Missing V2.2 data cell at ${x},${y}`);
    return cell;
  });

  const envelope = new Uint8Array(profile.dataByteCapacity);
  for (let i = 0; i < envelope.length; i += 1) {
    const copies = Array.from({ length: profile.repetition }, (_, copy) => physical[i + (copy * envelope.length)]);
    envelope[i] = joinS8C8B4Byte(
      majority(copies.map((cell) => cell.shapeId)),
      majority(copies.map((cell) => cell.colorIndex)),
      majority(copies.map((cell) => cell.backgroundIndex)),
    );
  }

  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const packetLength = view.getUint16(0, false);
  if (packetLength < 1 || packetLength > profile.maxPacketBytes) throw new Error(`Decoded packet length ${packetLength} exceeds profile capacity`);
  return envelope.slice(profile.lengthPrefixBytes, profile.lengthPrefixBytes + packetLength);
}
