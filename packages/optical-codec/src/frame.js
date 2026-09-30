import { getDataCellCoordinates, V1_G16_C16 } from './profiles.js';
import { bytesToC16Symbols, c16SymbolsToBytes } from './symbol-codec.js';

const FINDER_PATTERNS = Object.freeze({
  TL: [[1, 1], [1, 0]],
  TR: [[1, 0], [1, 1]],
  BL: [[1, 1], [0, 1]],
  BR: [[0, 1], [1, 1]],
});

function emptyCells(profile) {
  return Array.from({ length: profile.gridSize }, (_, y) =>
    Array.from({ length: profile.gridSize }, (_, x) => ({
      x,
      y,
      kind: 'guard',
    })),
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

function interleaveRepeatedSymbols(symbols, repetition) {
  const encoded = new Uint8Array(symbols.length * repetition);
  for (let copy = 0; copy < repetition; copy += 1) {
    encoded.set(symbols, copy * symbols.length);
  }
  return encoded;
}

export function encodeOpticalFrame(packetBytes, profile = V1_G16_C16) {
  if (!(packetBytes instanceof Uint8Array)) {
    throw new TypeError('encodeOpticalFrame expects packet bytes as Uint8Array');
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

  const logicalSymbols = bytesToC16Symbols(envelope);
  if (logicalSymbols.length !== profile.dataSymbolCapacity) {
    throw new Error('Internal profile logical capacity mismatch');
  }

  const repetition = profile.repetition ?? 1;
  const encodedSymbols = interleaveRepeatedSymbols(logicalSymbols, repetition);
  if (encodedSymbols.length !== profile.encodedSymbolCapacity) {
    throw new Error('Internal profile encoded capacity mismatch');
  }

  const cells = emptyCells(profile);
  const last = profile.gridSize - 1;
  placeFinder(cells, 'TL', 0, 0);
  placeFinder(cells, 'TR', last - 1, 0);
  placeFinder(cells, 'BL', 0, last - 1);
  placeFinder(cells, 'BR', last - 1, last - 1);

  // One known sample of every C16 symbol is emitted in every frame.
  for (let x = 0; x < profile.gridSize; x += 1) {
    cells[profile.calibrationRow][x] = {
      x,
      y: profile.calibrationRow,
      kind: 'calibration',
      symbol: x,
    };
  }

  // Copy 0 occupies the first logical-capacity cells, copy 1 the next set,
  // copy 2 the final set. A local blur/moire error therefore usually damages
  // only one copy of a logical symbol rather than all three.
  const dataCoordinates = getDataCellCoordinates(profile);
  dataCoordinates.slice(0, encodedSymbols.length).forEach(({ x, y }, index) => {
    cells[y][x] = {
      x,
      y,
      kind: 'data',
      symbol: encodedSymbols[index],
      encodedSymbolIndex: index,
      logicalSymbolIndex: index % profile.dataSymbolCapacity,
      copyIndex: Math.floor(index / profile.dataSymbolCapacity),
    };
  });

  return {
    version: 1,
    profileId: profile.id,
    logicalSize: profile.logicalSize,
    cellSize: profile.cellSize,
    gridSize: profile.gridSize,
    packetLength: packetBytes.length,
    cells,
  };
}

/**
 * Ideal decoder used by codec tests. For ideal frames all copies are exact;
 * majority logic is exercised in the camera decoder.
 */
export function decodeOpticalFrame(frame, profile = V1_G16_C16) {
  if (!frame || frame.profileId !== profile.id) {
    throw new Error(`Expected optical profile ${profile.id}`);
  }

  const dataCoordinates = getDataCellCoordinates(profile)
    .slice(0, profile.encodedSymbolCapacity);
  const encoded = new Uint8Array(profile.encodedSymbolCapacity);

  dataCoordinates.forEach(({ x, y }, index) => {
    const cell = frame.cells?.[y]?.[x];
    if (!cell || cell.kind !== 'data' || !Number.isInteger(cell.symbol)) {
      throw new Error(`Missing classified data symbol at cell ${x},${y}`);
    }
    encoded[index] = cell.symbol;
  });

  const logical = new Uint8Array(profile.dataSymbolCapacity);
  for (let i = 0; i < logical.length; i += 1) {
    const counts = new Map();
    for (let copy = 0; copy < profile.repetition; copy += 1) {
      const value = encoded[i + (copy * logical.length)];
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    let bestValue = 0;
    let bestCount = -1;
    for (const [value, count] of counts) {
      if (count > bestCount) {
        bestValue = value;
        bestCount = count;
      }
    }
    logical[i] = bestValue;
  }

  const envelope = c16SymbolsToBytes(logical);
  const view = new DataView(envelope.buffer, envelope.byteOffset, envelope.byteLength);
  const packetLength = view.getUint16(0, false);
  if (packetLength > profile.maxPacketBytes) {
    throw new Error(`Decoded packet length ${packetLength} exceeds profile capacity`);
  }

  return envelope.slice(profile.lengthPrefixBytes, profile.lengthPrefixBytes + packetLength);
}
