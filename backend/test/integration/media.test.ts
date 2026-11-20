import { assetService } from '../../src/media/assets.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import pg from 'pg';
import { buildApp } from '../../src/app.js';
import { loadConfig, localDatabaseTarget } from '../../src/config.js';
import { createDatabase, poolOptions } from '../../src/db/database.js';
import { migrate, seedOrReset } from '../../src/db/maintenance.js';

test('media, saved ideas, reels and Community stories against local PostgreSQL', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sikkim-media-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = loadConfig({
    ...process.env,
    ENABLE_DEMO_AUTH: 'true',
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
  const app = await buildApp(config, { rateLimitMax: 10000 });
  t.after(() => app.close());
  const a = (
    await app.inject({
      method: 'POST',
      url: '/v1/auth/demo',
      payload: { account: 'traveller-one' },
    })
  ).json().data;
  const b = (
    await app.inject({
      method: 'POST',
      url: '/v1/auth/demo',
      payload: { account: 'traveller-two' },
    })
  ).json().data;
  const ah = { authorization: `Bearer ${a.accessToken}` };
  const bh = { authorization: `Bearer ${b.accessToken}` };
  await owner.query('UPDATE public.users SET is_demo = false WHERE id = $1', [
    a.user.id,
  ]);
  await owner.query(
    "INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')",
    [b.user.id],
  );
  const host = (
    await owner.query(
      `
        INSERT INTO public.hosts (user_id, public_name, status, approved_until)
        VALUES
          (
            $1,
            'Test host',
            'approved',
            clock_timestamp() + interval '1 day'
          )
        RETURNING id
      `,
      [a.user.id],
    )
  ).rows[0].id;
  const experience = (
    await owner.query(
      `
        INSERT INTO public.experiences (
            host_id,
            slug,
            title,
            description,
            area_code,
            meeting_point,
            duration_minutes,
            price_paise
          )
        VALUES
          (
            $1,
            'media-test',
            'Test experience',
            'Test details',
            'pakyong',
            'Test place',
            60,
            100
          )
        RETURNING id
      `,
      [host],
    )
  ).rows[0].id;
  const policy = (
    await owner.query(
      `
        INSERT INTO public.policies (
            experience_id,
            version,
            cancellation,
            safety,
            participation
          )
        VALUES
          (
            $1,
            1,
            'Test cancellation',
            'Test safety',
            'Test participation'
          )
        RETURNING id
      `,
      [experience],
    )
  ).rows[0].id;
  await owner.query(
    'UPDATE public.experiences SET policy_id = $2 WHERE id = $1',
    [experience, policy],
  );
  await owner.query(
    "INSERT INTO public.experience_categories VALUES ($1, 'nature')",
    [experience],
  );
  const videoPath = join(directory, 'fixture.mp4');
  await promisify(execFile)('ffmpeg', [
    '-nostdin',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=64x96:d=1',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    videoPath,
  ]);
  const video = await readFile(videoPath);
  const imagePath = join(directory, 'fixture.png');
  await promisify(execFile)('ffmpeg', [
    '-nostdin',
    '-v',
    'error',
    '-f',
    'lavfi',
    '-i',
    'color=c=black:s=64x96',
    '-frames:v',
    '1',
    imagePath,
  ]);
  const png = await readFile(imagePath);
  const metadata = {
    purpose: 'public_content',
    contentType: 'video/mp4',
    bytes: video.length,
    author: 'Test author',
    sourceUrl: 'https://example.com/source',
    licenceUrl: 'https://example.com/licence',
    permissionNote: 'Test fixture only.',
    place: 'Test location',
    altText: 'Test video',
    captions: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nTest frame.\n',
  };
  async function intent(overrides = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/me/media',
      headers: ah,
      payload: { ...metadata, ...overrides },
    });
    assert.equal(response.statusCode, 201, response.body);
    return response.json().data;
  }
  async function ready(id: string, expected = 'ready') {
    for (let i = 0; i < 100; i++) {
      const response = await app.inject({
        url: `/v1/me/media/${id}`,
        headers: ah,
      });
      assert.equal(response.statusCode, 200, response.body);
      if (['ready', 'failed'].includes(response.json().data.state)) {
        assert.equal(response.json().data.state, expected, response.body);
        return response.json().data;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail('Media processing did not finish');
  }
  async function upload(
    asset: { id: string; uploadUrl: string },
    bytes: Buffer,
    expected = 'ready',
  ) {
    const response = await app.inject({
      method: 'PUT',
      url: asset.uploadUrl,
      headers: { ...ah, 'content-type': 'application/octet-stream' },
      payload: bytes,
    });
    assert.equal(response.statusCode, 202, response.body);
    return ready(asset.id, expected);
  }
  let clip: { id: string; revision: number };
  await t.test(
    'valid video creates a poster and captions; unsafe uploads fail and remain private',
    async () => {
      const invalid = await app.inject({
        method: 'POST',
        url: '/v1/me/media',
        headers: ah,
        payload: { ...metadata, captions: '' },
      });
      assert.equal(invalid.statusCode, 400);
      const oversized = await app.inject({
        method: 'POST',
        url: '/v1/me/media',
        headers: ah,
        payload: { ...metadata, bytes: 52428801 },
      });
      assert.equal(oversized.statusCode, 400);
      const asset = await intent();
      const other = await app.inject({
        method: 'PUT',
        url: asset.uploadUrl,
        headers: { ...bh, 'content-type': 'application/octet-stream' },
        payload: video,
      });
      assert.equal(other.statusCode, 404);
      clip = await upload(asset, video);
      const detail = (
        await app.inject({ url: `/v1/me/media/${clip.id}`, headers: ah })
      ).json().data;
      assert.deepEqual(detail.variants.sort(), ['captions', 'poster', 'video']);
      assert.equal(detail.moderation, 'pending');
      const repeated = await app.inject({
        method: 'PUT',
        url: asset.uploadUrl,
        headers: { ...ah, 'content-type': 'application/octet-stream' },
        payload: video,
      });
      assert.equal(repeated.statusCode, 409);
      const bad = await intent({ bytes: 12 });
      await upload(bad, Buffer.from('not-a-video!'), 'failed');
      const retry = await app.inject({
        method: 'POST',
        url: `/v1/me/media/${bad.id}/retry`,
        headers: ah,
        payload: { revision: 1 },
      });
      assert.equal(retry.statusCode, 202);
      await ready(bad.id, 'failed');
    },
  );
  await t.test(
    'only the owner can delete the current media revision and its files',
    async () => {
      const asset = await intent({
        contentType: 'image/png',
        bytes: png.length,
      });
      await upload(asset, png);
      const remove = (headers: typeof ah, revision: number) =>
        app.inject({
          method: 'POST',
          url: `/v1/me/media/${asset.id}/remove`,
          headers,
          payload: { revision },
        });
      assert.equal((await remove(bh, 1)).statusCode, 404);
      assert.equal((await remove(ah, 2)).statusCode, 409);
      assert.ok((await stat(join(directory, asset.id, 'image.webp'))).isFile());
      assert.equal((await remove(ah, 1)).statusCode, 204);
      await assert.rejects(stat(join(directory, asset.id)), { code: 'ENOENT' });
      const row = (
        await owner.query(
          'SELECT state, variants, failure_code FROM public.media_assets WHERE id = $1',
          [asset.id],
        )
      ).rows[0];
      assert.deepEqual(row, {
        state: 'deleted',
        variants: {},
        failure_code: null,
      });
      assert.equal(
        (await app.inject({ url: `/v1/me/media/${asset.id}`, headers: ah }))
          .statusCode,
        404,
      );
    },
  );
  await t.test(
    'private evidence requires ownership/admin and cannot be publicly downloaded',
    async () => {
      const privateAsset = await intent({
        purpose: 'private_evidence',
        contentType: 'image/png',
        bytes: png.length,
      });
      await upload(privateAsset, png);
      const preview = await app.inject({
        method: 'POST',
        url: `/v1/me/media/${privateAsset.id}/image/preview`,
        headers: ah,
      });
      assert.equal(preview.statusCode, 200, preview.body);
      const link = preview.json().data.url;
      assert.equal((await app.inject({ url: link })).statusCode, 401);
      assert.equal(
        (await app.inject({ url: link, headers: ah })).statusCode,
        200,
      );
      assert.equal(
        (await app.inject({ url: link.replace('/me/media/', '/media/') }))
          .statusCode,
        404,
      );
      await owner.query('DELETE FROM public.user_roles WHERE user_id = $1', [
        b.user.id,
      ]);
      assert.equal(
        (await app.inject({ url: link, headers: bh })).statusCode,
        403,
      );
      await owner.query(
        "INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')",
        [b.user.id],
      );
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: `/v1/admin/media/${privateAsset.id}/decisions`,
            headers: bh,
            payload: { revision: 1, action: 'approved', reason: 'Test' },
          })
        ).statusCode,
        403,
      );
    },
  );
  await t.test(
    'approval, attachment and publishing expose reels with revocable links and ranges',
    async () => {
      const decision = await app.inject({
        method: 'POST',
        url: `/v1/admin/media/${clip.id}/decisions`,
        headers: bh,
        payload: {
          revision: clip.revision,
          action: 'approved',
          reason: 'Test rights checked',
        },
      });
      assert.equal(decision.statusCode, 204, decision.body);
      const attach = await app.inject({
        method: 'PUT',
        url: `/v1/me/experiences/${experience}/media`,
        headers: ah,
        payload: {
          revision: 1,
          items: [{ assetId: clip.id, purpose: 'reel' }],
        },
      });
      assert.equal(attach.statusCode, 200, attach.body);
      assert.equal((await app.inject('/v1/reels')).json().data.length, 0);
      const submit = await app.inject({
        method: 'POST',
        url: `/v1/me/experiences/${experience}/submit`,
        headers: ah,
        payload: { revision: 2 },
      });
      assert.equal(submit.statusCode, 200, submit.body);
      const publish = await app.inject({
        method: 'POST',
        url: `/v1/admin/experiences/${experience}/decisions`,
        headers: bh,
        payload: {
          revision: 3,
          action: 'published',
          reason: 'Test',
          providerReference: 'Test provider',
        },
      });
      assert.equal(publish.statusCode, 200, publish.body);
      const feed = (await app.inject('/v1/reels')).json().data;
      assert.equal(feed.length, 1);
      assert.equal(feed[0].media.credit.author, 'Test author');
      const link = feed[0].media.urls.video;
      const range = await app.inject({
        url: link,
        headers: { range: 'bytes=0-9' },
      });
      assert.equal(range.statusCode, 206, range.body);
      assert.equal(range.rawPayload.length, 10);
      assert.equal(
        (await app.inject({ url: link, headers: { range: 'bytes=99999999-' } }))
          .statusCode,
        416,
      );
      assert.equal(
        (await app.inject(link.replace(/expires=\d+/, 'expires=1'))).statusCode,
        403,
      );
      const detail = (await app.inject('/v1/experiences/media-test')).json()
        .data;
      assert.equal(detail.media.length, 1);
    },
  );
  await t.test(
    'saves and likes are repeat-safe, isolated and survive hidden content',
    async () => {
      for (const route of ['saved', 'likes']) {
        const responses = await Promise.all(
          Array.from({ length: 3 }, () =>
            app.inject({
              method: 'PUT',
              url: `/v1/me/${route}/experiences/${experience}`,
              headers: bh,
            }),
          ),
        );
        responses.forEach((response) =>
          assert.equal(response.statusCode, 204, response.body),
        );
      }
      const state = (
        await app.inject({
          url: `/v1/me/experience-actions?ids=${experience}`,
          headers: bh,
        })
      ).json().data[0];
      assert.equal(state.likeCount, 1);
      assert.equal(state.saved, true);
      assert.equal(state.liked, true);
      assert.equal(
        (await app.inject({ url: '/v1/me/saved', headers: ah })).json().data
          .length,
        0,
      );
      assert.equal(
        (await app.inject({ url: '/v1/me/saved', headers: bh })).json().data[0]
          .experience.title,
        'Test experience',
      );
      const link = (await app.inject('/v1/reels')).json().data[0].media.urls
        .video;
      await owner.query(
        "UPDATE public.experiences SET status = 'hidden' WHERE id = $1",
        [experience],
      );
      assert.equal((await app.inject('/v1/reels')).json().data.length, 0);
      assert.equal((await app.inject(link)).statusCode, 404);
      const tombstone = (
        await app.inject({ url: '/v1/me/saved', headers: bh })
      ).json().data[0];
      assert.equal(tombstone.experience, null);
      assert.equal(tombstone.unavailable, true);
      for (let i = 0; i < 2; i++) {
        assert.equal(
          (
            await app.inject({
              method: 'DELETE',
              url: `/v1/me/saved/experiences/${experience}`,
              headers: bh,
            })
          ).statusCode,
          204,
        );
      }
    },
  );
  await t.test(
    'Community stories expire and seen markers are idempotent',
    async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/v1/me/stories',
        headers: ah,
        payload: {
          title: 'Test day',
          frames: [{ assetId: clip.id, caption: 'Test view' }],
        },
      });
      assert.equal(created.statusCode, 201, created.body);
      const id = created.json().data.id;
      const published = await app.inject({
        method: 'POST',
        url: `/v1/me/stories/${id}/publish`,
        headers: ah,
        payload: { revision: 1 },
      });
      assert.equal(published.statusCode, 204, published.body);
      assert.equal((await app.inject('/v1/stories')).json().data.length, 1);
      const detail = (await app.inject(`/v1/stories/${id}`)).json().data;
      const link = detail.frames[0].media.urls.video;
      assert.equal((await app.inject(link)).statusCode, 200);
      for (let i = 0; i < 2; i++) {
        assert.equal(
          (
            await app.inject({
              method: 'PUT',
              url: `/v1/me/stories/${id}/seen`,
              headers: bh,
            })
          ).statusCode,
          204,
        );
      }
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int AS n FROM public.story_views WHERE story_id = $1',
            [id],
          )
        ).rows[0].n,
        1,
      );
      await owner.query(
        `
          UPDATE public.stories
          SET
            published_at = CURRENT_TIMESTAMP - interval '2 days',
            expires_at = CURRENT_TIMESTAMP - interval '1 day'
          WHERE id = $1
        `,
        [id],
      );
      assert.equal((await app.inject('/v1/stories')).json().data.length, 0);
      assert.equal((await app.inject(`/v1/stories/${id}`)).statusCode, 404);
      assert.equal((await app.inject(link)).statusCode, 404);
      assert.equal(
        (
          await app.inject({
            method: 'PUT',
            url: `/v1/me/stories/${id}/seen`,
            headers: bh,
          })
        ).statusCode,
        404,
      );
    },
  );
  await t.test(
    'declared sizes, stale revisions and self-approval cannot bypass upload rules',
    async () => {
      const tooSmall = await intent({ bytes: 2 });
      const response = await app.inject({
        method: 'PUT',
        url: tooSmall.uploadUrl,
        headers: { ...ah, 'content-type': 'application/octet-stream' },
        payload: video,
      });
      assert.equal(response.statusCode, 400, response.body);
      const detail = await app.inject({
        url: '/v1/me/media/' + tooSmall.id,
        headers: ah,
      });
      assert.equal(detail.json().data.state, 'failed');
      await owner.query(
        "INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')",
        [a.user.id],
      );
      const self = await app.inject({
        method: 'POST',
        url: `/v1/admin/media/${clip.id}/decisions`,
        headers: ah,
        payload: { revision: 2, action: 'approved', reason: 'Self approval' },
      });
      assert.equal(self.statusCode, 403);
      await owner.query('DELETE FROM public.user_roles WHERE user_id = $1', [
        a.user.id,
      ]);
      const stale = await app.inject({
        method: 'POST',
        url: `/v1/admin/media/${clip.id}/decisions`,
        headers: bh,
        payload: { revision: 1, action: 'rejected', reason: 'Stale decision' },
      });
      assert.equal(stale.statusCode, 409);
    },
  );

  await t.test(
    'reels and saved lists paginate without duplicates and approval revokes old links',
    async () => {
      const ids: string[] = [];
      for (let index = 0; index < 24; index++) {
        const id = (
          await owner.query(
            `
              INSERT INTO public.experiences (host_id, slug, title, area_code, status)
              VALUES
                (
                  $1,
                  $2,
                  'Pagination fixture',
                  'pakyong',
                  'published'
                )
              RETURNING id
            `,
            [host, 'media-page-' + index],
          )
        ).rows[0].id;
        const policyId = (
          await owner.query(
            `
              INSERT INTO public.policies (
                  experience_id,
                  version,
                  cancellation,
                  safety,
                  participation
                )
              VALUES
                ($1, 1, 'Test', 'Test', 'Test')
              RETURNING id
            `,
            [id],
          )
        ).rows[0].id;
        await owner.query(
          'UPDATE public.experiences SET policy_id = $2 WHERE id = $1',
          [id, policyId],
        );
        await owner.query(
          "INSERT INTO public.experience_categories VALUES ($1, 'nature')",
          [id],
        );
        await owner.query(
          "INSERT INTO public.experience_media VALUES ($1, $2, 0, 'reel')",
          [id, clip.id],
        );
        assert.equal(
          (
            await app.inject({
              method: 'PUT',
              url: `/v1/me/saved/experiences/${id}`,
              headers: bh,
            })
          ).statusCode,
          204,
        );
        ids.push(id);
      }
      for (const path of ['/v1/reels', '/v1/me/saved']) {
        const first = (await app.inject({ url: path, headers: bh })).json();
        assert.equal(first.data.length, 20);
        assert.ok(first.page.nextCursor);
        const second = (
          await app.inject({
            url: path + '?after=' + first.page.nextCursor,
            headers: bh,
          })
        ).json();
        assert.equal(second.data.length, 4);
        assert.equal(second.page.nextCursor, null);
        const actual = [...first.data, ...second.data].map(
          (row: { id: string; experience: { id: string } }) =>
            path.endsWith('/reels') ? row.experience.id : row.id,
        );
        assert.deepEqual(actual.sort(), ids.sort());
      }
      const link = (await app.inject('/v1/reels')).json().data[0].media.urls
        .video;
      const rejected = await app.inject({
        method: 'POST',
        url: `/v1/admin/media/${clip.id}/decisions`,
        headers: bh,
        payload: {
          revision: 2,
          action: 'rejected',
          reason: 'Permission withdrawn in test',
        },
      });
      assert.equal(rejected.statusCode, 204, rejected.body);
      assert.equal((await app.inject(link)).statusCode, 404);
      assert.equal((await app.inject('/v1/reels')).json().data.length, 0);
    },
  );

  await t.test(
    'interrupted uploads recover and abandoned files are cleaned without deleting ready evidence',
    async () => {
      const abandoned = await intent();
      const interrupted = await intent();
      await owner.query(
        `
          UPDATE public.media_assets
          SET
            updated_at = clock_timestamp() - interval '2 days'
          WHERE id = $1
        `,
        [abandoned.id],
      );
      await owner.query(
        `
          UPDATE public.media_assets
          SET
            state = 'processing',
            updated_at = clock_timestamp() - interval '10 minutes'
          WHERE id = $1
        `,
        [interrupted.id],
      );
      const database = createDatabase(config, () => {});
      try {
        await assetService(database, config).recover();
        assert.equal(
          (
            await app.inject({
              url: '/v1/me/media/' + abandoned.id,
              headers: ah,
            })
          ).statusCode,
          404,
        );
        const state = (
          await app.inject({
            url: '/v1/me/media/' + interrupted.id,
            headers: ah,
          })
        ).json().data;
        assert.equal(state.state, 'failed');
        assert.equal(state.failureCode, 'PROCESSING_INTERRUPTED');
        assert.equal(
          (
            await owner.query(
              `
                SELECT count(*)::int AS n
                FROM public.media_assets
                WHERE purpose = 'private_evidence'
                  AND state = 'ready'
              `,
            )
          ).rows[0].n,
          1,
        );
        assert.equal(
          (
            await owner.query(
              'SELECT count(*)::int AS n FROM public.story_views',
            )
          ).rows[0].n,
          0,
        );
        const exported = await app.inject({
          method: 'GET',
          url: '/v1/me/export',
          headers: ah,
        });
        assert.equal(exported.statusCode, 200, exported.body);
        assert.ok(exported.json().data.media.assets.length > 0);
        assert.ok(exported.json().data.media.stories[0].frames.length > 0);
      } finally {
        await database.close();
      }
    },
  );
});
