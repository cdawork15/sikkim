import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';
import { buildApp } from '../../src/app.js';
import { testConfig } from '../helpers.js';

const uuid =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const noTransaction = async (): Promise<never> => {
  throw new Error('Unexpected database transaction in this test');
};
const readyDatabase = () => ({
  transaction: noTransaction,
  ready: async () => {},
  close: async () => {},
});

test('liveness/readiness, request IDs and security headers follow the API contract', async (t) => {
  const app = await buildApp(testConfig(), { database: readyDatabase() });
  t.after(() => app.close());
  for (const url of ['/v1/health/live', '/v1/health/ready']) {
    const reply = await app.inject({
      url,
      headers: { 'x-request-id': 'attacker-controlled' },
    });
    assert.equal(reply.statusCode, 200);
    assert.deepEqual(reply.json(), { data: { status: 'ok' } });
    assert.match(String(reply.headers['x-request-id']), uuid);
    assert.equal(reply.headers['cache-control'], 'no-store');
    assert.equal(reply.headers['x-content-type-options'], 'nosniff');
  }
});

test('database outage leaves liveness healthy and gives safe readiness failure', async (t) => {
  let closed = false;
  const app = await buildApp(testConfig(), {
    database: {
      transaction: noTransaction,
      ready: async () => {
        throw new Error('postgres://secret:password@private-host/db');
      },
      close: async () => {
        closed = true;
      },
    },
  });
  t.after(() => app.close());
  assert.equal((await app.inject('/v1/health/live')).statusCode, 200);
  const reply = await app.inject('/v1/health/ready');
  assert.equal(reply.statusCode, 503);
  assert.equal(reply.json().error.code, 'NOT_READY');
  assert.equal(reply.json().error.requestId, reply.headers['x-request-id']);
  assert.doesNotMatch(reply.body, /password|private-host/);
  await app.close();
  assert.equal(closed, true);
});

test('CORS permits only approved origins and does not enable cookies', async (t) => {
  const app = await buildApp(testConfig(), { database: readyDatabase() });
  t.after(() => app.close());
  const good = await app.inject({
    url: '/v1/health/live',
    headers: { origin: 'http://localhost:5173' },
  });
  assert.equal(
    good.headers['access-control-allow-origin'],
    'http://localhost:5173',
  );
  assert.equal(good.headers['access-control-allow-credentials'], undefined);
  const bad = await app.inject({
    url: '/v1/health/live',
    headers: { origin: 'https://attacker.example' },
  });
  assert.equal(bad.headers['access-control-allow-origin'], undefined);
  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/v1/health/ready',
    headers: {
      origin: 'http://localhost:5173',
      'access-control-request-method': 'GET',
    },
  });
  assert.equal(preflight.statusCode, 204);
  const invalid = await app.inject({
    method: 'OPTIONS',
    url: '/v1/health/live',
  });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.json().error.code, 'INVALID_REQUEST');
  assert.equal(invalid.json().error.requestId, invalid.headers['x-request-id']);
});

test(
  'validation, malformed JSON, unknown routes and oversized bodies ' +
    'have safe errors',
  async (t) => {
    const app = await buildApp(testConfig(), { database: readyDatabase() });
    app.post(
      '/test-input',
      {
        schema: {
          body: {
            type: 'object',
            additionalProperties: false,
            required: ['count'],
            properties: {
              count: { type: 'integer', minimum: 1, maximum: 100 },
            },
          },
        },
      },
      async () => ({ ok: true }),
    );
    t.after(() => app.close());
    const requests = [
      {
        url: '/v1/health/live',
        method: 'GET' as const,
        payload: { unexpected: true },
        status: 400,
      },
      { url: '/v1/health/live?unexpected=secret', status: 400 },
      { url: '/missing?token=secret', status: 404 },
      {
        url: '/test-input',
        method: 'POST' as const,
        payload: { count: '2' },
        status: 400,
      },
      {
        url: '/test-input',
        method: 'POST' as const,
        payload: { count: 2, extra: true },
        status: 400,
      },
      {
        url: '/test-input',
        method: 'POST' as const,
        headers: { 'content-type': 'application/json' },
        payload: '{',
        status: 400,
      },
      {
        url: '/test-input',
        method: 'POST' as const,
        payload: { count: 1, long: 'a'.repeat(17000) },
        status: 413,
      },
    ];
    for (const { status, ...request } of requests) {
      const response = await app.inject(request);
      assert.equal(response.statusCode, status);
      assert.equal(
        response.json().error.requestId,
        response.headers['x-request-id'],
      );
      assert.doesNotMatch(response.body, /secret|stack|postgres/);
    }
  },
);

test(
  'rate limits cannot be bypassed with spoofed proxy headers; ' +
    'liveness remains available',
  async (t) => {
    const app = await buildApp(testConfig(), {
      database: readyDatabase(),
      rateLimitMax: 2,
    });
    t.after(() => app.close());
    for (const suffix of [1, 2]) {
      assert.equal(
        (
          await app.inject({
            url: '/v1/health/ready',
            headers: { 'x-forwarded-for': `10.0.0.${suffix}` },
          })
        ).statusCode,
        200,
      );
    }
    const reply = await app.inject({
      url: '/v1/health/ready',
      headers: { 'x-forwarded-for': '10.0.0.3' },
    });
    assert.equal(reply.statusCode, 429);
    assert.equal(reply.json().error.code, 'RATE_LIMITED');
    assert.ok(reply.headers['retry-after']);
    assert.equal((await app.inject('/v1/health/live')).statusCode, 200);
  },
);

test('internal errors and access logs do not expose request secrets or raw errors', async (t) => {
  let logs = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      logs += String(chunk);
      callback();
    },
  });
  const config = { ...testConfig(), logLevel: 'info' };
  const app = await buildApp(config, {
    database: readyDatabase(),
    logStream: stream,
  });
  app.get('/explode', async () => {
    throw new Error('do-not-leak-database-password');
  });
  t.after(() => app.close());
  const reply = await app.inject({
    url: '/explode?token=do-not-leak-query',
    headers: {
      authorization: 'Bearer do-not-leak-auth',
      cookie: 'private=do-not-leak-cookie',
    },
  });
  assert.equal(reply.statusCode, 500);
  assert.equal(reply.json().error.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(reply.body + logs, /do-not-leak/);
  assert.match(logs, /request_failed/);
});
