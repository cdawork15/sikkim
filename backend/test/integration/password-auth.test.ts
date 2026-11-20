import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import test from 'node:test';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { poolOptions } from '../../src/db/database.js';
import { migrate, seedOrReset } from '../../src/db/maintenance.js';

const password = 'Trail#82';
const headers = (token: string) => ({ authorization: `Bearer ${token}` });
const credentials = () => ({
  email: `${randomUUID()}@example.com`,
  password,
  displayName: 'Pema',
});

test('password accounts against isolated PostgreSQL', async (t) => {
  const config = loadConfig({ ...process.env, ENABLE_DEMO_AUTH: 'false' });
  assert.equal(config.mode, 'test');
  const migrationUrl = process.env.MIGRATION_DATABASE_URL!;
  localDatabaseTarget('test', migrationUrl);
  localDatabaseTarget('test', config.connectionString);
  await migrate(config, migrationUrl);
  await seedOrReset(config, migrationUrl, 'sikkim_test');
  const owner = new pg.Client(poolOptions(config, migrationUrl));
  await owner.connect();
  t.after(() => owner.end());
  let logs = '';
  const app = await buildApp(config, {
    logStream: new Writable({
      write(chunk, _encoding, done) {
        logs += chunk;
        done();
      },
    }),
  });
  t.after(() => app.close());
  let ip = 1;
  const post = (path: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/v1/auth/${path}`,
      payload: payload as object,
      remoteAddress: `127.1.0.${ip++}`,
    });

  await t.test(
    'registration creates an ordinary private account and only stores salted hashes',
    async () => {
      const input = credentials();
      const response = await post('register', {
        ...input,
        email: input.email.toUpperCase(),
      });
      assert.equal(response.statusCode, 201, response.body);
      const session = response.json().data;
      assert.equal(session.demo, false);
      assert.equal(session.user.isDemo, false);
      assert.deepEqual(session.user.roles, ['traveller']);
      assert.equal(session.user.preferences.notificationsEnabled, false);
      assert.equal(session.user.onboardingComplete, false);
      assert.doesNotMatch(response.body, /password|passwordHash|password_hash/);
      const stored = (
        await owner.query(
          'SELECT password_hash FROM public.auth_passwords WHERE user_id=$1',
          [session.user.id],
        )
      ).rows[0].password_hash;
      assert.match(stored, /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
      assert.ok(!stored.includes(password));
      const duplicate = await post('register', input);
      assert.equal(duplicate.statusCode, 409, duplicate.body);
      const login = await post('login', { email: input.email, password });
      assert.equal(login.statusCode, 200, login.body);
      assert.equal(login.json().data.user.id, session.user.id);
      assert.notEqual(login.json().data.accessToken, session.accessToken);
      const exported = await app.inject({
        url: '/v1/me/export',
        headers: headers(session.accessToken),
      });
      assert.equal(exported.statusCode, 200, exported.body);
      assert.ok(!exported.body.includes(stored));
      assert.ok(!exported.body.includes(password));
      assert.ok(!logs.includes(password));
      assert.ok(!logs.includes(input.email));
      assert.ok(!logs.includes(session.accessToken));
      const settings = (await app.inject('/v1/settings')).json().data.auth;
      assert.equal(settings.mode, 'password');
      assert.equal(settings.emailVerificationAvailable, false);
      assert.equal(settings.passwordRecoveryAvailable, false);
    },
  );

  await t.test(
    'password accounts cannot accept demo policies or receive automatic host access',
    async () => {
      const previewApp = await buildApp({ ...config, demoAuth: true });
      try {
        const registered = await previewApp.inject({
          method: 'POST',
          url: '/v1/auth/register',
          payload: credentials(),
        });
        assert.equal(registered.statusCode, 201, registered.body);
        const auth = headers(registered.json().data.accessToken);
        const consent = await previewApp.inject({
          method: 'PUT',
          url: '/v1/me/consents/marketing',
          headers: auth,
          payload: { accepted: true, version: 'demo-v1' },
        });
        assert.equal(consent.statusCode, 503, consent.body);
        const profile = await previewApp.inject({
          url: '/v1/me',
          headers: auth,
        });
        assert.deepEqual(profile.json().data.roles, ['traveller']);
      } finally {
        await previewApp.close();
      }
    },
  );

  await t.test(
    'duplicate concurrent registrations create one account and no orphan rows',
    async () => {
      const input = credentials();
      const before = (
        await owner.query('SELECT count(*)::int AS count FROM public.users')
      ).rows[0].count;
      const replies = await Promise.all([
        post('register', input),
        post('register', { ...input, email: input.email.toUpperCase() }),
      ]);
      assert.deepEqual(replies.map((r) => r.statusCode).sort(), [201, 409]);
      assert.equal(
        (await owner.query('SELECT count(*)::int AS count FROM public.users'))
          .rows[0].count,
        before + 1,
      );
    },
  );

  await t.test(
    'wrong, unknown and disabled accounts return the same login error',
    async () => {
      const input = credentials();
      const registered = await post('register', input);
      assert.equal(registered.statusCode, 201, registered.body);
      const wrong = await post('login', {
        email: input.email,
        password: 'A wrong long passphrase',
      });
      const unknown = await post('login', {
        email: credentials().email,
        password,
      });
      await owner.query(
        "UPDATE public.users SET status='suspended' WHERE id=$1",
        [registered.json().data.user.id],
      );
      const disabled = await post('login', { email: input.email, password });
      for (const response of [wrong, unknown, disabled]) {
        assert.equal(response.statusCode, 401, response.body);
        assert.equal(response.json().error.code, 'LOGIN_FAILED');
        assert.equal(response.json().error.message, wrong.json().error.message);
      }
      assert.equal(
        (
          await app.inject({
            url: '/v1/me',
            headers: headers(registered.json().data.accessToken),
          })
        ).statusCode,
        401,
      );
    },
  );

  await t.test(
    'strict validation prevents weak inputs and privilege injection',
    async () => {
      for (const overrides of [
        { password: 'Trail#8' },
        { password: 'a'.repeat(129) },
        { email: 'not-an-email' },
        { displayName: '   ' },
        { roles: ['admin'] },
        { isDemo: true },
        { emailVerified: true },
      ]) {
        const response = await post('register', {
          ...credentials(),
          ...overrides,
        });
        assert.equal(response.statusCode, 400, response.body);
      }
    },
  );

  await t.test(
    'accounts remain isolated, sessions rotate and logout revokes access',
    async () => {
      const first = await post('register', credentials());
      const second = await post('register', credentials());
      assert.equal(first.statusCode, 201, first.body);
      assert.equal(second.statusCode, 201, second.body);
      const a = first.json().data;
      const b = second.json().data;
      const saved = await app.inject({
        method: 'PATCH',
        url: '/v1/me',
        headers: headers(a.accessToken),
        payload: { displayName: 'Only mine' },
      });
      assert.equal(saved.statusCode, 200);
      const other = await app.inject({
        url: '/v1/me',
        headers: headers(b.accessToken),
      });
      assert.equal(other.json().data.displayName, 'Pema');
      const renewed = await app.inject({
        method: 'POST',
        url: '/v1/auth/refresh',
        headers: headers(a.accessToken),
      });
      assert.equal(renewed.statusCode, 200);
      assert.equal(
        (await app.inject({ url: '/v1/me', headers: headers(a.accessToken) }))
          .statusCode,
        401,
      );
      const token = renewed.json().data.accessToken;
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/auth/logout',
            headers: headers(token),
          })
        ).statusCode,
        204,
      );
      assert.equal(
        (await app.inject({ url: '/v1/me', headers: headers(token) }))
          .statusCode,
        401,
      );
      assert.equal(
        (await app.inject({ url: '/v1/me', headers: headers(b.accessToken) }))
          .statusCode,
        200,
      );
    },
  );

  await t.test(
    'only five sessions survive, and deletion prevents signing in again',
    async () => {
      const input = credentials();
      const registered = (await post('register', input)).json().data;
      let latest = registered.accessToken;
      for (let i = 0; i < 5; i++) {
        const response = await post('login', { email: input.email, password });
        assert.equal(response.statusCode, 200, response.body);
        latest = response.json().data.accessToken;
      }
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int AS count FROM public.auth_sessions WHERE user_id=$1',
            [registered.user.id],
          )
        ).rows[0].count,
        5,
      );
      assert.equal(
        (
          await app.inject({
            url: '/v1/me',
            headers: headers(registered.accessToken),
          })
        ).statusCode,
        401,
      );
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/me/deletion-request',
            headers: headers(latest),
          })
        ).statusCode,
        202,
      );
      assert.equal(
        (await post('login', { email: input.email, password })).statusCode,
        401,
      );
    },
  );

  await t.test(
    'repeated attempts are limited by email across IP addresses',
    async () => {
      const input = { email: credentials().email, password };
      for (let i = 0; i < 10; i++)
        assert.equal((await post('login', input)).statusCode, 401);
      const limited = await post('login', {
        ...input,
        email: input.email.toUpperCase(),
      });
      assert.equal(limited.statusCode, 429, limited.body);
      assert.ok(limited.headers['retry-after']);
    },
  );

  await t.test(
    'one IP cannot bypass throttling by changing email or endpoint',
    async () => {
      for (let i = 0; i < 10; i++) {
        const response = await app.inject({
          method: 'POST',
          url: '/v1/auth/login',
          payload: { email: credentials().email, password },
          remoteAddress: '127.2.0.1',
        });
        assert.equal(response.statusCode, 401, response.body);
      }
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: credentials(),
        remoteAddress: '127.2.0.1',
      });
      assert.equal(response.statusCode, 429, response.body);
    },
  );
});
