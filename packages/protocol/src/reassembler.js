import { crc32 } from '../../fec/src/crc32.js';
import { FRAME_TYPES } from './constants.js';
import { decodePacket, PacketError } from './packet.js';

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function concatChunks(chunks, totalLength) {
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

export class TransferReassembler {
  constructor() {
    this.reset();
  }

  reset() {
    this.sessionId = null;
    this.dataPackets = new Map();
    this.endInfo = null;
    this.completedData = null;
    this.duplicates = 0;
    this.acceptedPackets = 0;
    this.ignoredPackets = 0;
  }

  addPacket(encodedPacket) {
    if (this.completedData) {
      return this.status('already-complete');
    }

    const packet = decodePacket(encodedPacket);

    if (packet.frameType !== FRAME_TYPES.DATA && packet.frameType !== FRAME_TYPES.END) {
      this.ignoredPackets += 1;
      return this.status('ignored-frame-type');
    }

    if (this.sessionId === null) {
      this.sessionId = packet.sessionId;
    } else if (packet.sessionId !== this.sessionId) {
      throw new PacketError(
        'SESSION_MISMATCH',
        `Expected session ${this.sessionId}, received ${packet.sessionId}`,
      );
    }

    if (packet.frameType === FRAME_TYPES.DATA) {
      this.#addDataPacket(packet);
    } else {
      this.#addEndPacket(packet);
    }

    this.acceptedPackets += 1;
    this.#tryComplete();
    return this.status(this.completedData ? 'complete' : 'accepted');
  }

  #addDataPacket(packet) {
    const existing = this.dataPackets.get(packet.sequence);
    if (existing) {
      if (!bytesEqual(existing, packet.payload)) {
        throw new PacketError(
          'CONFLICTING_DUPLICATE',
          `Sequence ${packet.sequence} was received with different payload bytes`,
        );
      }
      this.duplicates += 1;
      return;
    }

    if (this.endInfo && packet.sequence >= this.endInfo.packetCount) {
      throw new PacketError(
        'SEQUENCE_OUT_OF_RANGE',
        `DATA sequence ${packet.sequence} is outside completed transfer range`,
      );
    }
    this.dataPackets.set(packet.sequence, packet.payload);
  }

  #addEndPacket(packet) {
    if (packet.payload.length !== 8) {
      throw new PacketError('BAD_END_PAYLOAD', 'END payload must be exactly 8 bytes');
    }

    const view = new DataView(
      packet.payload.buffer,
      packet.payload.byteOffset,
      packet.payload.byteLength,
    );
    const nextEndInfo = {
      packetCount: packet.sequence,
      totalBytes: view.getUint32(0, false),
      transferCrc32: view.getUint32(4, false),
    };

    if (this.endInfo) {
      const same = (
        this.endInfo.packetCount === nextEndInfo.packetCount
        && this.endInfo.totalBytes === nextEndInfo.totalBytes
        && this.endInfo.transferCrc32 === nextEndInfo.transferCrc32
      );
      if (!same) {
        throw new PacketError('CONFLICTING_END', 'Conflicting END packets received');
      }
      this.duplicates += 1;
      return;
    }

    for (const sequence of this.dataPackets.keys()) {
      if (sequence >= nextEndInfo.packetCount) {
        throw new PacketError(
          'SEQUENCE_OUT_OF_RANGE',
          `Already-received DATA sequence ${sequence} exceeds END packet count`,
        );
      }
    }

    this.endInfo = nextEndInfo;
  }

  #tryComplete() {
    if (!this.endInfo) return false;
    if (this.dataPackets.size !== this.endInfo.packetCount) return false;

    const chunks = [];
    let measuredLength = 0;
    for (let sequence = 0; sequence < this.endInfo.packetCount; sequence += 1) {
      const chunk = this.dataPackets.get(sequence);
      if (!chunk) return false;
      chunks.push(chunk);
      measuredLength += chunk.length;
    }

    if (measuredLength !== this.endInfo.totalBytes) {
      throw new PacketError(
        'TRANSFER_LENGTH_MISMATCH',
        `Expected ${this.endInfo.totalBytes} bytes, reconstructed ${measuredLength}`,
      );
    }

    const data = concatChunks(chunks, measuredLength);
    const actualCrc = crc32(data);
    if (actualCrc !== this.endInfo.transferCrc32) {
      throw new PacketError(
        'TRANSFER_CRC_MISMATCH',
        `Whole-transfer CRC mismatch: expected 0x${this.endInfo.transferCrc32.toString(16)}, got 0x${actualCrc.toString(16)}`,
      );
    }

    this.completedData = data;
    return true;
  }

  status(event = 'status') {
    const expectedPackets = this.endInfo?.packetCount ?? null;
    return {
      event,
      sessionId: this.sessionId,
      complete: this.completedData !== null,
      receivedDataPackets: this.dataPackets.size,
      expectedDataPackets: expectedPackets,
      missingDataPackets: expectedPackets === null
        ? null
        : Math.max(0, expectedPackets - this.dataPackets.size),
      duplicates: this.duplicates,
      acceptedPackets: this.acceptedPackets,
      ignoredPackets: this.ignoredPackets,
      totalBytes: this.endInfo?.totalBytes ?? null,
    };
  }

  getData() {
    return this.completedData ? this.completedData.slice() : null;
  }

  getText() {
    if (!this.completedData) return null;
    return new TextDecoder().decode(this.completedData);
  }
}
