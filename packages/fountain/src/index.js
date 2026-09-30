import { crc32 } from '../../fec/src/crc32.js';
import { encodePacket, decodePacket, PacketError } from '../../protocol/src/packet.js';
import { FRAME_TYPES, MAX_PAYLOAD_BYTES } from '../../protocol/src/constants.js';
import { createSessionId, toBytes } from '../../protocol/src/chunker.js';

const FOUNTAIN_MAGIC_0 = 0x46; // F
const FOUNTAIN_MAGIC_1 = 0x54; // T
const FOUNTAIN_VERSION = 1;
export const FOUNTAIN_HEADER_BYTES = 20;

function ensureUint16(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) throw new RangeError(`${name} must be 0..65535`);
}

function ensureUint32(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFFFFFF) throw new RangeError(`${name} must be 0..4294967295`);
}

function xorshift32(value) {
  let x = value >>> 0;
  x ^= (x << 13) >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  return x >>> 0;
}

function seededValue(seed, round) {
  let value = (seed ^ Math.imul((round + 1) >>> 0, 0x9E3779B1)) >>> 0;
  value = xorshift32(value || 0xA5A5A5A5);
  return value >>> 0;
}

function chooseDegree(seed, sourceBlockCount, systematic = false) {
  if (systematic || sourceBlockCount <= 1) return 1;
  const r = (seededValue(seed, 0) & 0xFFFF) / 0x10000;
  let degree;
  if (r < 0.10) degree = 1;
  else if (r < 0.20) degree = 2;
  else degree = Math.min(Math.max(4, Math.ceil(sourceBlockCount / 2)), 32, sourceBlockCount);
  return Math.max(1, Math.min(degree, sourceBlockCount));
}

export function fountainIndices(seed, sourceBlockCount, options = {}) {
  ensureUint32(seed >>> 0, 'seed');
  ensureUint16(sourceBlockCount, 'sourceBlockCount');
  if (sourceBlockCount < 1) throw new RangeError('sourceBlockCount must be at least 1');
  if (options.systematicIndex !== undefined && options.systematicIndex !== null) {
    const index = options.systematicIndex;
    if (!Number.isInteger(index) || index < 0 || index >= sourceBlockCount) throw new RangeError('systematicIndex out of range');
    return [index];
  }
  const degree = options.degree ?? chooseDegree(seed, sourceBlockCount, false);
  const chosen = new Set();
  let round = 1;
  while (chosen.size < degree) {
    const value = seededValue(seed, round++);
    chosen.add(value % sourceBlockCount);
  }
  return [...chosen].sort((a, b) => a - b);
}

function xorInto(target, source) {
  for (let i = 0; i < target.length; i += 1) target[i] ^= source[i];
}

function splitSourceBlocks(data, blockSize) {
  const count = Math.max(1, Math.ceil(data.length / blockSize));
  const blocks = Array.from({ length: count }, () => new Uint8Array(blockSize));
  for (let i = 0; i < count; i += 1) {
    const start = i * blockSize;
    blocks[i].set(data.subarray(start, Math.min(start + blockSize, data.length)));
  }
  return blocks;
}

function buildDropletPayload({ sourceBlockCount, blockSize, totalBytes, transferCrc32, dropletId, seed, indices, block }) {
  const payload = new Uint8Array(FOUNTAIN_HEADER_BYTES + block.length);
  const view = new DataView(payload.buffer);
  payload[0] = FOUNTAIN_MAGIC_0;
  payload[1] = FOUNTAIN_MAGIC_1;
  payload[2] = FOUNTAIN_VERSION;
  payload[3] = indices.length;
  view.setUint16(4, sourceBlockCount, false);
  view.setUint16(6, blockSize, false);
  view.setUint32(8, totalBytes, false);
  view.setUint32(12, transferCrc32 >>> 0, false);
  view.setUint16(16, dropletId, false);
  view.setUint16(18, seed & 0xFFFF, false);
  payload.set(block, FOUNTAIN_HEADER_BYTES);
  return payload;
}

export function parseDropletPayload(payload) {
  if (!(payload instanceof Uint8Array)) throw new TypeError('payload must be Uint8Array');
  if (payload.length < FOUNTAIN_HEADER_BYTES) throw new PacketError('FOUNTAIN_TOO_SHORT', 'Fountain payload is too short');
  if (payload[0] !== FOUNTAIN_MAGIC_0 || payload[1] !== FOUNTAIN_MAGIC_1) throw new PacketError('FOUNTAIN_BAD_MAGIC', 'Fountain payload magic mismatch');
  if (payload[2] !== FOUNTAIN_VERSION) throw new PacketError('FOUNTAIN_BAD_VERSION', `Unsupported fountain version ${payload[2]}`);
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const degree = payload[3];
  const sourceBlockCount = view.getUint16(4, false);
  const blockSize = view.getUint16(6, false);
  const totalBytes = view.getUint32(8, false);
  const transferCrc32 = view.getUint32(12, false);
  const dropletId = view.getUint16(16, false);
  const seed16 = view.getUint16(18, false);
  if (sourceBlockCount < 1 || blockSize < 1 || degree < 1 || degree > sourceBlockCount) throw new PacketError('FOUNTAIN_BAD_HEADER', 'Invalid fountain metadata');
  if (payload.length !== FOUNTAIN_HEADER_BYTES + blockSize) throw new PacketError('FOUNTAIN_BAD_LENGTH', 'Fountain block length does not match metadata');
  const systematic = dropletId < sourceBlockCount;
  const seed = systematic ? dropletId >>> 0 : (((dropletId & 0xFFFF) << 16) | seed16) >>> 0;
  const indices = systematic ? [dropletId] : fountainIndices(seed, sourceBlockCount, { degree });
  return { degree, sourceBlockCount, blockSize, totalBytes, transferCrc32, dropletId, seed, indices, block: payload.slice(FOUNTAIN_HEADER_BYTES) };
}

export function createFountainTransfer(input, options = {}) {
  const data = toBytes(input);
  const sessionId = options.sessionId ?? createSessionId();
  const maxPacketPayload = options.packetPayloadBytes ?? MAX_PAYLOAD_BYTES;
  const overheadRatio = options.overheadRatio ?? 0.75;
  ensureUint16(sessionId, 'sessionId');
  if (!Number.isInteger(maxPacketPayload) || maxPacketPayload <= FOUNTAIN_HEADER_BYTES || maxPacketPayload > MAX_PAYLOAD_BYTES) {
    throw new RangeError(`packetPayloadBytes must be ${FOUNTAIN_HEADER_BYTES + 1}..${MAX_PAYLOAD_BYTES}`);
  }
  if (!Number.isFinite(overheadRatio) || overheadRatio < 0.1 || overheadRatio > 4) throw new RangeError('overheadRatio must be 0.1..4');

  const blockSize = options.blockSize ?? (maxPacketPayload - FOUNTAIN_HEADER_BYTES);
  if (!Number.isInteger(blockSize) || blockSize < 1 || blockSize > maxPacketPayload - FOUNTAIN_HEADER_BYTES) throw new RangeError('blockSize does not fit packet payload');
  const blocks = splitSourceBlocks(data, blockSize);
  if (blocks.length > 0xFFFF) throw new RangeError('Fountain transfer requires more than 65,535 source blocks');
  const transferCrc32 = crc32(data);
  const extraCount = Math.max(8, Math.ceil(blocks.length * overheadRatio));
  const dropletCount = blocks.length + extraCount;
  if (dropletCount > 0xFFFF) throw new RangeError('Fountain transfer requires more than 65,535 droplets');
  const packets = [];

  for (let dropletId = 0; dropletId < dropletCount; dropletId += 1) {
    let seed;
    let indices;
    if (dropletId < blocks.length) {
      seed = dropletId >>> 0;
      indices = [dropletId];
    } else {
      seed = (((dropletId & 0xFFFF) << 16) | ((Math.imul(dropletId + 1, 40503) ^ sessionId) & 0xFFFF)) >>> 0;
      indices = fountainIndices(seed, blocks.length);
    }
    const mixed = new Uint8Array(blockSize);
    for (const index of indices) xorInto(mixed, blocks[index]);
    const payload = buildDropletPayload({
      sourceBlockCount: blocks.length,
      blockSize,
      totalBytes: data.length,
      transferCrc32,
      dropletId,
      seed,
      indices,
      block: mixed,
    });
    packets.push(encodePacket({ frameType: FRAME_TYPES.FOUNTAIN, sessionId, sequence: dropletId, payload }));
  }

  return {
    mode: 'fountain',
    sessionId,
    sourceBlockCount: blocks.length,
    blockSize,
    totalBytes: data.length,
    transferCrc32,
    dropletCount,
    overheadRatio,
    packets,
  };
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

export class FountainReassembler {
  constructor() { this.reset(); }

  reset() {
    this.sessionId = null;
    this.meta = null;
    this.known = new Map();
    this.equations = [];
    this.seenDroplets = new Map();
    this.completedData = null;
    this.acceptedDroplets = 0;
    this.duplicates = 0;
    this.conflicts = 0;
  }

  addPacket(encodedPacket) {
    if (this.completedData) return this.status('already-complete');
    const packet = decodePacket(encodedPacket);
    if (packet.frameType !== FRAME_TYPES.FOUNTAIN) return this.status('ignored-frame-type');
    if (this.sessionId === null) this.sessionId = packet.sessionId;
    else if (packet.sessionId !== this.sessionId) throw new PacketError('SESSION_MISMATCH', `Expected session ${this.sessionId}, received ${packet.sessionId}`);

    const droplet = parseDropletPayload(packet.payload);
    const meta = {
      sourceBlockCount: droplet.sourceBlockCount,
      blockSize: droplet.blockSize,
      totalBytes: droplet.totalBytes,
      transferCrc32: droplet.transferCrc32,
    };
    if (!this.meta) this.meta = meta;
    else if (Object.keys(meta).some((key) => meta[key] !== this.meta[key])) throw new PacketError('FOUNTAIN_META_MISMATCH', 'Fountain droplet metadata conflicts with active transfer');

    const existing = this.seenDroplets.get(droplet.dropletId);
    if (existing) {
      if (!bytesEqual(existing, packet.payload)) {
        this.conflicts += 1;
        throw new PacketError('FOUNTAIN_CONFLICT', `Droplet ${droplet.dropletId} has conflicting content`);
      }
      this.duplicates += 1;
      return this.status('duplicate');
    }
    this.seenDroplets.set(droplet.dropletId, packet.payload.slice());
    this.acceptedDroplets += 1;
    this.#ingestEquation(new Set(droplet.indices), droplet.block.slice());
    this.#peel();
    this.#solveIfFullRank();
    this.#peel();
    this.#tryComplete();
    return this.status(this.completedData ? 'complete' : 'accepted');
  }

  #ingestEquation(indices, data) {
    for (const index of [...indices]) {
      const known = this.known.get(index);
      if (known) {
        xorInto(data, known);
        indices.delete(index);
      }
    }
    if (indices.size === 0) return;
    if (indices.size === 1) {
      const [index] = indices;
      this.#learn(index, data);
      return;
    }
    this.equations.push({ indices, data });
  }

  #learn(index, data) {
    const existing = this.known.get(index);
    if (existing) {
      if (!bytesEqual(existing, data)) throw new PacketError('FOUNTAIN_BLOCK_CONFLICT', `Source block ${index} conflicts with prior recovery`);
      return;
    }
    this.known.set(index, data.slice());
  }

  #peel() {
    let changed = true;
    while (changed) {
      changed = false;
      const next = [];
      for (const equation of this.equations) {
        const indices = new Set(equation.indices);
        const data = equation.data.slice();
        for (const index of [...indices]) {
          const known = this.known.get(index);
          if (known) {
            xorInto(data, known);
            indices.delete(index);
          }
        }
        if (indices.size === 0) continue;
        if (indices.size === 1) {
          const [index] = indices;
          const before = this.known.size;
          this.#learn(index, data);
          if (this.known.size > before) changed = true;
        } else {
          next.push({ indices, data });
        }
      }
      this.equations = next;
    }
  }

  #solveIfFullRank() {
    if (!this.meta || this.known.size >= this.meta.sourceBlockCount) return;
    const unknown = [];
    for (let i = 0; i < this.meta.sourceBlockCount; i += 1) if (!this.known.has(i)) unknown.push(i);
    if (!unknown.length || this.equations.length < unknown.length) return;

    const pivots = new Map();
    for (const equation of this.equations) {
      const indices = new Set(equation.indices);
      const data = equation.data.slice();
      const orderedPivots = [...pivots.keys()].sort((a, b) => a - b);
      for (const pivot of orderedPivots) {
        if (!indices.has(pivot)) continue;
        const row = pivots.get(pivot);
        xorInto(data, row.data);
        for (const index of row.indices) {
          if (indices.has(index)) indices.delete(index);
          else indices.add(index);
        }
      }
      if (!indices.size) continue;
      const pivot = Math.min(...indices);
      pivots.set(pivot, { indices, data });
      if (pivots.size >= unknown.length) break;
    }

    if (pivots.size < unknown.length || unknown.some((index) => !pivots.has(index))) return;
    const solved = new Map();
    for (const pivot of unknown.slice().sort((a, b) => b - a)) {
      const row = pivots.get(pivot);
      const value = row.data.slice();
      for (const index of row.indices) {
        if (index === pivot) continue;
        const known = this.known.get(index) ?? solved.get(index);
        if (!known) return;
        xorInto(value, known);
      }
      solved.set(pivot, value);
    }
    for (const [index, block] of solved) this.#learn(index, block);
  }

  #tryComplete() {
    if (!this.meta || this.known.size < this.meta.sourceBlockCount) return false;
    const padded = new Uint8Array(this.meta.sourceBlockCount * this.meta.blockSize);
    for (let index = 0; index < this.meta.sourceBlockCount; index += 1) {
      const block = this.known.get(index);
      if (!block) return false;
      padded.set(block, index * this.meta.blockSize);
    }
    const data = padded.slice(0, this.meta.totalBytes);
    const actual = crc32(data);
    if (actual !== this.meta.transferCrc32) throw new PacketError('FOUNTAIN_TRANSFER_CRC_MISMATCH', `Recovered data CRC mismatch: expected 0x${this.meta.transferCrc32.toString(16)}, got 0x${actual.toString(16)}`);
    this.completedData = data;
    return true;
  }

  status(event = 'status') {
    return {
      event,
      mode: 'fountain',
      sessionId: this.sessionId,
      complete: this.completedData !== null,
      acceptedDroplets: this.acceptedDroplets,
      uniqueDroplets: this.seenDroplets.size,
      duplicates: this.duplicates,
      recoveredSourceBlocks: this.known.size,
      sourceBlockCount: this.meta?.sourceBlockCount ?? null,
      pendingEquations: this.equations.length,
      totalBytes: this.meta?.totalBytes ?? null,
      progress: this.meta ? this.known.size / this.meta.sourceBlockCount : 0,
    };
  }

  getData() { return this.completedData ? this.completedData.slice() : null; }
  getText() { return this.completedData ? new TextDecoder().decode(this.completedData) : null; }
}
