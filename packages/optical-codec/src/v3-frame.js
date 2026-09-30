import { RS16_K, RS16_N, rs16Encode, rs16Decode } from '../../fec/src/rs16.js';
import { getV3DataCellCoordinates, V3_G64_S4_C4_RS } from './profiles.js';
import { splitV3Nibble, joinV3Nibble } from '../../constellation/src/v3.js';

const FINDER_PATTERNS = Object.freeze({
  TL: [[1, 1], [1, 0]],
  TR: [[1, 0], [1, 1]],
  BL: [[1, 1], [0, 1]],
  BR: [[0, 1], [1, 1]],
});

function emptyCells(profile) {
  return Array.from({ length: profile.gridSize }, (_, y) =>
    Array.from({ length: profile.gridSize }, (_, x) => ({ x, y, kind: 'v3-guard' })),
  );
}

function placeFinder(cells, finder) {
  const pattern = FINDER_PATTERNS[finder.corner];
  for (let dy = 0; dy < 2; dy += 1) {
    for (let dx = 0; dx < 2; dx += 1) {
      cells[finder.y + dy][finder.x + dx] = {
        x: finder.x + dx,
        y: finder.y + dy,
        kind: 'finder',
        corner: finder.corner,
        dark: pattern[dy][dx] === 1,
      };
    }
  }
}

function fillPadding(envelope, packetLength) {
  let state = (0xC3A5C85C ^ Math.imul(packetLength + 1, 0x9E3779B1)) >>> 0;
  for (let i = 0; i < envelope.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    envelope[i] = state & 0xFF;
  }
}

export function bytesToNibbles(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('bytesToNibbles expects Uint8Array');
  const nibbles = new Uint8Array(bytes.length * 2);
  for (let i = 0; i < bytes.length; i += 1) {
    nibbles[i * 2] = bytes[i] >>> 4;
    nibbles[(i * 2) + 1] = bytes[i] & 0x0F;
  }
  return nibbles;
}

export function nibblesToBytes(nibbles, byteCount = Math.floor(nibbles.length / 2)) {
  if (!(nibbles instanceof Uint8Array)) throw new TypeError('nibblesToBytes expects Uint8Array');
  if (!Number.isInteger(byteCount) || byteCount < 0 || byteCount * 2 > nibbles.length) throw new RangeError('Invalid V3 byte count');
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i += 1) bytes[i] = ((nibbles[i * 2] & 0x0F) << 4) | (nibbles[(i * 2) + 1] & 0x0F);
  return bytes;
}

export function rsInterleaveV3(dataNibbles, profile = V3_G64_S4_C4_RS) {
  if (!(dataNibbles instanceof Uint8Array) || dataNibbles.length !== profile.dataNibbleCapacity) {
    throw new TypeError(`V3 data nibble stream must contain ${profile.dataNibbleCapacity} symbols`);
  }
  const codewords = Array.from({ length: profile.rsCodewordCount }, (_, block) => {
    const start = block * RS16_K;
    return rs16Encode(dataNibbles.slice(start, start + RS16_K));
  });
  const interleaved = new Uint8Array(profile.encodedSymbolCapacity);
  let index = 0;
  for (let symbolPosition = 0; symbolPosition < RS16_N; symbolPosition += 1) {
    for (let block = 0; block < codewords.length; block += 1) interleaved[index++] = codewords[block][symbolPosition];
  }
  return interleaved;
}

export function deinterleaveV3(symbols, profile = V3_G64_S4_C4_RS) {
  if (!(symbols instanceof Uint8Array) || symbols.length !== profile.encodedSymbolCapacity) {
    throw new TypeError(`V3 encoded stream must contain ${profile.encodedSymbolCapacity} symbols`);
  }
  const codewords = Array.from({ length: profile.rsCodewordCount }, () => new Uint8Array(RS16_N));
  let index = 0;
  for (let symbolPosition = 0; symbolPosition < RS16_N; symbolPosition += 1) {
    for (let block = 0; block < codewords.length; block += 1) codewords[block][symbolPosition] = symbols[index++];
  }
  return codewords;
}

function deinterleaveConfidence(confidences, profile) {
  if (!confidences || confidences.length !== profile.encodedSymbolCapacity) return null;
  const codewords = Array.from({ length: profile.rsCodewordCount }, () => new Float32Array(RS16_N));
  let index = 0;
  for (let symbolPosition = 0; symbolPosition < RS16_N; symbolPosition += 1) {
    for (let block = 0; block < codewords.length; block += 1) codewords[block][symbolPosition] = confidences[index++];
  }
  return codewords;
}

function chooseErasures(confidenceWord) {
  if (!confidenceWord) return [];
  const ranked = Array.from(confidenceWord, (confidence, position) => ({ confidence, position }))
    .sort((a, b) => a.confidence - b.confidence);

  // Preserve room for one unknown RS error in ordinary frames: normally mark
  // no more than two suspicious cells. Only extremely weak cells (<0.18) are
  // allowed to consume all four parity symbols as explicit erasures.
  const erasures = ranked.filter((entry) => entry.confidence < 0.18).slice(0, 4).map((entry) => entry.position);
  if (erasures.length < 2) {
    for (const entry of ranked) {
      if (entry.confidence >= 0.34 || erasures.includes(entry.position)) continue;
      erasures.push(entry.position);
      if (erasures.length >= 2) break;
    }
  }
  return erasures;
}

export function recoverV3PacketFromSymbols(symbols, profile = V3_G64_S4_C4_RS, confidences = null) {
  const codewords = deinterleaveV3(symbols, profile);
  const confidenceWords = deinterleaveConfidence(confidences, profile);
  const recovered = [];
  let packetLength = null;
  let requiredNibbles = null;
  let correctedSymbols = 0;
  let erasuresUsed = 0;
  let blocksDecoded = 0;

  for (let blockIndex = 0; blockIndex < codewords.length; blockIndex += 1) {
    let decoded;
    const erasures = chooseErasures(confidenceWords?.[blockIndex]);
    try {
      decoded = rs16Decode(codewords[blockIndex], { erasures });
    } catch (error) {
      error.blockIndex = blockIndex;
      error.erasurePositions = erasures;
      throw error;
    }
    correctedSymbols += decoded.correctedSymbols;
    erasuresUsed += decoded.erasuresUsed ?? 0;
    blocksDecoded += 1;
    recovered.push(...decoded.data);

    if (packetLength === null && recovered.length >= 4) {
      const header = nibblesToBytes(Uint8Array.from(recovered.slice(0, 4)), 2);
      packetLength = new DataView(header.buffer).getUint16(0, false);
      if (packetLength < 1 || packetLength > profile.maxPacketBytes) throw new Error(`Invalid V3 packet length ${packetLength}`);
      requiredNibbles = (profile.lengthPrefixBytes + packetLength) * 2;
    }
    if (requiredNibbles !== null && recovered.length >= requiredNibbles) break;
  }

  if (packetLength === null || recovered.length < requiredNibbles) throw new Error('V3 packet was not fully recovered');
  const envelope = nibblesToBytes(Uint8Array.from(recovered), profile.lengthPrefixBytes + packetLength);
  return {
    packetBytes: envelope.slice(profile.lengthPrefixBytes),
    correctedSymbols,
    erasuresUsed,
    blocksDecoded,
    packetLength,
  };
}

export function encodeV3Frame(packetBytes, profile = V3_G64_S4_C4_RS) {
  if (!(packetBytes instanceof Uint8Array)) throw new TypeError('encodeV3Frame expects Uint8Array');
  if (packetBytes.length > profile.maxPacketBytes) throw new RangeError(`Packet is ${packetBytes.length} bytes; ${profile.id} allows ${profile.maxPacketBytes}`);

  const envelope = new Uint8Array(profile.dataByteCapacity);
  fillPadding(envelope, packetBytes.length);
  const view = new DataView(envelope.buffer);
  view.setUint16(0, packetBytes.length, false);
  envelope.set(packetBytes, profile.lengthPrefixBytes);

  const encodedSymbols = rsInterleaveV3(bytesToNibbles(envelope), profile);
  const cells = emptyCells(profile);
  const last = profile.gridSize - 1;

  for (let x = 0; x < profile.gridSize; x += 1) {
    cells[0][x] = { x, y: 0, kind: 'v3-timing', dark: (x & 1) === 0 };
    cells[last][x] = { x, y: last, kind: 'v3-timing', dark: (x & 1) === 0 };
  }
  for (let y = 1; y < last; y += 1) {
    cells[y][0] = { x: 0, y, kind: 'v3-timing', dark: (y & 1) === 0 };
    cells[y][last] = { x: last, y, kind: 'v3-timing', dark: (y & 1) === 0 };
  }
  for (const finder of profile.finderOrigins) placeFinder(cells, finder);

  for (let colorIndex = 0; colorIndex < profile.colorCount; colorIndex += 1) {
    const x = profile.colorCalibrationStartX + colorIndex;
    const y = profile.calibrationRow;
    cells[y][x] = { x, y, kind: 'v3-color-calibration', colorIndex };
  }
  for (let shapeId = 0; shapeId < profile.shapeCount; shapeId += 1) {
    const x = profile.shapeCalibrationStartX + shapeId;
    const y = profile.calibrationRow;
    cells[y][x] = { x, y, kind: 'v3-shape-calibration', shapeId };
  }
  profile.profileSignatureBits.forEach((bit, index) => {
    const x = profile.profileSignatureStartX + index;
    const y = profile.calibrationRow;
    cells[y][x] = { x, y, kind: 'profile-signature', dark: bit === 1 };
  });

  const coordinates = getV3DataCellCoordinates(profile);
  coordinates.forEach(({ x, y }, index) => {
    const value = encodedSymbols[index];
    const { shapeId, colorIndex } = splitV3Nibble(value);
    cells[y][x] = { x, y, kind: 'v3-data', value, shapeId, colorIndex, physicalSymbolIndex: index };
  });

  return {
    version: profile.version,
    modulation: profile.modulation,
    profileId: profile.id,
    totalSize: profile.totalSize,
    quietZone: profile.quietZone,
    fiducialScale: profile.fiducialScale,
    logicalSize: profile.logicalSize,
    cellSize: profile.cellSize,
    gridSize: profile.gridSize,
    packetLength: packetBytes.length,
    cells,
  };
}

export function decodeV3Frame(frame, profile = V3_G64_S4_C4_RS) {
  if (!frame || frame.profileId !== profile.id) throw new Error(`Expected ${profile.id}`);
  const coordinates = getV3DataCellCoordinates(profile);
  const symbols = new Uint8Array(profile.encodedSymbolCapacity);
  coordinates.forEach(({ x, y }, index) => {
    const cell = frame.cells?.[y]?.[x];
    if (!cell || cell.kind !== 'v3-data') throw new Error(`Missing V3 data cell at ${x},${y}`);
    symbols[index] = joinV3Nibble(cell.shapeId, cell.colorIndex);
  });
  return recoverV3PacketFromSymbols(symbols, profile);
}
