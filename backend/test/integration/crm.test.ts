import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import {
  AssistantError,
  type LeadAssistant,
  type LeadContext,
} from '../../src/ai/assistant.js';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { poolOptions } from '../../src/db/database.js';
import { migrate } from '../../src/db/maintenance.js';

const TABLES = `
  public.user_reels, public.auth_otp_challenges, public.crm_ai_runs, public.crm_tasks,
  public.crm_lead_notes, public.crm_leads, public.community_messages, public.community_members, public.community_photos,
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

const brief = {
  summary: 'Pottery studio in Pakyong; agreement signed, media pending.',
  nextAction: 'Collect the photos this week.',
  risks: ['No photos yet'],
  followUpMessage:
    'Namaste! Could you share a few photos? — Sikkim Experiences team',
  assessment: {
    uniqueness: { rating: 4, reason: 'Rare craft' },
    story: { rating: 4, reason: 'Family studio' },
    readiness: { rating: 3, reason: 'Needs guidance' },
    access: { rating: null, reason: 'Road access not recorded' },
    safety: { rating: 4, reason: 'Indoor studio' },
    photo: { rating: 5, reason: 'Very visual' },
  },
  confidence: 'medium' as const,
};

test('CRM scoring, automation, tasks, reports and AI brief', async (t) => {
  const url = process.env.MIGRATION_DATABASE_URL;
  assert.ok(url);
  const config = loadConfig({
    ...process.env,
    AI_PROVIDER: 'disabled',
    AI_ASSIST_HOURLY_LIMIT: '2',
  });
  localDatabaseTarget('test', url);
  localDatabaseTarget('test', config.connectionString);
  const owner = new pg.Client(poolOptions(config, url));
  await owner.connect();
  t.after(() => owner.end());
  await migrate(config, url);
  await owner.query(`TRUNCATE ${TABLES}`);
  const app = await buildApp(config, { rateLimitMax: 10000, assistant: null });
  t.after(() => app.close());

  const contexts: LeadContext[] = [];
  let behaviour: 'ok' | 'invalid' | 'down' = 'ok';
  const fake: LeadAssistant = {
    provider: 'anthropic',
    model: 'claude-opus-5-5',
    async brief(context) {
      contexts.push(context);
      if (behaviour === 'invalid')
        throw new AssistantError('invalid_output', 'bad');
      if (behaviour === 'down') throw new AssistantError('unavailable', 'down');
      return {
        brief,
        model: 'claude-opus-5-5',
        inputTokens: 900,
        outputTokens: 300,
      };
    },
  };
  const aiApp = await buildApp(config, {
    rateLimitMax: 10000,
    assistant: fake,
  });
  t.after(() => aiApp.close());

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
  const asha = await register('Asha Super', 'asha@example.test');
  const bina = await register('Bina Admin', 'bina@example.test');
  const traveller = await register('Mina Rai', 'mina@example.test');
  const hostUser = await register('Dawa Host', 'dawa@example.test');
  await owner.query(
    `INSERT INTO public.user_roles (user_id, role)
     VALUES ($1, 'admin'), ($1, 'super'), ($2, 'admin')`,
    [asha.id, bina.id],
  );
  type Who = { headers: Record<string, string> };
  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    who: Who | null,
    payload?: unknown,
    target = app,
  ) =>
    target.inject({
      method,
      url: '/v1' + path,
      ...(who ? { headers: who.headers } : {}),
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  const data = async (response: ReturnType<typeof call>, status = 200) => {
    const r = await response;
    assert.equal(r.statusCode, status, r.body);
    return r.json().data;
  };
  const istDate = (days: number) =>
    new Date(Date.now() + 330 * 60_000 + days * 86_400_000)
      .toISOString()
      .slice(0, 10);

  let studio: { id: string; revision: number };

  await t.test('new leads are routed and get the stage playbook', async () => {
    const first = await data(
      call('POST', '/admin/leads', asha, {
        name: 'Studio Maato',
        experienceIdea: 'Pottery with locals',
        district: 'Pakyong',
        phone: '+91 98000 00000',
        email: 'studio@example.test',
        ownerId: null,
      }),
      201,
    );
    // Nobody owns leads yet, so the earliest staff account gets it.
    assert.equal(first.ownerId, asha.id);
    assert.equal(first.nextFollowUp, istDate(3));
    assert.equal(first.score.band, 'cold');

    const second = await data(
      call('POST', '/admin/leads', asha, { name: 'Lepcha Weaves' }),
      201,
    );
    assert.equal(second.ownerId, bina.id, 'fewest open leads');
    const third = await data(
      call('POST', '/admin/leads', bina, {
        name: 'Pakyong Tea Walk',
        district: 'pakyong',
      }),
      201,
    );
    assert.equal(third.ownerId, asha.id, 'district owner first');
    const explicit = await data(
      call('POST', '/admin/leads', asha, {
        name: 'Assigned by hand',
        ownerId: bina.id,
        stage: 'interested',
      }),
      201,
    );
    assert.equal(explicit.ownerId, bina.id);

    const detail = await data(call('GET', `/admin/leads/${first.id}`, asha));
    assert.ok(
      detail.notes.some(
        (n: { kind: string; body: string }) =>
          n.kind === 'automation' &&
          /Assigned automatically to Asha/.test(n.body),
      ),
    );
    assert.equal(detail.tasks.length, 1);
    assert.equal(detail.tasks[0].source, 'automation');
    assert.equal(detail.tasks[0].status, 'open');
    assert.equal(detail.tasks[0].assigneeId, asha.id);
    assert.equal(detail.tasks[0].dueOn, istDate(3));
    assert.deepEqual(detail.assistant, { enabled: false, latest: null });
    const interested = await data(
      call('GET', `/admin/leads/${explicit.id}`, asha),
    );
    assert.match(interested.tasks[0].title, /assessment criteria/);
    studio = first;
  });

  await t.test(
    'stage moves replace automatic tasks; signing promotes',
    async () => {
      const moved = await data(
        call('PATCH', `/admin/leads/${studio.id}`, asha, {
          revision: studio.revision,
          stage: 'contacted',
        }),
      );
      let detail = await data(call('GET', `/admin/leads/${studio.id}`, asha));
      const open = detail.tasks.filter(
        (x: { status: string }) => x.status === 'open',
      );
      assert.equal(open.length, 1);
      assert.match(open[0].title, /confirm interest/);
      assert.ok(
        detail.tasks.some((x: { status: string }) => x.status === 'cancelled'),
      );

      const signed = await data(
        call('PATCH', `/admin/leads/${studio.id}`, asha, {
          revision: moved.revision,
          agreementSigned: true,
        }),
      );
      assert.equal(signed.stage, 'agreed');
      detail = await data(call('GET', `/admin/leads/${studio.id}`, asha));
      assert.ok(
        detail.notes.some((n: { body: string }) =>
          /Contacted → Agreed \(agreement signed\)/.test(n.body),
        ),
      );
      assert.ok(
        detail.tasks.some(
          (x: { status: string; title: string }) =>
            x.status === 'open' && /Collect photos/.test(x.title),
        ),
      );
      studio = signed;
    },
  );

  await t.test(
    'assessment ratings and expected value feed the score',
    async () => {
      const bad = await call('PATCH', `/admin/leads/${studio.id}`, asha, {
        revision: studio.revision,
        scoreUniqueness: 6,
      });
      assert.equal(bad.statusCode, 400);
      const rated = await data(
        call('PATCH', `/admin/leads/${studio.id}`, asha, {
          revision: studio.revision,
          scoreUniqueness: 5,
          scoreStory: 5,
          scoreReadiness: 4,
          scoreAccess: 4,
          scoreSafety: 5,
          scorePhoto: 5,
          contactConfirmed: true,
          mediaReceived: true,
          verdict: 'list_in_pilot',
          expectedMonthlyPaise: 500000,
        }),
      );
      assert.equal(rated.expectedMonthlyPaise, 500000);
      assert.equal(rated.score.assessed, 6);
      assert.equal(rated.score.score, 85);
      assert.equal(rated.score.band, 'hot');
      const list = await data(call('GET', '/admin/leads?stage=agreed', bina));
      assert.equal(list[0].score.score, 85);
      studio = rated;
    },
  );

  let taskId = '';
  await t.test('tasks: create, list, complete, reopen', async () => {
    assert.equal(
      (
        await call('POST', `/admin/leads/${studio.id}/tasks`, traveller, {
          title: 'x',
        })
      ).statusCode,
      403,
    );
    const bad = await call('POST', `/admin/leads/${studio.id}/tasks`, asha, {
      title: 'Visit',
      assigneeId: traveller.id,
    });
    assert.equal(bad.statusCode, 400);
    const task = await data(
      call('POST', `/admin/leads/${studio.id}/tasks`, asha, {
        title: 'Send the photo brief',
        dueOn: istDate(-1),
      }),
      201,
    );
    assert.equal(task.assigneeId, asha.id, 'defaults to the lead owner');
    assert.equal(task.source, 'staff');
    taskId = task.id;

    const mine = await data(call('GET', '/admin/tasks', asha));
    assert.equal(mine[0].id, taskId, 'overdue first');
    assert.ok(
      mine.every((x: { assigneeId: string }) => x.assigneeId === asha.id),
    );
    const everyone = await data(
      call('GET', '/admin/tasks?scope=everyone', bina),
    );
    assert.ok(everyone.length > mine.length);
    const queue = await data(call('GET', '/admin/queue', asha));
    assert.ok(queue.tasksDue >= 1);

    await owner.query(
      `UPDATE public.crm_leads SET last_activity_at = clock_timestamp() - interval '40 days' WHERE id = $1`,
      [studio.id],
    );
    const done = await data(
      call('PATCH', `/admin/tasks/${taskId}`, bina, { status: 'done' }),
    );
    assert.equal(done.status, 'done');
    assert.ok(done.completedAt);
    const lead = await data(call('GET', `/admin/leads/${studio.id}`, asha));
    assert.ok(Date.now() - Date.parse(lead.lastActivityAt) < 60_000);
    assert.ok(
      lead.notes.some(
        (n: { kind: string; body: string }) =>
          n.kind === 'task' && n.body === 'Done: Send the photo brief',
      ),
    );
    const reopened = await data(
      call('PATCH', `/admin/tasks/${taskId}`, asha, {
        status: 'open',
        dueOn: istDate(2),
        title: 'Send the photo brief again',
      }),
    );
    assert.equal(reopened.completedAt, null);
    assert.equal(reopened.dueOn, istDate(2));
    assert.equal(
      (
        await call('PATCH', `/admin/tasks/${randomUUID()}`, asha, {
          status: 'done',
        })
      ).statusCode,
      404,
    );
  });

  await t.test('calendar and CSV integrations', async () => {
    const ics = await call('GET', '/admin/crm/tasks.ics', asha);
    assert.equal(ics.statusCode, 200);
    assert.match(String(ics.headers['content-type']), /^text\/calendar/);
    assert.match(String(ics.headers['content-disposition']), /attachment/);
    assert.match(ics.body, /SUMMARY:Send the photo brief again/);
    assert.match(ics.body, /BEGIN:VEVENT/);
    assert.equal(
      (await call('GET', '/admin/crm/tasks.ics', traveller)).statusCode,
      403,
    );

    assert.equal(
      (await call('GET', '/admin/crm/leads.csv', bina)).statusCode,
      403,
    );
    const csv = await call('GET', '/admin/crm/leads.csv', asha);
    assert.equal(csv.statusCode, 200);
    assert.match(String(csv.headers['content-type']), /^text\/csv/);
    const [header, ...rows] = csv.body.trim().split('\r\n');
    assert.match(header!, /^Tracker ID,Name,Experience idea/);
    assert.equal(rows.length, 4);
    assert.ok(
      rows.some(
        (row) => row.includes('Studio Maato') && row.includes(',85,hot,'),
      ),
    );
    assert.ok(rows.some((row) => row.includes("'+91 98000 00000")));
  });

  await t.test('report: health, team and revenue forecast', async () => {
    // One past booking (last month), one upcoming, one cancelled.
    const hostId = (
      await owner.query(
        `INSERT INTO public.hosts(user_id, public_name, status, approved_until)
         VALUES ($1, 'Studio host', 'approved', '2099-01-01') RETURNING id`,
        [hostUser.id],
      )
    ).rows[0].id;
    const experience = (
      await owner.query(
        `INSERT INTO public.experiences(host_id, slug, title, description, area_code,
           meeting_point, duration_minutes, price_paise, max_participants, source_reference)
         VALUES ($1, $2, 'Pottery', 'Clay', 'pakyong', 'Studio gate', 60, 150000, 8, '')
         RETURNING id`,
        [hostId, randomUUID()],
      )
    ).rows[0].id;
    const policy = (
      await owner.query(
        `INSERT INTO public.policies(experience_id, version, cancellation, safety, participation)
         VALUES ($1, 1, 'See the date-specific cancellation cutoff.', 'Wear shoes.', 'Attend with your group.')
         RETURNING id`,
        [experience],
      )
    ).rows[0].id;
    const monthStart = `(date_trunc('month', clock_timestamp() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
    const book = async (startsAt: string, quantity: number, status: string) => {
      const slot = (
        await owner.query(
          `INSERT INTO public.experience_slots(experience_id, request_key, request_hash,
             starts_at, ends_at, timezone, booking_deadline, cancellation_hours,
             reschedule_hours, capacity, price_paise, currency, policy_id, experience_revision)
           VALUES ($1, $2, repeat('a', 64), ${startsAt}, ${startsAt} + interval '1 hour',
             'Asia/Kolkata', ${startsAt} - interval '1 hour', 2, 2, 8, 150000, 'INR', $3, 1)
           RETURNING id`,
          [experience, randomUUID(), policy],
        )
      ).rows[0].id;
      const hold = (
        await owner.query(
          `INSERT INTO public.seat_holds(slot_id, user_id, request_key, quantity, expires_at, status)
           VALUES ($1, $2, $3, $4, clock_timestamp(), 'used') RETURNING id`,
          [slot, traveller.id, randomUUID(), quantity],
        )
      ).rows[0].id;
      await owner.query(
        `INSERT INTO public.bookings(reference, user_id, hold_id, experience_id, slot_id,
           quantity, contact_name, contact_email, guests, snapshot, confirmation_hash, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'Mina', 'mina@example.test', $7, '{}', repeat('b', 64), $8)`,
        [
          'SE-' + randomUUID().slice(0, 8).toUpperCase(),
          traveller.id,
          hold,
          experience,
          slot,
          quantity,
          JSON.stringify(
            Array.from({ length: quantity }, (_, i) => `Guest ${i}`),
          ),
          status,
        ],
      );
    };
    await book(`${monthStart} - interval '10 days'`, 2, 'confirmed');
    await book(`${monthStart} - interval '12 days'`, 3, 'cancelled');
    await book(`clock_timestamp() + interval '3 days'`, 1, 'confirmed');

    assert.equal(
      (await call('GET', '/admin/crm/report', bina)).statusCode,
      403,
    );
    const report = await data(call('GET', '/admin/crm/report', asha));
    assert.equal(report.scoring.hot, 1);
    assert.equal(report.scoring.topLeads[0].name, 'Studio Maato');
    assert.equal(
      report.health.stages.find((s: { stage: string }) => s.stage === 'agreed')
        .count,
      1,
    );
    assert.equal(report.health.unassessed, 3);
    assert.equal(report.health.funnel[0].stage, 'contacted');
    assert.equal(report.health.funnel[0].count, 2);

    const f = report.forecast;
    assert.equal(f.currency, 'INR');
    assert.equal(f.history.length, 1);
    assert.equal(f.history[0].paise, 300000, 'cancelled bookings excluded');
    assert.equal(f.next30Days.paise, 150000);
    assert.equal(f.runRatePaise, 100000);
    assert.equal(f.weightedPipelinePaise, 350000);
    assert.equal(f.leadsWithoutValue, 3);
    assert.equal(f.months.length, 3);
    assert.equal(
      f.months[1].projectedPaise,
      Math.max(f.months[1].bookedPaise, 100000) + 350000,
    );

    const team = report.team as {
      id: string;
      openLeads: number;
      activities30d: number;
      hotLeads: number;
    }[];
    assert.equal(team.length, 2);
    const ashaRow = team.find((m) => m.id === asha.id)!;
    assert.equal(ashaRow.openLeads, 2);
    assert.equal(ashaRow.hotLeads, 1);
    // Bina finished the photo-brief task (Asha reopened it later).
    assert.equal(team.find((m) => m.id === bina.id)!.activities30d, 1);
  });

  await t.test('AI brief: off, on, capped and failure handling', async () => {
    const off = await call(
      'POST',
      `/admin/leads/${studio.id}/ai-brief`,
      asha,
      {},
    );
    assert.equal(off.statusCode, 503);
    assert.equal(off.json().error.code, 'AI_DISABLED');

    assert.equal(
      (
        await call(
          'POST',
          `/admin/leads/${studio.id}/ai-brief`,
          traveller,
          {},
          aiApp,
        )
      ).statusCode,
      403,
    );
    const run = await data(
      call('POST', `/admin/leads/${studio.id}/ai-brief`, asha, {}, aiApp),
      201,
    );
    assert.equal(run.model, 'claude-opus-5-5');
    assert.equal(run.brief.assessment.photo.rating, 5);
    assert.equal(run.requestedBy, 'Asha Super');
    const sent = JSON.stringify(contexts[0]);
    assert.doesNotMatch(sent, /98000|studio@example/, 'no phone or email');
    assert.equal(contexts[0]!.name, 'Studio Maato');
    assert.equal(contexts[0]!.ratings.uniqueness, 5);
    assert.ok(contexts[0]!.notes.length > 0);

    const lead = await data(
      call('GET', `/admin/leads/${studio.id}`, asha, undefined, aiApp),
    );
    assert.equal(lead.assistant.enabled, true);
    assert.equal(lead.assistant.latest.id, run.id);
    assert.ok(lead.notes.some((n: { kind: string }) => n.kind === 'ai'));
    const stored = (
      await owner.query(
        'SELECT input_tokens, output_tokens FROM public.crm_ai_runs',
      )
    ).rows;
    assert.deepEqual(stored, [{ input_tokens: 900, output_tokens: 300 }]);

    behaviour = 'invalid';
    const invalid = await call(
      'POST',
      `/admin/leads/${studio.id}/ai-brief`,
      asha,
      {},
      aiApp,
    );
    assert.equal(invalid.statusCode, 502);
    assert.equal(invalid.json().error.code, 'AI_FAILED');
    behaviour = 'down';
    const down = await call(
      'POST',
      `/admin/leads/${studio.id}/ai-brief`,
      asha,
      {},
      aiApp,
    );
    assert.equal(down.statusCode, 503);
    assert.equal(down.json().error.code, 'AI_UNAVAILABLE');

    behaviour = 'ok';
    await data(
      call('POST', `/admin/leads/${studio.id}/ai-brief`, asha, {}, aiApp),
      201,
    );
    const capped = await call(
      'POST',
      `/admin/leads/${studio.id}/ai-brief`,
      asha,
      {},
      aiApp,
    );
    assert.equal(capped.statusCode, 429);
    assert.equal(capped.json().error.code, 'AI_LIMIT');
    // The cap is per person.
    await data(
      call('POST', `/admin/leads/${studio.id}/ai-brief`, bina, {}, aiApp),
      201,
    );
    assert.equal(
      (
        await call(
          'POST',
          `/admin/leads/${randomUUID()}/ai-brief`,
          bina,
          {},
          aiApp,
        )
      ).statusCode,
      404,
    );
  });
});
