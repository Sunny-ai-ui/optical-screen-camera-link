export const MAGIC_0 = 0x4F; // O
export const MAGIC_1 = 0x53; // S
export const PROTOCOL_VERSION = 1;

export const HEADER_BYTES = 10;
export const CRC_BYTES = 4;
export const MIN_PACKET_BYTES = HEADER_BYTES + CRC_BYTES;
export const MAX_PAYLOAD_BYTES = 4096;

// Conservative V0/V1 default. Optical frame capacity can change independently.
export const DEFAULT_CHUNK_BYTES = 64;

export const FRAME_TYPES = Object.freeze({
  SYNC: 1,
  DATA: 2,
  END: 3,
  TEST: 4,
  FOUNTAIN: 5,
});

export const FRAME_TYPE_NAMES = Object.freeze({
  [FRAME_TYPES.SYNC]: 'SYNC',
  [FRAME_TYPES.DATA]: 'DATA',
  [FRAME_TYPES.END]: 'END',
  [FRAME_TYPES.TEST]: 'TEST',
  [FRAME_TYPES.FOUNTAIN]: 'FOUNTAIN',
});

export const VALID_FRAME_TYPES = new Set(Object.values(FRAME_TYPES));
