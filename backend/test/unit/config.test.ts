import assert from 'node:assert/strict';
import test from 'node:test';
import {
  databaseUrl,
  loadConfig,
  localDatabaseTarget,
} from '../../src/config.js';
import { migrate, seedOrReset } from '../../src/db/maintenance.js';
import { testEnvironment } from '../helpers.js';

test('configuration has bounded defaults and does not trust forwarded headers', () => {
  const config = loadConfig(testEnvironment);
  assert.equal(config.port, 3000);
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.databaseTls, false);
  assert.deepEqual(config.trustProxy, []);
  assert.equal(config.hostVerification, 'disabled');
});

test('sign-in codes need a long secret and are dev-only on the console', () => {
  assert.equal(loadConfig(testEnvironment).otp.delivery, 'disabled');
  const secret = 'x'.repeat(32);
  assert.equal(
    loadConfig({
      ...testEnvironment,
      OTP_DELIVERY: 'console',
      OTP_SECRET: secret,
    }).otp.delivery,
    'console',
  );
  assert.throws(() =>
    loadConfig({
      ...testEnvironment,
      OTP_DELIVERY: 'console',
      OTP_SECRET: 'short',
    }),
  );
  assert.throws(() =>
    loadConfig({ ...testEnvironment, OTP_DELIVERY: 'sms', OTP_SECRET: secret }),
  );
  assert.throws(() =>
    loadConfig({ ...testEnvironment, OTP_DEFAULT_COUNTRY_CODE: '+91' }),
  );
});

test('sessions last until sign-out within bounded, configurable windows', () => {
  const { session } = loadConfig(testEnvironment);
  assert.deepEqual(session, {
    idleSeconds: 30 * 86400,
    maxSeconds: 365 * 86400,
    cookieSecure: false,
  });
  assert.equal(
    loadConfig({ ...testEnvironment, SESSION_IDLE_DAYS: '7' }).session
      .idleSeconds,
    7 * 86400,
  );
  for (const bad of [
    { SESSION_IDLE_DAYS: '0' },
    { SESSION_MAX_DAYS: '401' },
    { SESSION_IDLE_DAYS: '90', SESSION_MAX_DAYS: '60' },
    { SESSION_COOKIE_SECURE: 'yes' },
  ])
    assert.throws(() => loadConfig({ ...testEnvironment, ...bad }));
});

test('host verification mode is explicit', () => {
  assert.equal(
    loadConfig({ ...testEnvironment, HOST_VERIFICATION_MODE: 'manual' })
      .hostVerification,
    'manual',
  );
  assert.throws(() =>
    loadConfig({ ...testEnvironment, HOST_VERIFICATION_MODE: 'auto' }),
  );
});

for (const [field, value] of Object.entries({
  NODE_ENV: 'staging',
  DATABASE_URL: '',
  FRONTEND_ORIGINS: '*',
  PORT: '0',
  HOST: 'example.com',
  DB_TLS: 'yes',
  TRUST_PROXY_CIDRS: 'true',
})) {
  test(`rejects unsafe ${field}`, () =>
    assert.throws(() => loadConfig({ ...testEnvironment, [field]: value })));
}

test('rejects malformed ports, URLs, origins and overbroad proxies', () => {
  for (const PORT of ['65536', '3.5', '3000junk']) {
    assert.throws(() => loadConfig({ ...testEnvironment, PORT }));
  }
  for (const DATABASE_URL of [
    'invalid-secret',
    'https://example.com/db',
    'postgres://a:b@localhost/',
    'postgres://a:b@localhost/db?sslmode=disable',
  ]) {
    assert.throws(
      () => loadConfig({ ...testEnvironment, DATABASE_URL }),
      (error) => !String(error).includes(DATABASE_URL),
    );
  }
  for (const FRONTEND_ORIGINS of [
    'http://localhost/path',
    'https://a:b@example.com',
    'null',
    'http://localhost,',
  ]) {
    assert.throws(() => loadConfig({ ...testEnvironment, FRONTEND_ORIGINS }));
  }
  for (const TRUST_PROXY_CIDRS of [
    '0.0.0.0/0',
    '::/0',
    '127.0.0.1/33',
    '::1/129',
    '127.0.0.1/',
  ]) {
    assert.throws(() => loadConfig({ ...testEnvironment, TRUST_PROXY_CIDRS }));
  }
});

test('production requires exact HTTPS origins and verified database TLS', () => {
  const production = { ...testEnvironment, NODE_ENV: 'production' };
  assert.throws(() => loadConfig(production));
  assert.throws(() => loadConfig({ ...production, DB_TLS: 'true' }));
  assert.throws(() =>
    loadConfig({
      ...production,
      DB_TLS: 'true',
      PUBLIC_API_ORIGIN: 'https://api.example.com',
    }),
  );
  const safe = {
    ...production,
    DB_TLS: 'true',
    PUBLIC_API_ORIGIN: 'https://api.example.com',
    FRONTEND_ORIGINS: 'https://example.com',
    TRUST_PROXY_CIDRS: '127.0.0.1/32,::1/128',
  };
  assert.equal(loadConfig(safe).production, true);
  assert.throws(() =>
    loadConfig({ ...safe, PUBLIC_API_ORIGIN: 'http://example.com' }),
  );
});

test('seed/reset requires a matching local disposable database', () => {
  assert.equal(
    localDatabaseTarget('test', testEnvironment.DATABASE_URL),
    'sikkim_test',
  );
  assert.equal(
    localDatabaseTarget('development', 'postgres://a:b@localhost/sikkim_dev'),
    'sikkim_dev',
  );
  for (const [mode, url] of [
    ['production', testEnvironment.DATABASE_URL],
    ['development', testEnvironment.DATABASE_URL],
    ['test', 'postgres://a:b@remote.example/sikkim_test'],
    ['test', 'postgres://a:b@localhost/customer_data'],
  ]) {
    assert.throws(() => localDatabaseTarget(mode!, url!));
  }
  assert.throws(() =>
    databaseUrl('postgres://a:b@localhost/sikkim_test?options=unsafe'),
  );
});

test('database commands reject mismatched targets before connecting', async () => {
  const config = loadConfig(testEnvironment);
  const other = 'postgres://owner:example@localhost/another_db';
  await assert.rejects(migrate(config, other), /same database/);
  await assert.rejects(seedOrReset(config, other), /same database/);
});
