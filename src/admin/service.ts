import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { accountAccess } from '../accounts/access.js';
import { AccountError } from '../accounts/model.js';
import { audit } from '../db/audit.js';
import {
  decodeCursor,
  encodeCursor,
  forbidden,
  invalid,
  leadColumns,
  normaliseLead,
  notFound,
  stageLabels,
  stale,
  type LeadFilter,
  type LeadInput,
  type LeadPatch,
} from './model.js';

const PAGE = 20;

export async function requireAdmin(client: PoolClient, userId: string) {
  const row = await client.query(
    "SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = 'admin'",
    [userId],
  );
  if (!row.rowCount) throw forbidden();
}

// Escape LIKE wildcards so search text is matched literally.
const like = (value: string) =>
  '%' + value.replace(/[\\%_]/g, (c) => '\\' + c) + '%';

function page<T extends { id: string; createdAt: Date }>(rows: T[]) {
  const data = rows.slice(0, PAGE);
  const last = data[data.length - 1];
  return {
    data,
    page: {
      nextCursor:
        rows.length > PAGE && last
          ? encodeCursor(last.createdAt, last.id)
          : null,
    },
  };
}

const leadSelect = `
  l.id,
  l.code,
  l.name,
  l.experience_idea AS "experienceIdea",
  l.district,
  l.locality,
  l.category_code AS "categoryCode",
  l.contact_name AS "contactName",
  l.phone,
  l.email,
  l.contact_source AS "contactSource",
  l.contact_confirmed AS "contactConfirmed",
  l.stage,
  l.verdict,
  l.site_visit AS "siteVisit",
  l.media_received AS "mediaReceived",
  l.rights_confirmed AS "rightsConfirmed",
  l.agreement_signed AS "agreementSigned",
  l.writeup_final AS "writeupFinal",
  l.owner_id AS "ownerId",
  o.display_name AS "ownerName",
  l.host_id AS "hostId",
  h.public_name AS "hostName",
  h.status AS "hostStatus",
  to_char(l.next_follow_up, 'YYYY-MM-DD') AS "nextFollowUp",
  l.revision,
  l.created_at AS "createdAt",
  l.updated_at AS "updatedAt"
`;
const leadFrom = `
  FROM public.crm_leads l
    LEFT JOIN public.users o ON o.id = l.owner_id
    LEFT JOIN public.hosts h ON h.id = l.host_id
`;

async function readLead(client: PoolClient, id: string, lock = false) {
  const lead = (
    await client.query(
      `SELECT ${leadSelect} ${leadFrom} WHERE l.id = $1 ${lock ? 'FOR UPDATE OF l' : ''}`,
      [id],
    )
  ).rows[0];
  if (!lead) throw notFound('Lead');
  return lead;
}

async function checkReferences(client: PoolClient, input: LeadInput) {
  if (input.ownerId) {
    const owner = await client.query(
      `SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = 'admin'`,
      [input.ownerId],
    );
    if (!owner.rowCount) throw invalid('Assign the lead to an admin.');
  }
  if (input.hostId) {
    const host = await client.query(
      'SELECT 1 FROM public.hosts WHERE id = $1',
      [input.hostId],
    );
    if (!host.rowCount) throw invalid('Link an existing host profile.');
  }
  if (input.categoryCode) {
    const category = await client.query(
      'SELECT 1 FROM public.categories WHERE code = $1 AND active',
      [input.categoryCode],
    );
    if (!category.rowCount) throw invalid('Choose an active category.');
  }
}

// Unique-constraint violations become friendly 409s instead of 500s.
async function guardUnique<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error) {
      const pgError = error as { code?: string; constraint?: string };
      if (pgError.code === '23505') {
        throw new AccountError(
          409,
          'DUPLICATE',
          pgError.constraint?.includes('host')
            ? 'That host is already linked to another lead.'
            : 'That tracker ID is already used.',
        );
      }
    }
    throw error;
  }
}

async function addNote(
  client: PoolClient,
  leadId: string,
  authorId: string,
  kind: string,
  body: string,
) {
  return (
    await client.query(
      `
        INSERT INTO public.crm_lead_notes (lead_id, author_id, kind, body)
        VALUES ($1, $2, $3, $4)
        RETURNING id, kind, body, created_at AS "createdAt"
      `,
      [leadId, authorId, kind, body],
    )
  ).rows[0];
}

export function adminService(database: Database, config: Config) {
  const access = accountAccess(database, config);
  const asAdmin = <T>(
    token: string,
    task: (client: PoolClient, adminId: string) => Promise<T>,
  ) =>
    access(token, async (client, p) => {
      await requireAdmin(client, p.userId);
      return task(client, p.userId);
    });

  return {
    overview: (token: string) =>
      asAdmin(token, async (client) => {
        const one = async (sql: string, params: unknown[] = []) =>
          (await client.query(sql, params)).rows[0];
        const queue = await one(`
          SELECT
            (SELECT count(*)::int FROM public.hosts WHERE status = 'pending') AS hosts,
            (SELECT count(*)::int FROM public.experiences WHERE status = 'review') AS experiences,
            (SELECT count(*)::int FROM public.media_assets
               WHERE moderation = 'pending' AND state = 'ready') AS media
        `);
        const bookings = await one(`
          SELECT
            count(*)::int AS total,
            coalesce(sum(b.quantity), 0)::int AS guests,
            count(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE b.status = 'no_show')::int AS "noShows",
            count(*) FILTER (WHERE t.status = 'checked_in')::int AS "checkedIn"
          FROM public.bookings b
            LEFT JOIN public.tickets t
              ON t.booking_id = b.id AND t.status <> 'revoked'
          WHERE b.created_at > clock_timestamp() - interval '30 days'
        `);
        const upcoming = await one(`
          SELECT count(*)::int AS bookings, coalesce(sum(b.quantity), 0)::int AS guests
          FROM public.bookings b
            JOIN public.experience_slots s ON s.id = b.slot_id
          WHERE b.status = 'confirmed'
            AND s.starts_at BETWEEN clock_timestamp() AND clock_timestamp() + interval '7 days'
        `);
        const people = await one(`
          SELECT
            count(*) FILTER (WHERE status = 'active' AND NOT is_demo)::int AS active,
            count(*) FILTER (
              WHERE NOT is_demo AND created_at > clock_timestamp() - interval '30 days'
            )::int AS "newLast30Days"
          FROM public.users
        `);
        const hosts = await one(`
          SELECT
            count(*) FILTER (
              WHERE h.status = 'approved' AND h.approved_until > clock_timestamp()
            )::int AS active,
            count(*) FILTER (
              WHERE h.status = 'approved'
                AND h.approved_until BETWEEN clock_timestamp()
                  AND clock_timestamp() + interval '30 days'
            )::int AS "expiringSoon"
          FROM public.hosts h
            JOIN public.users u ON u.id = h.user_id
          WHERE NOT u.is_demo
        `);
        const listings = await one(`
          SELECT
            count(*) FILTER (WHERE status = 'published')::int AS published,
            count(*) FILTER (WHERE status = 'draft')::int AS drafts
          FROM public.experiences
        `);
        const community = await one(`
          SELECT count(*)::int AS published
          FROM public.community_events WHERE status = 'published'
        `);
        const byArea = (
          await client.query(`
            SELECT a.name AS area, count(*)::int AS bookings
            FROM public.bookings b
              JOIN public.experiences e ON e.id = b.experience_id
              JOIN public.areas a ON a.code = e.area_code
            WHERE b.created_at > clock_timestamp() - interval '30 days'
              AND b.status <> 'cancelled'
            GROUP BY a.name
            ORDER BY bookings DESC, a.name
            LIMIT 8
          `)
        ).rows;
        const stages = (
          await client.query(`
            SELECT stage, count(*)::int AS count
            FROM public.crm_leads GROUP BY stage
          `)
        ).rows as { stage: keyof typeof stageLabels; count: number }[];
        // Mirrors the pilot tracker measures, per district.
        const tracker = (
          await client.query(`
            SELECT
              CASE WHEN district = '' THEN 'Unassigned' ELSE district END AS district,
              count(*) FILTER (WHERE stage <> 'declined')::int AS longlisted,
              count(*) FILTER (WHERE verdict <> 'undecided')::int AS rated,
              count(*) FILTER (WHERE verdict = 'list_in_pilot')::int AS "listInPilot",
              count(*) FILTER (WHERE site_visit = 'pending')::int AS "siteVisitsPending",
              count(*) FILTER (WHERE media_received)::int AS "mediaReceived",
              count(*) FILTER (WHERE writeup_final)::int AS "writeupFinal",
              count(*) FILTER (WHERE stage IN ('onboarding', 'live'))::int AS "onboardedOrLive"
            FROM public.crm_leads
            GROUP BY 1
            ORDER BY 1
          `)
        ).rows;
        const followUps = await one(`
          SELECT count(*)::int AS due
          FROM public.crm_leads
          WHERE next_follow_up <= (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
            AND stage NOT IN ('live', 'declined')
        `);
        return {
          queue,
          bookings: { last30Days: bookings, next7Days: upcoming, byArea },
          people,
          hosts,
          listings,
          community,
          pipeline: {
            stages: Object.entries(stageLabels).map(([stage, label]) => ({
              stage,
              label,
              count: stages.find((row) => row.stage === stage)?.count ?? 0,
            })),
            tracker,
            followUpsDue: followUps.due,
          },
        };
      }),

    listLeads: (token: string, filter: LeadFilter) =>
      asAdmin(token, async (client) => {
        const cursor = decodeCursor(filter.after);
        const rows = (
          await client.query(
            `
              SELECT ${leadSelect} ${leadFrom}
              WHERE ($1::text IS NULL OR l.stage = $1)
                AND ($2::text IS NULL OR lower(l.district) = lower($2))
                AND (
                  $3::text IS NULL
                  OR l.name ILIKE $3 OR l.experience_idea ILIKE $3
                  OR l.contact_name ILIKE $3 OR l.code ILIKE $3
                  OR l.locality ILIKE $3
                )
                AND (
                  NOT $4::boolean
                  OR (
                    l.next_follow_up <= (clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date
                    AND l.stage NOT IN ('live', 'declined')
                  )
                )
                AND (
                  $5::timestamptz IS NULL
                  OR (l.created_at, l.id) < ($5::timestamptz, $6::uuid)
                )
              ORDER BY l.created_at DESC, l.id DESC
              LIMIT ${PAGE + 1}
            `,
            [
              filter.stage ?? null,
              filter.district?.trim() || null,
              filter.q?.trim() ? like(filter.q.trim()) : null,
              filter.followUpDue ?? false,
              cursor?.[0] ?? null,
              cursor?.[1] ?? null,
            ],
          )
        ).rows;
        return page(rows);
      }),

    createLead: (token: string, raw: LeadInput, requestId: string) =>
      asAdmin(token, async (client, adminId) => {
        const input = normaliseLead(raw);
        if (!input.name) throw invalid('Add the curator or business name.');
        await checkReferences(client, input);
        const entries = Object.entries(leadColumns).filter(
          ([key]) => input[key as keyof LeadInput] !== undefined,
        );
        const id = await guardUnique(async () => {
          const result = await client.query(
            `
              INSERT INTO public.crm_leads (${entries.map(([, c]) => c).join(', ')}, created_by)
              VALUES (${entries.map((_, i) => `$${i + 1}`).join(', ')}, $${entries.length + 1})
              RETURNING id
            `,
            [...entries.map(([key]) => input[key as keyof LeadInput]), adminId],
          );
          return result.rows[0].id as string;
        });
        await addNote(
          client,
          id,
          adminId,
          'stage',
          `Added at stage: ${stageLabels[input.stage ?? 'idea']}`,
        );
        await audit(
          client,
          adminId,
          'crm.lead_created',
          requestId,
          'crm_lead',
          id,
        );
        return readLead(client, id);
      }),

    getLead: (token: string, id: string) =>
      asAdmin(token, async (client) => {
        const lead = await readLead(client, id);
        const notes = (
          await client.query(
            `
              SELECT n.id, n.kind, n.body, n.created_at AS "createdAt",
                u.display_name AS "authorName"
              FROM public.crm_lead_notes n
                JOIN public.users u ON u.id = n.author_id
              WHERE n.lead_id = $1
              ORDER BY n.created_at DESC, n.id DESC
              LIMIT 100
            `,
            [id],
          )
        ).rows;
        return { ...lead, notes };
      }),

    updateLead: (
      token: string,
      id: string,
      raw: LeadPatch,
      requestId: string,
    ) =>
      asAdmin(token, async (client, adminId) => {
        const { revision, ...rest } = raw;
        const input = normaliseLead(rest);
        const current = await readLead(client, id, true);
        if (current.revision !== revision) throw stale();
        await checkReferences(client, input);
        const entries = Object.entries(leadColumns).filter(
          ([key]) => input[key as keyof LeadInput] !== undefined,
        );
        if (!entries.length) throw invalid('Change at least one field.');
        await guardUnique(() =>
          client.query(
            `
              UPDATE public.crm_leads
              SET ${entries.map(([, c], i) => `${c} = $${i + 2}`).join(', ')},
                revision = revision + 1,
                updated_at = clock_timestamp()
              WHERE id = $1
            `,
            [id, ...entries.map(([key]) => input[key as keyof LeadInput])],
          ),
        );
        if (input.stage && input.stage !== current.stage) {
          await addNote(
            client,
            id,
            adminId,
            'stage',
            `Stage: ${stageLabels[current.stage as keyof typeof stageLabels]} → ${stageLabels[input.stage]}`,
          );
        }
        await audit(
          client,
          adminId,
          'crm.lead_updated',
          requestId,
          'crm_lead',
          id,
        );
        return readLead(client, id);
      }),

    addLeadNote: (
      token: string,
      id: string,
      note: { kind: string; body: string },
      requestId: string,
    ) =>
      asAdmin(token, async (client, adminId) => {
        await readLead(client, id, true);
        const body = note.body.trim();
        if (!body) throw invalid('Write a note before saving.');
        const created = await addNote(client, id, adminId, note.kind, body);
        await client.query(
          'UPDATE public.crm_leads SET updated_at = clock_timestamp() WHERE id = $1',
          [id],
        );
        await audit(
          client,
          adminId,
          'crm.note_added',
          requestId,
          'crm_lead',
          id,
        );
        return created;
      }),

    listUsers: (
      token: string,
      filter: { q?: string; role?: string; after?: string },
    ) =>
      asAdmin(token, async (client) => {
        const cursor = decodeCursor(filter.after);
        const rows = (
          await client.query(
            `
              SELECT
                u.id,
                u.display_name AS "displayName",
                i.subject AS email,
                u.status,
                u.is_demo AS "isDemo",
                u.created_at AS "createdAt",
                coalesce(
                  array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL),
                  '{}'
                ) AS roles,
                h.status AS "hostStatus",
                (SELECT count(*)::int FROM public.bookings b WHERE b.user_id = u.id) AS bookings
              FROM public.users u
                LEFT JOIN public.auth_identities i
                  ON i.user_id = u.id AND i.provider = 'password'
                LEFT JOIN public.user_roles r ON r.user_id = u.id
                LEFT JOIN public.hosts h ON h.user_id = u.id
              WHERE u.status <> 'deleted'
                AND ($1::text IS NULL OR u.display_name ILIKE $1 OR i.subject ILIKE $1)
                AND (
                  $2::text IS NULL
                  OR EXISTS (
                    SELECT 1 FROM public.user_roles rr
                    WHERE rr.user_id = u.id AND rr.role = $2
                  )
                )
                AND (
                  $3::timestamptz IS NULL
                  OR (u.created_at, u.id) < ($3::timestamptz, $4::uuid)
                )
              GROUP BY u.id, i.subject, h.status
              ORDER BY u.created_at DESC, u.id DESC
              LIMIT ${PAGE + 1}
            `,
            [
              filter.q?.trim() ? like(filter.q.trim()) : null,
              filter.role ?? null,
              cursor?.[0] ?? null,
              cursor?.[1] ?? null,
            ],
          )
        ).rows;
        return page(rows);
      }),

    getUser: (token: string, id: string) =>
      asAdmin(token, async (client) => {
        const user = (
          await client.query(
            `
              SELECT
                u.id,
                u.display_name AS "displayName",
                i.subject AS email,
                u.language,
                u.status,
                u.is_demo AS "isDemo",
                u.created_at AS "createdAt",
                coalesce(
                  (SELECT array_agg(role ORDER BY role) FROM public.user_roles WHERE user_id = u.id),
                  '{}'
                ) AS roles,
                (SELECT count(*)::int FROM public.auth_sessions s
                  WHERE s.user_id = u.id AND s.expires_at > clock_timestamp()) AS "activeSessions"
              FROM public.users u
                LEFT JOIN public.auth_identities i
                  ON i.user_id = u.id AND i.provider = 'password'
              WHERE u.id = $1
            `,
            [id],
          )
        ).rows[0];
        if (!user) throw notFound('User');
        const host =
          (
            await client.query(
              `
              SELECT id, public_name AS "publicName", status,
                approved_until AS "approvedUntil"
              FROM public.hosts WHERE user_id = $1
            `,
              [id],
            )
          ).rows[0] ?? null;
        const bookings = (
          await client.query(
            `
              SELECT b.id, b.reference, b.status, b.quantity,
                e.title AS "experienceTitle", s.starts_at AS "startsAt"
              FROM public.bookings b
                JOIN public.experiences e ON e.id = b.experience_id
                JOIN public.experience_slots s ON s.id = b.slot_id
              WHERE b.user_id = $1
              ORDER BY b.created_at DESC
              LIMIT 10
            `,
            [id],
          )
        ).rows;
        const activity = (
          await client.query(
            `
              SELECT action, entity_type AS "entityType", created_at AS "createdAt"
              FROM public.audit_logs
              WHERE actor_id = $1 OR (entity_type = 'user' AND entity_id = $1)
              ORDER BY created_at DESC
              LIMIT 20
            `,
            [id],
          )
        ).rows;
        return { ...user, host, bookings, activity };
      }),

    setStatus: (
      token: string,
      id: string,
      status: 'active' | 'suspended',
      requestId: string,
    ) =>
      asAdmin(token, async (client, adminId) => {
        if (id === adminId) throw invalid('You cannot change your own status.');
        const user = (
          await client.query(
            'SELECT status FROM public.users WHERE id = $1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!user) throw notFound('User');
        if (!['active', 'suspended'].includes(user.status))
          throw invalid('This account is being deleted and cannot be changed.');
        await client.query(
          'UPDATE public.users SET status = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
          [id, status],
        );
        if (status === 'suspended') {
          // Suspension signs the person out everywhere immediately.
          await client.query(
            'DELETE FROM public.auth_sessions WHERE user_id = $1',
            [id],
          );
        }
        await audit(
          client,
          adminId,
          `admin.user_${status}`,
          requestId,
          'user',
          id,
        );
        return { id, status };
      }),

    listBookings: (
      token: string,
      filter: { q?: string; status?: string; after?: string },
    ) =>
      asAdmin(token, async (client) => {
        const cursor = decodeCursor(filter.after);
        const q = filter.q?.trim();
        const rows = (
          await client.query(
            `
              SELECT
                b.id,
                b.reference,
                b.status,
                b.quantity,
                b.contact_name AS "contactName",
                b.contact_email AS "contactEmail",
                b.created_at AS "createdAt",
                e.title AS "experienceTitle",
                e.slug AS "experienceSlug",
                h.public_name AS "hostName",
                s.starts_at AS "startsAt",
                t.status AS "ticketStatus"
              FROM public.bookings b
                JOIN public.experiences e ON e.id = b.experience_id
                JOIN public.hosts h ON h.id = e.host_id
                JOIN public.experience_slots s ON s.id = b.slot_id
                LEFT JOIN public.tickets t
                  ON t.booking_id = b.id AND t.status <> 'revoked'
              WHERE ($1::text IS NULL OR b.status = $1)
                AND (
                  $2::text IS NULL
                  OR upper(b.reference) = upper($3)
                  OR b.contact_email ILIKE $2
                  OR b.contact_name ILIKE $2
                  OR e.title ILIKE $2
                )
                AND (
                  $4::timestamptz IS NULL
                  OR (b.created_at, b.id) < ($4::timestamptz, $5::uuid)
                )
              ORDER BY b.created_at DESC, b.id DESC
              LIMIT ${PAGE + 1}
            `,
            [
              filter.status ?? null,
              q ? like(q) : null,
              q ?? null,
              cursor?.[0] ?? null,
              cursor?.[1] ?? null,
            ],
          )
        ).rows;
        return page(rows);
      }),
  };
}
