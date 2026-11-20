import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { loadConfig, localDatabaseTarget, databaseUrl } from '../config.js';
import { poolOptions } from '../db/database.js';
import { localMediaStorage } from '../media/storage.js';
import { validateCaptions } from '../media/model.js';

// Existing credited clips only. These fixtures never represent a bookable route
// or verified provider, and this command is blocked outside local development.
const clips = [
  [
    'nathu',
    'sunrise-in-the-himalayas',
    'Nathu La, Sikkim',
    'Mountain_Landscape_near_Nathu_La_Pass,_Sikkim.webm',
  ],
  [
    'enchey',
    'monastery-stories',
    'Enchey Monastery, Gangtok',
    'Prayer_flags_at_Enchey_Monastery,_Gangtok.webm',
  ],
  [
    'tsongmo',
    'ridge-walk',
    'Tsongmo Lake, Sikkim',
    'Tsongmo_Lake,_Sikkim,_2026.webm',
  ],
] as const;

async function main() {
  const config = loadConfig();
  const url = process.env.MIGRATION_DATABASE_URL;
  const argument = process.argv[2];
  if (
    !config.media ||
    config.mode !== 'development' ||
    !config.demoAuth ||
    !url ||
    !argument?.startsWith('--from=') ||
    process.argv.length !== 3
  ) {
    throw new Error(
      'Use local media preview with --from=<credited frontend videos directory>.',
    );
  }
  localDatabaseTarget(config.mode, url);
  localDatabaseTarget(config.mode, config.connectionString);
  const owner = databaseUrl(url);
  const runtime = databaseUrl(config.connectionString);
  if (owner.host !== runtime.host || owner.pathname !== runtime.pathname) {
    throw new Error('Database targets must match.');
  }
  const source = resolve(argument.slice(7));
  const credits = await readFile(join(source, 'CREDITS.txt'), 'utf8');
  if (
    !credits.includes('Rajani Gairshail') ||
    !credits.includes('https://creativecommons.org/licenses/by-sa/4.0/')
  ) {
    throw new Error('The expected Commons credit record is required.');
  }
  const db = new pg.Client(poolOptions(config, url));
  await db.connect();
  const storage = localMediaStorage(config.media.directory);
  try {
    const marker = await db.query(`
      SELECT shobj_description(oid, 'pg_database') AS marker
      FROM pg_database
      WHERE datname = current_database()
    `);
    if (marker.rows[0].marker !== 'sikkim-local-only') {
      throw new Error('Local marker required.');
    }
    for (const [index, [name, slug, place, file]] of clips.entries()) {
      if (!credits.includes(file)) {
        throw new Error('A source credit is missing.');
      }
      const experience = (
        await db.query(
          `
            SELECT
              e.id,
              e.host_id,
              h.user_id
            FROM public.experiences e
              JOIN public.hosts h ON h.id = e.host_id
            WHERE e.slug = $1
              AND e.source_reference = 'local-design-preview'
          `,
          ['preview-' + slug],
        )
      ).rows[0];
      if (!experience) {
        throw new Error('Run db:preview first.');
      }
      const id = `d37e0000-0000-4000-8000-${String(6000 + index).padStart(12, '0')}`;
      const storyId = `d37e0000-0000-4000-8000-${String(7000 + index).padStart(12, '0')}`;
      const existing = (
        await db.query('SELECT state FROM public.media_assets WHERE id = $1', [
          id,
        ])
      ).rows[0];
      if (!existing) {
        // Clear files left by an interrupted import with no database record.
        await storage.remove(id);
        const input = join(source, name + '.mp4');
        const captions = validateCaptions(
          await readFile(join(source, name + '.vtt'), 'utf8'),
        );
        await storage.receive(
          id,
          createReadStream(input),
          (await stat(input)).size,
        );
        const variants = await storage.process(id, 'video/mp4', captions);
        await db.query(
          `
            INSERT INTO public.media_assets (
                id,
                owner_id,
                purpose,
                kind,
                content_type,
                expected_bytes,
                state,
                moderation,
                author,
                source_url,
                licence_url,
                permission_note,
                place,
                alt_text,
                captions,
                variants,
                review_reason
              )
            VALUES
              (
                $1,
                $2,
                'public_content',
                'video',
                'video/mp4',
                $3,
                'ready',
                'approved',
                'Rajani Gairshail',
                $4,
                'https://creativecommons.org/licenses/by-sa/4.0/',
                $5,
                $6,
                $7,
                $8,
                $9,
                'Local preview: existing Commons credit record; no provider endorsement'
              )
          `,
          [
            id,
            experience.user_id,
            (await stat(input)).size,
            'https://commons.wikimedia.org/wiki/File:' + file,
            'CC BY-SA 4.0; edited eight-second clip, resized/re-encoded, ' +
              'poster and English descriptions. ' +
              'Preview inspiration only, not this fictional host or route.',
            place,
            'Real location footage: ' + place,
            captions,
            variants,
          ],
        );
        await storage.removeSource(id);
      } else if (existing.state !== 'ready') {
        throw new Error(
          'An existing preview asset needs attention; it was not overwritten.',
        );
      }
      await db.query(
        `
          INSERT INTO public.experience_media (experience_id, asset_id, position, purpose)
          VALUES
            ($1, $2, 0, 'reel')
          ON CONFLICT DO NOTHING
        `,
        [experience.id, id],
      );
      await db.query(
        `
          INSERT INTO public.stories (
              id,
              host_id,
              title,
              status,
              published_at,
              expires_at
            )
          VALUES
            (
              $1,
              $2,
              $3,
              'published',
              statement_timestamp(),
              statement_timestamp() + interval '24 hours'
            )
          ON CONFLICT (id) DO NOTHING
        `,
        [storyId, experience.host_id, place],
      );
      await db.query(
        `
          INSERT INTO public.story_items (story_id, asset_id, position, caption)
          VALUES
            (
              $1,
              $2,
              0,
              $3
            )
          ON CONFLICT DO NOTHING
        `,
        [storyId, id, place],
      );
    }
    console.log(
      'Three credited preview reels and Community stories are ready.',
    );
  } finally {
    await db.end();
  }
}
main().catch(() => {
  console.error(
    'Media preview failed. Check the local setup, source credits and ffmpeg installation.',
  );
  process.exitCode = 1;
});
