import test from 'node:test';
import assert from 'node:assert/strict';
import { decodePayload, encodePayload, isPayloadEnvelope } from './index.js';

test('payload envelope round-trips unicode text and verifies SHA-256', async () => {
  const text = 'Training will start at 11 am — ਸਤ ਸ੍ਰੀ ਅਕਾਲ';
  const encoded = await encodePayload(text, { envelope: 'force' });
  assert.equal(isPayloadEnvelope(encoded.bytes), true);
  const decoded = await decodePayload(encoded.bytes);
  assert.equal(decoded.text, text);
  assert.equal(decoded.verified, true);
  assert.equal(decoded.sha256.length, 64);
});

test('short text stays direct when envelope overhead would make transfer larger', async () => {
  const encoded = await encodePayload('abc123');
  assert.equal(encoded.codec, 'raw-direct');
  assert.equal(encoded.enveloped, false);
  const decoded = await decodePayload(encoded.bytes);
  assert.equal(decoded.legacy, true);
  assert.equal(decoded.text, 'abc123');
});

test('repetitive text uses gzip when it reduces body size', async () => {
  const text = 'CP PLUS optical link training data. '.repeat(120);
  const encoded = await encodePayload(text);
  if (typeof CompressionStream === 'function') {
    assert.equal(encoded.codec, 'gzip');
    assert.ok(encoded.encodedBodyBytes < encoded.originalBytes);
  }
  const decoded = await decodePayload(encoded.bytes);
  assert.equal(decoded.text, text);
});

test('tampered envelope fails end-to-end verification', async () => {
  const encoded = await encodePayload('integrity check payload', { compression: 'off', envelope: 'force' });
  const tampered = encoded.bytes.slice();
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(() => decodePayload(tampered), /SHA-256 payload verification failed/);
});

test('legacy raw bytes remain readable for backward compatibility', async () => {
  const bytes = new TextEncoder().encode('legacy transfer');
  const decoded = await decodePayload(bytes);
  assert.equal(decoded.legacy, true);
  assert.equal(decoded.text, 'legacy transfer');
  assert.equal(decoded.verified, null);
});
