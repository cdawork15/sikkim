import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../../src/config.js';
import { testEnvironment } from '../helpers.js';
import {
  signature,
  verifySignature,
  validateCaptions,
  validateUrl,
} from '../../src/media/model.js';
import { byteRange } from '../../src/media/routes.js';

test('signed media links bind operation, asset, revision, expiry and variant', () => {
  const id = randomUUID();
  const key = 'local-test-signing-key-at-least-32-characters';
  const expires = Math.floor(Date.now() / 1000) + 60;
  const signed = signature(key, 'download', id, 2, expires, 'video');
  assert.doesNotThrow(() =>
    verifySignature(key, 'download', id, 2, String(expires), signed, 'video'),
  );
  for (const [operation, asset, revision, expiry, variant] of [
    ['preview', id, 2, expires, 'video'],
    ['download', randomUUID(), 2, expires, 'video'],
    ['download', id, 3, expires, 'video'],
    ['download', id, 2, expires - 120, 'video'],
    ['download', id, 2, expires, 'poster'],
  ] as const) {
    assert.throws(() =>
      verifySignature(
        key,
        operation,
        asset,
        revision,
        String(expiry),
        signed,
        variant,
      ),
    );
  }
});

test('captions and credits reject markup, invalid timings and credential URLs', () => {
  const valid =
    'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nMountain landscape.\n';
  assert.equal(validateCaptions(valid), valid);
  for (const value of [
    '',
    valid.replace('Mountain', '<img>'),
    valid.replace('00:00:01.000', '00:01:01.000'),
    valid.replace('00:00:00.000', '00:00:02.000'),
  ]) {
    assert.throws(() => validateCaptions(value));
  }
  for (const value of [
    'invalid',
    'http://example.com',
    'https://user:secret@example.com',
  ]) {
    assert.throws(() => validateUrl(value), { code: 'INVALID_MEDIA' });
  }
  assert.equal(
    validateUrl('https://example.com/source'),
    'https://example.com/source',
  );
});

test('byte ranges are bounded and malformed/multiple ranges are rejected', () => {
  assert.deepEqual(byteRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(byteRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(byteRange('bytes=90-999', 100), { start: 90, end: 99 });
  for (const range of [
    'bytes=200-',
    'bytes=-0',
    'bytes=4-1',
    'bytes=0-1,4-5',
    'bytes=-',
  ]) {
    assert.throws(() => byteRange(range, 100));
  }
});

test('local media storage is opt-in and cannot be exposed in production', () => {
  assert.equal(loadConfig(testEnvironment).media, null);
  const env = {
    ...testEnvironment,
    MEDIA_STORAGE_DIR: '/private/tmp/sikkim-test-media',
    MEDIA_SIGNING_KEY: 'x'.repeat(32),
  };
  assert.ok(loadConfig(env).media);
  for (const patch of [
    { MEDIA_SIGNING_KEY: 'short' },
    { MEDIA_STORAGE_DIR: '/' },
    { MEDIA_STORAGE_DIR: 'public/media' },
    { HOST: '0.0.0.0' },
    { TRUST_PROXY_CIDRS: '127.0.0.1' },
    {
      NODE_ENV: 'production',
      DB_TLS: 'true',
      PUBLIC_API_ORIGIN: 'https://api.example.com',
      FRONTEND_ORIGINS: 'https://example.com',
    },
  ]) {
    assert.throws(() => loadConfig({ ...env, ...patch }));
  }
});

test('single-server media requires explicit production configuration and a loopback proxy', () => {
  const env = {
    ...testEnvironment,
    NODE_ENV: 'production',
    DB_TLS: 'true',
    PUBLIC_API_ORIGIN: 'https://demo.example.com',
    FRONTEND_ORIGINS: 'https://demo.example.com',
    HOST: '127.0.0.1',
    TRUST_PROXY_CIDRS: '127.0.0.1/32',
    MEDIA_STORAGE_MODE: 'single_server',
    MEDIA_STORAGE_DIR: '/var/lib/sikkim/media',
    MEDIA_SIGNING_KEY: 'x'.repeat(48),
  };
  assert.ok(loadConfig(env).media);
  for (const patch of [
    { NODE_ENV: 'development' },
    { DB_TLS: 'false' },
    { HOST: '0.0.0.0' },
    { TRUST_PROXY_CIDRS: '' },
    { TRUST_PROXY_CIDRS: '10.0.0.0/8' },
    { MEDIA_STORAGE_DIR: '/' },
    { MEDIA_SIGNING_KEY: 'short' },
    { MEDIA_STORAGE_MODE: 'unknown' },
  ]) {
    assert.throws(() => loadConfig({ ...env, ...patch }));
  }
});

test('the shared-network request allowance stays bounded', () => {
  assert.equal(loadConfig(testEnvironment).requestsPerMinute, 100);
  assert.equal(
    loadConfig({ ...testEnvironment, REQUESTS_PER_MINUTE: '600' })
      .requestsPerMinute,
    600,
  );
  for (const value of ['0', '-1', '10001', 'NaN', '1.5']) {
    assert.throws(() =>
      loadConfig({ ...testEnvironment, REQUESTS_PER_MINUTE: value }),
    );
  }
});
