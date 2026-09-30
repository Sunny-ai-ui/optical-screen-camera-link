import { crc32 } from '../../fec/src/crc32.js';
import {
  DEFAULT_CHUNK_BYTES,
  FRAME_TYPES,
  MAX_PAYLOAD_BYTES,
} from './constants.js';
import { encodePacket } from './packet.js';

export function createSessionId() {
  if (globalThis.crypto?.getRandomValues) {
    const value = new Uint16Array(1);
    globalThis.crypto.getRandomValues(value);
    return value[0];
  }
  return Math.floor(Math.random() * 0x10000);
}

export function toBytes(input) {
  if (input instanceof Uint8Array) return input.slice();
  if (typeof input === 'string') return new TextEncoder().encode(input);
  throw new TypeError('Transfer input must be a string or Uint8Array');
}

function createEndPayload(data) {
  if (data.length > 0xFFFFFFFF) {
    throw new RangeError('V1 transfer length cannot exceed 4,294,967,295 bytes');
  }
  const payload = new Uint8Array(8);
  const view = new DataView(payload.buffer);
  view.setUint32(0, data.length, false);
  view.setUint32(4, crc32(data), false);
  return payload;
}

/**
 * Convert arbitrary bytes into ordered DATA packets followed by one END packet.
 * END.sequence equals the number of DATA packets.
 */
export function createTransferPackets(input, options = {}) {
  const data = toBytes(input);
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK_BYTES;
  const sessionId = options.sessionId ?? createSessionId();

  if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > MAX_PAYLOAD_BYTES) {
    throw new RangeError(`chunkSize must be 1..${MAX_PAYLOAD_BYTES}`);
  }
  if (!Number.isInteger(sessionId) || sessionId < 0 || sessionId > 0xFFFF) {
    throw new RangeError('sessionId must be 0..65535');
  }

  const dataPacketCount = Math.ceil(data.length / chunkSize);
  if (dataPacketCount > 0xFFFF) {
    throw new RangeError('Transfer requires more than 65,535 DATA packets');
  }

  const packets = [];
  for (let sequence = 0; sequence < dataPacketCount; sequence += 1) {
    const start = sequence * chunkSize;
    const payload = data.slice(start, Math.min(start + chunkSize, data.length));
    packets.push(encodePacket({
      frameType: FRAME_TYPES.DATA,
      sessionId,
      sequence,
      payload,
    }));
  }

  packets.push(encodePacket({
    frameType: FRAME_TYPES.END,
    sessionId,
    sequence: dataPacketCount,
    payload: createEndPayload(data),
  }));

  return {
    sessionId,
    chunkSize,
    dataPacketCount,
    totalBytes: data.length,
    transferCrc32: crc32(data),
    packets,
  };
}
