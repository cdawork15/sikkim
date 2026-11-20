import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { tokenHash } from '../../src/accounts/model.js';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { poolOptions } from '../../src/db/database.js';
import { migrate, seedOrReset } from '../../src/db/maintenance.js';

test('Community events and four photos are shared publicly, with creator-only writes', async (t) => {
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
  async function user() {
    const id = (
      await owner.query(
        "INSERT INTO public.users(display_name) VALUES('Community host') RETURNING id",
      )
    ).rows[0].id;
    const token = randomBytes(32).toString('base64url');
    await owner.query(
      `INSERT INTO public.auth_sessions(user_id,token_hash,expires_at,absolute_expires_at)
      VALUES($1,$2,clock_timestamp()+interval '1 hour',clock_timestamp()+interval '24 hours')`,
      [id, tokenHash(token)],
    );
    return { authorization: 'Bearer ' + token };
  }
  const alice = await user();
  const bob = await user();
  const photos = ['red', 'blue', 'green', 'yellow'].map(
    (color) =>
      'data:image/jpeg;base64,' +
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        `color=c=${color}:s=32x32`,
        '-frames:v',
        '1',
        '-threads',
        '1',
        '-f',
        'image2pipe',
        '-c:v',
        'mjpeg',
        'pipe:1',
      ]).toString('base64'),
  );
  const input = {
    title: 'Shared village walk',
    description: 'Meet local travellers for a relaxed village walk.',
    area: 'Pakyong',
    meeting: 'Public village square',
    date: '2099-01-01',
    start: '16:00',
    end: '18:00',
    capacity: 10,
    price: 0,
    interest: 'Nature',
    approval: false,
    images: photos,
  };
  const url = '/v1/community/events';
  const guest = await app.inject({ method: 'POST', url, payload: input });
  assert.equal(guest.statusCode, 401);
  const created = await app.inject({
    method: 'POST',
    url,
    headers: alice,
    payload: input,
  });
  assert.equal(created.statusCode, 201, created.body);
  const event = created.json().data;
  assert.equal(event.images.length, 4);
  for (const headers of [{}, bob]) {
    const list = await app.inject({ url, headers });
    assert.equal(list.statusCode, 200);
    assert.equal(list.json().data[0].id, event.id);
    const detail = await app.inject({ url: `${url}/${event.id}`, headers });
    assert.deepEqual(detail.json().data.images, event.images);
    for (const image of event.images) {
      const response = await app.inject({ url: image, headers });
      assert.equal(response.statusCode, 200);
      assert.equal(response.headers['content-type'], 'image/webp');
      assert.equal(response.rawPayload.toString('ascii', 0, 4), 'RIFF');
    }
    assert.equal(
      (
        await app.inject({
          method: 'PUT',
          url: `${url}/${event.id}`,
          headers,
          payload: { ...input, revision: 1 },
        })
      ).statusCode,
      headers === bob ? 404 : 401,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `${url}/${event.id}/cancel`,
          headers,
          payload: { revision: 1 },
        })
      ).statusCode,
      headers === bob ? 404 : 401,
    );
  }
  const update = {
    ...input,
    title: 'Updated village walk',
    images: [event.images[2], event.images[0]],
    revision: 1,
  };
  const edited = await app.inject({
    method: 'PUT',
    url: `${url}/${event.id}`,
    headers: alice,
    payload: update,
  });
  assert.equal(edited.statusCode, 200, edited.body);
  assert.equal(edited.json().data.image, event.images[2]);
  assert.equal(edited.json().data.revision, 2);
  assert.equal((await app.inject({ url: event.images[1] })).statusCode, 404);
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `${url}/${event.id}`,
        headers: alice,
        payload: update,
      })
    ).statusCode,
    409,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: bob,
        payload: { ...input, images: [event.images[0]] },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: bob,
        payload: {
          ...input,
          images: ['data:image/jpeg;base64,bm90LWEtcGhvdG8='],
        },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: bob,
        payload: { ...input, images: [...photos, photos[0]] },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: bob,
        payload: { ...input, ownerId: event.ownerId },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url,
        headers: bob,
        payload: { ...input, date: '2020-01-01' },
      })
    ).statusCode,
    400,
  );
  const cancelled = await app.inject({
    method: 'POST',
    url: `${url}/${event.id}/cancel`,
    headers: alice,
    payload: { revision: 2 },
  });
  assert.equal(cancelled.statusCode, 200, cancelled.body);
  assert.equal(
    (await app.inject(`${url}/${event.id}`)).json().data.status,
    'cancelled',
  );
  assert.equal(
    (
      await app.inject({
        method: 'PUT',
        url: `${url}/${event.id}`,
        headers: alice,
        payload: { ...update, revision: 3 },
      })
    ).statusCode,
    409,
  );
});
