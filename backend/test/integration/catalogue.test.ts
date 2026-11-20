import type { LightMyRequestResponse } from 'fastify';
import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { poolOptions } from '../../src/db/database.js';
import { migrate } from '../../src/db/maintenance.js';
import { browseQuery } from '../../src/catalogue/read.js';

const completeDraft = {
  title: 'Forest tea walk',
  description: 'A forest walk with a local guide and tea.',
  area: 'pakyong',
  categories: ['nature', 'hiking'],
  meetingPoint: 'Meet at the agreed village meeting point.',
  durationMinutes: 120,
  pricePaise: 50000,
  minParticipants: 1,
  maxParticipants: 8,
  difficulty: 'easy',
  accessibility: 'unknown',
  inclusions: ['Guide', 'Tea'],
  exclusions: ['Transport'],
  preparation: 'Bring drinking water.',
  policy: {
    cancellation: 'Test cancellation terms; not a real offer.',
    safety: 'Test safety terms; confirm conditions with the host.',
    participation: 'Test participation terms.',
  },
};

test('catalogue API and PostgreSQL rules', async (t) => {
  const config = loadConfig({ ...process.env, ENABLE_DEMO_AUTH: 'true' });
  const migrationUrl = process.env.MIGRATION_DATABASE_URL;
  assert.ok(migrationUrl);
  assert.equal(config.mode, 'test');
  localDatabaseTarget('test', config.connectionString);
  localDatabaseTarget('test', migrationUrl);
  const owner = new pg.Client(poolOptions(config, migrationUrl));
  await owner.connect();
  t.after(() => owner.end());
  const marker = (
    await owner.query(
      `
        SELECT shobj_description(oid, 'pg_database') AS marker
        FROM pg_database
        WHERE datname = current_database()
      `,
    )
  ).rows[0].marker;
  assert.equal(marker, 'sikkim-local-only');
  await migrate(config, migrationUrl);

  async function setup(real = true) {
    await owner.query(`
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
    `);
    await owner.query('UPDATE public.areas SET active=true');
    await owner.query('UPDATE public.categories SET active=true');
    const app = await buildApp(config, { rateLimitMax: 1000 });
    const login = async (account: string) => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/auth/demo',
        payload: { account },
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().data;
    };
    const hostUser = await login('traveller-one');
    const reviewer = await login('traveller-two');
    const hostHeaders = { authorization: `Bearer ${hostUser.accessToken}` };
    const reviewerHeaders = { authorization: `Bearer ${reviewer.accessToken}` };
    // Owner-only fixtures model a future verified real account. No API skips verification.
    if (real) {
      await owner.query('UPDATE public.users SET is_demo=false WHERE id=$1', [
        hostUser.user.id,
      ]);
    }
    const host = (
      await owner.query(
        `
          INSERT INTO public.hosts (
              user_id,
              public_name,
              story,
              service_areas,
              status,
              approved_until
            )
          VALUES
            (
              $1,
              'Test host',
              'A test host',
              ARRAY['Pakyong'],
              'approved',
              '2099-01-01'
            )
          RETURNING id
        `,
        [hostUser.user.id],
      )
    ).rows[0];
    const grantReviewer = () =>
      owner.query(
        `
          INSERT INTO public.user_roles (user_id, role)
          VALUES
            ($1, 'admin')
          ON CONFLICT DO NOTHING
        `,
        [reviewer.user.id],
      );
    const create = async (overrides = {}) => {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/me/experiences',
        headers: hostHeaders,
        payload: { ...completeDraft, ...overrides },
      });
      assert.equal(response.statusCode, 201, response.body);
      return response.json().data;
    };
    const submit = (id: string, revision: number) =>
      app.inject({
        method: 'POST',
        url: `/v1/me/experiences/${id}/submit`,
        headers: hostHeaders,
        payload: { revision },
      });
    const review = (
      id: string,
      revision: number,
      action = 'published',
      extra = {},
    ) =>
      app.inject({
        method: 'POST',
        url: `/v1/admin/experiences/${id}/decisions`,
        headers: reviewerHeaders,
        payload: {
          revision,
          action,
          reason: 'Checked test offer.',
          ...(action === 'published'
            ? {
                providerReference:
                  'Private provider confirmation for test only.',
              }
            : {}),
          ...extra,
        },
      });
    const publish = async (overrides = {}, decision = {}) => {
      let item = await create(overrides);
      const submitted = await submit(item.id, item.revision);
      assert.equal(submitted.statusCode, 200, submitted.body);
      item = submitted.json().data;
      await grantReviewer();
      const response = await review(
        item.id,
        item.revision,
        'published',
        decision,
      );
      assert.equal(response.statusCode, 200, response.body);
      return response.json().data;
    };
    return {
      app,
      hostUser,
      reviewer,
      host,
      hostHeaders,
      reviewerHeaders,
      create,
      submit,
      review,
      publish,
      grantReviewer,
    };
  }

  await t.test(
    'ownership, strict drafts, incomplete submission and safe reviewer access',
    async () => {
      const { app, hostHeaders, reviewerHeaders, create, submit, review } =
        await setup();
      try {
        assert.equal(
          (
            await app.inject({
              method: 'POST',
              url: '/v1/me/experiences',
              payload: completeDraft,
            })
          ).statusCode,
          401,
        );
        const item = await create();
        assert.equal(
          (
            await app.inject({
              url: `/v1/me/experiences/${item.id}`,
              headers: reviewerHeaders,
            })
          ).statusCode,
          404,
        );
        assert.equal(
          (
            await app.inject({
              method: 'PUT',
              url: `/v1/me/experiences/${item.id}`,
              headers: reviewerHeaders,
              payload: { ...completeDraft, revision: item.revision },
            })
          ).statusCode,
          403,
        );
        assert.equal((await review(item.id, item.revision)).statusCode, 403);
        for (const extra of [
          { status: 'published' },
          { hostId: item.hostId },
          { pricePaise: -1 },
          { pricePaise: '50000' },
          { minParticipants: 11, maxParticipants: 8 },
          { durationMinutes: 0 },
          { categories: ['bad'] },
          { categories: ['nature', 'nature'] },
          { area: 'missing' },
          { title: '  ' },
        ]) {
          const response = await app.inject({
            method: 'POST',
            url: '/v1/me/experiences',
            headers: hostHeaders,
            payload: { ...completeDraft, ...extra },
          });
          assert.equal(response.statusCode, 400, response.body);
        }
        const draft = await create({ description: '' });
        assert.equal((await submit(draft.id, draft.revision)).statusCode, 400);
        const submitted = await submit(item.id, item.revision);
        assert.equal(submitted.statusCode, 200, submitted.body);
        assert.equal(
          (
            await app.inject({
              method: 'PUT',
              url: `/v1/me/experiences/${item.id}`,
              headers: hostHeaders,
              payload: {
                ...completeDraft,
                revision: submitted.json().data.revision,
              },
            })
          ).statusCode,
          409,
        );
        assert.deepEqual((await app.inject('/v1/experiences')).json().data, []);
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'publish, details, home and host listings expose only safe approved content',
    async () => {
      const { app, host, publish } = await setup();
      try {
        const item = await publish(
          {
            sourceKind: 'district',
            sourceReference: 'Private district source notes.',
          },
          { sourceVerified: true, featuredRank: 1 },
        );
        const response = await app.inject(`/v1/experiences/${item.slug}`);
        assert.equal(response.statusCode, 200, response.body);
        const detail = response.json().data;
        assert.equal(detail.pricePaise, 50000);
        assert.equal(detail.durationMinutes, 120);
        assert.equal(detail.policy.version, 1);
        assert.equal(detail.rating, null);
        assert.equal(detail.accessibility, 'unknown');
        assert.equal(detail.availability.bookable, false);
        assert.deepEqual(detail.media, []);
        for (const forbidden of [
          'sourceReference',
          'providerReference',
          'Private district',
          'Private provider',
          'search_document',
          'actor_id',
        ]) {
          assert.equal(response.body.includes(forbidden), false);
        }
        assert.equal(
          (await app.inject(`/v1/hosts/${host.id}/experiences`)).json().data[0]
            .id,
          item.id,
        );
        assert.equal(
          (await app.inject(`/v1/hosts/${host.id}`)).json().data
            .listingsAvailable,
          true,
        );
        const home = (await app.inject('/v1/home')).json().data;
        assert.equal(home.recommendationMethod, 'team_curated');
        assert.equal(home.rows[0].experiences[0].id, item.id);
        assert.equal(
          (await app.inject('/v1/search/suggestions?q=Fore')).json().data[0].id,
          item.id,
        );
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'district proposals need provider and source confirmation; ' +
      'reviewers cannot publish their own offers',
    async () => {
      const {
        app,
        hostUser,
        hostHeaders,
        create,
        submit,
        review,
        grantReviewer,
      } = await setup();
      try {
        let item = await create({
          sourceKind: 'district',
          sourceReference: 'District reference.',
        });
        item = (await submit(item.id, item.revision)).json().data;
        await grantReviewer();
        assert.equal((await review(item.id, item.revision)).statusCode, 400);
        assert.equal(
          (
            await review(item.id, item.revision, 'published', {
              providerReference: '',
              sourceVerified: true,
            })
          ).statusCode,
          400,
        );
        await owner.query(
          "INSERT INTO public.user_roles(user_id,role) VALUES($1,'admin')",
          [hostUser.user.id],
        );
        const self = await app.inject({
          method: 'POST',
          url: `/v1/admin/experiences/${item.id}/decisions`,
          headers: hostHeaders,
          payload: {
            revision: item.revision,
            action: 'published',
            reason: 'Self',
            providerReference: 'Self',
            sourceVerified: true,
          },
        });
        assert.equal(self.statusCode, 403);
        assert.equal(
          (
            await review(item.id, item.revision, 'published', {
              sourceVerified: true,
            })
          ).statusCode,
          200,
        );
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'demo, suspended, expired and inactive-area/category offers never leak through public reads',
    async () => {
      const demo = await setup(false);
      try {
        let item = await demo.create();
        item = (await demo.submit(item.id, item.revision)).json().data;
        await demo.grantReviewer();
        assert.equal(
          (await demo.review(item.id, item.revision)).statusCode,
          403,
        );
        await owner.query(
          `
            UPDATE public.experiences
            SET
              status = 'published',
              published_at = clock_timestamp()
            WHERE id = $1
          `,
          [item.id],
        );
        assert.deepEqual(
          (await demo.app.inject('/v1/experiences')).json().data,
          [],
        );
      } finally {
        await demo.app.close();
      }
      const { app, hostUser, host, publish } = await setup();
      try {
        const item = await publish();
        const assertHidden = async () => {
          assert.equal(
            (await app.inject(`/v1/experiences/${item.slug}`)).statusCode,
            404,
          );
          assert.deepEqual(
            (await app.inject('/v1/experiences?q=forest')).json().data,
            [],
          );
          assert.deepEqual(
            (await app.inject('/v1/search/suggestions?q=Fore')).json().data,
            [],
          );
          assert.deepEqual(
            (await app.inject(`/v1/hosts/${host.id}/experiences`)).json().data,
            [],
          );
          assert.ok(
            (await app.inject('/v1/home'))
              .json()
              .data.rows.every(
                (row: { experiences: unknown[] }) =>
                  row.experiences.length === 0,
              ),
          );
        };
        await owner.query(
          "UPDATE public.hosts SET status='suspended' WHERE id=$1",
          [host.id],
        );
        await assertHidden();
        await owner.query(
          `
            UPDATE public.hosts
            SET
              status = 'approved',
              approved_until = '2000-01-01'
            WHERE id = $1
          `,
          [host.id],
        );
        await assertHidden();
        await owner.query(
          "UPDATE public.hosts SET approved_until='2099-01-01' WHERE id=$1",
          [host.id],
        );
        await owner.query(
          "UPDATE public.users SET status='deletion_requested' WHERE id=$1",
          [hostUser.user.id],
        );
        await assertHidden();
        await owner.query(
          "UPDATE public.users SET status='active' WHERE id=$1",
          [hostUser.user.id],
        );
        await owner.query(
          "UPDATE public.areas SET active=false WHERE code='pakyong'",
        );
        await assertHidden();
        await owner.query(
          "UPDATE public.areas SET active=true WHERE code='pakyong'",
        );
        await owner.query(
          "UPDATE public.categories SET active=false WHERE code='nature'",
        );
        await assertHidden();
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'changed price and policy require a fresh review; hide and rejection remain recoverable',
    async () => {
      const { app, hostHeaders, reviewerHeaders, publish, submit, review } =
        await setup();
      try {
        let item = await publish();
        const oldPolicyId = item.policy.id;
        const updatedDraft = {
          ...completeDraft,
          pricePaise: 75000,
          policy: {
            ...completeDraft.policy,
            cancellation: 'Revised test cancellation terms.',
          },
        };
        const update = await app.inject({
          method: 'PUT',
          url: `/v1/me/experiences/${item.id}`,
          headers: hostHeaders,
          payload: { ...updatedDraft, revision: item.revision },
        });
        assert.equal(update.statusCode, 200, update.body);
        const oldRevision = item.revision;
        item = update.json().data;
        assert.equal(item.status, 'draft');
        assert.equal(item.policy.version, 2);
        assert.notEqual(item.policy.id, oldPolicyId);
        assert.equal(
          (
            await owner.query(
              'SELECT cancellation FROM public.policies WHERE id=$1',
              [oldPolicyId],
            )
          ).rows[0].cancellation,
          completeDraft.policy.cancellation,
        );
        assert.equal(
          (await app.inject(`/v1/experiences/${item.slug}`)).statusCode,
          404,
        );
        assert.equal(
          (
            await app.inject({
              method: 'PUT',
              url: `/v1/me/experiences/${item.id}`,
              headers: hostHeaders,
              payload: { ...updatedDraft, revision: oldRevision },
            })
          ).statusCode,
          409,
        );
        item = (await submit(item.id, item.revision)).json().data;
        item = (await review(item.id, item.revision, 'rejected')).json().data;
        assert.equal(item.status, 'rejected');
        assert.equal(
          (
            await app.inject({
              url: `/v1/me/experiences/${item.id}`,
              headers: hostHeaders,
            })
          )
            .json()
            .data.history.at(-1).action,
          'rejected',
        );
        item = (await submit(item.id, item.revision)).json().data;
        item = (await review(item.id, item.revision)).json().data;
        assert.equal(
          (await app.inject(`/v1/experiences/${item.slug}`)).json().data
            .pricePaise,
          75000,
        );
        item = (await review(item.id, item.revision, 'hidden')).json().data;
        assert.equal(item.status, 'hidden');
        assert.equal(
          (await app.inject(`/v1/experiences/${item.slug}`)).statusCode,
          404,
        );
        const exported = (
          await app.inject({ url: '/v1/me/export', headers: hostHeaders })
        ).json().data.catalogue;
        assert.equal(exported.policies.length, 2);
        assert.equal(exported.experiences.length, 1);
        assert.equal(
          (
            await app.inject({ url: '/v1/me/export', headers: reviewerHeaders })
          ).json().data.catalogue.experiences.length,
          0,
        );
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'all sorts paginate stably; filters, unusual input and ' +
      'date availability are explicit',
    async () => {
      const { app, publish } = await setup();
      try {
        for (let i = 0; i < 7; i++) {
          await publish({
            title: `Forest tea walk ${i}`,
            pricePaise: (i % 3) * 10000,
            durationMinutes: 60 + i,
            accessibility: i === 0 ? 'accessible' : 'unknown',
            accessibilityNotes: i === 0 ? 'Step-free test route details.' : '',
          });
        }
        for (const sort of [
          'recommended',
          'price_asc',
          'price_desc',
          'duration',
          'newest',
        ]) {
          const ids = new Set<string>();
          let cursor: string | null = null;
          do {
            const response: LightMyRequestResponse = await app.inject(
              `/v1/experiences?sort=${sort}&limit=2${cursor ? '&cursor=' + cursor : ''}`,
            );
            assert.equal(response.statusCode, 200, response.body);
            const page: {
              data: { id: string }[];
              page: { nextCursor: string | null };
            } = response.json();
            for (const item of page.data) {
              assert.equal(ids.has(item.id), false);
              ids.add(item.id);
            }
            cursor = page.page.nextCursor;
          } while (cursor);
          assert.equal(ids.size, 7);
        }
        const first = (await app.inject('/v1/experiences?limit=2')).json();
        assert.equal(
          (
            await app.inject(
              `/v1/experiences?sort=price_asc&cursor=${first.page.nextCursor}`,
            )
          ).statusCode,
          400,
        );
        assert.equal(
          (
            await app.inject(
              '/v1/experiences?area=pakyong&category=nature' +
                '&accessibility=accessible&difficulty=easy&maxPricePaise=0',
            )
          ).json().data.length,
          1,
        );
        assert.equal(
          (await app.inject('/v1/experiences?q=forest%20tea')).json().data
            .length,
          7,
        );
        assert.equal(
          (await app.inject('/v1/experiences?area=unknown')).json().data.length,
          0,
        );
        for (const q of ['%', '_', "' OR 1=1 --", 'zzzznotpresent']) {
          assert.equal(
            (await app.inject('/v1/experiences?q=' + encodeURIComponent(q)))
              .statusCode,
            200,
          );
          assert.deepEqual(
            (
              await app.inject(
                '/v1/search/suggestions?q=' + encodeURIComponent(q),
              )
            ).json().data,
            [],
          );
        }
        for (const query of [
          'limit=0',
          'limit=101',
          'sort=invalid',
          'cursor=garbage',
          'minPricePaise=10&maxPricePaise=1',
          'maxPricePaise=2147483648',
          'date=2099-02-29',
          'q=%20',
          'unknown=x',
        ]) {
          assert.equal(
            (await app.inject('/v1/experiences?' + query)).statusCode,
            400,
            query,
          );
        }
        const date = await app.inject('/v1/experiences?date=2099-01-01');
        assert.equal(date.statusCode, 200);
        assert.deepEqual(date.json().data, []);
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'recent searches are opt-in, bounded, isolated and clearable; ' +
      'filter choices survive another session',
    async () => {
      const { app, hostHeaders, reviewerHeaders } = await setup();
      try {
        await app.inject('/v1/experiences?q=forest');
        assert.deepEqual(
          (
            await app.inject({ url: '/v1/me/searches', headers: hostHeaders })
          ).json().data.recent,
          [],
        );
        for (let i = 0; i < 12; i++) {
          assert.equal(
            (
              await app.inject({
                method: 'POST',
                url: '/v1/me/recent-searches',
                headers: hostHeaders,
                payload: { q: `Walk ${i}` },
              })
            ).statusCode,
            204,
          );
        }
        await app.inject({
          method: 'POST',
          url: '/v1/me/recent-searches',
          headers: hostHeaders,
          payload: { q: ' WALK 11 ' },
        });
        const searches = (
          await app.inject({ url: '/v1/me/searches', headers: hostHeaders })
        ).json().data;
        assert.equal(searches.recent.length, 10);
        assert.equal(searches.recent[0].query, 'walk 11');
        assert.deepEqual(
          (
            await app.inject({
              url: '/v1/me/searches',
              headers: reviewerHeaders,
            })
          ).json().data.recent,
          [],
        );
        const choices = {
          category: 'nature',
          minPricePaise: 0,
          maxPricePaise: 50000,
          sort: 'price_asc',
        };
        assert.equal(
          (
            await app.inject({
              method: 'PUT',
              url: '/v1/me/search-filters',
              headers: hostHeaders,
              payload: choices,
            })
          ).statusCode,
          200,
        );
        const reloaded = await buildApp(config);
        try {
          assert.deepEqual(
            (
              await reloaded.inject({
                url: '/v1/me/searches',
                headers: hostHeaders,
              })
            ).json().data.filters,
            choices,
          );
        } finally {
          await reloaded.close();
        }
        assert.equal(
          (
            await app.inject({ url: '/v1/me/export', headers: hostHeaders })
          ).json().data.catalogue.recentSearches.length,
          10,
        );
        assert.equal(
          (
            await app.inject({
              method: 'DELETE',
              url: '/v1/me/recent-searches',
              headers: hostHeaders,
            })
          ).statusCode,
          204,
        );
        assert.deepEqual(
          (
            await app.inject({ url: '/v1/me/searches', headers: hostHeaders })
          ).json().data.recent,
          [],
        );
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'concurrent decisions cannot double-publish; audit failure rolls ' +
      'back and policies remain immutable',
    async () => {
      const { app, create, submit, review, grantReviewer } = await setup();
      const runtime = new pg.Client(poolOptions(config));
      await runtime.connect();
      try {
        let item = await create();
        const submissions = await Promise.all([
          submit(item.id, item.revision),
          submit(item.id, item.revision),
        ]);
        assert.deepEqual(
          submissions.map((r) => r.statusCode).sort(),
          [200, 409],
        );
        item = submissions.find((r) => r.statusCode === 200)!.json().data;
        await grantReviewer();
        await owner.query('REVOKE INSERT ON public.audit_logs FROM sikkim_app');
        try {
          assert.equal((await review(item.id, item.revision)).statusCode, 500);
        } finally {
          await owner.query('GRANT INSERT ON public.audit_logs TO sikkim_app');
        }
        assert.equal(
          (
            await owner.query(
              'SELECT status FROM public.experiences WHERE id=$1',
              [item.id],
            )
          ).rows[0].status,
          'review',
        );
        const decisions = await Promise.all([
          review(item.id, item.revision),
          review(item.id, item.revision),
        ]);
        assert.deepEqual(decisions.map((r) => r.statusCode).sort(), [200, 409]);
        assert.equal(
          (
            await owner.query(
              'SELECT * FROM public.experience_reviews WHERE experience_id=$1',
              [item.id],
            )
          ).rowCount,
          2,
        );
        for (const query of [
          "UPDATE public.policies SET cancellation='changed'",
          'DELETE FROM public.policies',
          'DELETE FROM public.experience_reviews',
        ]) {
          await assert.rejects(runtime.query(query), /permission denied/);
        }
      } finally {
        await runtime.end();
        await app.close();
      }
    },
  );

  await t.test(
    'two reviewers who also host can review each other without deadlocking',
    async () => {
      const {
        app,
        hostUser,
        reviewer,
        hostHeaders,
        reviewerHeaders,
        create,
        submit,
        review,
        grantReviewer,
      } = await setup();
      try {
        await grantReviewer();
        await owner.query(
          "INSERT INTO public.user_roles(user_id,role) VALUES($1,'admin')",
          [hostUser.user.id],
        );
        await owner.query('UPDATE public.users SET is_demo=false WHERE id=$1', [
          reviewer.user.id,
        ]);
        await owner.query(
          `
            INSERT INTO public.hosts (user_id, public_name, status, approved_until)
            VALUES
              ($1, 'Second test host', 'approved', '2099-01-01')
          `,
          [reviewer.user.id],
        );
        let first = await create();
        first = (await submit(first.id, first.revision)).json().data;
        const created = await app.inject({
          method: 'POST',
          url: '/v1/me/experiences',
          headers: reviewerHeaders,
          payload: completeDraft,
        });
        assert.equal(created.statusCode, 201, created.body);
        let second = created.json().data;
        const submitted = await app.inject({
          method: 'POST',
          url: `/v1/me/experiences/${second.id}/submit`,
          headers: reviewerHeaders,
          payload: { revision: second.revision },
        });
        assert.equal(submitted.statusCode, 200, submitted.body);
        second = submitted.json().data;
        const decisions = await Promise.all([
          review(first.id, first.revision),
          app.inject({
            method: 'POST',
            url: `/v1/admin/experiences/${second.id}/decisions`,
            headers: hostHeaders,
            payload: {
              revision: second.revision,
              action: 'published',
              reason: 'Test review',
              providerReference: 'Test provider',
            },
          }),
        ]);
        assert.ok(decisions.some((response) => response.statusCode === 200));
        for (const response of decisions) {
          assert.ok([200, 409].includes(response.statusCode), response.body);
          if (response.statusCode === 409) {
            assert.equal(response.json().error.code, 'REVIEW_BUSY');
          }
        }
      } finally {
        await app.close();
      }
    },
  );

  await t.test(
    'representative 10000-offer search and filter query plans',
    async () => {
      const { app } = await setup();
      try {
        await owner.query(`
          WITH
            people AS (
              INSERT INTO public.users (display_name)
              SELECT 'Benchmark host ' || n
              FROM generate_series(1, 49) n
              RETURNING id
            )
          INSERT INTO public.hosts (user_id, public_name, status, approved_until)
          SELECT
            id,
            'Benchmark host',
            'approved',
            '2099-01-01'
          FROM people
        `);
        await owner.query(`
          INSERT INTO public.experiences (
              host_id,
              slug,
              title,
              description,
              area_code,
              meeting_point,
              duration_minutes,
              price_paise,
              status,
              published_at,
              accessibility
            )
          SELECT
            h.id,
            'benchmark-' || n,
            CASE
              WHEN n % 50 = 0 THEN 'Orchid forest walk '
              ELSE 'Mountain village walk '
            END || n,
            'Local test experience',
            CASE
              WHEN n % 2 = 0 THEN 'pakyong'
              ELSE 'gangtok'
            END,
            'Test meeting point',
            60 + n % 240,
            n % 1000 * 100,
            'published',
            clock_timestamp(),
            CASE
              WHEN n % 3 = 0 THEN 'accessible'
              ELSE 'unknown'
            END
          FROM generate_series(1, 10000) n
            JOIN (
              SELECT
                id,
                row_number() OVER (
                  ORDER BY id
                ) -1 AS position
              FROM public.hosts
            ) h ON h.position = n % 50
        `);
        await owner.query(`
          INSERT INTO public.policies (
              experience_id,
              version,
              cancellation,
              safety,
              participation
            )
          SELECT
            id,
            1,
            'Test cancellation',
            'Test safety',
            'Test participation'
          FROM public.experiences
        `);
        await owner.query(
          `
            UPDATE public.experiences e
            SET
              policy_id = p.id
            FROM public.policies p
            WHERE p.experience_id = e.id
          `,
        );
        await owner.query(
          `
            INSERT INTO public.experience_categories
            SELECT
              id,
              CASE
                WHEN split_part(slug, '-', 2)::int % 3 = 0 THEN 'nature'
                WHEN split_part(slug, '-', 2)::int % 3 = 1 THEN 'culture'
                ELSE 'hiking'
              END
            FROM public.experiences
          `,
        );
        await owner.query('ANALYZE public.experiences');
        await owner.query('ANALYZE public.experience_categories');
        const query = browseQuery(
          {
            q: 'orchid',
            area: 'pakyong',
            category: 'nature',
            sort: 'price_asc',
          },
          20,
          undefined,
        );
        const plan = (
          await owner.query(
            'EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ' + query.text,
            query.values,
          )
        ).rows[0]['QUERY PLAN'][0];
        const timings: number[] = [];
        for (let i = 0; i < 20; i++) {
          const start = performance.now();
          const response = await app.inject(
            '/v1/experiences?q=orchid&area=pakyong&category=nature&sort=price_asc',
          );
          timings.push(performance.now() - start);
          assert.equal(response.statusCode, 200, response.body);
          assert.equal(response.json().data.length, 20);
        }
        timings.sort((a, b) => a - b);
        t.diagnostic(
          `Local 10000-offer / 50-host benchmark: API p95=${timings[18]!.toFixed(2)}ms; ` +
            `PostgreSQL execution=${plan['Execution Time']}ms; ` +
            `plan uses search index=${JSON.stringify(plan).includes('experiences_search_idx')}. ` +
            'This is not a staging SLA.',
        );
        assert.ok(
          (
            await owner.query(
              "SELECT 1 FROM pg_indexes WHERE indexname='experiences_search_idx'",
            )
          ).rowCount,
        );
      } finally {
        await app.close();
      }
    },
  );
});
