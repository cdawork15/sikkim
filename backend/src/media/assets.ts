import type { Readable } from 'node:stream';
import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { accountAccess } from '../accounts/access.js';
import { AccountError } from '../accounts/model.js';
import { audit } from '../db/audit.js';
import { requireReviewer } from '../catalogue/write.js';
import {
  mediaConflict,
  mediaInvalid,
  mediaMissing,
  mediaUnavailable,
  validateCaptions,
  validateUrl,
  verifySignature,
  type UploadIntent,
  type Variant,
} from './model.js';
import { signedLink, type Asset } from './delivery.js';
import { linkedPublicAsset } from './visibility.js';
import { localMediaStorage } from './storage.js';

async function assetRow(client: PoolClient, id: string, owner?: string) {
  const row = (
    await client.query<Asset>(
      `
        SELECT *
        FROM public.media_assets
        WHERE id = $1
          AND (
            $2::uuid IS NULL
            OR owner_id = $2
          )
          AND state <> 'deleted'
        FOR UPDATE
      `,
      [id, owner ?? null],
    )
  ).rows[0];
  if (!row) {
    throw mediaMissing();
  }
  return row;
}

function ownCard(row: Asset, config: Config) {
  return {
    id: row.id,
    purpose: row.purpose,
    kind: row.kind,
    state: row.state,
    moderation: row.moderation,
    revision: row.revision,
    author: row.author,
    sourceUrl: row.source_url,
    licenceUrl: row.licence_url,
    permissionNote: row.permission_note,
    place: row.place,
    altText: row.alt_text,
    failureCode: row.failure_code,
    reviewReason: row.review_reason,
    variants: Object.keys(row.variants),
    uploadUrl:
      row.state === 'pending' ? signedLink(config, row, 'upload') : null,
  };
}

export function assetService(database: Database, config: Config) {
  const access = accountAccess(database, config);
  const storage = config.media
    ? localMediaStorage(config.media.directory)
    : null;
  let running = 0;
  const jobs = new Set<Promise<void>>();

  function enabled() {
    if (!storage || !config.media) {
      throw mediaUnavailable();
    }
    return { storage, settings: config.media };
  }
  async function process(row: Asset) {
    const { storage } = enabled();
    try {
      const variants = await storage.process(
        row.id,
        row.content_type,
        row.captions,
      );
      await database.transaction((client) =>
        client.query(
          `
            UPDATE public.media_assets
            SET
              state = 'ready',
              variants = $2,
              failure_code = NULL,
              updated_at = clock_timestamp()
            WHERE id = $1
              AND state = 'processing'
              AND revision = $3
          `,
          [row.id, variants, row.revision],
        ),
      );
      await storage.removeSource(row.id);
    } catch {
      await database.transaction((client) =>
        client.query(
          `
            UPDATE public.media_assets
            SET
              state = 'failed',
              failure_code = 'PROCESSING_FAILED',
              updated_at = clock_timestamp()
            WHERE id = $1
              AND state = 'processing'
              AND revision = $2
          `,
          [row.id, row.revision],
        ),
      );
    }
  }
  function schedule(row: Asset) {
    running++;
    const job = process(row)
      .catch(() => {
        // A database outage leaves the durable processing row for recovery.
      })
      .finally(() => {
        running--;
        jobs.delete(job);
      });
    jobs.add(job);
  }

  async function capacity<T>(operation: () => Promise<T>) {
    if (running >= 2) {
      throw new AccountError(
        503,
        'MEDIA_BUSY',
        'Media is processing. Try again shortly.',
      );
    }
    running++;
    try {
      return await operation();
    } finally {
      running--;
    }
  }

  async function cleanDeletedAsset(id: string) {
    const { storage } = enabled();
    await storage.remove(id);
    await database.transaction((client) =>
      client.query(
        `
          UPDATE public.media_assets
          SET
            failure_code = NULL,
            variants = '{}'
          WHERE id = $1
            AND state = 'deleted'
            AND failure_code = 'CLEANUP_PENDING'
        `,
        [id],
      ),
    );
  }

  return {
    async close() {
      await Promise.allSettled(jobs);
    },
    async recover() {
      if (!storage) {
        return;
      }
      await database.transaction(async (client) => {
        await client.query(`
          DELETE FROM public.story_views sv USING public.stories s
          WHERE sv.story_id = s.id
            AND s.expires_at <= clock_timestamp()
        `);
        await client.query(`
          UPDATE public.media_assets
          SET
            state = 'failed',
            failure_code = 'PROCESSING_INTERRUPTED',
            updated_at = clock_timestamp()
          WHERE state IN ('uploading', 'processing')
            AND updated_at < clock_timestamp() - interval '5 minutes'
        `);
        await client.query(`
          UPDATE public.media_assets
          SET
            state = 'deleted',
            revision = revision + 1,
            failure_code = 'CLEANUP_PENDING',
            updated_at = clock_timestamp()
          WHERE state IN ('pending', 'failed')
            AND updated_at < clock_timestamp() - interval '24 hours'
        `);
      });
      const removed = await database.transaction(
        async (client) =>
          (
            await client.query<{ id: string }>(`
              SELECT id
              FROM public.media_assets
              WHERE state = 'deleted'
                AND failure_code = 'CLEANUP_PENDING'
              ORDER BY id
              LIMIT 100
            `)
          ).rows,
      );
      for (const row of removed) {
        await cleanDeletedAsset(row.id);
      }
    },

    create: (token: string, input: UploadIntent) =>
      access(token, async (client, p) => {
        enabled();
        const kind = input.contentType.startsWith('image/') ? 'image' : 'video';
        if (kind === 'image' && input.bytes > 10485760) {
          throw mediaInvalid('Images must be 10 MB or smaller.');
        }
        if (input.purpose === 'private_evidence' && kind !== 'image') {
          throw mediaInvalid('Private evidence must be an image.');
        }
        const captions =
          kind === 'video' ? validateCaptions(input.captions ?? '') : '';
        const count = (
          await client.query<{ count: number }>(
            `
              SELECT count(*)::int AS count
              FROM public.media_assets
              WHERE owner_id = $1
                AND state <> 'deleted'
            `,
            [p.userId],
          )
        ).rows[0]!.count;
        if (count >= 100) {
          throw mediaInvalid('Remove unused media before uploading more.');
        }
        const row = (
          await client.query<Asset>(
            `
              INSERT INTO public.media_assets (
                  owner_id,
                  purpose,
                  kind,
                  content_type,
                  expected_bytes,
                  author,
                  source_url,
                  licence_url,
                  permission_note,
                  place,
                  alt_text,
                  captions
                )
              VALUES
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
              RETURNING *
            `,
            [
              p.userId,
              input.purpose,
              kind,
              input.contentType,
              input.bytes,
              input.author.trim(),
              input.sourceUrl ? validateUrl(input.sourceUrl) : '',
              input.licenceUrl ? validateUrl(input.licenceUrl) : '',
              input.permissionNote.trim(),
              input.place.trim(),
              input.altText.trim(),
              captions,
            ],
          )
        ).rows[0]!;
        return ownCard(row, config);
      }),

    list: (token: string, after: string | undefined, admin = false) =>
      access(token, async (client, p) => {
        if (admin) {
          await requireReviewer(client, p.userId);
        }
        const rows = (
          await client.query<Asset>(
            `
              SELECT *
              FROM public.media_assets
              WHERE (
                  $1::uuid IS NULL
                  OR owner_id = $1
                )
                AND state <> 'deleted'
                AND (
                  $2::uuid IS NULL
                  OR id > $2
                )
                AND (
                  NOT $3
                  OR purpose = 'public_content'
                )
              ORDER BY id
              LIMIT 21
            `,
            [admin ? null : p.userId, after ?? null, admin],
          )
        ).rows;
        return {
          data: rows.slice(0, 20).map((row) => ownCard(row, config)),
          page: { nextCursor: rows.length > 20 ? rows[19]!.id : null },
        };
      }),

    detail: (token: string, id: string) =>
      access(token, async (client, p) =>
        ownCard(await assetRow(client, id, p.userId), config),
      ),

    async upload(
      token: string,
      id: string,
      expires: string,
      supplied: string,
      input: Readable,
    ) {
      const { storage, settings } = enabled();
      return capacity(async () => {
        const row = await access(token, async (client, p) => {
          const row = await assetRow(client, id, p.userId);
          verifySignature(
            settings.signingKey,
            'upload',
            id,
            row.revision,
            expires,
            supplied,
          );
          if (row.state !== 'pending') {
            throw mediaConflict();
          }
          await client.query(
            `
              UPDATE public.media_assets
              SET
                state = 'uploading',
                updated_at = clock_timestamp()
              WHERE id = $1
            `,
            [id],
          );
          return row;
        });
        try {
          await storage.receive(id, input, row.expected_bytes);
          // Re-authenticate before accepting content in case the account was revoked mid-upload.
          await access(token, async (client, p) => {
            const current = await assetRow(client, id, p.userId);
            if (current.state !== 'uploading') {
              throw mediaConflict();
            }
            await client.query(
              `
                UPDATE public.media_assets
                SET
                  state = 'processing',
                  uploaded_at = clock_timestamp(),
                  processing_started_at = clock_timestamp(),
                  updated_at = clock_timestamp()
                WHERE id = $1
              `,
              [id],
            );
          });
          schedule(row);
        } catch (error) {
          await storage.remove(id);
          await database.transaction((client) =>
            client.query(
              `
                UPDATE public.media_assets
                SET
                  state = 'failed',
                  failure_code = 'UPLOAD_FAILED',
                  updated_at = clock_timestamp()
                WHERE id = $1
                  AND state = 'uploading'
              `,
              [id],
            ),
          );
          throw error;
        }
      });
    },

    async retry(token: string, id: string, revision: number) {
      enabled();
      return capacity(async () => {
        const row = await access(token, async (client, p) => {
          const row = await assetRow(client, id, p.userId);
          if (row.revision !== revision || row.state !== 'failed') {
            throw mediaConflict();
          }
          await client.query(
            `
              UPDATE public.media_assets
              SET
                state = 'processing',
                revision = revision + 1,
                processing_started_at = clock_timestamp(),
                updated_at = clock_timestamp()
              WHERE id = $1
            `,
            [id],
          );
          return { ...row, revision: row.revision + 1 };
        });
        schedule(row);
      });
    },

    async remove(token: string, id: string, revision: number) {
      enabled();
      await access(token, async (client, p) => {
        const row = await assetRow(client, id, p.userId);
        if (
          row.revision !== revision ||
          ['uploading', 'processing'].includes(row.state)
        ) {
          throw mediaConflict();
        }
        await client.query(
          `
            UPDATE public.media_assets
            SET
              state = 'deleted',
              revision = revision + 1,
              failure_code = 'CLEANUP_PENDING',
              updated_at = clock_timestamp()
            WHERE id = $1
          `,
          [id],
        );
      });
      await cleanDeletedAsset(id);
    },

    review: (
      token: string,
      id: string,
      revision: number,
      action: 'approved' | 'rejected',
      reason: string,
      requestId: string,
    ) =>
      access(token, async (client, p) => {
        await requireReviewer(client, p.userId);
        const row = await assetRow(client, id);
        if (row.owner_id === p.userId || row.purpose !== 'public_content') {
          throw new AccountError(
            403,
            'FORBIDDEN',
            'Another reviewer must review public media.',
          );
        }
        if (row.revision !== revision || row.state !== 'ready') {
          throw mediaConflict();
        }
        await client.query(
          `
            UPDATE public.media_assets
            SET
              moderation = $2,
              review_reason = $3,
              reviewed_by = $4,
              revision = revision + 1,
              updated_at = clock_timestamp()
            WHERE id = $1
          `,
          [id, action, reason.trim(), p.userId],
        );
        await audit(
          client,
          p.userId,
          `media.${action}`,
          requestId,
          'media',
          id,
        );
      }),

    preview: (token: string, id: string, variant: Variant) =>
      access(token, async (client, p) => {
        enabled();
        const row = await assetRow(client, id);
        if (row.owner_id !== p.userId) {
          await requireReviewer(client, p.userId);
        }
        if (row.state !== 'ready' || !row.variants[variant]) {
          throw mediaMissing();
        }
        return { url: signedLink(config, row, 'preview', variant) };
      }),

    async download(
      id: string,
      variant: Variant,
      expires: string,
      supplied: string,
      token?: string,
    ) {
      const { storage, settings } = enabled();
      const read = async (client: PoolClient, userId?: string) => {
        const row = (
          await client.query<Asset>(
            `
              SELECT m.*
              FROM public.media_assets m
              WHERE m.id = $1
                AND m.state = 'ready'
                AND (
                  $2::boolean
                  OR (${linkedPublicAsset})
                )
            `,
            [id, Boolean(token)],
          )
        ).rows[0];
        if (!row || !row.variants[variant]) {
          throw mediaMissing();
        }
        if (token && row.owner_id !== userId) {
          await requireReviewer(client, userId!);
        }
        verifySignature(
          settings.signingKey,
          token ? 'preview' : 'download',
          id,
          row.revision,
          expires,
          supplied,
          variant,
        );
        return {
          size: row.variants[variant]!,
          stream: (range?: { start: number; end: number }) =>
            storage.read(id, variant, range),
        };
      };
      return token
        ? access(token, (client, p) => read(client, p.userId))
        : database.transaction((client) => read(client));
    },
  };
}
