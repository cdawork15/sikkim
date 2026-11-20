import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { accountAccess } from '../accounts/access.js';
import { audit } from '../db/audit.js';
import { browse, detail, suggestions } from './read.js';
import {
  decide,
  privateDetail,
  requireReviewer,
  saveDraft,
  submit,
} from './write.js';
import {
  filters,
  pageSize,
  type Draft,
  type Filters,
  type Query,
  type Review,
} from './model.js';

export function catalogueService(database: Database, config: Config) {
  const access = accountAccess(database, config);

  return {
    options: () =>
      database.transaction(async (client) => ({
        areas: (
          await client.query(
            `
              SELECT
                code,
                name,
                latitude,
                longitude
              FROM public.areas
              WHERE active
              ORDER BY name
            `,
          )
        ).rows,
        categories: (
          await client.query(
            `
              SELECT
                code,
                name,
                label_key AS "labelKey"
              FROM public.categories
              WHERE active
              ORDER BY code
            `,
          )
        ).rows,
        dateFilteringAvailable: true,
        mediaAvailable: Boolean(config.media),
        bookingAvailable: true,
        paymentsAvailable: false,
        recommendationMethod: 'team_curated',
      })),

    list: (query: Query, hostId?: string) =>
      database.transaction((client) =>
        browse(
          client,
          filters(query, true),
          pageSize(query.limit),
          query.cursor,
          hostId,
          config,
        ),
      ),

    detail: (slug: string) =>
      database.transaction((client) => detail(client, slug, config)),

    suggestions: (query: string) =>
      database.transaction((client) => suggestions(client, query)),

    home: () =>
      database.transaction(async (client) => {
        const recommended = await browse(
          client,
          { sort: 'recommended' },
          12,
          undefined,
          undefined,
          config,
        );
        const newest = await browse(
          client,
          { sort: 'newest' },
          12,
          undefined,
          undefined,
          config,
        );
        return {
          rows: [
            {
              id: 'featured',
              title: 'Featured experiences',
              experiences: recommended.data.filter(
                (item) => item.featuredRank !== null,
              ),
            },
            {
              id: 'recommended',
              title: 'Explore Sikkim',
              experiences: recommended.data,
            },
            { id: 'new', title: 'New experiences', experiences: newest.data },
          ],
          recommendationMethod: 'team_curated',
          availabilityConnected: true,
        };
      }),

    create: (token: string, draft: Draft, requestId: string) =>
      access(token, (client, principal) =>
        saveDraft(client, principal.userId, draft, requestId),
      ),

    update: (
      token: string,
      id: string,
      revision: number,
      draft: Draft,
      requestId: string,
    ) =>
      access(token, (client, principal) =>
        saveDraft(client, principal.userId, draft, requestId, id, revision),
      ),

    submit: (token: string, id: string, revision: number, requestId: string) =>
      access(token, (client, principal) =>
        submit(client, principal.userId, id, revision, requestId),
      ),

    decide: (token: string, id: string, review: Review, requestId: string) =>
      access(token, (client, principal) =>
        decide(client, principal.userId, id, review, requestId),
      ),

    privateDetail: (token: string, id: string, admin = false) =>
      access(token, async (client, principal) => {
        if (admin) {
          await requireReviewer(client, principal.userId);
        }
        return privateDetail(client, id, admin ? undefined : principal.userId);
      }),

    privateList: (
      token: string,
      after?: string,
      status?: string,
      admin = false,
    ) =>
      access(token, async (client, principal) => {
        if (admin) {
          await requireReviewer(client, principal.userId);
        }
        const rows = (
          await client.query(
            `
              SELECT
                e.id,
                e.slug,
                e.title,
                e.status,
                e.revision,
                e.price_paise AS "pricePaise",
                u.is_demo AS "isDemo"
              FROM public.experiences e
                JOIN public.hosts h ON h.id = e.host_id
                JOIN public.users u ON u.id = h.user_id
              WHERE (
                  $1::uuid IS NULL
                  OR h.user_id = $1
                )
                AND (
                  $2::uuid IS NULL
                  OR e.id > $2
                )
                AND (
                  $3::text IS NULL
                  OR e.status = $3
                )
              ORDER BY e.id
              LIMIT 21
            `,
            [admin ? null : principal.userId, after ?? null, status ?? null],
          )
        ).rows;
        return {
          data: rows.slice(0, 20),
          page: { nextCursor: rows.length > 20 ? rows[19].id : null },
        };
      }),

    searches: (token: string) =>
      access(token, async (client, principal) => ({
        filters: (
          await client.query(
            'SELECT search_filters FROM public.user_preferences WHERE user_id=$1',
            [principal.userId],
          )
        ).rows[0].search_filters,
        recent: (
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
              LIMIT 10
            `,
            [principal.userId],
          )
        ).rows,
      })),

    saveFilters: (
      token: string,
      choices: Partial<Filters>,
      requestId: string,
    ) =>
      access(token, async (client, principal) => {
        const values = filters(
          Object.fromEntries(
            Object.entries(choices).map(([key, value]) => [key, String(value)]),
          ),
          true,
        );
        await client.query(
          'UPDATE public.user_preferences SET search_filters=$2 WHERE user_id=$1',
          [principal.userId, values],
        );
        await audit(
          client,
          principal.userId,
          'search.filters_saved',
          requestId,
        );
        return values;
      }),

    remember: (token: string, query: string) =>
      access(token, async (client, principal) => {
        await client.query(
          `
            INSERT INTO public.recent_searches (user_id, query)
            VALUES
              ($1, $2)
            ON CONFLICT (user_id, query) DO UPDATE
            SET
              searched_at = clock_timestamp()
          `,
          [principal.userId, query.trim().toLowerCase()],
        );
        await client.query(
          `
            DELETE FROM public.recent_searches
            WHERE user_id = $1
              AND query IN (
                SELECT query
                FROM public.recent_searches
                WHERE user_id = $1
                ORDER BY
                  searched_at DESC,
                  query
                OFFSET 10
              )
          `,
          [principal.userId],
        );
      }),

    clearSearches: (token: string, requestId: string) =>
      access(token, async (client, principal) => {
        await client.query(
          'DELETE FROM public.recent_searches WHERE user_id=$1',
          [principal.userId],
        );
        await audit(
          client,
          principal.userId,
          'search.history_cleared',
          requestId,
        );
      }),
  };
}
