import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { accountAccess } from '../accounts/access.js';
import { AccountError } from '../accounts/model.js';
import { audit } from '../db/audit.js';
import { joins, visible } from '../catalogue/visibility.js';
import { mediaCard, type Asset } from '../media/delivery.js';
import { approvedAsset } from '../media/visibility.js';

export type ReelInput = {
  assetId: string;
  caption?: string;
  place?: string;
  experienceId?: string | null;
};

const PAGE = 20;
const notFound = () =>
  new AccountError(404, 'NOT_FOUND', 'This reel was not found.');
const invalid = (message: string) =>
  new AccountError(400, 'INVALID_REQUEST', message);

// A community reel is public when it is active and its video passed review.
export const visibleUserReel = `
  r.status = 'active'
  AND m.owner_id = r.user_id
  AND ${approvedAsset}
  AND m.kind = 'video'
`;

async function linkedExperience(
  client: PoolClient,
  experienceId: string | null | undefined,
) {
  if (!experienceId) return null;
  const row = (
    await client.query(
      `SELECT e.id, e.slug, e.title ${joins} WHERE e.id = $1 AND ${visible}`,
      [experienceId],
    )
  ).rows[0];
  if (!row) throw invalid('Tag a published experience, or leave it empty.');
  return row;
}

export function reelService(database: Database, config: Config) {
  const access = accountAccess(database, config);
  const card = (row: {
    id: string;
    caption: string;
    place: string;
    createdAt: Date;
    creatorName: string;
    asset: Asset;
    experienceId: string | null;
    experienceSlug: string | null;
    experienceTitle: string | null;
  }) => ({
    id: row.id,
    caption: row.caption,
    place: row.place,
    createdAt: row.createdAt,
    creator: { name: row.creatorName },
    experience: row.experienceId
      ? {
          id: row.experienceId,
          slug: row.experienceSlug,
          title: row.experienceTitle,
        }
      : null,
    media: mediaCard(row.asset, config),
  });
  const select = `
    SELECT
      r.id,
      r.caption,
      r.place,
      r.created_at AS "createdAt",
      u.display_name AS "creatorName",
      to_jsonb(m) AS asset,
      ve.id AS "experienceId",
      ve.slug AS "experienceSlug",
      ve.title AS "experienceTitle"
    FROM public.user_reels r
      JOIN public.media_assets m ON m.id = r.asset_id
      JOIN public.users u ON u.id = r.user_id
      LEFT JOIN LATERAL (
        SELECT e.id, e.slug, e.title ${joins}
        WHERE e.id = r.experience_id AND ${visible}
      ) ve ON true
  `;

  return {
    feed: (after?: string) =>
      database.transaction(async (client) => {
        if (!config.media) return { data: [], page: { nextCursor: null } };
        const rows = (
          await client.query(
            `
              ${select}
              WHERE ${visibleUserReel}
                AND (
                  $1::uuid IS NULL
                  OR (r.created_at, r.id) < (
                    SELECT created_at, id FROM public.user_reels WHERE id = $1
                  )
                )
              ORDER BY r.created_at DESC, r.id DESC
              LIMIT ${PAGE + 1}
            `,
            [after ?? null],
          )
        ).rows;
        return {
          data: rows.slice(0, PAGE).map(card),
          page: { nextCursor: rows.length > PAGE ? rows[PAGE - 1].id : null },
        };
      }),

    mine: (token: string) =>
      access(token, async (client, p) => {
        const rows = (
          await client.query(
            `
              SELECT r.id, r.caption, r.place, r.created_at AS "createdAt",
                m.state, m.moderation, m.review_reason AS "reviewReason",
                r.experience_id AS "experienceId"
              FROM public.user_reels r
                JOIN public.media_assets m ON m.id = r.asset_id
              WHERE r.user_id = $1 AND r.status = 'active'
              ORDER BY r.created_at DESC
              LIMIT 50
            `,
            [p.userId],
          )
        ).rows;
        return rows.map((row) => ({
          ...row,
          status:
            row.state === 'failed' || row.moderation === 'rejected'
              ? 'not_published'
              : row.state === 'ready' && row.moderation === 'approved'
                ? 'live'
                : 'in_review',
        }));
      }),

    create: (token: string, input: ReelInput, requestId: string) =>
      access(token, async (client, p) => {
        const asset = (
          await client.query(
            `
              SELECT id, kind, purpose, state FROM public.media_assets
              WHERE id = $1 AND owner_id = $2
              FOR UPDATE
            `,
            [input.assetId, p.userId],
          )
        ).rows[0];
        if (!asset) throw invalid('Upload the video first.');
        if (asset.kind !== 'video' || asset.purpose !== 'public_content')
          throw invalid('Reels must be a public video.');
        if (['failed', 'deleted'].includes(asset.state))
          throw invalid('This video could not be processed. Upload another.');
        await linkedExperience(client, input.experienceId);
        const used = await client.query(
          'SELECT 1 FROM public.user_reels WHERE asset_id = $1',
          [input.assetId],
        );
        if (used.rowCount) throw invalid('This video is already a reel.');
        const reel = (
          await client.query(
            `
              INSERT INTO public.user_reels (user_id, asset_id, caption, place, experience_id)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id
            `,
            [
              p.userId,
              input.assetId,
              input.caption?.trim() ?? '',
              input.place?.trim() ?? '',
              input.experienceId ?? null,
            ],
          )
        ).rows[0];
        await audit(
          client,
          p.userId,
          'reel.created',
          requestId,
          'user_reel',
          reel.id,
        );
        return { id: reel.id, status: 'in_review' };
      }),

    remove: (token: string, id: string, requestId: string) =>
      access(token, async (client, p) => {
        const result = await client.query(
          `
            UPDATE public.user_reels SET status = 'removed'
            WHERE id = $1 AND user_id = $2 AND status = 'active'
          `,
          [id, p.userId],
        );
        if (!result.rowCount) throw notFound();
        await audit(
          client,
          p.userId,
          'reel.removed',
          requestId,
          'user_reel',
          id,
        );
      }),
  };
}
