const TABLE = new Uint32Array(256);

for (let i = 0; i < 256; i += 1) {
  let c = i;
  for (let bit = 0; bit < 8; bit += 1) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  TABLE[i] = c >>> 0;
}

/**
 * IEEE CRC-32 (polynomial 0xEDB88320).
 * @param {Uint8Array} bytes
 * @returns {number} unsigned 32-bit CRC
 */
export function crc32(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new TypeError('crc32 expects Uint8Array');
  }

  let crc = 0xFFFFFFFF;
  for (const byte of bytes) {
    crc = TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
