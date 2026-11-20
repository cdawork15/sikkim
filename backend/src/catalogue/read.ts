import type { Config } from '../config.js';
import { catalogueMedia } from '../media/delivery.js';
import type { PoolClient } from 'pg';
import {
  cursor,
  filterKey,
  nextCursor,
  type Filters,
  missing,
} from './model.js';

import { visible, joins } from './visibility.js';
import { availableSlot } from '../bookings/model.js';

export { visible, joins } from './visibility.js';

export const summary = `
  e.id,
  e.slug,
  e.title,
  e.description,
  e.area_code AS "areaCode",
  a.name AS area,
  e.duration_minutes AS "durationMinutes",
  e.price_paise AS "pricePaise",
  e.currency,
  e.accessibility,
  e.difficulty,
  h.id AS "hostId",
  h.public_name AS "hostName",
  e.featured_rank AS "featuredRank",
  ARRAY(
    SELECT category_code
    FROM public.experience_categories
    WHERE experience_id = e.id
    ORDER BY category_code
  ) AS categories
`;
const sortExpressions = {
  recommended: 'COALESCE(e.featured_rank,1001)',
  price_asc: 'e.price_paise',
  price_desc: '-e.price_paise',
  duration: 'e.duration_minutes',
  newest: '-extract(epoch from e.published_at)::double precision',
};

export function publicCard(
  row: Record<string, unknown>,
): Record<string, unknown> {
  const { sortValue: _, ...data } = row;
  return {
    ...data,
    media: [],
    rating: null,
    availability: { status: 'no_dates', bookable: false },
  };
}

export function browseQuery(
  f: Filters,
  limit: number,
  after: string | undefined,
  hostId?: string,
) {
  const key = filterKey([f, hostId ?? null]);
  const position = cursor(after, key);
  const values: unknown[] = [];
  const add = (v: unknown) => {
    values.push(v);
    return '$' + values.length;
  };
  const clauses = [visible];
  if (f.q) {
    clauses.push(`e.search_document @@ plainto_tsquery('simple',${add(f.q)})`);
  }
  if (f.area) {
    clauses.push(`e.area_code=${add(f.area)}`);
  }
  if (f.category) {
    clauses.push(
      `
        EXISTS (
          SELECT 1
          FROM public.experience_categories ec
          WHERE ec.experience_id = e.id
            AND ec.category_code = ${add(f.category)}
        )
      `,
    );
  }
  if (f.minPricePaise !== undefined) {
    clauses.push(`e.price_paise>=${add(f.minPricePaise)}`);
  }
  if (f.maxPricePaise !== undefined) {
    clauses.push(`e.price_paise<=${add(f.maxPricePaise)}`);
  }
  if (f.accessibility) {
    clauses.push(`e.accessibility=${add(f.accessibility)}`);
  }
  if (f.difficulty) {
    clauses.push(`e.difficulty=${add(f.difficulty)}`);
  }
  if (hostId) {
    clauses.push(`e.host_id=${add(hostId)}`);
  }
  if (f.date) {
    clauses.push(`EXISTS (SELECT 1 FROM public.experience_slots s
      WHERE s.experience_id=e.id AND ${availableSlot}
      AND (s.starts_at AT TIME ZONE s.timezone)::date=${add(f.date)}::date)`);
  }
  const sort = sortExpressions[f.sort];
  if (position) {
    clauses.push(
      `(${sort},e.id)>(${add(position.value)},${add(position.id)}::uuid)`,
    );
  }
  return {
    key,
    text: `
      SELECT
        ${summary},
        ${sort} AS "sortValue"
        ${joins}
      WHERE ${clauses.join(' AND ')}
      ORDER BY
        ${sort},
        e.id
      LIMIT ${add(limit + 1)}
    `,
    values,
  };
}

export async function browse(
  client: PoolClient,
  f: Filters,
  limit = 20,
  after?: string,
  hostId?: string,
  config?: Config,
) {
  const query = browseQuery(f, limit, after, hostId);
  const rows = (await client.query(query.text, query.values)).rows;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    data: await hydrateCards(client, items, config),
    page: {
      nextCursor:
        rows.length > limit
          ? nextCursor(query.key, last.id, Number(last.sortValue))
          : null,
    },
    meta: {
      order: f.sort === 'recommended' ? 'team_curated' : f.sort,
      dateFilteringAvailable: true,
      mediaAvailable: Boolean(config?.media),
    },
  };
}

export async function detail(
  client: PoolClient,
  slug: string,
  config?: Config,
) {
  const row = (
    await client.query(
      `
        SELECT
          ${summary},
          e.meeting_point AS "meetingPoint",
          e.min_participants AS "minParticipants",
          e.max_participants AS "maxParticipants",
          e.inclusions,
          e.exclusions,
          e.preparation,
          e.accessibility_notes AS "accessibilityNotes",
          h.story AS "hostStory",
          jsonb_build_object(
            'id',
            p.id,
            'version',
            p.version,
            'cancellation',
            p.cancellation,
            'safety',
            p.safety,
            'participation',
            p.participation
          ) AS policy
          ${joins}
          JOIN public.policies p ON p.id = e.policy_id
        WHERE e.slug = $1
          AND ${visible}
      `,
      [slug],
    )
  ).rows[0];
  if (!row) {
    throw missing();
  }
  return (await hydrateCards(client, [row], config))[0]!;
}

export async function suggestions(client: PoolClient, q: string) {
  const escaped = q
    .trim()
    .toLowerCase()
    .replace(/[\\%_]/g, '\\$&');
  return (
    await client.query(
      `
        SELECT
          e.id,
          e.slug,
          e.title
          ${joins}
        WHERE ${visible}
          AND lower(e.title) LIKE $1 ESCAPE '\\'
        ORDER BY
          lower(e.title),
          e.id
        LIMIT 8
      `,
      [escaped + '%'],
    )
  ).rows;
}

export async function catalogueAccountData(client: PoolClient, userId: string) {
  const experiences = (
    await client.query(
      `
        SELECT to_jsonb(e) - 'search_document' AS record
        FROM public.experiences e
          JOIN public.hosts h ON h.id = e.host_id
        WHERE h.user_id = $1
        ORDER BY e.id
      `,
      [userId],
    )
  ).rows.map((row) => row.record);
  const policies = (
    await client.query(
      `
        SELECT p.*
        FROM public.policies p
          JOIN public.experiences e ON e.id = p.experience_id
          JOIN public.hosts h ON h.id = e.host_id
        WHERE h.user_id = $1
        ORDER BY
          p.experience_id,
          p.version
      `,
      [userId],
    )
  ).rows;
  const reviews = (
    await client.query(
      `
        SELECT
          r.experience_id,
          r.revision,
          r.action,
          r.reason,
          r.provider_reference,
          r.source_verified,
          r.snapshot,
          r.created_at
        FROM public.experience_reviews r
          JOIN public.experiences e ON e.id = r.experience_id
          JOIN public.hosts h ON h.id = e.host_id
        WHERE h.user_id = $1
        ORDER BY
          r.experience_id,
          r.revision
      `,
      [userId],
    )
  ).rows;
  const recentSearches = (
    await client.query(
      `
        SELECT
          query,
          searched_at AS "searchedAt"
        FROM public.recent_searches
        WHERE user_id = $1
        ORDER BY
          searched_at DESC,
          query
      `,
      [userId],
    )
  ).rows;
  return { experiences, policies, reviews, recentSearches };
}

export async function hydrateCards(
  client: PoolClient,
  rows: Record<string, unknown>[],
  config?: Config,
): Promise<Record<string, unknown>[]> {
  if (!rows.length) return [];
  const available = (
    await client.query(
      `
    SELECT e.id, bool_or(s.price_paise=0) AS bookable
    FROM public.experiences e JOIN public.experience_slots s ON s.experience_id=e.id
    WHERE e.id=ANY($1::uuid[]) AND ${availableSlot} GROUP BY e.id
  `,
      [rows.map((row) => String(row.id))],
    )
  ).rows;
  const availability = new Map(available.map((row) => [row.id, row.bookable]));
  const media = config
    ? await catalogueMedia(
        client,
        rows.map((row) => String(row.id)),
        config,
      )
    : new Map();
  return rows.map((row) => ({
    ...publicCard(row),
    availability: {
      status: availability.has(row.id)
        ? availability.get(row.id)
          ? 'available'
          : 'payment_unavailable'
        : 'no_dates',
      bookable: availability.get(row.id) ?? false,
    },
    media: media.get(row.id) ?? [],
  }));
}
