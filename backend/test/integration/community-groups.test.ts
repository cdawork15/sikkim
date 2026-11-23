import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { tokenHash } from '../../src/accounts/model.js';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { poolOptions } from '../../src/db/database.js';
import { migrate, seedOrReset } from '../../src/db/maintenance.js';

test('Community groups: joining, host confirmation and members-only chat', async (t) => {
  const config = loadConfig({ ...process.env, ENABLE_DEMO_AUTH: 'false' });
  assert.equal(config.mode, 'test');
  const migrationUrl = process.env.MIGRATION_DATABASE_URL!;
  localDatabaseTarget('test', migrationUrl);
  await migrate(config, migrationUrl);
  await seedOrReset(config, migrationUrl, 'sikkim_test');
  const owner = new pg.Client(poolOptions(config, migrationUrl));
  await owner.connect();
  t.after(() => owner.end());
  const app = await buildApp(config, { rateLimitMax: 10000 });
  t.after(() => app.close());

  async function user(name: string) {
    const id = (
      await owner.query(
        'INSERT INTO public.users(display_name) VALUES($1) RETURNING id',
        [name],
      )
    ).rows[0].id as string;
    const token = randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO public.auth_sessions(user_id,token_hash,expires_at,absolute_expires_at)
      VALUES($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '24 hours')`,
      [id, tokenHash(token)],
    );
    return { id, headers: { authorization: 'Bearer ' + token } };
  }
  type User = Awaited<ReturnType<typeof user>>;
  const host = await user('Doma');
  const alice = await user('Alice');
  const bob = await user('Bob');
  const carol = await user('Carol');
  const call = (
    method: 'GET' | 'POST' | 'PUT',
    url: string,
    who?: User,
    payload?: object,
  ) =>
    app.inject({
      method,
      url,
      ...(who ? { headers: who.headers } : {}),
      ...(payload ? { payload } : method === 'POST' ? { payload: {} } : {}),
    });
  const ok = (response: Awaited<ReturnType<typeof call>>, status = 200) => {
    assert.equal(response.statusCode, status, response.body);
    return response.json().data;
  };
  const code = (response: Awaited<ReturnType<typeof call>>) =>
    response.json().error.code;
  const base = {
    title: 'Momo evening',
    description: 'Fold and steam momos with a small group of travellers.',
    area: 'Gangtok',
    meeting: 'MG Marg fountain',
    date: '2099-01-01',
    start: '16:00',
    end: '18:00',
    capacity: 2,
    price: 0,
    interest: 'Food',
    approval: false,
    images: [],
  };
  const create = async (overrides: object = {}) =>
    ok(
      await call('POST', '/v1/community/events', host, {
        ...base,
        ...overrides,
      }),
      201,
    );

  await t.test(
    'open events confirm while places remain, then queue',
    async () => {
      const event = await create();
      const url = `/v1/community/events/${event.id}`;
      assert.equal((await call('POST', url + '/join')).statusCode, 401);
      assert.equal(
        code(await call('POST', url + '/join', host)),
        'INVALID_REQUEST',
      );
      assert.equal(
        ok(await call('POST', url + '/join', alice)).status,
        'confirmed',
      );
      // Joining twice is harmless.
      assert.equal(
        ok(await call('POST', url + '/join', alice)).status,
        'confirmed',
      );
      assert.equal(
        ok(await call('POST', url + '/join', bob)).status,
        'confirmed',
      );
      const waiting = ok(await call('POST', url + '/join', carol));
      assert.deepEqual([waiting.status, waiting.canChat], ['waiting', false]);
      assert.equal(ok(await call('GET', url)).attendees, 2);
      // A confirmed member leaving gives the place to the first person waiting.
      ok(await call('POST', url + '/leave', bob));
      const carolNow = ok(await call('GET', url + '/membership', carol));
      assert.deepEqual(
        [carolNow.status, carolNow.canChat],
        ['confirmed', true],
      );
      // Capacity cannot drop below the confirmed members.
      const shrink = await call('PUT', url, host, {
        ...base,
        capacity: 2,
        revision: event.revision,
      });
      assert.equal(shrink.statusCode, 200, shrink.body);
    },
  );

  await t.test(
    'approval events need the host to confirm each person',
    async () => {
      const event = await create({ approval: true });
      const url = `/v1/community/events/${event.id}`;
      const request = ok(await call('POST', url + '/join', alice));
      assert.deepEqual([request.status, request.canChat], ['requested', false]);
      ok(await call('POST', url + '/join', bob));
      // Not confirmed yet: no chat in either direction.
      assert.equal(
        (await call('GET', url + '/messages', alice)).statusCode,
        403,
      );
      assert.equal(
        (await call('POST', url + '/messages', alice, { body: 'Hi' }))
          .statusCode,
        403,
      );
      // Only the host sees and manages the member list.
      assert.equal(
        (await call('GET', url + '/members', alice)).statusCode,
        404,
      );
      const list = ok(await call('GET', url + '/members', host));
      assert.deepEqual(
        list.map((m: { name: string; status: string }) => [m.name, m.status]),
        [
          ['Alice', 'requested'],
          ['Bob', 'requested'],
        ],
      );
      assert.equal(
        (await call('POST', `${url}/members/${alice.id}/confirm`, bob))
          .statusCode,
        404,
      );
      ok(await call('POST', `${url}/members/${alice.id}/confirm`, host));
      ok(await call('POST', `${url}/members/${bob.id}/decline`, host));
      assert.equal(
        code(await call('POST', url + '/join', bob)),
        'MEMBERSHIP_DECLINED',
      );

      // Host and confirmed member can chat; outsiders and declined people cannot.
      const hello = ok(
        await call('POST', url + '/messages', host, { body: '  Welcome!  ' }),
        201,
      );
      assert.deepEqual(
        [hello.body, hello.author, hello.host, hello.mine],
        ['Welcome!', 'Doma', true, true],
      );
      const reply = ok(
        await call('POST', url + '/messages', alice, { body: 'Thank you' }),
        201,
      );
      assert.equal((await call('GET', url + '/messages', bob)).statusCode, 403);
      assert.equal(
        (await call('GET', url + '/messages', carol)).statusCode,
        403,
      );
      assert.equal(
        (await call('POST', url + '/messages', alice, { body: '   ' }))
          .statusCode,
        400,
      );
      const all = ok(await call('GET', url + '/messages', alice));
      assert.deepEqual(
        all.map((m: { body: string; mine: boolean }) => [m.body, m.mine]),
        [
          ['Welcome!', false],
          ['Thank you', true],
        ],
      );
      assert.deepEqual(
        ok(await call('GET', `${url}/messages?after=${hello.id}`, host)).map(
          (m: { id: string }) => m.id,
        ),
        [reply.id],
      );
      // Removing a confirmed member closes their chat.
      ok(await call('POST', `${url}/members/${alice.id}/decline`, host));
      assert.equal(
        (await call('GET', url + '/messages', alice)).statusCode,
        403,
      );
    },
  );

  await t.test('cancelled, ended and paid events', async () => {
    const event = await create();
    const url = `/v1/community/events/${event.id}`;
    ok(await call('POST', url + '/join', alice));
    ok(
      await call('POST', url + '/messages', alice, { body: 'See you there' }),
      201,
    );
    ok(await call('POST', url + '/cancel', host, { revision: event.revision }));
    assert.equal(code(await call('POST', url + '/join', bob)), 'EVENT_CLOSED');
    // History stays readable, but the chat is read-only.
    assert.equal(ok(await call('GET', url + '/messages', alice)).length, 1);
    assert.equal(
      code(await call('POST', url + '/messages', alice, { body: 'Hello?' })),
      'EVENT_CLOSED',
    );
    const paid = await create({ price: 300 });
    assert.equal(
      code(await call('POST', `/v1/community/events/${paid.id}/join`, alice)),
      'PAYMENT_UNAVAILABLE',
    );
    const ended = await create();
    await owner.query(
      `UPDATE public.community_events SET details=details||'{"date":"2020-01-01"}' WHERE id=$1`,
      [ended.id],
    );
    assert.equal(
      code(await call('POST', `/v1/community/events/${ended.id}/join`, bob)),
      'EVENT_CLOSED',
    );
  });

  await t.test('my community lists what I host and what I joined', async () => {
    const mine = ok(await call('GET', '/v1/me/community', alice));
    assert.ok(mine.length >= 2);
    assert.ok(
      mine.every(
        (row: { role: string; status: string }) =>
          row.role === 'member' &&
          ['requested', 'confirmed', 'waiting'].includes(row.status),
      ),
    );
    const hosted = ok(await call('GET', '/v1/me/community', host));
    assert.ok(
      hosted.every(
        (row: { role: string; canChat: boolean }) =>
          row.role === 'host' && row.canChat,
      ),
    );
    assert.equal((await call('GET', '/v1/me/community')).statusCode, 401);
  });

  await t.test('capacity cannot drop below confirmed members', async () => {
    const event = await create({ capacity: 3 });
    const url = `/v1/community/events/${event.id}`;
    for (const who of [alice, bob, carol])
      ok(await call('POST', url + '/join', who));
    const shrink = await call('PUT', url, host, {
      ...base,
      capacity: 2,
      revision: event.revision,
    });
    assert.equal(shrink.statusCode, 400, shrink.body);
  });
});
