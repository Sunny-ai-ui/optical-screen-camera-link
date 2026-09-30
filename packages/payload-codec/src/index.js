const MAGIC = Object.freeze([0x4f, 0x50, 0x4c, 0x44]); // OPLD
const VERSION = 1;
const CODEC_RAW = 0;
const CODEC_GZIP = 1;
export const PAYLOAD_HEADER_BYTES = 46;

function toBytes(input) {
  if (input instanceof Uint8Array) return input.slice();
  if (typeof input === 'string') return new TextEncoder().encode(input);
  throw new TypeError('Payload must be a string or Uint8Array');
}

function bytesEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

function hex(bytes) {
  return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable in this browser');
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
}

async function transformStream(bytes, kind) {
  const StreamCtor = kind === 'compress' ? globalThis.CompressionStream : globalThis.DecompressionStream;
  if (typeof StreamCtor !== 'function') throw new Error(`${kind === 'compress' ? 'Compression' : 'Decompression'}Stream is unavailable`);
  const stream = new Blob([bytes]).stream().pipeThrough(new StreamCtor('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function tryGzip(bytes) {
  if (typeof globalThis.CompressionStream !== 'function') return null;
  try {
    return await transformStream(bytes, 'compress');
  } catch {
    return null;
  }
}

export function isPayloadEnvelope(bytes) {
  return bytes instanceof Uint8Array
    && bytes.length >= PAYLOAD_HEADER_BYTES
    && MAGIC.every((value, index) => bytes[index] === value);
}

export async function encodePayload(input, { compression = 'auto' } = {}) {
  const raw = toBytes(input);
  const digest = await sha256(raw);
  let codec = CODEC_RAW;
  let body = raw;

  if (compression !== 'off' && raw.length > 0) {
    const compressed = await tryGzip(raw);
    if (compressed && compressed.length < raw.length) {
      codec = CODEC_GZIP;
      body = compressed;
    }
  }

  const envelope = new Uint8Array(PAYLOAD_HEADER_BYTES + body.length);
  envelope.set(MAGIC, 0);
  envelope[4] = VERSION;
  envelope[5] = codec;
  const view = new DataView(envelope.buffer);
  view.setUint32(6, raw.length, false);
  view.setUint32(10, body.length, false);
  envelope.set(digest, 14);
  envelope.set(body, PAYLOAD_HEADER_BYTES);

  return {
    bytes: envelope,
    codec: codec === CODEC_GZIP ? 'gzip' : 'raw',
    originalBytes: raw.length,
    encodedBodyBytes: body.length,
    envelopeBytes: envelope.length,
    savedBytes: raw.length - body.length,
    compressionRatio: raw.length ? body.length / raw.length : 1,
    sha256: hex(digest),
  };
}

export async function decodePayload(input, { allowLegacy = true } = {}) {
  const bytes = toBytes(input);
  if (!isPayloadEnvelope(bytes)) {
    if (!allowLegacy) throw new Error('Payload envelope magic mismatch');
    return {
      bytes,
      text: new TextDecoder().decode(bytes),
      codec: 'legacy-raw',
      legacy: true,
      verified: null,
      originalBytes: bytes.length,
      envelopeBytes: bytes.length,
      sha256: null,
    };
  }

  if (bytes[4] !== VERSION) throw new Error(`Unsupported payload envelope version ${bytes[4]}`);
  const codec = bytes[5];
  if (codec !== CODEC_RAW && codec !== CODEC_GZIP) throw new Error(`Unsupported payload codec ${codec}`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const originalLength = view.getUint32(6, false);
  const bodyLength = view.getUint32(10, false);
  if (PAYLOAD_HEADER_BYTES + bodyLength !== bytes.length) throw new Error('Payload envelope length mismatch');

  const expectedDigest = bytes.slice(14, 46);
  const body = bytes.slice(PAYLOAD_HEADER_BYTES);
  let raw;
  if (codec === CODEC_GZIP) {
    raw = await transformStream(body, 'decompress');
  } else {
    raw = body;
  }
  if (raw.length !== originalLength) throw new Error(`Payload length mismatch: expected ${originalLength}, got ${raw.length}`);

  const actualDigest = await sha256(raw);
  if (!bytesEqual(expectedDigest, actualDigest)) throw new Error('SHA-256 payload verification failed');

  return {
    bytes: raw,
    text: new TextDecoder().decode(raw),
    codec: codec === CODEC_GZIP ? 'gzip' : 'raw',
    legacy: false,
    verified: true,
    originalBytes: originalLength,
    encodedBodyBytes: bodyLength,
    envelopeBytes: bytes.length,
    sha256: hex(actualDigest),
  };
}

export const PAYLOAD_CODECS = Object.freeze({ RAW: CODEC_RAW, GZIP: CODEC_GZIP });
