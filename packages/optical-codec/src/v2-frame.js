import { getDataCellCoordinates, V2_S8_C32_R3 } from './profiles.js';
import { joinS8C32Byte, splitS8C32Byte } from './shapes.js';

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

function repeatBytesInterleaved(bytes, repetition) {
  const encoded = new Uint8Array(bytes.length * repetition);
  for (let copy = 0; copy < repetition; copy += 1) {
    encoded.set(bytes, copy * bytes.length);
  }
  return encoded;
}

/**
 * Fill bytes that are outside the declared packet with deterministic mixed
 * optical values instead of 0x00. The receiver ignores these bytes after it
 * reads the 2-byte packet length, but distributing shapes/colours prevents a
 * short packet from painting most of the frame with one locator-like symbol.
 */
export function fillV2Padding(envelope, usedBytes, packetBytes = new Uint8Array(0)) {
  let state = 0xA7 ^ (usedBytes & 0xFF);
  for (const value of packetBytes) {
    state = ((state * 33) ^ value ^ 0x5D) & 0xFF;
  }

  for (let i = usedBytes; i < envelope.length; i += 1) {
    state = ((state * 73) + 41 + (i * 17)) & 0xFF;
    // Keep the filler distributed even if the PRNG happens to hit zero.
    envelope[i] = state === 0 ? (0x5A ^ i) & 0xFF : state;
  }
  return envelope;
}

export function encodeS8C32Frame(packetBytes, profile = V2_S8_C32_R3) {
  if (!(packetBytes instanceof Uint8Array)) {
    throw new TypeError('encodeS8C32Frame expects packet bytes as Uint8Array');
  }
  if (packetBytes.length > profile.maxPacketBytes) {
    throw new RangeError(
      `Packet is ${packetBytes.length} bytes; ${profile.id} allows at most ${profile.maxPacketBytes}`,
    );
  }

  const envelope = new Uint8Array(profile.dataByteCapacity);
  const view = new DataView(envelope.buffer);
  view.setUint16(0, packetBytes.length, false);
  envelope.set(packetBytes, profile.lengthPrefixBytes);
  const usedBytes = profile.lengthPrefixBytes + packetBytes.length;
  fillV2Padding(envelope, usedBytes, packetBytes);

  const repeated = repeatBytesInterleaved(envelope, profile.repetition);
  if (repeated.length !== profile.encodedByteCapacity) {
    throw new Error('Internal V2 encoded byte capacity mismatch');
  }

  const cells = emptyCells(profile);
  const last = profile.gridSize - 1;
  placeFinder(cells, 'TL', 0, 0);
  placeFinder(cells, 'TR', last - 1, 0);
  placeFinder(cells, 'BL', 0, last - 1);
  placeFinder(cells, 'BR', last - 1, last - 1);

  // Eight live shape templates captured through the same display/camera path.
  for (let shapeId = 0; shapeId < profile.shapeCount; shapeId += 1) {
    const x = profile.shapeCalibrationStartX + shapeId;
    const y = profile.shapeCalibrationRow;
    cells[y][x] = {
      x,
      y,
      kind: 'shape-calibration',
      shapeId,
    };
  }

  // V2 profile signature: V1 leaves these cells neutral grey, while V2 emits
  // a strong black/white pattern that is easy to recognize after rectification.
  profile.profileSignatureBits.forEach((bit, index) => {
    const x = profile.profileSignatureStartX + index;
    const y = profile.profileSignatureRow;
    cells[y][x] = {
      x,
      y,
      kind: 'profile-signature',
      dark: bit === 1,
    };
  });

  // Two full rows provide one measured camera reference for every C32 colour.
  for (let colorIndex = 0; colorIndex < profile.colorCount; colorIndex += 1) {
    const rowOffset = Math.floor(colorIndex / profile.gridSize);
    const x = colorIndex % profile.gridSize;
    const y = profile.colorCalibrationRows[rowOffset];
    cells[y][x] = {
      x,
      y,
      kind: 'color-calibration',
      colorIndex,
    };
  }

  const dataCoordinates = getDataCellCoordinates(profile);
  dataCoordinates.slice(0, repeated.length).forEach(({ x, y }, index) => {
    const value = repeated[index];
    const { shapeId, colorIndex } = splitS8C32Byte(value);
    cells[y][x] = {
      x,
      y,
      kind: 's8c32-data',
      value,
      shapeId,
      colorIndex,
      logicalByteIndex: index % profile.dataByteCapacity,
      copyIndex: Math.floor(index / profile.dataByteCapacity),
    };
  });

  return {
    version: 2,
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

export function decodeS8C32Frame(frame, profile = V2_S8_C32_R3) {
  if (!frame || frame.profileId !== profile.id) {
    throw new Error(`Expected optical profile ${profile.id}`);
  }

  const coordinates = getDataCellCoordinates(profile).slice(0, profile.encodedByteCapacity);
  const physical = coordinates.map(({ x, y }) => {
    const cell = frame.cells?.[y]?.[x];
    if (!cell || cell.kind !== 's8c32-data') {
      throw new Error(`Missing V2 data cell at ${x},${y}`);
    }
    return cell;
  });

  const envelope = new Uint8Array(profile.dataByteCapacity);
  for (let i = 0; i < envelope.length; i += 1) {
    const copies = Array.from({ length: profile.repetition }, (_, copy) =>
      physical[i + (copy * envelope.length)],
    );
    const shapeId = majority(copies.map((cell) => cell.shapeId));
    const colorIndex = majority(copies.map((cell) => cell.colorIndex));
    envelope[i] = joinS8C32Byte(shapeId, colorIndex);
  }

  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const packetLength = view.getUint16(0, false);
  if (packetLength < 1 || packetLength > profile.maxPacketBytes) {
    throw new Error(`Decoded packet length ${packetLength} exceeds profile capacity`);
  }

  return envelope.slice(profile.lengthPrefixBytes, profile.lengthPrefixBytes + packetLength);
}
