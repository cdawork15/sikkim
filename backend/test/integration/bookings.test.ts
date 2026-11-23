import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { tokenHash } from '../../src/accounts/model.js';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { poolOptions } from '../../src/db/database.js';
import { migrate, seedOrReset } from '../../src/db/maintenance.js';

test('free bookings, capacity and tickets against isolated PostgreSQL', async (t) => {
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
  const app = await buildApp(config, { rateLimitMax: 10000 });
  t.after(() => app.close());
  async function user() {
    const id = (
      await owner.query(
        "INSERT INTO public.users(display_name) VALUES('Test traveller') RETURNING id",
      )
    ).rows[0].id as string;
    await owner.query(
      'INSERT INTO public.user_preferences(user_id) VALUES($1)',
      [id],
    );
    const token = randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO public.auth_sessions(user_id,token_hash,expires_at,absolute_expires_at)
      VALUES($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '24 hours')`,
      [id, tokenHash(token)],
    );
    return { id, headers: { authorization: 'Bearer ' + token } };
  }
  const host = await user();
  const alice = await user();
  const bob = await user();
  const hostId = (
    await owner.query(
      `INSERT INTO public.hosts(user_id,public_name,status,approved_until)
    VALUES($1,'Verified test host','approved','2099-01-01') RETURNING id`,
      [host.id],
    )
  ).rows[0].id;
  type User = typeof alice;
  const call = (
    method: 'POST' | 'PUT' | 'GET',
    url: string,
    who: User,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      headers: who.headers,
      ...(payload ? { payload } : {}),
    });
  const data = (response: Awaited<ReturnType<typeof call>>, status = 200) => {
    assert.equal(response.statusCode, status, response.body);
    return response.json().data;
  };
  async function experience(price = 0, source = '') {
    const id = (
      await owner.query(
        `INSERT INTO public.experiences(host_id,slug,title,description,area_code,
      meeting_point,duration_minutes,price_paise,max_participants,source_reference)
      VALUES($1,$2,'Forest walk','A test walk','pakyong','Village meeting point',60,$3,8,$4) RETURNING id`,
        [hostId, randomUUID(), price, source],
      )
    ).rows[0].id as string;
    const policy = (
      await owner.query(
        `INSERT INTO public.policies(experience_id,version,cancellation,safety,participation)
      VALUES($1,1,'See the date-specific cancellation cutoff.','Wear walking shoes.','Attend with your group.') RETURNING id`,
        [id],
      )
    ).rows[0].id;
    await owner.query(
      "INSERT INTO public.experience_categories VALUES($1,'nature')",
      [id],
    );
    await owner.query(
      "UPDATE public.experiences SET policy_id=$2,status='published',published_at=clock_timestamp() WHERE id=$1",
      [id, policy],
    );
    return id;
  }
  function slotInput(overrides: object = {}) {
    const startsAt = new Date(Date.now() + 48 * 3600000);
    return {
      requestKey: randomUUID(),
      startsAt: startsAt.toISOString(),
      endsAt: new Date(+startsAt + 3600000).toISOString(),
      bookingDeadline: new Date(+startsAt - 3600000).toISOString(),
      timezone: 'Asia/Kolkata',
      capacity: 2,
      cancellationHours: 2,
      rescheduleHours: 2,
      ...overrides,
    };
  }
  async function newSlot(exp: string, overrides: object = {}) {
    return data(
      await call(
        'POST',
        `/v1/me/experiences/${exp}/slots`,
        host,
        slotInput(overrides),
      ),
      201,
    );
  }
  async function hold(slotId: string, who = alice, quantity = 1) {
    return data(
      await call('POST', '/v1/me/seat-holds', who, {
        slotId,
        quantity,
        requestKey: randomUUID(),
      }),
      201,
    );
  }
  const confirmation = (holdId: string, quantity = 1) => ({
    holdId,
    contactName: 'Pema',
    contactEmail: 'pema@example.com',
    guests: Array.from({ length: quantity }, (_, i) => `Guest ${i + 1}`),
  });
  async function reserve(slotId: string, who = alice, quantity = 1) {
    return data(
      await call(
        'POST',
        '/v1/me/bookings',
        who,
        confirmation((await hold(slotId, who, quantity)).id, quantity),
      ),
      201,
    );
  }
  const ticketFor = async (id: string, who = alice) =>
    data(await call('GET', `/v1/me/bookings/${id}/ticket`, who));

  await t.test(
    'strict slot validation, ownership and retry-safe date creation',
    async () => {
      const exp = await experience();
      const input = slotInput();
      const endpoint = `/v1/me/experiences/${exp}/slots`;
      assert.equal(
        (await app.inject({ method: 'POST', url: endpoint, payload: input }))
          .statusCode,
        401,
      );
      assert.equal((await call('POST', endpoint, bob, input)).statusCode, 404);
      for (const extra of [
        { capacity: 9 },
        { timezone: 'UTC' },
        { pricePaise: 0 },
        { startsAt: '2000-01-01T00:00:00Z' },
        { endsAt: input.startsAt },
      ]) {
        assert.equal(
          (await call('POST', endpoint, host, { ...input, ...extra }))
            .statusCode,
          400,
        );
      }
      const first = data(await call('POST', endpoint, host, input), 201);
      assert.equal(
        data(await call('GET', `/v1/me/slots/${first.id}`, host)).experienceId,
        exp,
      );
      assert.equal(
        (await call('GET', `/v1/me/slots/${first.id}`, bob)).statusCode,
        404,
      );
      assert.equal(
        data(await call('POST', endpoint, host, input), 201).id,
        first.id,
      );
      const reordered = Object.fromEntries(Object.entries(input).reverse());
      assert.equal(
        data(await call('POST', endpoint, host, reordered), 201).id,
        first.id,
      );
      assert.equal(
        (await call('POST', endpoint, host, { ...input, capacity: 3 }))
          .statusCode,
        409,
      );
      assert.equal(
        (await call('GET', `/v1/me/experiences/${exp}/slots`, bob)).statusCode,
        404,
      );
    },
  );

  await t.test(
    'available dates stay chronological across cursor pages',
    async () => {
      const exp = await experience();
      const created = [];
      for (const days of [5, 3, 4]) {
        const start = Date.now() + days * 86400000;
        created.push(
          await newSlot(exp, {
            startsAt: new Date(start).toISOString(),
            endsAt: new Date(start + 3600000).toISOString(),
            bookingDeadline: new Date(start - 3600000).toISOString(),
          }),
        );
      }
      const dates = (await app.inject(`/v1/experiences/${exp}/slots`)).json()
        .data;
      assert.deepEqual(
        dates.map((row: { id: string }) => row.id),
        [created[1].id, created[2].id, created[0].id],
      );
      const next = (
        await app.inject(`/v1/experiences/${exp}/slots?after=${created[1].id}`)
      ).json().data;
      assert.deepEqual(
        next.map((row: { id: string }) => row.id),
        [created[2].id, created[0].id],
      );
    },
  );

  await t.test(
    'two buyers racing for the last seat cannot oversell',
    async () => {
      const selected = await newSlot(await experience(), { capacity: 1 });
      const results = await Promise.all(
        [alice, bob].map((who) =>
          call('POST', '/v1/me/seat-holds', who, {
            slotId: selected.id,
            quantity: 1,
            requestKey: randomUUID(),
          }),
        ),
      );
      assert.deepEqual(results.map((r) => r.statusCode).sort(), [201, 409]);
      const winner = results[0]!.statusCode === 201 ? alice : bob;
      const held = results.find((r) => r.statusCode === 201)!.json().data;
      const input = confirmation(held.id);
      const confirmed = await Promise.all([
        call('POST', '/v1/me/bookings', winner, input),
        call('POST', '/v1/me/bookings', winner, input),
      ]);
      assert.ok(confirmed.every((r) => r.statusCode === 201));
      assert.equal(confirmed[0]!.json().data.id, confirmed[1]!.json().data.id);
      assert.equal(
        (
          await owner.query(
            "SELECT sum(quantity)::int AS n FROM public.bookings WHERE slot_id=$1 AND status='confirmed'",
            [selected.id],
          )
        ).rows[0].n,
        1,
      );
    },
  );

  await t.test(
    'multiple guests, immutable snapshots, idempotency and owner-only details',
    async () => {
      const selected = await newSlot(await experience());
      const input = {
        slotId: selected.id,
        quantity: 2,
        requestKey: randomUUID(),
      };
      const held = data(
        await call('POST', '/v1/me/seat-holds', alice, input),
        201,
      );
      assert.equal(
        data(await call('POST', '/v1/me/seat-holds', alice, input), 201).id,
        held.id,
      );
      assert.equal(
        (
          await call('POST', '/v1/me/seat-holds', alice, {
            ...input,
            quantity: 1,
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (await call('POST', '/v1/me/bookings', alice, confirmation(held.id)))
          .statusCode,
        400,
      );
      assert.equal(
        (await call('POST', '/v1/me/bookings', bob, confirmation(held.id, 2)))
          .statusCode,
        404,
      );
      const confirmed = data(
        await call('POST', '/v1/me/bookings', alice, confirmation(held.id, 2)),
        201,
      );
      assert.equal(confirmed.totalPaise, 0);
      assert.equal(confirmed.snapshot.policy.cancellationHours, 2);
      assert.equal(
        (
          await call('POST', '/v1/me/bookings', alice, {
            ...confirmation(held.id, 2),
            contactName: 'Different',
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (await call('GET', `/v1/me/bookings/${confirmed.id}`, bob)).statusCode,
        404,
      );
      assert.equal(
        (await call('GET', `/v1/me/bookings/${confirmed.id}/ticket`, host))
          .statusCode,
        404,
      );
      const ticket = await ticketFor(confirmed.id);
      assert.match(ticket.verificationToken, /^[a-f0-9]{64}$/);
      assert.ok(!ticket.shareText.includes('pema@example.com'));
      const guests = data(
        await call('GET', `/v1/me/slots/${selected.id}/bookings`, host),
      );
      assert.equal(guests[0].guests.length, 2);
      assert.equal(guests[0].contactEmail, undefined);
      assert.equal(guests[0].token, undefined);
      assert.equal(
        (await call('GET', `/v1/me/slots/${selected.id}/bookings`, bob))
          .statusCode,
        404,
      );
    },
  );

  await t.test(
    'expired and released holds free capacity without a background worker',
    async () => {
      const selected = await newSlot(await experience(), { capacity: 1 });
      const held = await hold(selected.id);
      await owner.query(
        "UPDATE public.seat_holds SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [held.id],
      );
      assert.equal(
        (await call('POST', '/v1/me/bookings', alice, confirmation(held.id)))
          .statusCode,
        409,
      );
      const replacement = await hold(selected.id, bob);
      assert.equal(
        data(
          await call(
            'POST',
            `/v1/me/seat-holds/${replacement.id}/release`,
            bob,
            {},
          ),
        ).status,
        'released',
      );
      assert.equal(
        (
          await call(
            'POST',
            '/v1/me/bookings',
            bob,
            confirmation(replacement.id),
          )
        ).statusCode,
        409,
      );
      await reserve(selected.id);
    },
  );

  await t.test(
    'capacity changes, closing and stale revisions respect held and confirmed seats',
    async () => {
      const selected = await newSlot(await experience(), { capacity: 3 });
      await hold(selected.id, alice, 2);
      assert.equal(
        (
          await call('PUT', `/v1/me/slots/${selected.id}`, host, {
            revision: 1,
            capacity: 1,
            status: 'open',
          })
        ).statusCode,
        409,
      );
      const closed = data(
        await call('PUT', `/v1/me/slots/${selected.id}`, host, {
          revision: 1,
          capacity: 3,
          status: 'closed',
        }),
      );
      assert.equal(closed.revision, 2);
      assert.equal(
        (
          await call('PUT', `/v1/me/slots/${selected.id}`, host, {
            revision: 1,
            capacity: 3,
            status: 'open',
          })
        ).statusCode,
        409,
      );
      assert.equal(
        (
          await call('POST', '/v1/me/seat-holds', bob, {
            slotId: selected.id,
            quantity: 1,
            requestKey: randomUUID(),
          })
        ).statusCode,
        409,
      );
    },
  );

  await t.test(
    'cancellation revokes tickets, releases seats and records one event on retry',
    async () => {
      const selected = await newSlot(await experience(), { capacity: 1 });
      const confirmed = await reserve(selected.id);
      const input = { revision: 1, reason: 'Plans changed' };
      const path = `/v1/me/bookings/${confirmed.id}/cancel`;
      assert.equal(
        data(await call('POST', path, alice, input)).status,
        'cancelled',
      );
      assert.equal(
        data(await call('POST', path, alice, input)).history.filter(
          (row: { action: string }) => row.action === 'cancelled',
        ).length,
        1,
      );
      assert.equal((await ticketFor(confirmed.id)).verificationToken, null);
      await reserve(selected.id, bob);
      const late = await reserve(
        (await newSlot(await experience(), { cancellationHours: 72 })).id,
      );
      assert.equal(
        (await call('POST', `/v1/me/bookings/${late.id}/cancel`, alice, input))
          .statusCode,
        409,
      );
      assert.equal(
        data(await call('GET', `/v1/me/bookings/${late.id}`, alice)).status,
        'confirmed',
      );
    },
  );

  await t.test(
    'rescheduling reserves the replacement safely and invalidates the previous ticket',
    async () => {
      const exp = await experience();
      const from = await newSlot(exp, { capacity: 1 });
      const to = await newSlot(exp, { capacity: 1 });
      const confirmed = await reserve(from.id);
      const previous = (await ticketFor(confirmed.id)).verificationToken;
      const blocker = await hold(to.id, bob);
      const input = {
        revision: 1,
        slotId: to.id,
        requestKey: randomUUID(),
        reason: 'Another date',
      };
      const path = `/v1/me/bookings/${confirmed.id}/reschedule`;
      assert.equal((await call('POST', path, alice, input)).statusCode, 409);
      assert.equal(
        data(await call('GET', `/v1/me/bookings/${confirmed.id}`, alice)).slot
          .id,
        from.id,
      );
      await call('POST', `/v1/me/seat-holds/${blocker.id}/release`, bob, {});
      const moved = data(await call('POST', path, alice, input));
      assert.equal(moved.slot.id, to.id);
      assert.equal(moved.snapshot.originalSlotId, from.id);
      assert.equal(data(await call('POST', path, alice, input)).revision, 2);
      assert.notEqual(
        (await ticketFor(confirmed.id)).verificationToken,
        previous,
      );
      assert.equal(
        (await call('POST', '/v1/me/check-ins', host, { token: previous }))
          .statusCode,
        409,
      );
      await reserve(from.id, bob);
    },
  );

  await t.test(
    'a reschedule and a new hold racing for one place cannot oversell',
    async () => {
      const exp = await experience();
      const from = await newSlot(exp, { capacity: 1 });
      const to = await newSlot(exp, { capacity: 1 });
      const confirmed = await reserve(from.id);
      const responses = await Promise.all([
        call('POST', `/v1/me/bookings/${confirmed.id}/reschedule`, alice, {
          revision: 1,
          slotId: to.id,
          requestKey: randomUUID(),
          reason: 'Change date',
        }),
        call('POST', '/v1/me/seat-holds', bob, {
          slotId: to.id,
          quantity: 1,
          requestKey: randomUUID(),
        }),
      ]);
      assert.equal(
        responses.filter((response) => response.statusCode < 300).length,
        1,
      );
      assert.equal(
        responses.filter((response) => response.statusCode === 409).length,
        1,
      );
      const occupied = (
        await owner.query(
          `SELECT sum(quantity)::int AS count FROM (
      SELECT quantity FROM public.bookings WHERE slot_id=$1 AND status='confirmed'
      UNION ALL SELECT quantity FROM public.seat_holds WHERE slot_id=$1
        AND status='active' AND expires_at>clock_timestamp()) places`,
          [to.id],
        )
      ).rows[0].count;
      assert.equal(occupied, 1);
    },
  );

  await t.test(
    'reschedules reject new policies and passed cutoffs without losing the booking',
    async () => {
      const exp = await experience();
      const from = await newSlot(exp, { rescheduleHours: 72 });
      const to = await newSlot(exp, { rescheduleHours: 72 });
      const current = await reserve(from.id);
      assert.equal(
        (
          await call(
            'POST',
            `/v1/me/bookings/${current.id}/reschedule`,
            alice,
            {
              revision: 1,
              slotId: to.id,
              requestKey: randomUUID(),
              reason: 'Change date',
            },
          )
        ).json().error.code,
        'DEADLINE_PASSED',
      );
      const first = await newSlot(exp);
      const changedTerms = await newSlot(exp, { cancellationHours: 24 });
      const movable = await reserve(first.id);
      assert.equal(
        (
          await call(
            'POST',
            `/v1/me/bookings/${movable.id}/reschedule`,
            alice,
            {
              revision: 1,
              slotId: changedTerms.id,
              requestKey: randomUUID(),
              reason: 'Change date',
            },
          )
        ).json().error.code,
        'POLICY_CHANGED',
      );
      assert.equal(
        data(await call('GET', `/v1/me/bookings/${movable.id}`, alice)).slot.id,
        first.id,
      );
    },
  );

  await t.test(
    'paid, preview, changed and hidden listings cannot acquire or confirm seats',
    async () => {
      const paid = await newSlot(await experience(10000));
      const response = await call('POST', '/v1/me/seat-holds', alice, {
        slotId: paid.id,
        quantity: 1,
        requestKey: randomUUID(),
      });
      assert.equal(response.json().error.code, 'PAYMENT_UNAVAILABLE');
      assert.equal(
        (
          await call(
            'POST',
            `/v1/me/experiences/${await experience(0, 'local-design-preview')}/slots`,
            host,
            slotInput(),
          )
        ).statusCode,
        404,
      );
      const exp = await experience();
      const selected = await newSlot(exp);
      const held = await hold(selected.id);
      await owner.query(
        'UPDATE public.experiences SET price_paise=100,revision=revision+1 WHERE id=$1',
        [exp],
      );
      assert.equal(
        (await call('POST', '/v1/me/bookings', alice, confirmation(held.id)))
          .statusCode,
        409,
      );
      await owner.query(
        "UPDATE public.experiences SET status='hidden' WHERE id=$1",
        [exp],
      );
      assert.deepEqual(
        (await app.inject(`/v1/experiences/${exp}/slots`)).json().data,
        [],
      );
      assert.equal(
        (await call('POST', '/v1/me/bookings', alice, confirmation(held.id)))
          .statusCode,
        404,
      );
    },
  );

  await t.test(
    'host weather cancellation revokes all tickets and records durable change events',
    async () => {
      const selected = await newSlot(await experience());
      const confirmed = await reserve(selected.id);
      const held = await hold(selected.id, bob);
      const input = { revision: 1, reason: 'Unsafe weather' };
      assert.equal(
        (await call('POST', `/v1/me/slots/${selected.id}/cancel`, bob, input))
          .statusCode,
        404,
      );
      assert.equal(
        data(
          await call('POST', `/v1/me/slots/${selected.id}/cancel`, host, input),
        ).status,
        'cancelled',
      );
      assert.equal(
        data(await call('GET', `/v1/me/bookings/${confirmed.id}`, alice))
          .status,
        'cancelled',
      );
      assert.equal((await ticketFor(confirmed.id)).verificationToken, null);
      assert.equal(
        (await call('POST', '/v1/me/bookings', bob, confirmation(held.id)))
          .statusCode,
        409,
      );
      const events = (
        await owner.query(
          'SELECT * FROM public.booking_changes WHERE booking_id=$1 ORDER BY sequence',
          [confirmed.id],
        )
      ).rows;
      assert.deepEqual(
        events.map((row) => row.action),
        ['confirmed', 'cancelled'],
      );
      assert.equal(events[1].reason, 'Unsafe weather');
      assert.ok(!JSON.stringify(events).includes('pema@example.com'));
    },
  );

  await t.test(
    'check-in requires the correct host, valid time and a one-use ticket',
    async () => {
      const selected = await newSlot(await experience());
      const confirmed = await reserve(selected.id);
      const token = (await ticketFor(confirmed.id)).verificationToken;
      assert.equal(
        (await call('POST', '/v1/me/check-ins', bob, { token })).statusCode,
        404,
      );
      assert.equal(
        (await call('POST', '/v1/me/check-ins', host, { token })).statusCode,
        409,
      );
      await owner.query(
        `UPDATE public.experience_slots SET starts_at=clock_timestamp()+interval '30 minutes',
      ends_at=clock_timestamp()+interval '90 minutes',booking_deadline=clock_timestamp() WHERE id=$1`,
        [selected.id],
      );
      const replies = await Promise.all([
        call('POST', '/v1/me/check-ins', host, { token }),
        call('POST', '/v1/me/check-ins', host, { token }),
      ]);
      assert.deepEqual(replies.map((r) => r.statusCode).sort(), [200, 409]);
      assert.equal((await ticketFor(confirmed.id)).status, 'checked_in');
      assert.equal(
        (
          await call('POST', `/v1/me/slots/${selected.id}/cancel`, host, {
            revision: 1,
            reason: 'Weather',
          })
        ).statusCode,
        409,
      );
    },
  );

  await t.test(
    'expired tickets and no-shows cannot check in; lists distinguish past and cancelled',
    async () => {
      const selected = await newSlot(await experience());
      const confirmed = await reserve(selected.id);
      const token = (await ticketFor(confirmed.id)).verificationToken;
      await owner.query(
        `UPDATE public.experience_slots SET starts_at=clock_timestamp()-interval '2 hours',
      ends_at=clock_timestamp()-interval '1 hour',booking_deadline=clock_timestamp()-interval '3 hours' WHERE id=$1`,
        [selected.id],
      );
      assert.equal((await ticketFor(confirmed.id)).status, 'expired');
      assert.equal(
        (await call('POST', '/v1/me/check-ins', host, { token })).statusCode,
        409,
      );
      assert.equal(
        data(
          await call(
            'POST',
            `/v1/me/host-bookings/${confirmed.id}/no-show`,
            host,
            { revision: 1 },
          ),
        ).status,
        'no_show',
      );
      assert.ok(
        data(await call('GET', '/v1/me/bookings?status=past', alice)).some(
          (r: { id: string }) => r.id === confirmed.id,
        ),
      );
      assert.ok(
        data(
          await call('GET', '/v1/me/bookings?status=cancelled', alice),
        ).every((r: { status: string }) => r.status === 'cancelled'),
      );
    },
  );

  await t.test(
    'date search uses India dates and live seats, and keeps full dates out of results',
    async () => {
      const exp = await experience();
      const date = new Date(Date.now() + 96 * 3600000)
        .toISOString()
        .slice(0, 10);
      const selected = await newSlot(exp, {
        capacity: 1,
        startsAt: date + 'T00:15:00+05:30',
        endsAt: date + 'T01:15:00+05:30',
        bookingDeadline: date + 'T00:00:00+05:30',
      });
      const search = () => app.inject('/v1/experiences?date=' + date);
      assert.ok(
        (await search()).json().data.some((r: { id: string }) => r.id === exp),
      );
      await hold(selected.id);
      assert.ok(
        !(await search()).json().data.some((r: { id: string }) => r.id === exp),
      );
      assert.equal(
        (await app.inject('/v1/catalogue/options')).json().data
          .dateFilteringAvailable,
        true,
      );
    },
  );

  await t.test(
    'booking pagination does not duplicate rows or expose another account',
    async () => {
      const exp = await experience();
      for (let index = 0; index < 22; index++) {
        await reserve((await newSlot(exp, { capacity: 1 })).id);
      }
      const ids: string[] = [];
      let after: string | null = null;
      do {
        const response = await call(
          'GET',
          '/v1/me/bookings' + (after ? '?after=' + after : ''),
          alice,
        );
        const rows = data(response);
        assert.ok(rows.length <= 20);
        ids.push(...rows.map((row: { id: string }) => row.id));
        after = response.json().page.nextCursor;
      } while (after);
      const owned = (
        await owner.query('SELECT id FROM public.bookings WHERE user_id=$1', [
          alice.id,
        ])
      ).rows.map((row) => row.id);
      assert.equal(ids.length, new Set(ids).size);
      assert.deepEqual(ids.sort(), owned.sort());
    },
  );

  await t.test(
    'one confirmed booking per traveller per date, listed by experience',
    async () => {
      const exp = await experience();
      const first = await newSlot(exp, { capacity: 8 });
      const later = new Date(Date.now() + 72 * 3600000);
      const second = await newSlot(exp, {
        capacity: 8,
        startsAt: later.toISOString(),
        endsAt: new Date(+later + 3600000).toISOString(),
        bookingDeadline: new Date(+later - 3600000).toISOString(),
      });
      const booked = await reserve(first.id);
      // Hold another date first, then try to reserve the booked date again.
      const pending = await hold(second.id);
      const again = await call('POST', '/v1/me/seat-holds', alice, {
        slotId: first.id,
        quantity: 1,
        requestKey: randomUUID(),
      });
      assert.equal(again.statusCode, 409, again.body);
      assert.equal(again.json().error.code, 'ALREADY_BOOKED');
      // Two holds made before either was confirmed: only the first confirms.
      const racing = await hold(second.id);
      data(
        await call('POST', '/v1/me/bookings', alice, confirmation(pending.id)),
        201,
      );
      const late = await call(
        'POST',
        '/v1/me/bookings',
        alice,
        confirmation(racing.id),
      );
      assert.equal(late.json().error.code, 'ALREADY_BOOKED');
      // Another traveller can still book the same date.
      await reserve(first.id, bob);
      // Moving onto a date you already hold is refused too.
      const move = await call(
        'POST',
        `/v1/me/bookings/${booked.id}/reschedule`,
        alice,
        {
          revision: booked.revision,
          slotId: second.id,
          requestKey: randomUUID(),
          reason: 'Same date as my other booking',
        },
      );
      assert.equal(move.json().error.code, 'ALREADY_BOOKED');
      const mine = data(
        await call(
          'GET',
          `/v1/me/bookings?status=upcoming&experienceId=${exp}`,
          alice,
        ),
      );
      assert.equal(mine.length, 2);
      assert.ok(
        mine.every((row: { experienceId: string }) => row.experienceId === exp),
      );
      assert.deepEqual(
        mine.map((row: { slotId: string }) => row.slotId).sort(),
        [first.id, second.id].sort(),
      );
      // After cancelling, the date can be booked again.
      data(
        await call('POST', `/v1/me/bookings/${booked.id}/cancel`, alice, {
          revision: booked.revision,
          reason: 'Plans changed',
        }),
      );
      await reserve(first.id);
    },
  );

  await t.test(
    'exports isolate booking data and omit ticket secrets; snapshots and events cannot be rewritten',
    async () => {
      const exported = data(await call('GET', '/v1/me/export', alice));
      assert.ok(exported.bookings.reservations.length > 0);
      assert.ok(
        exported.bookings.reservations.every(
          (row: object) => !('token' in row),
        ),
      );
      const runtime = new pg.Client(poolOptions(config));
      await runtime.connect();
      try {
        await assert.rejects(
          runtime.query("UPDATE public.bookings SET snapshot='{}'"),
          /permission denied/,
        );
        await assert.rejects(
          runtime.query("UPDATE public.booking_changes SET reason='changed'"),
          /permission denied/,
        );
        await assert.rejects(
          runtime.query('DELETE FROM public.booking_changes'),
          /permission denied/,
        );
        await assert.rejects(
          runtime.query('UPDATE public.experience_slots SET price_paise=0'),
          /permission denied/,
        );
      } finally {
        await runtime.end();
      }
    },
  );
});
