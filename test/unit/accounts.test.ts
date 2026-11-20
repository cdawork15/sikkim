import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bearerToken,
  newToken,
  tokenHash,
  validTripStart,
} from '../../src/accounts/model.js';
import { loadConfig } from '../../src/config.js';
import { testEnvironment } from '../helpers.js';

test('bearer secrets are random, hashed and strictly parsed', () => {
  const secret = newToken();
  assert.match(secret, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(secret, newToken());
  assert.equal(bearerToken(`Bearer ${secret}`), secret);
  assert.equal(bearerToken(`bearer ${secret}`), secret);
  assert.match(tokenHash(secret), /^[a-f0-9]{64}$/);
  assert.equal(tokenHash(secret), tokenHash(secret));
  for (const value of [
    undefined,
    secret,
    `Basic ${secret}`,
    `Bearer ${secret} extra`,
    'Bearer short',
  ]) {
    assert.throws(() => bearerToken(value), /Sign in again/);
  }
});

test('trip dates are real calendar dates, using today in India', () => {
  const now = new Date('2026-11-06T20:00:00Z');
  assert.equal(validTripStart('2026-11-07', now), true);
  assert.equal(validTripStart('2026-11-06', now), false);
  assert.equal(validTripStart('2028-02-29', now), true);
  for (const date of [
    '2027-02-29',
    '2027-04-31',
    '2027-13-01',
    '2027-1-1',
    'invalid',
  ]) {
    assert.equal(validTripStart(date, now), false);
  }
});

test(
  'demo sign-in is opt-in and cannot use production, public ' +
    'binding, proxies or remote databases',
  () => {
    assert.equal(loadConfig(testEnvironment).demoAuth, false);
    const demo = { ...testEnvironment, ENABLE_DEMO_AUTH: 'true' };
    assert.equal(loadConfig(demo).demoAuth, true);
    for (const overrides of [
      { ENABLE_DEMO_AUTH: 'yes' },
      { HOST: '0.0.0.0' },
      { HOST: '::' },
      { TRUST_PROXY_CIDRS: '127.0.0.1' },
      { DATABASE_URL: 'postgres://a:b@remote.example/sikkim_test' },
      { DATABASE_URL: 'postgres://a:b@localhost/sikkim_dev' },
      {
        NODE_ENV: 'production',
        DB_TLS: 'true',
        PUBLIC_API_ORIGIN: 'https://api.example.com',
        FRONTEND_ORIGINS: 'https://example.com',
      },
    ]) {
      assert.throws(() => loadConfig({ ...demo, ...overrides }));
    }
  },
);
