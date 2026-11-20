import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import { signature, type ContentType, type Variant } from './model.js';
import { approvedAsset } from './visibility.js';

export type Asset = {
  id: string;
  owner_id: string;
  purpose: 'public_content' | 'private_evidence';
  kind: 'image' | 'video';
  content_type: ContentType;
  expected_bytes: number;
  state:
    'pending' | 'uploading' | 'processing' | 'ready' | 'failed' | 'deleted';
  moderation: 'pending' | 'approved' | 'rejected';
  revision: number;
  author: string;
  source_url: string;
  licence_url: string;
  permission_note: string;
  place: string;
  alt_text: string;
  captions: string;
  variants: Partial<Record<Variant, number>>;
  failure_code: string | null;
  review_reason: string | null;
};

export function signedLink(
  config: Config,
  asset: Asset,
  operation: 'upload' | 'download' | 'preview',
  variant?: Variant,
) {
  if (!config.media) {
    return null;
  }
  const expires = Math.floor(Date.now() / 1000) + 900;
  const query = new URLSearchParams({
    expires: String(expires),
    signature: signature(
      config.media.signingKey,
      operation,
      asset.id,
      asset.revision,
      expires,
      variant,
    ),
  });
  const path =
    operation === 'upload'
      ? `/v1/me/media/${asset.id}/content`
      : `/v1/${operation === 'preview' ? 'me/' : ''}media/${asset.id}/${variant}`;
  return `${path}?${query}`;
}

export function mediaCard(asset: Asset, config: Config) {
  return {
    id: asset.id,
    kind: asset.kind,
    altText: asset.alt_text,
    place: asset.place,
    credit: {
      author: asset.author,
      sourceUrl: asset.source_url || null,
      licenceUrl: asset.licence_url || null,
    },
    urls: Object.fromEntries(
      Object.keys(asset.variants).map((variant) => [
        variant,
        signedLink(config, asset, 'download', variant as Variant),
      ]),
    ),
  };
}

export async function catalogueMedia(
  client: PoolClient,
  ids: string[],
  config: Config,
) {
  const grouped = new Map<
    string,
    (ReturnType<typeof mediaCard> & { placement: string })[]
  >();
  if (!config.media || !ids.length) {
    return grouped;
  }
  const rows = (
    await client.query<
      Asset & {
        experience_id: string;
        position: number;
        placement: string;
      }
    >(
      `
        SELECT
          m.*,
          em.experience_id,
          em.position,
          em.purpose AS placement
        FROM public.experience_media em
          JOIN public.media_assets m ON m.id = em.asset_id
        WHERE em.experience_id = ANY ($1::uuid[])
          AND ${approvedAsset}
        ORDER BY
          em.position,
          m.id
      `,
      [ids],
    )
  ).rows;
  for (const row of rows) {
    const items = grouped.get(row.experience_id) ?? [];
    items.push({ ...mediaCard(row, config), placement: row.placement });
    grouped.set(row.experience_id, items);
  }
  return grouped;
}
