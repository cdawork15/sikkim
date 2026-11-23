import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { createDatabase, poolOptions } from '../../src/db/database.js';
import { migrate } from '../../src/db/maintenance.js';
import { requirePublishableHost } from '../../src/hosts/service.js';

test('host onboarding and approval against isolated PostgreSQL', async (t) => {
  const config = loadConfig({ ...process.env, ENABLE_DEMO_AUTH: 'true' });
  assert.equal(config.mode, 'test');
  const url = process.env.MIGRATION_DATABASE_URL;
  assert.ok(url);
  localDatabaseTarget('test', url);
  localDatabaseTarget('test', config.connectionString);
  const owner = new pg.Client(poolOptions(config, url));
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
  await migrate(config, url);
  const db = createDatabase(config, () => {});
  t.after(() => db.close());
  async function setup() {
    await owner.query(
      `
        TRUNCATE public.user_reels, public.auth_otp_challenges, public.crm_ai_runs, public.crm_tasks, public.crm_lead_notes, public.crm_leads, public.community_messages, public.community_members, public.community_photos, public.community_events, public.booking_changes, public.tickets, public.bookings,
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
    const app = await buildApp(config);
    const signIn = async (account: string) => {
      const r = await app.inject({
        method: 'POST',
        url: '/v1/auth/demo',
        payload: { account },
      });
      assert.equal(r.statusCode, 201, r.body);
      return r.json().data;
    };
    const a = await signIn('traveller-one'),
      b = await signIn('traveller-two');
    const ah = { authorization: `Bearer ${a.accessToken}` },
      bh = { authorization: `Bearer ${b.accessToken}` };
    const draft = async (revision = 0, extra = {}) => {
      const r = await app.inject({
        method: 'PUT',
        url: '/v1/me/host',
        headers: ah,
        payload: {
          revision,
          publicName: 'Tashi',
          story: 'Local walks and stories.',
          serviceAreas: ['Pakyong'],
          ...extra,
        },
      });
      assert.equal(r.statusCode, 200, r.body);
      return r.json().data;
    };
    const submit = async (revision: number) =>
      app.inject({
        method: 'POST',
        url: '/v1/me/host/submit',
        headers: ah,
        payload: { revision },
      });
    const admin = () =>
      owner.query(
        `
          INSERT INTO public.user_roles (user_id, role)
          VALUES
            ($1, 'admin')
          ON CONFLICT DO NOTHING
        `,
        [b.user.id],
      );
    const decide = (
      id: string,
      revision: number,
      action = 'approved',
      extra = {},
    ) =>
      app.inject({
        method: 'POST',
        url: `/v1/admin/hosts/${id}/decisions`,
        headers: bh,
        payload: {
          revision,
          action,
          reason: 'Local demo review only.',
          ...(action === 'approved'
            ? { expiresAt: '2099-01-01T00:00:00Z' }
            : {}),
          ...extra,
        },
      });
    return { app, a, b, ah, bh, draft, submit, admin, decide };
  }
  await t.test(
    'easy drafts, strict fields, incomplete submission and distinct same-name accounts',
    async () => {
      const { app, ah, bh, draft, submit } = await setup();
      try {
        assert.equal((await app.inject('/v1/me/host')).statusCode, 401);
        assert.equal(
          (await app.inject({ url: '/v1/me/host', headers: ah })).statusCode,
          404,
        );
        const empty = await app.inject({
          method: 'PUT',
          url: '/v1/me/host',
          headers: ah,
          payload: { revision: 0, publicName: 'Tashi' },
        });
        assert.equal(empty.statusCode, 200);
        assert.equal(
          (await submit(empty.json().data.revision)).statusCode,
          400,
        );
        const host = await draft(empty.json().data.revision);
        const other = await app.inject({
          method: 'PUT',
          url: '/v1/me/host',
          headers: bh,
          payload: { revision: 0, publicName: 'Tashi' },
        });
        assert.notEqual(host.id, other.json().data.id);
        for (const extra of [
          { status: 'approved' },
          { userId: other.json().data.userId },
          { evidenceUrl: 'https://example.com/passport' },
          { publicName: '   ' },
          { serviceAreas: ['Pakyong', ' pakyong '] },
          { serviceAreas: Array(11).fill('x') },
        ]) {
          const r = await app.inject({
            method: 'PUT',
            url: '/v1/me/host',
            headers: ah,
            payload: { revision: host.revision, ...extra },
          });
          assert.equal(r.statusCode, 400, r.body);
        }
        assert.equal(
          (
            await app.inject({
              method: 'PUT',
              url: '/v1/me/host',
              headers: ah,
              payload: { revision: 0, story: 'stale' },
            })
          ).statusCode,
          409,
        );
        assert.equal(
          (await app.inject({ url: '/v1/admin/hosts', headers: ah }))
            .statusCode,
          403,
        );
        assert.equal(
          (await app.inject({ url: `/v1/admin/hosts/${host.id}`, headers: bh }))
            .statusCode,
          403,
        );
      } finally {
        await app.close();
      }
    },
  );
  await t.test(
    'review, rejection, correction, approval and suspension retain ' +
      'history and block demo publishing',
    async () => {
      const { app, a, ah, draft, submit, admin, decide } = await setup();
      try {
        let host = await draft();
        host = (await submit(host.revision)).json().data;
        assert.equal(host.status, 'pending');
        assert.equal(host.uploadsAvailable, false);
        assert.equal((await decide(host.id, host.revision)).statusCode, 403);
        await admin();
        let r = await decide(host.id, host.revision, 'rejected');
        assert.equal(r.statusCode, 200, r.body);
        host = r.json().data;
        host = await draft(host.revision, {
          story: 'Corrected local introduction.',
        });
        host = (await submit(host.revision)).json().data;
        assert.equal(
          (await decide(host.id, host.revision, 'approved', { reason: ' ' }))
            .statusCode,
          400,
        );
        assert.equal(
          (
            await decide(host.id, host.revision, 'approved', {
              expiresAt: '2000-01-01T00:00:00Z',
            })
          ).statusCode,
          400,
        );
        r = await decide(host.id, host.revision);
        assert.equal(r.statusCode, 200, r.body);
        host = r.json().data;
        assert.equal(host.status, 'approved');
        assert.equal(host.isDemo, true);
        assert.deepEqual(
          host.history.map((h: { action: string }) => h.action),
          ['submitted', 'rejected', 'submitted', 'approved'],
        );
        assert.equal(
          (await app.inject({ url: `/v1/hosts/${host.id}` })).statusCode,
          404,
        );
        await assert.rejects(
          db.transaction((c) => requirePublishableHost(c, a.user.id)),
          /approved real host/,
        );
        assert.equal(
          (
            await app.inject({
              method: 'PUT',
              url: '/v1/me/host',
              headers: ah,
              payload: { revision: host.revision, story: 'unchecked edit' },
            })
          ).statusCode,
          409,
        );
        r = await decide(host.id, host.revision, 'suspended');
        assert.equal(r.statusCode, 200, r.body);
        host = r.json().data;
        assert.equal(host.history.length, 5);
        assert.equal(host.status, 'suspended');
        assert.equal(
          (await decide(host.id, host.revision, 'approved')).statusCode,
          409,
        );
        assert.equal(
          (
            await owner.query(
              'SELECT * FROM public.host_verifications WHERE host_id=$1',
              [host.id],
            )
          ).rowCount,
          5,
        );
        assert.equal(
          (
            await owner.query(
              `
                SELECT *
                FROM public.audit_logs
                WHERE entity_id = $1
                  AND action = 'host.suspended'
              `,
              [host.id],
            )
          ).rowCount,
          1,
        );
      } finally {
        await app.close();
      }
    },
  );
  await t.test(
    'duplicate submits and concurrent decisions have exactly one winner; no self-review',
    async () => {
      const { app, a, ah, draft, submit, admin, decide } = await setup();
      try {
        let host = await draft();
        const submits = await Promise.all([
          submit(host.revision),
          submit(host.revision),
        ]);
        assert.deepEqual(submits.map((r) => r.statusCode).sort(), [200, 409]);
        host = submits.find((r) => r.statusCode === 200)!.json().data;
        await owner.query(
          "INSERT INTO public.user_roles(user_id,role) VALUES ($1,'admin')",
          [a.user.id],
        );
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: `/v1/admin/hosts/${host.id}/decisions`,
              headers: ah,
              payload: {
                revision: host.revision,
                action: 'rejected',
                reason: 'self',
              },
            })
          ).statusCode,
          403,
        );
        await admin();
        const responses = await Promise.all([
          decide(host.id, host.revision),
          decide(host.id, host.revision, 'rejected'),
        ]);
        assert.deepEqual(responses.map((r) => r.statusCode).sort(), [200, 409]);
        assert.equal(
          (
            await owner.query(
              'SELECT * FROM public.host_verifications WHERE host_id=$1',
              [host.id],
            )
          ).rowCount,
          2,
        );
      } finally {
        await app.close();
      }
    },
  );
  await t.test(
    'real submission stays unavailable; public fields and publishing ' +
      'exclude inactive, expired and suspended hosts',
    async () => {
      const { app, a, ah, draft, submit, admin, decide } = await setup();
      try {
        let host = await draft();
        await owner.query('UPDATE public.users SET is_demo=false WHERE id=$1', [
          a.user.id,
        ]);
        assert.equal((await submit(host.revision)).statusCode, 503);
        // Owner-only fixtures model future verified real accounts; the API cannot approve them yet.
        await owner.query(
          `
            UPDATE public.hosts
            SET
              status = 'approved',
              approved_until = '2099-01-01'
            WHERE id = $1
          `,
          [host.id],
        );
        const publicResponse = await app.inject(`/v1/hosts/${host.id}`);
        assert.equal(publicResponse.statusCode, 200);
        assert.deepEqual(
          Object.keys(publicResponse.json().data).sort(),
          [
            'contactChoice',
            'id',
            'listingsAvailable',
            'publicName',
            'serviceAreas',
            'story',
          ].sort(),
        );
        assert.equal(
          await db.transaction((c) => requirePublishableHost(c, a.user.id)),
          host.id,
        );
        await owner.query(
          "UPDATE public.hosts SET approved_until='2000-01-01' WHERE id=$1",
          [host.id],
        );
        assert.equal(
          (await app.inject(`/v1/hosts/${host.id}`)).statusCode,
          404,
        );
        await assert.rejects(
          db.transaction((c) => requirePublishableHost(c, a.user.id)),
        );
        await owner.query(
          "UPDATE public.hosts SET approved_until='2099-01-01' WHERE id=$1",
          [host.id],
        );
        await owner.query(
          "UPDATE public.users SET status='suspended' WHERE id=$1",
          [a.user.id],
        );
        assert.equal(
          (await app.inject(`/v1/hosts/${host.id}`)).statusCode,
          404,
        );
        await assert.rejects(
          db.transaction((c) => requirePublishableHost(c, a.user.id)),
        );
        await owner.query(
          "UPDATE public.users SET status='active' WHERE id=$1",
          [a.user.id],
        );
        await admin();
        assert.equal(
          (await decide(host.id, host.revision, 'suspended')).statusCode,
          200,
        );
        assert.equal(
          (await app.inject(`/v1/hosts/${host.id}`)).statusCode,
          404,
        );
        await assert.rejects(
          db.transaction((c) => requirePublishableHost(c, a.user.id)),
        );
        assert.equal(
          (await app.inject({ url: '/v1/me/host', headers: ah })).json().data
            .status,
          'suspended',
        );
      } finally {
        await app.close();
      }
    },
  );
  await t.test(
    'audit failure rolls back decisions and runtime cannot rewrite review history',
    async () => {
      const { app, draft, submit, admin, decide } = await setup();
      try {
        let host = await draft();
        host = (await submit(host.revision)).json().data;
        await admin();
        await owner.query('REVOKE INSERT ON public.audit_logs FROM sikkim_app');
        try {
          assert.equal((await decide(host.id, host.revision)).statusCode, 500);
        } finally {
          await owner.query('GRANT INSERT ON public.audit_logs TO sikkim_app');
        }
        assert.equal(
          (
            await owner.query('SELECT status FROM public.hosts WHERE id=$1', [
              host.id,
            ])
          ).rows[0].status,
          'pending',
        );
        assert.equal(
          (
            await owner.query(
              'SELECT * FROM public.host_verifications WHERE host_id=$1',
              [host.id],
            )
          ).rowCount,
          1,
        );
        await assert.rejects(
          db.transaction((c) =>
            c.query('DELETE FROM public.host_verifications'),
          ),
          /permission denied/,
        );
      } finally {
        await app.close();
      }
    },
  );
  await t.test(
    'bounded directories paginate without repeats and exports contain only your host history',
    async () => {
      const { app, ah, bh, draft, submit, admin } = await setup();
      try {
        let host = await draft();
        host = (await submit(host.revision)).json().data;
        const exported = (
          await app.inject({ url: '/v1/me/export', headers: ah })
        ).json().data;
        assert.equal(exported.host.id, host.id);
        assert.equal(exported.host.history.length, 1);
        assert.equal(
          (await app.inject({ url: '/v1/me/export', headers: bh })).json().data
            .host,
          null,
        );
        await owner.query(`
          WITH
            new_users AS (
              INSERT INTO public.users (display_name)
              SELECT 'Public test host ' || n
              FROM generate_series(1, 23) n
              RETURNING id
            )
          INSERT INTO public.hosts (
              user_id,
              public_name,
              story,
              service_areas,
              status,
              approved_until
            )
          SELECT
            id,
            'Test host',
            'Test introduction',
            ARRAY['Pakyong'],
            'approved',
            '2099-01-01'
          FROM new_users
        `);
        const first = (await app.inject('/v1/hosts')).json();
        assert.equal(first.data.length, 20);
        assert.ok(first.page.nextCursor);
        const last = (
          await app.inject('/v1/hosts?after=' + first.page.nextCursor)
        ).json();
        assert.equal(last.data.length, 3);
        assert.equal(last.page.nextCursor, null);
        assert.equal(
          new Set([...first.data, ...last.data].map((h) => h.id)).size,
          23,
        );
        assert.equal(
          (await app.inject('/v1/hosts?after=invalid')).statusCode,
          400,
        );
        await admin();
        const queue = (
          await app.inject({
            url: '/v1/admin/hosts?status=pending',
            headers: bh,
          })
        ).json();
        assert.equal(queue.data.length, 1);
        assert.equal(queue.data[0].id, host.id);
        assert.equal(
          (
            await app.inject({
              url: '/v1/admin/hosts?status=approved',
              headers: bh,
            })
          ).json().data.length,
          20,
        );
      } finally {
        await app.close();
      }
    },
  );
});
