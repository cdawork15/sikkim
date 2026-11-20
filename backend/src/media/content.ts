import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { accountAccess } from '../accounts/access.js';
import { AccountError } from '../accounts/model.js';
import { requirePublishableHost } from '../hosts/service.js';
import { changed, invalid, missing } from '../catalogue/model.js';
import { hydrateCards, summary } from '../catalogue/read.js';
import { joins, visible } from '../catalogue/visibility.js';
import { audit } from '../db/audit.js';
import { mediaCard, type Asset } from './delivery.js';
import { mediaMissing } from './model.js';
import { approvedAsset, visibleStory } from './visibility.js';

export type Frame = { assetId: string; caption: string };

export type Placement = {
  assetId: string;
  purpose: 'gallery' | 'cover' | 'reel';
};

async function ownedAssets(client: PoolClient, ids: string[], userId: string) {
  if (new Set(ids).size !== ids.length) {
    throw invalid('Choose each file only once.');
  }
  const rows = (
    await client.query<Asset>(
      `
        SELECT *
        FROM public.media_assets
        WHERE id = ANY ($1::uuid[])
          AND owner_id = $2
          AND purpose = 'public_content'
          AND state = 'ready'
        ORDER BY id
        FOR SHARE
      `,
      [ids, userId],
    )
  ).rows;
  if (rows.length !== ids.length) {
    throw invalid('Choose your own ready public media.');
  }
  return rows;
}

const storyJoins = `
  FROM public.stories s
  JOIN public.hosts sh ON sh.id = s.host_id
  JOIN public.users su ON su.id = sh.user_id
`;

export function contentService(database: Database, config: Config) {
  const access = accountAccess(database, config);
  return {
    attach: (
      token: string,
      id: string,
      revision: number,
      items: Placement[],
      requestId: string,
    ) =>
      access(token, async (client, p) => {
        const experience = (
          await client.query(
            `
              SELECT
                e.id,
                e.revision,
                e.status
              FROM public.experiences e
                JOIN public.hosts h ON h.id = e.host_id
              WHERE e.id = $1
                AND h.user_id = $2
              FOR UPDATE OF e
            `,
            [id, p.userId],
          )
        ).rows[0];
        if (!experience) {
          throw missing();
        }
        if (
          experience.revision !== revision ||
          experience.status === 'review'
        ) {
          throw changed();
        }
        const assets = await ownedAssets(
          client,
          items.map((item) => item.assetId),
          p.userId,
        );
        for (const purpose of ['cover', 'reel']) {
          if (items.filter((item) => item.purpose === purpose).length > 1) {
            throw invalid('Choose at most one cover and one reel.');
          }
        }
        for (const item of items) {
          const asset = assets.find((asset) => asset.id === item.assetId)!;
          if ((item.purpose === 'reel') !== (asset.kind === 'video')) {
            throw invalid(
              'Use images for the gallery/cover, and a video for the reel.',
            );
          }
        }
        await client.query(
          'DELETE FROM public.experience_media WHERE experience_id = $1',
          [id],
        );
        for (const [position, item] of items.entries()) {
          await client.query(
            `
              INSERT INTO
                public.experience_media (experience_id, asset_id, position, purpose)
              VALUES
                ($1, $2, $3, $4)
            `,
            [id, item.assetId, position, item.purpose],
          );
        }
        await client.query(
          `
            UPDATE public.experiences
            SET
              status = 'draft',
              revision = revision + 1,
              featured_rank = NULL,
              updated_at = clock_timestamp()
            WHERE id = $1
          `,
          [id],
        );
        await audit(
          client,
          p.userId,
          'experience.media_changed',
          requestId,
          'experience',
          id,
        );
        return { revision: revision + 1, status: 'draft' };
      }),

    placements: (token: string, id: string) =>
      access(token, async (client, p) => {
        const owned = await client.query(
          `
            SELECT e.id
            FROM public.experiences e
              JOIN public.hosts h ON h.id = e.host_id
            WHERE e.id = $1
              AND h.user_id = $2
          `,
          [id, p.userId],
        );
        if (!owned.rowCount) {
          throw missing();
        }
        return (
          await client.query(
            `
              SELECT
                asset_id AS "assetId",
                purpose
              FROM public.experience_media
              WHERE experience_id = $1
              ORDER BY position
            `,
            [id],
          )
        ).rows;
      }),

    reels: (after?: string) =>
      database.transaction(async (client) => {
        if (!config.media) {
          return { data: [], page: { nextCursor: null } };
        }
        const rows = (
          await client.query(
            `
              SELECT
                ${summary},
                to_jsonb(m) AS asset
                ${joins}
                JOIN public.experience_media em ON em.experience_id = e.id
                AND em.purpose = 'reel'
                JOIN public.media_assets m ON m.id = em.asset_id
              WHERE ${visible}
                AND ${approvedAsset}
                AND m.kind = 'video'
                AND (
                  $1::uuid IS NULL
                  OR e.id > $1
                )
              ORDER BY e.id
              LIMIT 21
            `,
            [after ?? null],
          )
        ).rows;
        const experiences = await hydrateCards(
          client,
          rows.slice(0, 20).map(({ asset: _, ...experience }) => experience),
        );
        return {
          data: rows.slice(0, 20).map(({ asset }, index) => ({
            experience: experiences[index],
            media: mediaCard(asset, config),
          })),
          page: { nextCursor: rows.length > 20 ? rows[19].id : null },
        };
      }),

    stories: (after?: string) =>
      database.transaction(async (client) => {
        if (!config.media) {
          return { data: [], page: { nextCursor: null } };
        }
        const rows = (
          await client.query(
            `
              SELECT
                s.id,
                s.title,
                s.expires_at AS "expiresAt",
                sh.public_name AS "hostName",
                sh.id AS "hostId",
                (
                  SELECT to_jsonb(m)
                  FROM public.story_items si
                    JOIN public.media_assets m ON m.id = si.asset_id
                  WHERE si.story_id = s.id
                  ORDER BY si.position
                  LIMIT 1
                ) AS cover ${storyJoins}
              WHERE ${visibleStory}
                AND (
                  $1::uuid IS NULL
                  OR s.id > $1
                )
              ORDER BY s.id
              LIMIT 21
            `,
            [after ?? null],
          )
        ).rows;
        return {
          data: rows
            .slice(0, 20)
            .map((row) => ({ ...row, cover: mediaCard(row.cover, config) })),
          page: { nextCursor: rows.length > 20 ? rows[19].id : null },
        };
      }),

    story: (id: string) =>
      database.transaction(async (client) => {
        if (!config.media) {
          throw mediaMissing();
        }
        const story = (
          await client.query(
            `
              SELECT
                s.id,
                s.title,
                s.expires_at AS "expiresAt",
                sh.public_name AS "hostName" ${storyJoins}
              WHERE s.id = $1
                AND ${visibleStory}
            `,
            [id],
          )
        ).rows[0];
        if (!story) {
          throw mediaMissing();
        }
        const frames = (
          await client.query<Asset & { caption: string }>(
            `
              SELECT
                m.*,
                si.caption
              FROM public.story_items si
                JOIN public.media_assets m ON m.id = si.asset_id
              WHERE si.story_id = $1
              ORDER BY si.position
            `,
            [id],
          )
        ).rows;
        return {
          ...story,
          frames: frames.map((row) => ({
            caption: row.caption,
            media: mediaCard(row, config),
          })),
        };
      }),

    ownStories: (token: string, after?: string) =>
      access(token, async (client, p) => {
        const rows = (
          await client.query(
            `
              SELECT
                s.id,
                s.title,
                s.status,
                s.revision,
                s.expires_at AS "expiresAt",
                COALESCE(
                  (
                    SELECT
                      jsonb_agg(
                        jsonb_build_object('assetId', si.asset_id, 'caption', si.caption)
                        ORDER BY si.position
                      )
                    FROM public.story_items si
                    WHERE si.story_id = s.id
                  ),
                  '[]'
                ) AS frames ${storyJoins}
              WHERE sh.user_id = $1
                AND (
                  $2::uuid IS NULL
                  OR s.id > $2
                )
              ORDER BY s.id
              LIMIT 21
            `,
            [p.userId, after ?? null],
          )
        ).rows;
        return {
          data: rows.slice(0, 20),
          page: { nextCursor: rows.length > 20 ? rows[19].id : null },
        };
      }),

    saveStory: (
      token: string,
      title: string,
      frames: Frame[],
      id?: string,
      revision?: number,
    ) =>
      access(token, async (client, p) => {
        const host = (
          await client.query(
            `
              SELECT
                id,
                status
              FROM public.hosts
              WHERE user_id = $1
              FOR UPDATE
            `,
            [p.userId],
          )
        ).rows[0];
        if (!host || host.status === 'suspended') {
          throw new AccountError(
            403,
            'HOST_REQUIRED',
            'Create an active host profile first.',
          );
        }
        await ownedAssets(
          client,
          frames.map((frame) => frame.assetId),
          p.userId,
        );
        let story;
        if (id) {
          story = (
            await client.query(
              `
                UPDATE public.stories
                SET
                  title = $3,
                  revision = revision + 1
                WHERE id = $1
                  AND host_id = $2
                  AND revision = $4
                  AND status = 'draft'
                RETURNING id,
                  revision
              `,
              [id, host.id, title.trim(), revision],
            )
          ).rows[0];
          if (!story) {
            throw changed();
          }
          await client.query(
            'DELETE FROM public.story_items WHERE story_id = $1',
            [id],
          );
        } else {
          story = (
            await client.query(
              `
                INSERT INTO public.stories (host_id, title)
                VALUES
                  ($1, $2)
                RETURNING id,
                  revision
              `,
              [host.id, title.trim()],
            )
          ).rows[0];
        }
        for (const [position, frame] of frames.entries()) {
          await client.query(
            `
              INSERT INTO public.story_items (story_id, asset_id, position, caption)
              VALUES
                ($1, $2, $3, $4)
            `,
            [story.id, frame.assetId, position, frame.caption.trim()],
          );
        }
        return { ...story, status: 'draft' };
      }),

    publishStory: (
      token: string,
      id: string,
      revision: number,
      publish: boolean,
      requestId: string,
    ) =>
      access(token, async (client, p) => {
        if (publish) {
          await requirePublishableHost(client, p.userId);
        }
        const story = (
          await client.query(
            `
              SELECT s.* ${storyJoins}
              WHERE s.id = $1
                AND sh.user_id = $2
              FOR UPDATE OF s
            `,
            [id, p.userId],
          )
        ).rows[0];
        if (!story) {
          throw mediaMissing();
        }
        if (
          story.revision !== revision ||
          (publish && story.status !== 'draft')
        ) {
          throw changed();
        }
        if (publish) {
          const assets = (
            await client.query<Asset>(
              `
                SELECT m.*
                FROM public.story_items si
                  JOIN public.media_assets m ON m.id = si.asset_id
                WHERE si.story_id = $1
                  AND ${approvedAsset}
                  AND m.owner_id = $2
                ORDER BY m.id
                FOR SHARE OF
                  m
              `,
              [id, p.userId],
            )
          ).rows;
          const count = (
            await client.query<{ count: number }>(
              `
                SELECT count(*)::int AS count
                FROM public.story_items
                WHERE story_id = $1
              `,
              [id],
            )
          ).rows[0]!.count;
          if (!count || assets.length !== count) {
            throw invalid(
              'All story frames must be ready and approved before publishing.',
            );
          }
        }
        await client.query(
          `
            UPDATE public.stories
            SET
              status = $2::text,
              revision = revision + 1,
              published_at = CASE
                WHEN $2::text = 'published' THEN statement_timestamp()
                ELSE published_at
              END,
              expires_at = CASE
                WHEN $2::text = 'published' THEN statement_timestamp() + interval '24 hours'
                ELSE expires_at
              END
            WHERE id = $1
          `,
          [id, publish ? 'published' : 'hidden'],
        );
        await audit(
          client,
          p.userId,
          publish ? 'story.published' : 'story.hidden',
          requestId,
          'story',
          id,
        );
      }),

    seen: (token: string, id: string) =>
      access(token, async (client, p) => {
        const story = await client.query(
          `
            SELECT s.id ${storyJoins}
            WHERE s.id = $1
              AND ${visibleStory}
          `,
          [id],
        );
        if (!story.rowCount) {
          throw mediaMissing();
        }
        await client.query(
          `
            INSERT INTO public.story_views (user_id, story_id)
            VALUES
              ($1, $2)
            ON CONFLICT DO NOTHING
          `,
          [p.userId, id],
        );
      }),

    views: (token: string) =>
      access(
        token,
        async (client, p) =>
          (
            await client.query(
              `
                SELECT sv.story_id AS id
                FROM public.story_views sv
                  JOIN public.stories s ON s.id = sv.story_id
                WHERE sv.user_id = $1
                  AND s.expires_at > clock_timestamp()
                ORDER BY sv.seen_at DESC
                LIMIT 100
              `,
              [p.userId],
            )
          ).rows,
      ),
  };
}
