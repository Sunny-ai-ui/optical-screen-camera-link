import { crc32 } from '../../fec/src/crc32.js';
import {
  CRC_BYTES,
  HEADER_BYTES,
  MAGIC_0,
  MAGIC_1,
  MAX_PAYLOAD_BYTES,
  MIN_PACKET_BYTES,
  PROTOCOL_VERSION,
  VALID_FRAME_TYPES,
} from './constants.js';

export class PacketError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PacketError';
    this.code = code;
  }
}

function ensureUint8Array(value, fieldName) {
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${fieldName} must be Uint8Array`);
  }
}

function ensureUint16(value, fieldName) {
  if (!Number.isInteger(value) || value < 0 || value > 0xFFFF) {
    throw new RangeError(`${fieldName} must be an integer from 0 to 65535`);
  }
}

/**
 * Serialize one protocol packet.
 * CRC32 covers header + payload and is appended as the final 4 bytes.
 */
export function encodePacket({
  frameType,
  sessionId,
  sequence,
  payload = new Uint8Array(0),
}) {
  ensureUint8Array(payload, 'payload');
  ensureUint16(sessionId, 'sessionId');
  ensureUint16(sequence, 'sequence');

  if (!VALID_FRAME_TYPES.has(frameType)) {
    throw new RangeError(`Unsupported frame type: ${frameType}`);
  }
  if (payload.length > MAX_PAYLOAD_BYTES) {
    throw new RangeError(`Payload exceeds ${MAX_PAYLOAD_BYTES} bytes`);
  }

  const withoutCrc = new Uint8Array(HEADER_BYTES + payload.length);
  const view = new DataView(withoutCrc.buffer);

  withoutCrc[0] = MAGIC_0;
  withoutCrc[1] = MAGIC_1;
  withoutCrc[2] = PROTOCOL_VERSION;
  withoutCrc[3] = frameType;
  view.setUint16(4, sessionId, false);
  view.setUint16(6, sequence, false);
  view.setUint16(8, payload.length, false);
  withoutCrc.set(payload, HEADER_BYTES);

  const checksum = crc32(withoutCrc);
  const packet = new Uint8Array(withoutCrc.length + CRC_BYTES);
  packet.set(withoutCrc, 0);
  new DataView(packet.buffer).setUint32(withoutCrc.length, checksum, false);
  return packet;
}

/**
 * Parse and validate one packet. Throws PacketError on malformed/corrupt input.
 */
export function decodePacket(packet) {
  ensureUint8Array(packet, 'packet');

  if (packet.length < MIN_PACKET_BYTES) {
    throw new PacketError('TOO_SHORT', `Packet is only ${packet.length} bytes`);
  }
  if (packet[0] !== MAGIC_0 || packet[1] !== MAGIC_1) {
    throw new PacketError('BAD_MAGIC', 'Packet magic does not match OS');
  }
  if (packet[2] !== PROTOCOL_VERSION) {
    throw new PacketError('BAD_VERSION', `Unsupported protocol version ${packet[2]}`);
  }

  const frameType = packet[3];
  if (!VALID_FRAME_TYPES.has(frameType)) {
    throw new PacketError('BAD_FRAME_TYPE', `Unsupported frame type ${frameType}`);
  }

  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  const sessionId = view.getUint16(4, false);
  const sequence = view.getUint16(6, false);
  const payloadLength = view.getUint16(8, false);
  const expectedLength = HEADER_BYTES + payloadLength + CRC_BYTES;

  if (payloadLength > MAX_PAYLOAD_BYTES) {
    throw new PacketError('PAYLOAD_TOO_LARGE', `Payload length ${payloadLength} exceeds limit`);
  }
  if (packet.length !== expectedLength) {
    throw new PacketError(
      'BAD_LENGTH',
      `Packet length ${packet.length} does not match declared length ${expectedLength}`,
    );
  }

  const crcOffset = HEADER_BYTES + payloadLength;
  const expectedCrc = view.getUint32(crcOffset, false);
  const actualCrc = crc32(packet.subarray(0, crcOffset));

  if (actualCrc !== expectedCrc) {
    throw new PacketError(
      'CRC_MISMATCH',
      `CRC mismatch: expected 0x${expectedCrc.toString(16)}, got 0x${actualCrc.toString(16)}`,
    );
  }

  return {
    version: packet[2],
    frameType,
    sessionId,
    sequence,
    payload: packet.slice(HEADER_BYTES, crcOffset),
    crc32: expectedCrc,
  };
}

export function safeDecodePacket(packet) {
  try {
    return { ok: true, packet: decodePacket(packet), error: null };
  } catch (error) {
    return { ok: false, packet: null, error };
  }
}
