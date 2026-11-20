import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { poolOptions } from '../../src/db/database.js';
import { migrate, seedOrReset } from '../../src/db/maintenance.js';

const OTP_ENV = {
  OTP_DELIVERY: 'console',
  OTP_SECRET: 'test-only-otp-secret-with-at-least-32-chars',
};

test('OTP sign-in, account types and community reels', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sikkim-reels-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = loadConfig({
    ...process.env,
    ...OTP_ENV,
    MEDIA_STORAGE_DIR: directory,
    MEDIA_SIGNING_KEY: 'local-test-signing-key-at-least-32-characters',
  });
  const url = process.env.MIGRATION_DATABASE_URL!;
  localDatabaseTarget('test', url);
  localDatabaseTarget('test', config.connectionString);
  const owner = new pg.Client(poolOptions(config, url));
  await owner.connect();
  t.after(() => owner.end());
  await migrate(config, url);
  await seedOrReset(config, url, 'sikkim_test');

  const outbox: { channel: string; destination: string; code: string }[] = [];
  const app = await buildApp(config, {
    rateLimitMax: 10000,
    otpDelivery: async (message) => {
      outbox.push(message);
    },
  });
  t.after(() => app.close());

  // Sign-in routes allow 10 requests per minute per IP; spread test calls
  // across addresses so the suite exercises behaviour, not the limiter.
  let ip = 0;
  const nextIp = () => `10.0.${Math.floor(++ip / 250)}.${(ip % 250) + 1}`;
  const requestCode = (channel: string, destination: string) =>
    app.inject({
      method: 'POST',
      remoteAddress: nextIp(),
      url: '/v1/auth/otp/request',
      payload: { channel, destination },
    });
  const verify = (challengeId: string, code: string, extra = {}) =>
    app.inject({
      method: 'POST',
      remoteAddress: nextIp(),
      url: '/v1/auth/otp/verify',
      payload: { challengeId, code, ...extra },
    });
  const signIn = async (
    channel: string,
    destination: string,
    name?: string,
  ) => {
    const requested = await requestCode(channel, destination);
    assert.equal(requested.statusCode, 202, requested.body);
    const code = outbox.at(-1)!.code;
    const verified = await verify(
      requested.json().data.challengeId,
      code,
      name ? { displayName: name } : {},
    );
    assert.equal(verified.statusCode, 200, verified.body);
    const data = verified.json().data;
    return {
      ...data,
      headers: { authorization: `Bearer ${data.accessToken}` },
    };
  };
  const clearCooldown = () =>
    owner.query(
      "UPDATE public.auth_otp_challenges SET created_at = created_at - interval '1 hour'",
    );

  await t.test('email OTP creates an account, then signs back in', async () => {
    const requested = await requestCode('email', '  Mina@Example.TEST ');
    assert.equal(requested.statusCode, 202, requested.body);
    const body = requested.json().data;
    assert.equal(outbox.at(-1)!.destination, 'mina@example.test');
    assert.match(outbox.at(-1)!.code, /^\d{6}$/);
    assert.equal(body.destination, 'm•••@example.test');
    assert.equal(JSON.stringify(body).includes(outbox.at(-1)!.code), false);
    const stored = await owner.query(
      'SELECT code_hash FROM public.auth_otp_challenges WHERE id = $1',
      [body.challengeId],
    );
    assert.notEqual(stored.rows[0].code_hash, outbox.at(-1)!.code);

    const cooldown = await requestCode('email', 'mina@example.test');
    assert.equal(cooldown.statusCode, 429);

    const wrong = await verify(body.challengeId, '000000');
    assert.equal(
      wrong.statusCode,
      outbox.at(-1)!.code === '000000' ? 200 : 400,
    );
    const attempts = await owner.query(
      'SELECT attempts FROM public.auth_otp_challenges WHERE id = $1',
      [body.challengeId],
    );
    assert.equal(attempts.rows[0].attempts, 1, 'wrong codes are counted');

    const ok = await verify(body.challengeId, outbox.at(-1)!.code, {
      displayName: 'Mina Rai',
    });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().data.isNewAccount, true);
    assert.equal(ok.json().data.user.displayName, 'Mina Rai');
    assert.equal(ok.json().data.user.email, 'mina@example.test');
    assert.equal(ok.json().data.user.phone, null);
    assert.deepEqual(ok.json().data.user.summary, {
      bookings: 0,
      saved: 0,
      reels: 0,
    });
    const reused = await verify(body.challengeId, outbox.at(-1)!.code);
    assert.equal(reused.json().error.code, 'OTP_EXPIRED');

    await clearCooldown();
    const again = await signIn('email', 'mina@example.test');
    assert.equal(again.isNewAccount, false);
    assert.equal(again.user.id, ok.json().data.user.id);
  });

  await t.test(
    'phone OTP normalises local numbers and locks after 5 wrong codes',
    async () => {
      const requested = await requestCode('phone', '98000 12345');
      assert.equal(requested.statusCode, 202, requested.body);
      assert.equal(outbox.at(-1)!.destination, '+919800012345');
      const id = requested.json().data.challengeId;
      const real = outbox.at(-1)!.code;
      const wrong = real === '111111' ? '222222' : '111111';
      for (let i = 0; i < 5; i += 1) await verify(id, wrong);
      const locked = await verify(id, real);
      assert.equal(locked.statusCode, 429);
      assert.equal(locked.json().error.code, 'OTP_LOCKED');
      assert.equal((await requestCode('phone', '12')).statusCode, 400);

      await clearCooldown();
      const user = await signIn('phone', '+91 98000 12345', 'Pema');
      assert.equal(user.isNewAccount, true);
      assert.equal(user.user.phone, '+919800012345');
      assert.equal(user.user.email, null);
      await clearCooldown();
      const expiredRequest = await requestCode('phone', '9800012345');
      await owner.query(
        "UPDATE public.auth_otp_challenges SET expires_at = clock_timestamp() - interval '1 second' WHERE id = $1",
        [expiredRequest.json().data.challengeId],
      );
      const expired = await verify(
        expiredRequest.json().data.challengeId,
        outbox.at(-1)!.code,
      );
      assert.equal(expired.json().error.code, 'OTP_EXPIRED');
    },
  );

  await t.test(
    'password accounts can also sign in with an email code',
    async () => {
      const registered = await app.inject({
        method: 'POST',
        url: '/v1/auth/register',
        payload: {
          displayName: 'Asha',
          email: 'asha@example.test',
          password: 'correct horse battery',
        },
      });
      assert.equal(registered.statusCode, 201);
      const viaOtp = await signIn('email', 'asha@example.test');
      assert.equal(viaOtp.isNewAccount, false);
      assert.equal(viaOtp.user.id, registered.json().data.user.id);
    },
  );

  await t.test('suspended accounts cannot sign in with a code', async () => {
    await clearCooldown();
    const person = await signIn('email', 'blocked@example.test');
    await owner.query(
      "UPDATE public.users SET status = 'suspended' WHERE id = $1",
      [person.user.id],
    );
    await clearCooldown();
    const requested = await requestCode('email', 'blocked@example.test');
    const denied = await verify(
      requested.json().data.challengeId,
      outbox.at(-1)!.code,
    );
    assert.equal(denied.statusCode, 403);
  });

  await t.test('OTP is off unless configured', async () => {
    const closed = await buildApp(loadConfig({ ...process.env }), {
      rateLimitMax: 10000,
    });
    try {
      const r = await closed.inject({
        method: 'POST',
        url: '/v1/auth/otp/request',
        payload: { channel: 'email', destination: 'x@example.test' },
      });
      assert.equal(r.statusCode, 503);
    } finally {
      await closed.close();
    }
  });

  // Three account types.
  await clearCooldown();
  const traveller = await signIn(
    'email',
    'traveller@example.test',
    'Traveller T',
  );
  const staff = await signIn('email', 'staff@example.test', 'Admin A');
  const superUser = await signIn('phone', '+919811111111', 'Super S');
  await owner.query(
    `INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin'), ($2, 'super')`,
    [staff.user.id, superUser.user.id],
  );
  const call = (
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    who: { headers: Record<string, string> },
    payload?: object,
  ) =>
    app.inject({
      method,
      url: '/v1' + path,
      headers: who.headers,
      ...(payload ? { payload } : {}),
    });

  await t.test(
    'roles: super sees people and analytics; admin runs operations',
    async () => {
      for (const path of ['/admin/overview', '/admin/users']) {
        assert.equal(
          (await call('GET', path, traveller)).statusCode,
          403,
          path,
        );
        assert.equal((await call('GET', path, staff)).statusCode, 403, path);
        assert.equal(
          (await call('GET', path, superUser)).statusCode,
          200,
          path,
        );
      }
      for (const path of [
        '/admin/leads',
        '/admin/bookings',
        '/admin/queue',
        '/admin/hosts?status=pending',
      ]) {
        assert.equal(
          (await call('GET', path, traveller)).statusCode,
          403,
          path,
        );
        assert.equal((await call('GET', path, staff)).statusCode, 200, path);
        assert.equal(
          (await call('GET', path, superUser)).statusCode,
          200,
          path,
        );
      }
      const overview = (await call('GET', '/admin/overview', superUser)).json()
        .data;
      assert.ok(overview.accounts.total >= 6);
      assert.ok(overview.accounts.withPhone >= 2);
      assert.equal(overview.accounts.signups.length, 14);
      const people = (
        await call('GET', '/admin/users?q=9811111111', superUser)
      ).json().data;
      assert.equal(people.length, 1);
      assert.equal(people[0].phone, '+919811111111');
      assert.deepEqual(people[0].signInMethods, ['phone']);
      assert.ok(people[0].lastSignInAt);
      const admins = (
        await call('GET', '/admin/users?role=admin', superUser)
      ).json().data;
      assert.deepEqual(
        admins.map((u: { id: string }) => u.id),
        [staff.user.id],
      );
    },
  );

  await t.test('staff host profiles are approved straight away', async () => {
    const draft = await call('PUT', '/me/host', staff, {
      revision: 0,
      publicName: 'Sikkim Experiences team',
      story: 'Trips run by the Sikkim Experiences team.',
      serviceAreas: ['Gangtok'],
    });
    assert.equal(draft.statusCode, 200, draft.body);
    const submitted = await call('POST', '/me/host/submit', staff, {
      revision: draft.json().data.revision,
    });
    assert.equal(submitted.statusCode, 200, submitted.body);
    const host = submitted.json().data;
    assert.equal(host.status, 'approved');
    assert.equal(host.history.at(-1).method, 'staff');
    assert.ok(new Date(host.approvedUntil).getTime() > Date.now());

    const travellerDraft = await call('PUT', '/me/host', traveller, {
      revision: 0,
      publicName: 'T',
      story: 'Walks.',
      serviceAreas: ['Gangtok'],
    });
    const travellerSubmit = await call('POST', '/me/host/submit', traveller, {
      revision: travellerDraft.json().data.revision,
    });
    assert.equal(
      travellerSubmit.statusCode,
      503,
      'non-staff still need verification',
    );
  });

  await t.test(
    'anyone can share a reel; it goes live after review',
    async () => {
      const videoPath = join(directory, 'reel.mp4');
      await promisify(execFile)('ffmpeg', [
        '-nostdin',
        '-v',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=red:s=64x96:d=1',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        videoPath,
      ]);
      const video = await readFile(videoPath);
      const intent = await call('POST', '/me/media', traveller, {
        purpose: 'public_content',
        contentType: 'video/mp4',
        bytes: video.length,
        author: 'Traveller T',
        permissionNote: 'My own video.',
        place: 'Tsomgo Lake',
        altText: 'Red test frame',
        captions: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello.\n',
      });
      assert.equal(intent.statusCode, 201, intent.body);
      const asset = intent.json().data;
      const put = await app.inject({
        method: 'PUT',
        url: asset.uploadUrl,
        headers: {
          ...traveller.headers,
          'content-type': 'application/octet-stream',
        },
        payload: video,
      });
      assert.equal(put.statusCode, 202, put.body);
      let ready = asset;
      for (
        let i = 0;
        i < 100 && !['ready', 'failed'].includes(ready.state);
        i += 1
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        ready = (await call('GET', `/me/media/${asset.id}`, traveller)).json()
          .data;
      }
      assert.equal(ready.state, 'ready');

      const reel = await call('POST', '/me/reels', traveller, {
        assetId: asset.id,
        caption: 'First snow at Tsomgo',
        place: 'Tsomgo Lake',
      });
      assert.equal(reel.statusCode, 201, reel.body);
      assert.equal(
        (await call('POST', '/me/reels', traveller, { assetId: asset.id }))
          .statusCode,
        400,
      );
      assert.equal(
        (await call('POST', '/me/reels', staff, { assetId: asset.id }))
          .statusCode,
        400,
      );
      assert.equal(
        (await app.inject('/v1/community-reels')).json().data.length,
        0,
      );
      const mine = (await call('GET', '/me/reels', traveller)).json().data;
      assert.equal(mine[0].status, 'in_review');

      const decision = await call(
        'POST',
        `/admin/media/${asset.id}/decisions`,
        staff,
        {
          revision: ready.revision,
          action: 'approved',
          reason: 'Own footage, rights confirmed.',
        },
      );
      assert.equal(decision.statusCode, 204, decision.body);
      const feed = (await app.inject('/v1/community-reels')).json().data;
      assert.equal(feed.length, 1);
      assert.equal(feed[0].caption, 'First snow at Tsomgo');
      assert.equal(feed[0].creator.name, 'Traveller T');
      const stream = await app.inject({
        url: feed[0].media.urls.video,
        headers: { range: 'bytes=0-9' },
      });
      assert.equal(
        stream.statusCode,
        206,
        'approved reel videos are publicly playable',
      );

      const removed = await app.inject({
        method: 'DELETE',
        url: `/v1/me/reels/${reel.json().data.id}`,
        headers: traveller.headers,
      });
      assert.equal(removed.statusCode, 204);
      assert.equal(
        (await app.inject('/v1/community-reels')).json().data.length,
        0,
      );
      assert.equal(
        (await app.inject(feed[0].media.urls.video)).statusCode,
        404,
      );
    },
  );
});
