import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { createDatabase, poolOptions } from '../../src/db/database.js';
import { migrate, seedId, seedOrReset } from '../../src/db/maintenance.js';
import { buildApp } from '../../src/app.js';

test(
  'isolated PostgreSQL: fresh/upgrade migrations, safe role, reset ' +
    'and outage recovery',
  async (t) => {
    const config = loadConfig();
    const migrationUrl = process.env.MIGRATION_DATABASE_URL;
    assert.ok(
      migrationUrl,
      'Set MIGRATION_DATABASE_URL for the disposable test database',
    );
    assert.equal(config.mode, 'test');
    localDatabaseTarget('test', migrationUrl);
    localDatabaseTarget('test', config.connectionString);
    const owner = new pg.Client(poolOptions(config, migrationUrl));
    await owner.connect();
    t.after(() => owner.end());
    const marker = await owner.query(
      `
      SELECT shobj_description(oid, 'pg_database') AS marker
      FROM pg_database
      WHERE datname = current_database()
    `,
    );
    assert.equal(
      marker.rows[0].marker,
      'sikkim-local-only',
      'Refusing to reset an unmarked database',
    );
    await owner.query(
      `
      DROP TABLE IF EXISTS public.user_reels, public.auth_otp_challenges, public.crm_ai_runs, public.crm_tasks, public.crm_lead_notes, public.crm_leads, public.community_messages, public.community_members, public.community_photos, public.community_events, public.booking_changes,
        public.tickets,
        public.bookings,
        public.seat_holds,
        public.experience_slots,
        public.story_views,
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
      public.categories,
      public.areas,
      public.host_verifications,
      public.hosts,
      public.account_requests,
      public.user_consents,
      public.user_roles,
      public.user_interests,
      public.user_preferences,
      public.auth_sessions,
      public.auth_passwords,
      public.auth_identities,
      public.audit_logs,
      public.users,
      public.interests,
      public.schema_migrations
    `,
    );

    const app = await buildApp(config);
    t.after(() => app.close());
    await t.test(
      'missing migrations report unavailable without leaking SQL',
      async () => {
        const response = await app.inject('/v1/health/ready');
        assert.equal(response.statusCode, 503);
        assert.doesNotMatch(response.body, /relation|schema_migrations|SELECT/);
      },
    );

    await t.test(
      'initial migration preserves records when upgraded; running again is a no-op',
      async () => {
        await migrate(config, migrationUrl, 1);
        const id = randomUUID();
        await owner.query(
          `
          INSERT INTO public.audit_logs (id, action, entity_type, entity_id, request_id)
          VALUES
            ($1, 'test.created', 'system', $1, $1)
        `,
          [id],
        );
        assert.equal((await app.inject('/v1/health/ready')).statusCode, 503);
        await migrate(config, migrationUrl);
        await migrate(config, migrationUrl);
        assert.equal(
          (
            await owner.query(
              'SELECT count(*)::int AS count FROM public.schema_migrations',
            )
          ).rows[0].count,
          15,
        );
        assert.equal(
          (
            await owner.query('SELECT id FROM public.audit_logs WHERE id=$1', [
              id,
            ])
          ).rowCount,
          1,
        );
        assert.equal((await app.inject('/v1/health/ready')).statusCode, 200);
        const indexes = await owner.query(
          "SELECT indexname FROM pg_indexes WHERE tablename='audit_logs'",
        );
        assert.equal(indexes.rowCount, 3);
      },
    );

    await t.test(
      'application role can append/read audit events but cannot rewrite history or schema',
      async () => {
        const runtime = new pg.Client(poolOptions(config));
        await runtime.connect();
        try {
          const id = randomUUID();
          await runtime.query(
            `
            INSERT INTO public.audit_logs (action, entity_type, entity_id, request_id)
            VALUES
              ('test.created', 'system', $1, $1)
          `,
            [id],
          );
          assert.ok(
            (await runtime.query('SELECT * FROM public.audit_logs')).rowCount,
          );
          for (const sql of [
            "UPDATE public.audit_logs SET action='changed'",
            'DELETE FROM public.audit_logs',
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
            public.audit_logs
          `,
            'CREATE TABLE public.should_fail(id int)',
            'CREATE DATABASE should_fail',
          ]) {
            await assert.rejects(runtime.query(sql), /permission denied/);
          }
          await assert.rejects(
            runtime.query(
              `
              INSERT INTO public.audit_logs (action, entity_type, entity_id, request_id)
              VALUES
                ('private message text', 'system', $1, $1)
            `,
              [id],
            ),
            /check constraint/,
          );
          await assert.rejects(
            runtime.query(
              `
              INSERT INTO public.audit_logs (action, entity_type, entity_id, request_id)
              VALUES
                ('test.created', 'system', 'not-a-uuid', $1)
            `,
              [id],
            ),
            /uuid/,
          );
          assert.equal(
            (await runtime.query('SHOW timezone')).rows[0].TimeZone,
            'UTC',
          );
        } finally {
          await runtime.end();
        }
      },
    );

    await t.test(
      'privileged runtime credentials are rejected by readiness',
      async () => {
        const privileged = createDatabase(
          { ...config, connectionString: migrationUrl },
          () => {},
        );
        try {
          await assert.rejects(privileged.ready(), /not ready/);
        } finally {
          await privileged.close();
        }
      },
    );

    await t.test(
      'seed is repeatable; reset needs exact name, local environment and database marker',
      async () => {
        await seedOrReset(config, migrationUrl);
        await seedOrReset(config, migrationUrl);
        assert.equal(
          (
            await owner.query(
              'SELECT count(*)::int AS count FROM public.audit_logs WHERE id=$1',
              [seedId],
            )
          ).rows[0].count,
          1,
        );
        await assert.rejects(
          seedOrReset(config, migrationUrl, 'wrong'),
          /exact database/,
        );
        await assert.rejects(
          seedOrReset(
            { ...config, mode: 'production' },
            migrationUrl,
            'sikkim_test',
          ),
          /restricted/,
        );
        await owner.query('COMMENT ON DATABASE sikkim_test IS NULL');
        try {
          await assert.rejects(
            seedOrReset(config, migrationUrl, 'sikkim_test'),
            /not marked/,
          );
        } finally {
          await owner.query(
            "COMMENT ON DATABASE sikkim_test IS 'sikkim-local-only'",
          );
        }
        await seedOrReset(config, migrationUrl, 'sikkim_test');
        assert.equal(
          (
            await owner.query(
              'SELECT count(*)::int AS count FROM public.audit_logs',
            )
          ).rows[0].count,
          1,
        );
        assert.equal(
          (
            await owner.query(
              'SELECT count(*)::int AS count FROM public.schema_migrations',
            )
          ).rows[0].count,
          15,
        );
      },
    );

    await t.test(
      'connection outage returns promptly and recovery is possible',
      async () => {
        const url = new URL(config.connectionString);
        url.port = '1';
        const offline = await buildApp({
          ...config,
          connectionString: url.toString(),
        });
        try {
          const response = await offline.inject('/v1/health/ready');
          assert.equal(response.statusCode, 503);
          assert.doesNotMatch(response.body, /ECONNREFUSED|password|postgres/);
          assert.equal(
            (await offline.inject('/v1/health/live')).statusCode,
            200,
          );
        } finally {
          await offline.close();
        }
        assert.equal((await app.inject('/v1/health/ready')).statusCode, 200);
      },
    );
    await t.test(
      'all migrations also work together on a fresh database',
      async () => {
        await owner.query(
          `
          DROP TABLE public.user_reels, public.auth_otp_challenges, public.crm_ai_runs, public.crm_tasks, public.crm_lead_notes, public.crm_leads, public.community_messages, public.community_members, public.community_photos, public.community_events, public.booking_changes,
          public.tickets,
          public.bookings,
          public.seat_holds,
          public.experience_slots,
          public.story_views,
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
          public.categories,
          public.areas,
          public.host_verifications,
          public.hosts,
          public.account_requests,
          public.user_consents,
          public.user_roles,
          public.user_interests,
          public.user_preferences,
          public.auth_sessions,
          public.auth_passwords,
          public.auth_identities,
          public.audit_logs,
          public.users,
          public.interests,
          public.schema_migrations
        `,
        );
        await migrate(config, migrationUrl);
        assert.equal(
          (
            await owner.query(
              'SELECT count(*)::int AS count FROM public.schema_migrations',
            )
          ).rows[0].count,
          15,
        );
        assert.equal(
          (
            await owner.query(
              'SELECT count(*)::int AS count FROM public.audit_logs',
            )
          ).rows[0].count,
          0,
        );
        assert.equal((await app.inject('/v1/health/ready')).statusCode, 200);
      },
    );
  },
);
