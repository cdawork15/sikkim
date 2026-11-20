import type { PoolClient } from 'pg';
import { accountAccess } from '../accounts/access.js';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { missing } from '../catalogue/model.js';
import { hydrateCards, summary } from '../catalogue/read.js';
import { joins, visible } from '../catalogue/visibility.js';

export function experienceActions(database: Database, config: Config) {
  const access = accountAccess(database, config);

  return {
    set: (
      token: string,
      id: string,
      kind: 'saved' | 'liked',
      enabled: boolean,
    ) =>
      access(token, async (client, principal) => {
        // Table names are chosen here, never supplied by a request.
        const table = kind === 'saved' ? 'saved_items' : 'experience_likes';
        if (enabled) {
          const available = await client.query(
            `
              SELECT e.id
              ${joins}
              WHERE e.id = $1
                AND ${visible}
            `,
            [id],
          );
          if (!available.rowCount) {
            throw missing();
          }
          await client.query(
            `
              INSERT INTO public.${table} (user_id, experience_id)
              VALUES
                ($1, $2)
              ON CONFLICT DO NOTHING
            `,
            [principal.userId, id],
          );
        } else {
          // Removing a saved/liked item must also work after it is hidden.
          await client.query(
            `
              DELETE FROM public.${table}
              WHERE user_id = $1
                AND experience_id = $2
            `,
            [principal.userId, id],
          );
        }
      }),

    states: (token: string, ids: string[]) =>
      access(token, async (client, p) => {
        const result = await client.query(
          `
            SELECT
              e.id,
              EXISTS (
                SELECT 1
                FROM public.saved_items s
                WHERE s.experience_id = e.id
                  AND s.user_id = $2
              ) AS saved,
              EXISTS (
                SELECT 1
                FROM public.experience_likes l
                WHERE l.experience_id = e.id
                  AND l.user_id = $2
              ) AS liked,
              (
                SELECT count(*)::int
                FROM public.experience_likes l
                  JOIN public.users lu ON lu.id = l.user_id
                WHERE l.experience_id = e.id
                  AND lu.status = 'active'
              ) AS "likeCount"
              ${joins}
            WHERE e.id = ANY ($1::uuid[])
              AND ${visible}
            ORDER BY e.id
          `,
          [ids, p.userId],
        );
        return result.rows;
      }),

    saved: (token: string, after?: string) =>
      access(token, async (client, p) => {
        const saved = (
          await client.query<{ id: string; savedAt: Date }>(
            `
              SELECT
                experience_id AS id,
                created_at AS "savedAt"
              FROM public.saved_items
              WHERE user_id = $1
                AND (
                  $2::uuid IS NULL
                  OR experience_id > $2
                )
              ORDER BY experience_id
              LIMIT 21
            `,
            [p.userId, after ?? null],
          )
        ).rows;
        const page = saved.slice(0, 20);
        const available = (
          await client.query(
            `
              SELECT ${summary}
              ${joins}
              WHERE e.id = ANY ($1::uuid[])
                AND ${visible}
            `,
            [page.map((item) => item.id)],
          )
        ).rows;
        const cards = await hydrateCards(client, available, config);
        const byId = new Map(cards.map((row) => [row.id, row]));
        return {
          data: page.map((item) => ({
            ...item,
            experience: byId.get(item.id) ?? null,
            unavailable: !byId.has(item.id),
          })),
          page: { nextCursor: saved.length > 20 ? page.at(-1)!.id : null },
        };
      }),
  };
}

export async function mediaAccountData(client: PoolClient, userId: string) {
  const saved = (
    await client.query(
      `
        SELECT
          experience_id,
          created_at
        FROM public.saved_items
        WHERE user_id = $1
      `,
      [userId],
    )
  ).rows;
  const likes = (
    await client.query(
      `
        SELECT
          experience_id,
          created_at
        FROM public.experience_likes
        WHERE user_id = $1
      `,
      [userId],
    )
  ).rows;
  const views = (
    await client.query(
      `
        SELECT
          story_id,
          seen_at
        FROM public.story_views
        WHERE user_id = $1
      `,
      [userId],
    )
  ).rows;
  const assets = (
    await client.query(
      `
        SELECT
          id,
          purpose,
          state,
          moderation,
          author,
          source_url,
          licence_url,
          permission_note,
          place,
          alt_text,
          captions,
          content_type,
          expected_bytes,
          review_reason,
          created_at
        FROM public.media_assets
        WHERE owner_id = $1
        ORDER BY id
      `,
      [userId],
    )
  ).rows;
  const stories = (
    await client.query(
      `
        SELECT
          s.*,
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
          ) AS frames
        FROM public.stories s
          JOIN public.hosts h ON h.id = s.host_id
        WHERE h.user_id = $1
        ORDER BY s.id
      `,
      [userId],
    )
  ).rows;
  return { saved, likes, views, assets, stories };
}
