import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';
import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { poolOptions } from '../../src/db/database.js';
import { migrate } from '../../src/db/maintenance.js';
import { tokenHash } from '../../src/accounts/model.js';

const headers = (accessToken: string) => ({
  authorization: `Bearer ${accessToken}`,
});

async function signIn(app: FastifyInstance, account = 'traveller-one') {
  const response = await app.inject({
    method: 'POST',
    url: '/v1/auth/demo',
    payload: { account },
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json().data as {
    accessToken: string;
    user: { id: string; isDemo: boolean; roles: string[] };
  };
}

test('accounts against isolated PostgreSQL', async (t) => {
  const config = loadConfig({ ...process.env, ENABLE_DEMO_AUTH: 'true' });
  assert.equal(config.mode, 'test');
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  assert.ok(migrationUrl);
  localDatabaseTarget('test', migrationUrl);
  localDatabaseTarget('test', config.connectionString);
  const owner = new pg.Client(poolOptions(config, migrationUrl));
  await owner.connect();
  t.after(() => owner.end());
  assert.equal(
    (
      await owner.query(
        `
          SELECT shobj_description(oid, 'pg_database') AS marker
          FROM pg_database
          WHERE datname = current_database()
        `,
      )
    ).rows[0].marker,
    'sikkim-local-only',
  );
  await migrate(config, migrationUrl);
  async function cleanApp() {
    await owner.query(
      `
        TRUNCATE public.user_reels, public.auth_otp_challenges, public.crm_lead_notes, public.crm_leads, public.community_photos, public.community_events, public.booking_changes, public.tickets, public.bookings,
        public.seat_holds, public.experience_slots, public.story_views,
        public.saved_items,
        public.experience_likes,
        public.story_items,
        public.stories,
        public.experience_media,
        public.media_assets,
        public.experience_categories,
        public.experience_reviews,
        public.recent_searches,
        public.experiences,
        public.policies,
        public.host_verifications,
        public.hosts,
        public.audit_logs,
        public.account_requests,
        public.user_consents,
        public.user_roles,
        public.user_interests,
        public.user_preferences,
        public.auth_sessions,
        public.auth_passwords,
        public.auth_identities,
        public.users
      `,
    );
    return buildApp(config);
  }

  await t.test(
    'guests see settings and interests, private routes need a bearer token',
    async () => {
      const app = await cleanApp();
      try {
        assert.equal((await app.inject('/v1/interests')).json().data.length, 7);
        const settings = (await app.inject('/v1/settings')).json().data;
        assert.equal(settings.auth.realSignInAvailable, true);
        assert.equal(settings.locationRequired, false);
        assert.equal(
          settings.privacy.choices.every(
            (c: { defaultAccepted: boolean }) => !c.defaultAccepted,
          ),
          true,
        );
        for (const auth of [
          undefined,
          'Bearer invalid',
          `Bearer ${'a'.repeat(43)}`,
        ]) {
          const response = await app.inject({
            url: '/v1/me',
            headers: auth
              ? { authorization: auth }
              : { cookie: 'session=fake' },
          });
          assert.equal(response.statusCode, 401);
          assert.equal(response.json().error.code, 'AUTH_REQUIRED');
        }
        assert.equal(
          (await app.inject('/v1/settings?userId=other')).statusCode,
          400,
        );
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'concurrent first sign-ins share one account and only hashed secrets are stored',
    async () => {
      const app = await cleanApp();
      try {
        const [a, b] = await Promise.all([signIn(app), signIn(app)]);
        assert.equal(a.user.id, b.user.id);
        assert.notEqual(a.accessToken, b.accessToken);
        assert.equal(a.user.isDemo, true);
        assert.deepEqual(a.user.roles, ['traveller']);
        assert.equal(
          (await owner.query('SELECT * FROM public.users')).rowCount,
          1,
        );
        assert.equal(
          (await owner.query('SELECT * FROM public.auth_identities')).rowCount,
          1,
        );
        const sessions = (
          await owner.query('SELECT token_hash FROM public.auth_sessions')
        ).rows;
        assert.equal(sessions.length, 2);
        assert.ok(
          sessions.some((s) => s.token_hash === tokenHash(a.accessToken)),
        );
        assert.ok(
          sessions.every(
            (s) => s.token_hash !== a.accessToken && s.token_hash.length === 64,
          ),
        );
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'profile, optional area and onboarding persist across sessions and a new app process',
    async () => {
      const app = await cleanApp();
      const a = await signIn(app);
      try {
        const name = await app.inject({
          method: 'PATCH',
          url: '/v1/me',
          headers: headers(a.accessToken),
          payload: { displayName: '  ताशी  ', language: 'hi' },
        });
        assert.equal(name.statusCode, 200, name.body);
        assert.equal(name.json().data.displayName, 'ताशी');
        const prefs = await app.inject({
          method: 'PATCH',
          url: '/v1/me/preferences',
          headers: headers(a.accessToken),
          payload: {
            chosenArea: ' Pakyong ',
            tripStart: '2099-01-10',
            tripDays: 4,
            travellers: 2,
            pace: 'slow',
            notificationsEnabled: true,
          },
        });
        assert.equal(prefs.statusCode, 200, prefs.body);
        assert.equal(prefs.json().data.preferences.chosenArea, 'Pakyong');
        const interests = await app.inject({
          method: 'PUT',
          url: '/v1/me/interests',
          headers: headers(a.accessToken),
          payload: { codes: ['food', 'nature'] },
        });
        assert.equal(interests.statusCode, 200, interests.body);
        assert.equal(interests.json().data.onboardingComplete, true);
      } finally {
        await app.close();
      }
      const second = await buildApp(config);
      try {
        const b = await signIn(second);
        assert.equal(b.user.id, a.user.id);
        const me = (
          await second.inject({
            url: '/v1/me',
            headers: headers(b.accessToken),
          })
        ).json().data;
        assert.equal(me.displayName, 'ताशी');
        assert.equal(me.language, 'hi');
        assert.equal(me.contentLanguage, 'en');
        assert.equal(me.preferences.tripStart, '2099-01-10');
        assert.deepEqual(me.interests, ['nature', 'food']);
        const cleared = await second.inject({
          method: 'PATCH',
          url: '/v1/me/preferences',
          headers: headers(a.accessToken),
          payload: { chosenArea: null, tripStart: null, tripDays: null },
        });
        assert.equal(cleared.statusCode, 200);
        assert.equal(cleared.json().data.preferences.chosenArea, null);
        assert.equal(
          (
            await second.inject({
              method: 'PUT',
              url: '/v1/me/interests',
              headers: headers(a.accessToken),
              payload: { codes: [] },
            })
          ).json().data.onboardingComplete,
          false,
        );
      } finally {
        await second.close();
      }
    },
  );

  await t.test(
    'strict input and ownership checks block another account and role escalation',
    async () => {
      const app = await cleanApp();
      try {
        const a = await signIn(app),
          b = await signIn(app, 'traveller-two');
        for (const payload of [
          { userId: b.user.id, displayName: 'hijacked' },
          { roles: ['admin'] },
          { status: 'active' },
          { isDemo: false },
          { displayName: '   ' },
          { language: 'xx' },
          {},
        ]) {
          assert.equal(
            (
              await app.inject({
                method: 'PATCH',
                url: '/v1/me',
                headers: headers(a.accessToken),
                payload,
              })
            ).statusCode,
            400,
          );
        }
        for (const payload of [
          { tripStart: '2099-02-29' },
          { tripStart: '2000-01-01' },
          { tripStart: '2099-04-31' },
          { travellers: '2' },
          { travellers: 0 },
          { travellers: 11 },
          { tripDays: 1 },
          { tripDays: 11 },
          { pace: 'fast' },
          { notificationsEnabled: 'true' },
          { chosenArea: '  ' },
          { userId: b.user.id },
          {},
        ]) {
          assert.equal(
            (
              await app.inject({
                method: 'PATCH',
                url: '/v1/me/preferences',
                headers: headers(a.accessToken),
                payload,
              })
            ).statusCode,
            400,
            JSON.stringify(payload),
          );
        }
        for (const codes of [['nature', 'nature'], ['invalid']]) {
          assert.equal(
            (
              await app.inject({
                method: 'PUT',
                url: '/v1/me/interests',
                headers: headers(a.accessToken),
                payload: { codes },
              })
            ).statusCode,
            400,
          );
        }
        assert.equal(
          (
            await app.inject({
              url: `/v1/me?userId=${b.user.id}`,
              headers: headers(a.accessToken),
            })
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await app.inject({
              url: `/v1/users/${b.user.id}`,
              headers: headers(a.accessToken),
            })
          ).statusCode,
          404,
        );
        await app.inject({
          method: 'PATCH',
          url: '/v1/me',
          headers: headers(a.accessToken),
          payload: { displayName: 'First account' },
        });
        const other = (
          await app.inject({ url: '/v1/me', headers: headers(b.accessToken) })
        ).json().data;
        assert.equal(other.displayName, 'Demo traveller two');
        assert.deepEqual(other.roles, ['traveller']);
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'refresh rotates once under concurrency, caps expiry and logout revokes the right sessions',
    async () => {
      const app = await cleanApp();
      try {
        const a = await signIn(app),
          another = await signIn(app),
          b = await signIn(app, 'traveller-two');
        await owner.query(
          `
            UPDATE public.auth_sessions
            SET
              expires_at = CURRENT_TIMESTAMP + interval '5 minutes',
              absolute_expires_at = CURRENT_TIMESTAMP + interval '10 minutes'
            WHERE token_hash = $1
          `,
          [tokenHash(a.accessToken)],
        );
        const results = await Promise.all(
          [1, 2].map(() =>
            app.inject({
              method: 'POST',
              url: '/v1/auth/refresh',
              headers: headers(a.accessToken),
            }),
          ),
        );
        assert.deepEqual(results.map((r) => r.statusCode).sort(), [200, 401]);
        const renewed = results.find((r) => r.statusCode === 200)!.json().data;
        assert.equal(renewed.expiresAt, renewed.absoluteExpiresAt);
        assert.notEqual(renewed.accessToken, a.accessToken);
        assert.equal(
          (await app.inject({ url: '/v1/me', headers: headers(a.accessToken) }))
            .statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/auth/logout',
              headers: headers(renewed.accessToken),
            })
          ).statusCode,
          204,
        );
        assert.equal(
          (
            await app.inject({
              url: '/v1/me',
              headers: headers(renewed.accessToken),
            })
          ).statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              url: '/v1/me',
              headers: headers(another.accessToken),
            })
          ).statusCode,
          200,
        );
        const third = await signIn(app);
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/auth/logout-all',
              headers: headers(another.accessToken),
            })
          ).statusCode,
          204,
        );
        for (const token of [another.accessToken, third.accessToken]) {
          assert.equal(
            (await app.inject({ url: '/v1/me', headers: headers(token) }))
              .statusCode,
            401,
          );
        }
        assert.equal(
          (await app.inject({ url: '/v1/me', headers: headers(b.accessToken) }))
            .statusCode,
          200,
        );
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'sign-out on one device wins over simultaneous renewal on another device',
    async () => {
      const app = await cleanApp();
      try {
        const first = await signIn(app),
          second = await signIn(app);
        const [renewal, logout] = await Promise.all([
          app.inject({
            method: 'POST',
            url: '/v1/auth/refresh',
            headers: headers(first.accessToken),
          }),
          app.inject({
            method: 'POST',
            url: '/v1/auth/logout-all',
            headers: headers(second.accessToken),
          }),
        ]);
        assert.equal(logout.statusCode, 204, logout.body);
        assert.ok([200, 401].includes(renewal.statusCode), renewal.body);
        const tokens = [first.accessToken, second.accessToken];
        if (renewal.statusCode === 200) {
          tokens.push(renewal.json().data.accessToken);
        }
        for (const token of tokens) {
          assert.equal(
            (await app.inject({ url: '/v1/me', headers: headers(token) }))
              .statusCode,
            401,
          );
        }
        assert.equal(
          (await owner.query('SELECT * FROM public.auth_sessions')).rowCount,
          0,
        );
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'expired, suspended and deleted accounts cannot use or renew sessions',
    async () => {
      const app = await cleanApp();
      try {
        const a = await signIn(app);
        await owner.query(
          `
            UPDATE public.auth_sessions
            SET
              expires_at = CURRENT_TIMESTAMP - interval '1 second'
            WHERE user_id = $1
          `,
          [a.user.id],
        );
        for (const [method, url] of [
          ['GET', '/v1/me'],
          ['POST', '/v1/auth/refresh'],
        ] as const) {
          assert.equal(
            (await app.inject({ method, url, headers: headers(a.accessToken) }))
              .statusCode,
            401,
          );
        }
        for (const status of ['suspended', 'deleted']) {
          await owner.query(
            "UPDATE public.users SET status='active' WHERE id=$1",
            [a.user.id],
          );
          const active = await signIn(app);
          await owner.query('UPDATE public.users SET status=$2 WHERE id=$1', [
            a.user.id,
            status,
          ]);
          assert.equal(
            (
              await app.inject({
                url: '/v1/me',
                headers: headers(active.accessToken),
              })
            ).statusCode,
            401,
          );
          assert.equal(
            (
              await app.inject({
                method: 'POST',
                url: '/v1/auth/refresh',
                headers: headers(active.accessToken),
              })
            ).statusCode,
            401,
          );
          assert.equal(
            (
              await app.inject({
                method: 'POST',
                url: '/v1/auth/demo',
                payload: { account: 'traveller-one' },
              })
            ).statusCode,
            403,
          );
        }
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'at most five sessions remain; demo endpoints enforce local origin and retry limits',
    async () => {
      const app = await cleanApp();
      try {
        const first = await signIn(app);
        for (let i = 0; i < 5; i++) {
          await signIn(app);
        }
        assert.equal(
          (await owner.query('SELECT * FROM public.auth_sessions')).rowCount,
          5,
        );
        assert.equal(
          (
            await app.inject({
              url: '/v1/me',
              headers: headers(first.accessToken),
            })
          ).statusCode,
          401,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/auth/demo',
              remoteAddress: '192.0.2.10',
              payload: { account: 'traveller-one' },
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/auth/demo',
              headers: { origin: 'https://untrusted.example' },
              payload: { account: 'traveller-one' },
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/auth/demo',
              payload: { account: 'someone' },
            })
          ).statusCode,
          400,
        );
        await signIn(app);
        await signIn(app);
        const limited = await app.inject({
          method: 'POST',
          url: '/v1/auth/demo',
          payload: { account: 'traveller-one' },
        });
        assert.equal(limited.statusCode, 429);
        assert.ok(limited.headers['retry-after']);
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'turning demo off disables sign-in and existing demo tokens',
    async () => {
      const app = await cleanApp();
      const a = await signIn(app);
      await app.close();
      const disabled = await buildApp({ ...config, demoAuth: false });
      try {
        assert.equal(
          (
            await disabled.inject({
              method: 'POST',
              url: '/v1/auth/demo',
              payload: { account: 'traveller-one' },
            })
          ).statusCode,
          404,
        );
        assert.equal(
          (
            await disabled.inject({
              url: '/v1/me',
              headers: headers(a.accessToken),
            })
          ).statusCode,
          401,
        );
        assert.equal(
          (await disabled.inject('/v1/settings')).json().data.auth.mode,
          'password',
        );
        assert.equal((await disabled.inject('/v1/interests')).statusCode, 200);
      } finally {
        await disabled.close();
      }
    },
  );

  await t.test(
    'consent is versioned, repeat-safe and withdrawable; export contains only your account',
    async () => {
      const app = await cleanApp();
      try {
        const a = await signIn(app),
          b = await signIn(app, 'traveller-two');
        const save = (accepted: boolean, version = 'demo-v1') =>
          app.inject({
            method: 'PUT',
            url: '/v1/me/consents/marketing',
            headers: headers(a.accessToken),
            payload: { accepted, version },
          });
        assert.deepEqual(
          (
            await app.inject({
              url: '/v1/me/consents',
              headers: headers(a.accessToken),
            })
          ).json().data,
          [],
        );
        assert.equal((await save(true, 'old')).statusCode, 409);
        for (const accepted of [true, true, false]) {
          assert.equal((await save(accepted)).statusCode, 200);
        }
        assert.equal(
          (await owner.query('SELECT * FROM public.user_consents')).rowCount,
          2,
        );
        assert.equal(
          (
            await app.inject({
              url: '/v1/me/consents',
              headers: headers(a.accessToken),
            })
          ).json().data[0].accepted,
          false,
        );
        assert.deepEqual(
          (
            await app.inject({
              url: '/v1/me/consents',
              headers: headers(b.accessToken),
            })
          ).json().data,
          [],
        );
        const exported = await app.inject({
          url: '/v1/me/export',
          headers: headers(a.accessToken),
        });
        assert.equal(exported.statusCode, 200);
        assert.match(
          String(exported.headers['content-disposition']),
          /attachment/,
        );
        assert.equal(exported.json().data.user.id, a.user.id);
        assert.equal(exported.json().data.consents.length, 2);
        assert.equal(
          exported.json().data.identities[0].subject,
          'traveller-one',
        );
        for (const forbidden of [
          a.accessToken,
          b.accessToken,
          b.user.id,
          'token_hash',
          'tokenHash',
          'password',
        ]) {
          assert.equal(exported.body.includes(forbidden), false);
        }
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'deletion request is atomic, revokes all sessions and preserves data pending retention review',
    async () => {
      const app = await cleanApp();
      try {
        const a = await signIn(app),
          second = await signIn(app),
          b = await signIn(app, 'traveller-two');
        const responses = await Promise.all(
          [a, second].map((s) =>
            app.inject({
              method: 'POST',
              url: '/v1/me/deletion-request',
              headers: headers(s.accessToken),
            }),
          ),
        );
        assert.deepEqual(responses.map((r) => r.statusCode).sort(), [202, 401]);
        assert.equal(
          (
            await owner.query(
              'SELECT * FROM public.account_requests WHERE user_id=$1',
              [a.user.id],
            )
          ).rowCount,
          1,
        );
        assert.equal(
          (
            await owner.query('SELECT status FROM public.users WHERE id=$1', [
              a.user.id,
            ])
          ).rows[0].status,
          'deletion_requested',
        );
        assert.equal(
          (
            await owner.query(
              'SELECT * FROM public.auth_sessions WHERE user_id=$1',
              [a.user.id],
            )
          ).rowCount,
          0,
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/auth/demo',
              payload: { account: 'traveller-one' },
            })
          ).statusCode,
          403,
        );
        assert.equal(
          (await app.inject({ url: '/v1/me', headers: headers(b.accessToken) }))
            .statusCode,
          200,
        );
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'database permissions prevent role grants and rewriting consent ' +
      'history; server reads assigned roles',
    async () => {
      const app = await cleanApp();
      const runtime = new pg.Client(poolOptions(config));
      await runtime.connect();
      try {
        const a = await signIn(app);
        for (const sql of [
          "INSERT INTO public.user_roles (user_id,role) VALUES ($1,'admin')",
          'UPDATE public.users SET is_demo=false WHERE id=$1',
          'UPDATE public.user_consents SET accepted=true WHERE user_id=$1',
          'DELETE FROM public.user_consents WHERE user_id=$1',
        ]) {
          await assert.rejects(
            runtime.query(sql, [a.user.id]),
            /permission denied/,
          );
        }
        await owner.query(
          "INSERT INTO public.user_roles (user_id,role) VALUES ($1,'host')",
          [a.user.id],
        );
        assert.deepEqual(
          (
            await app.inject({ url: '/v1/me', headers: headers(a.accessToken) })
          ).json().data.roles,
          ['traveller', 'host'],
        );
        await assert.rejects(
          owner.query(
            `
              INSERT INTO public.audit_logs (
                  actor_id,
                  action,
                  entity_type,
                  entity_id,
                  request_id
                )
              VALUES
                (
                  gen_random_uuid(),
                  'test.created',
                  'user',
                  $1,
                  gen_random_uuid()
                )
            `,
            [a.user.id],
          ),
          /foreign key/,
        );
      } finally {
        await runtime.end();
        await app.close();
      }
    },
  );

  await t.test(
    'logs omit bearer secrets and profile text; failed transactions roll back',
    async () => {
      const initial = await cleanApp();
      await initial.close();
      let logs = '';
      const app = await buildApp(
        { ...config, logLevel: 'info' },
        {
          logStream: new Writable({
            write(chunk, _encoding, done) {
              logs += chunk.toString();
              done();
            },
          }),
        },
      );
      try {
        const a = await signIn(app);
        await owner.query('REVOKE INSERT ON public.audit_logs FROM sikkim_app');
        try {
          const response = await app.inject({
            method: 'PATCH',
            url: '/v1/me',
            headers: headers(a.accessToken),
            payload: { displayName: 'PRIVATE_PROFILE_MARKER' },
          });
          assert.equal(response.statusCode, 500);
          assert.doesNotMatch(
            response.body,
            /permission|audit_logs|PRIVATE_PROFILE_MARKER/,
          );
          assert.equal(
            (
              await owner.query(
                'SELECT display_name FROM public.users WHERE id=$1',
                [a.user.id],
              )
            ).rows[0].display_name,
            'Demo traveller one',
          );
        } finally {
          await owner.query('GRANT INSERT ON public.audit_logs TO sikkim_app');
        }
        assert.equal(logs.includes(a.accessToken), false);
        assert.equal(logs.includes('PRIVATE_PROFILE_MARKER'), false);
        assert.equal(logs.includes('permission denied'), false);
      } finally {
        await app.close();
      }
    },
  );
});
