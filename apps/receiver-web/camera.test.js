import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCameraAttempts,
  describeCameraError,
  openCameraWithFallback,
} from './camera.js';

test('camera attempts include selected, environment and generic fallback', () => {
  const attempts = buildCameraAttempts('device-1');
  assert.equal(attempts.length, 3);
  assert.equal(attempts[0].label, 'selected camera');
  assert.equal(attempts[1].label, 'rear/environment camera');
  assert.equal(attempts[2].label, 'any available camera');
});

test('camera fallback retries constraint failure and succeeds generically', async () => {
  const calls = [];
  const fakeStream = { id: 'ok' };
  const mediaDevices = {
    async getUserMedia(constraints) {
      calls.push(constraints);
      if (calls.length === 1) {
        const error = new Error('unsupported constraint');
        error.name = 'OverconstrainedError';
        throw error;
      }
      return fakeStream;
    },
  };

  const result = await openCameraWithFallback(mediaDevices);
  assert.equal(result.stream, fakeStream);
  assert.equal(result.attempt, 'any available camera');
  assert.equal(calls.length, 2);
});

test('permission denial stops fallback and returns actionable error', async () => {
  let calls = 0;
  const mediaDevices = {
    async getUserMedia() {
      calls += 1;
      const error = new Error('Permission denied');
      error.name = 'NotAllowedError';
      throw error;
    },
  };

  await assert.rejects(() => openCameraWithFallback(mediaDevices), { name: 'NotAllowedError' });
  assert.equal(calls, 1);

  const info = describeCameraError({ name: 'NotAllowedError', message: 'Permission denied' });
  assert.equal(info.code, 'permission-denied');
  assert.match(info.detail, /Allow camera access/i);
});
