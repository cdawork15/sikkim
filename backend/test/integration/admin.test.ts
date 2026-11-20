import assert from 'node:assert/strict';
import test from 'node:test';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { createDatabase, poolOptions } from '../../src/db/database.js';
import { migrate } from '../../src/db/maintenance.js';
import { requirePublishableHost } from '../../src/hosts/service.js';

const TABLES = `
  public.user_reels, public.auth_otp_challenges, public.crm_lead_notes, public.crm_leads, public.community_photos,
  public.community_events, public.booking_changes, public.tickets,
  public.bookings, public.seat_holds, public.experience_slots,
  public.story_views, public.saved_items, public.experience_likes,
  public.story_items, public.stories, public.experience_media,
  public.media_assets, public.experience_categories,
  public.experience_reviews, public.recent_searches, public.experiences,
  public.policies, public.host_verifications, public.hosts,
  public.audit_logs, public.account_requests, public.user_consents,
  public.user_roles, public.user_interests, public.user_preferences,
  public.auth_sessions, public.auth_passwords, public.auth_identities,
  public.users
`;

test('admin workspace and curator CRM against isolated PostgreSQL', async (t) => {
  const url = process.env.MIGRATION_DATABASE_URL;
  assert.ok(url);
  const config = loadConfig({
    ...process.env,
    HOST_VERIFICATION_MODE: 'manual',
  });
  localDatabaseTarget('test', url);
  localDatabaseTarget('test', config.connectionString);
  const owner = new pg.Client(poolOptions(config, url));
  await owner.connect();
  t.after(() => owner.end());
  await migrate(config, url);
  await owner.query(`TRUNCATE ${TABLES}`);
  const app = await buildApp(config, { rateLimitMax: 10000 });
  t.after(() => app.close());

  const register = async (displayName: string, email: string) => {
    const r = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      payload: { displayName, email, password: 'correct horse battery' },
    });
    assert.equal(r.statusCode, 201, r.body);
    const data = r.json().data;
    return {
      id: data.user.id as string,
      headers: { authorization: `Bearer ${data.accessToken}` },
    };
  };
  const admin = await register('Asha Admin', 'asha@example.test');
  const host = await register('Dawa Lepcha', 'dawa@example.test');
  const traveller = await register('Mina Rai', 'mina@example.test');
  // The CRM operator here is a super admin (people and analytics need super).
  await owner.query(
    `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin'), ($1, 'super')`,
    [admin.id],
  );
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    who: { headers: Record<string, string> } | null,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url: '/v1' + path,
      ...(who ? { headers: who.headers } : {}),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  await t.test('only admins can reach the workspace', async () => {
    assert.equal((await call('GET', '/admin/overview', null)).statusCode, 401);
    for (const path of [
      '/admin/overview',
      '/admin/leads',
      '/admin/users',
      '/admin/bookings',
    ]) {
      const r = await call('GET', path, traveller);
      assert.equal(r.statusCode, 403, path);
      assert.equal(r.json().error.code, 'FORBIDDEN');
    }
    assert.equal((await call('GET', '/admin/overview', admin)).statusCode, 200);
  });

  await t.test(
    'curator leads: create, validate, update, notes, filters',
    async () => {
      const created = await call('POST', '/admin/leads', admin, {
        code: 'pkg-02',
        name: '  Studio Maato ',
        experienceIdea: 'Pottery with locals',
        district: 'Pakyong',
        phone: '+91 98000 00000',
        email: 'Studio@Example.TEST',
        contactSource: 'public-source number: confirm by phone',
      });
      assert.equal(created.statusCode, 201, created.body);
      const lead = created.json().data;
      assert.equal(lead.code, 'PKG-02');
      assert.equal(lead.name, 'Studio Maato');
      assert.equal(lead.email, 'studio@example.test');
      assert.equal(lead.stage, 'idea');
      assert.equal(lead.revision, 1);

      const duplicate = await call('POST', '/admin/leads', admin, {
        code: 'PKG-02',
        name: 'Another',
      });
      assert.equal(duplicate.statusCode, 409);
      assert.equal(duplicate.json().error.code, 'DUPLICATE');
      for (const bad of [
        { name: 'x', phone: 'call me' },
        { name: 'x', email: 'not-an-email' },
        { name: 'x', code: 'nope' },
        { name: '   ' },
        { name: 'x', stage: 'won' },
        { name: 'x', ownerId: traveller.id },
      ]) {
        assert.equal(
          (await call('POST', '/admin/leads', admin, bad)).statusCode,
          400,
          JSON.stringify(bad),
        );
      }

      const stale = await call('PATCH', `/admin/leads/${lead.id}`, admin, {
        revision: 99,
        stage: 'contacted',
      });
      assert.equal(stale.statusCode, 409);
      const updated = await call('PATCH', `/admin/leads/${lead.id}`, admin, {
        revision: 1,
        stage: 'contacted',
        ownerId: admin.id,
        contactConfirmed: true,
        nextFollowUp: '2020-01-01',
        verdict: 'list_in_pilot',
      });
      assert.equal(updated.statusCode, 200, updated.body);
      assert.equal(updated.json().data.revision, 2);
      assert.equal(updated.json().data.ownerName, 'Asha Admin');
      assert.equal(updated.json().data.nextFollowUp, '2020-01-01');

      const note = await call('POST', `/admin/leads/${lead.id}/notes`, admin, {
        kind: 'call',
        body: 'Agreed to send camera roll and rights note.',
      });
      assert.equal(note.statusCode, 201, note.body);
      const detail = (
        await call('GET', `/admin/leads/${lead.id}`, admin)
      ).json().data;
      assert.deepEqual(
        detail.notes.map((n: { kind: string }) => n.kind),
        ['call', 'stage', 'stage'],
      );
      assert.match(detail.notes[1].body, /Idea → Contacted/);

      await call('POST', '/admin/leads', admin, {
        code: 'GTK-05',
        name: 'Blue and Yellow Bakery',
        district: 'Gangtok',
      });
      const byDistrict = (
        await call('GET', '/admin/leads?district=gangtok', admin)
      ).json();
      assert.deepEqual(
        byDistrict.data.map((l: { code: string }) => l.code),
        ['GTK-05'],
      );
      const bySearch = (
        await call('GET', '/admin/leads?q=maato', admin)
      ).json();
      assert.equal(bySearch.data.length, 1);
      const wildcard = (await call('GET', '/admin/leads?q=%25', admin)).json();
      assert.equal(wildcard.data.length, 0, 'LIKE wildcards are literal');
      const due = (
        await call('GET', '/admin/leads?followUpDue=true', admin)
      ).json();
      assert.deepEqual(
        due.data.map((l: { code: string }) => l.code),
        ['PKG-02'],
      );
      assert.equal(
        (await call('GET', '/admin/leads?after=garbage', admin)).statusCode,
        400,
      );
    },
  );

  await t.test(
    'lead pages use an opaque cursor without gaps or repeats',
    async () => {
      for (let i = 0; i < 25; i += 1) {
        const r = await call('POST', '/admin/leads', admin, {
          name: `Village homestay ${i}`,
          district: 'Soreng',
        });
        assert.equal(r.statusCode, 201);
      }
      const first = (
        await call('GET', '/admin/leads?district=Soreng', admin)
      ).json();
      assert.equal(first.data.length, 20);
      assert.ok(first.page.nextCursor);
      const second = (
        await call(
          'GET',
          `/admin/leads?district=Soreng&after=${first.page.nextCursor}`,
          admin,
        )
      ).json();
      assert.equal(second.data.length, 5);
      assert.equal(second.page.nextCursor, null);
      const ids = new Set(
        [...first.data, ...second.data].map((l: { id: string }) => l.id),
      );
      assert.equal(ids.size, 25);
    },
  );

  await t.test(
    'real hosts are verified manually and can then publish',
    async () => {
      const draft = await call('PUT', '/me/host', host, {
        revision: 0,
        publicName: 'Dawa Lepcha',
        story: 'Potter in Aritar.',
        serviceAreas: ['Aritar'],
      });
      assert.equal(draft.statusCode, 200, draft.body);
      assert.equal(draft.json().data.realVerificationAvailable, true);
      const submitted = await call('POST', '/me/host/submit', host, {
        revision: draft.json().data.revision,
      });
      assert.equal(submitted.statusCode, 200, submitted.body);
      const pending = submitted.json().data;
      const decide = (extra: object) =>
        call('POST', `/admin/hosts/${pending.id}/decisions`, admin, {
          revision: pending.revision,
          action: 'approved',
          reason: 'Met in person at the studio; Aadhaar checked.',
          expiresAt: '2099-01-01T00:00:00Z',
          ...extra,
        });
      const noMethod = await decide({});
      assert.equal(noMethod.statusCode, 400);
      const approved = await decide({ method: 'in_person' });
      assert.equal(approved.statusCode, 200, approved.body);
      const history = approved.json().data.history;
      assert.equal(history.at(-1).method, 'in_person');
      const db = createDatabase(config, () => {});
      try {
        await db.transaction((client) =>
          requirePublishableHost(client, host.id),
        );
      } finally {
        await db.close();
      }

      const leads = (await call('GET', '/admin/leads?q=maato', admin)).json()
        .data;
      const linked = await call('PATCH', `/admin/leads/${leads[0].id}`, admin, {
        revision: leads[0].revision,
        hostId: pending.id,
        stage: 'onboarding',
      });
      assert.equal(linked.statusCode, 200, linked.body);
      assert.equal(linked.json().data.hostName, 'Dawa Lepcha');
    },
  );

  await t.test(
    'host verification stays closed when the mode is disabled',
    async () => {
      const closed = await buildApp(
        loadConfig({ ...process.env, HOST_VERIFICATION_MODE: 'disabled' }),
        { rateLimitMax: 10000 },
      );
      try {
        const r = await closed.inject({
          method: 'POST',
          url: '/v1/me/host/submit',
          headers: traveller.headers,
          payload: { revision: 0 },
        });
        // No host profile yet → 404; with one, the closed mode would answer 503.
        assert.ok([404, 503].includes(r.statusCode), r.body);
        const draft = await closed.inject({
          method: 'PUT',
          url: '/v1/me/host',
          headers: traveller.headers,
          payload: {
            revision: 0,
            publicName: 'Mina',
            story: 'Walks.',
            serviceAreas: ['Gangtok'],
          },
        });
        const submit = await closed.inject({
          method: 'POST',
          url: '/v1/me/host/submit',
          headers: traveller.headers,
          payload: { revision: draft.json().data.revision },
        });
        assert.equal(submit.statusCode, 503);
        assert.equal(submit.json().error.code, 'VERIFICATION_UNAVAILABLE');
      } finally {
        await closed.close();
      }
    },
  );

  await t.test('users: search, roles, suspension', async () => {
    const found = (await call('GET', '/admin/users?q=mina', admin)).json().data;
    assert.equal(found.length, 1);
    assert.equal(found[0].email, 'mina@example.test');
    assert.deepEqual(found[0].roles, []);

    const admins = (await call('GET', '/admin/users?role=admin', admin)).json()
      .data;
    assert.deepEqual(
      admins.map((u: { id: string }) => u.id),
      [admin.id],
    );
    // Roles are operator-only (npm run admin); the API exposes no grant route.
    assert.equal(
      (await call('PUT', `/admin/users/${traveller.id}/roles/admin`, admin))
        .statusCode,
      404,
    );
    const detail = (await call('GET', `/admin/users/${host.id}`, admin)).json()
      .data;
    assert.equal(detail.host.status, 'approved');
    assert.ok(detail.activeSessions >= 1);

    assert.equal((await call('GET', '/me', traveller)).statusCode, 200);
    const suspended = await call(
      'POST',
      `/admin/users/${traveller.id}/status`,
      admin,
      {
        status: 'suspended',
      },
    );
    assert.equal(suspended.statusCode, 200);
    assert.equal((await call('GET', '/me', traveller)).statusCode, 401);
    assert.equal(
      (
        await call('POST', `/admin/users/${admin.id}/status`, admin, {
          status: 'suspended',
        })
      ).statusCode,
      400,
    );
    const restored = await call(
      'POST',
      `/admin/users/${traveller.id}/status`,
      admin,
      {
        status: 'active',
      },
    );
    assert.equal(restored.json().data.status, 'active');

    const audit = await owner.query(
      `SELECT action FROM public.audit_logs WHERE entity_id = $1 ORDER BY created_at`,
      [traveller.id],
    );
    const actions = audit.rows.map((r) => r.action);
    for (const expected of ['admin.user_suspended', 'admin.user_active'])
      assert.ok(actions.includes(expected), expected);
  });

  await t.test(
    'overview reports live counts and the pilot tracker',
    async () => {
      const overview = (await call('GET', '/admin/overview', admin)).json()
        .data;
      assert.equal(overview.hosts.active, 1);
      assert.equal(overview.people.active, 3);
      const pakyong = overview.pipeline.tracker.find(
        (row: { district: string }) => row.district === 'Pakyong',
      );
      assert.deepEqual(
        {
          longlisted: pakyong.longlisted,
          rated: pakyong.rated,
          listInPilot: pakyong.listInPilot,
          onboardedOrLive: pakyong.onboardedOrLive,
        },
        { longlisted: 1, rated: 1, listInPilot: 1, onboardedOrLive: 1 },
      );
      assert.equal(
        overview.pipeline.stages.find(
          (s: { stage: string }) => s.stage === 'idea',
        ).count,
        26,
      );
      assert.equal(overview.pipeline.followUpsDue, 1);
      assert.equal(overview.bookings.last30Days.total, 0);
    },
  );

  await t.test('booking lookup validates filters', async () => {
    const r = await call(
      'GET',
      '/admin/bookings?q=SE-1&status=confirmed',
      admin,
    );
    assert.equal(r.statusCode, 200, r.body);
    assert.deepEqual(r.json().data, []);
    assert.equal(
      (await call('GET', '/admin/bookings?status=refunded', admin)).statusCode,
      400,
    );
  });
});
