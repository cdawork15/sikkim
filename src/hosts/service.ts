import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { accountAccess } from '../accounts/access.js';
import { AccountError } from '../accounts/model.js';
import { audit } from '../db/audit.js';
import { hasAnyRole, requireStaff, staffRoles } from '../accounts/roles.js';

export type HostDraft = {
  revision: number;
  publicName?: string;
  story?: string;
  serviceAreas?: string[];
  contactChoice?: 'hidden' | 'in_app';
};

export type Decision = {
  revision: number;
  action: 'approved' | 'rejected' | 'suspended';
  reason: string;
  expiresAt?: string;
  method?: VerificationMethod;
};

export const verificationMethods = [
  'in_person',
  'video_call',
  'document',
] as const;
export type VerificationMethod = (typeof verificationMethods)[number];

const verificationUnavailable = () =>
  new AccountError(
    503,
    'VERIFICATION_UNAVAILABLE',
    'Real host verification is not available yet.',
  );
const missing = () =>
  new AccountError(404, 'NOT_FOUND', 'Host profile was not found.');
const conflict = () =>
  new AccountError(
    409,
    'HOST_CHANGED',
    'Reload the host profile before trying again.',
  );
const columns = `
  h.id,
  h.user_id AS "userId",
  h.public_name AS "publicName",
  h.story,
  h.service_areas AS "serviceAreas",
  h.contact_choice AS "contactChoice",
  h.status,
  h.revision,
  h.approved_until AS "approvedUntil",
  h.created_at AS "createdAt",
  h.updated_at AS "updatedAt",
  u.is_demo AS "isDemo"
`;

// Publishing services must use this inside their write transaction and keep the
// locks until the listing/event write commits. A host role alone is insufficient.

export async function requirePublishableHost(
  client: PoolClient,
  userId: string,
) {
  const user = (
    await client.query(
      `
        SELECT id
        FROM public.users
        WHERE id = $1
          AND status = 'active'
          AND NOT is_demo
        FOR UPDATE
      `,
      [userId],
    )
  ).rows[0];
  if (!user) {
    throw new AccountError(
      403,
      'HOST_NOT_ELIGIBLE',
      'An approved real host account is required.',
    );
  }
  const host = (
    await client.query(
      `
        SELECT id
        FROM public.hosts
        WHERE user_id = $1
          AND status = 'approved'
          AND approved_until > clock_timestamp()
        FOR UPDATE
      `,
      [userId],
    )
  ).rows[0];
  if (!host) {
    throw new AccountError(
      403,
      'HOST_NOT_ELIGIBLE',
      'An approved real host account is required.',
    );
  }
  return host.id as string;
}

export async function hostAccountData(
  client: PoolClient,
  userId: string,
  realVerificationAvailable = false,
) {
  const host = (
    await client.query(
      `
        SELECT ${columns}
        FROM public.hosts h
          JOIN public.users u ON u.id = h.user_id
        WHERE h.user_id = $1
      `,
      [userId],
    )
  ).rows[0];
  if (!host) {
    return null;
  }
  const history = (
    await client.query(
      `
        SELECT
          id,
          revision,
          action,
          reason,
          expires_at AS "expiresAt",
          method,
          is_demo AS "isDemo",
          created_at AS "createdAt"
        FROM public.host_verifications
        WHERE host_id = $1
        ORDER BY revision
      `,
      [host.id],
    )
  ).rows;
  return {
    ...host,
    history,
    uploadsAvailable: false,
    realVerificationAvailable,
  };
}

async function reviewer(client: PoolClient, userId: string) {
  await requireStaff(
    client,
    userId,
    'Only an authorised reviewer can do this.',
  );
}

async function record(
  client: PoolClient,
  hostId: string,
  userId: string,
  action: string,
  reason: string | null,
  requestId: string,
  method: VerificationMethod | 'staff' | null = null,
) {
  await client.query(
    `
      INSERT INTO public.host_verifications (
          host_id,
          revision,
          action,
          actor_id,
          reason,
          snapshot,
          expires_at,
          is_demo,
          method
        )
      SELECT
        h.id,
        h.revision,
        $3,
        $2,
        $4,
        jsonb_build_object(
          'publicName',
          h.public_name,
          'story',
          h.story,
          'serviceAreas',
          h.service_areas,
          'contactChoice',
          h.contact_choice
        ),
        h.approved_until,
        u.is_demo,
        $5
      FROM public.hosts h
        JOIN public.users u ON u.id = h.user_id
      WHERE h.id = $1
    `,
    [hostId, userId, action, reason, method],
  );
  await audit(client, userId, `host.${action}`, requestId, 'host', hostId);
}

export function hostService(database: Database, config: Config) {
  const access = accountAccess(database, config);
  const manual = config.hostVerification === 'manual';
  // Demo hosts can complete the flow only on a local demo server; real hosts
  // need the manual verification process to be switched on.
  const verifiable = (isDemo: boolean) => (isDemo ? config.demoAuth : manual);
  async function own(client: PoolClient, userId: string) {
    const host = await hostAccountData(client, userId, manual);
    if (!host) {
      throw missing();
    }
    return host;
  }
  return {
    me: (token: string) => access(token, (client, p) => own(client, p.userId)),
    draft: (token: string, patch: HostDraft, requestId: string) =>
      access(token, async (client, p) => {
        let host = (
          await client.query(
            `
              SELECT
                id,
                status,
                revision
              FROM public.hosts
              WHERE user_id = $1
              FOR UPDATE
            `,
            [p.userId],
          )
        ).rows[0];
        if (!host) {
          if (patch.revision !== 0) {
            throw conflict();
          }
          host = (
            await client.query(
              `
                INSERT INTO public.hosts (user_id)
                VALUES
                  ($1)
                RETURNING id,
                  status,
                  revision
              `,
              [p.userId],
            )
          ).rows[0];
        } else {
          if (host.revision !== patch.revision) {
            throw conflict();
          }
          if (!['draft', 'rejected'].includes(host.status)) {
            throw new AccountError(
              409,
              'HOST_LOCKED',
              'Only drafts and rejected applications can be edited.',
            );
          }
        }
        const areas = patch.serviceAreas?.map((a) => a.trim());
        if (
          areas &&
          new Set(areas.map((a) => a.toLowerCase())).size !== areas.length
        ) {
          throw new AccountError(
            400,
            'INVALID_REQUEST',
            'Use each service area only once.',
          );
        }
        await client.query(
          `
            UPDATE public.hosts
            SET
              public_name = COALESCE($2, public_name),
              story = COALESCE($3, story),
              service_areas = COALESCE($4, service_areas),
              contact_choice = COALESCE($5, contact_choice),
              status = 'draft',
              revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [
            host.id,
            patch.publicName?.trim(),
            patch.story?.trim(),
            areas,
            patch.contactChoice,
          ],
        );
        await audit(
          client,
          p.userId,
          'host.draft_saved',
          requestId,
          'host',
          host.id,
        );
        return own(client, p.userId);
      }),
    submit: (token: string, revision: number, requestId: string) =>
      access(token, async (client, p) => {
        const host = await own(client, p.userId);
        if (host.revision !== revision) {
          throw conflict();
        }
        if (host.status !== 'draft') {
          throw new AccountError(
            409,
            'HOST_LOCKED',
            'Save a draft before submitting.',
          );
        }
        if (!host.publicName || !host.story || !host.serviceAreas.length) {
          throw new AccountError(
            400,
            'HOST_INCOMPLETE',
            'Add a public name, introduction and at least one service area.',
          );
        }
        // Staff (admin/super) are known to the team, so their own host
        // profile is approved straight away to let them run trips.
        const staff =
          !host.isDemo && (await hasAnyRole(client, p.userId, staffRoles));
        if (!staff && !verifiable(host.isDemo)) {
          throw verificationUnavailable();
        }
        await client.query(
          `
            UPDATE public.hosts
            SET
              status = 'pending',
              revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [host.id],
        );
        await record(client, host.id, p.userId, 'submitted', null, requestId);
        if (staff) {
          await client.query(
            `
              UPDATE public.hosts
              SET
                status = 'approved',
                approved_until = clock_timestamp() + interval '1 year',
                revision = revision + 1,
                updated_at = CURRENT_TIMESTAMP
              WHERE id = $1
            `,
            [host.id],
          );
          await record(
            client,
            host.id,
            p.userId,
            'approved',
            'Staff account: identity known to the team.',
            requestId,
            'staff',
          );
        }
        return own(client, p.userId);
      }),
    reviewList: (token: string, status: string, after: string | undefined) =>
      access(token, async (client, p) => {
        await reviewer(client, p.userId);
        const rows = (
          await client.query(
            `
              SELECT ${columns}
              FROM public.hosts h
                JOIN public.users u ON u.id = h.user_id
              WHERE h.status = $1
                AND (
                  $2::uuid IS NULL
                  OR h.id > $2
                )
              ORDER BY h.id
              LIMIT 21
            `,
            [status, after ?? null],
          )
        ).rows;
        return {
          data: rows.slice(0, 20),
          page: { nextCursor: rows.length > 20 ? rows[19].id : null },
        };
      }),
    reviewDetail: (token: string, id: string) =>
      access(token, async (client, p) => {
        await reviewer(client, p.userId);
        const row = (
          await client.query('SELECT user_id FROM public.hosts WHERE id=$1', [
            id,
          ])
        ).rows[0];
        if (!row) {
          throw missing();
        }
        return own(client, row.user_id);
      }),
    decide: (
      token: string,
      id: string,
      decision: Decision,
      requestId: string,
    ) =>
      access(token, async (client, p) => {
        await reviewer(client, p.userId);
        const host = (
          await client.query(
            `
              SELECT
                ${columns},
                u.status AS "accountStatus"
              FROM public.hosts h
                JOIN public.users u ON u.id = h.user_id
              WHERE h.id = $1
              FOR UPDATE OF h
            `,
            [id],
          )
        ).rows[0];
        if (!host) {
          throw missing();
        }
        if (host.userId === p.userId) {
          throw new AccountError(
            403,
            'FORBIDDEN',
            'Another reviewer must review your application.',
          );
        }
        if (host.revision !== decision.revision) {
          throw conflict();
        }
        if (
          decision.action === 'suspended'
            ? host.status !== 'approved'
            : host.status !== 'pending'
        ) {
          throw new AccountError(
            409,
            'HOST_LOCKED',
            'This decision does not match the current application status.',
          );
        }
        if (decision.action !== 'suspended' && !verifiable(host.isDemo)) {
          throw verificationUnavailable();
        }
        if (
          decision.action === 'approved' && !host.isDemo
            ? !decision.method
            : decision.method !== undefined
        ) {
          throw new AccountError(
            400,
            'INVALID_REQUEST',
            'Record how the identity was checked when approving a real host.',
          );
        }
        if (decision.action === 'approved' && host.accountStatus !== 'active') {
          throw new AccountError(
            409,
            'ACCOUNT_UNAVAILABLE',
            'This host account is not active.',
          );
        }
        const expiry = decision.expiresAt ? new Date(decision.expiresAt) : null;
        if (
          decision.action === 'approved'
            ? !expiry ||
              !Number.isFinite(expiry.getTime()) ||
              expiry.getTime() <= Date.now()
            : Boolean(expiry)
        ) {
          throw new AccountError(
            400,
            'INVALID_REQUEST',
            'Only approval requires a future expiry date.',
          );
        }
        await client.query(
          `
            UPDATE public.hosts
            SET
              status = $2,
              approved_until = $3,
              revision = revision + 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [id, decision.action, expiry],
        );
        await record(
          client,
          id,
          p.userId,
          decision.action,
          decision.reason.trim(),
          requestId,
          decision.method ?? null,
        );
        return own(client, host.userId);
      }),
    publicList: (after: string | undefined) =>
      database.transaction(async (client) => {
        const rows = (
          await client.query(
            `
              SELECT
                h.id,
                h.public_name AS "publicName",
                h.story,
                h.service_areas AS "serviceAreas",
                h.contact_choice AS "contactChoice"
              FROM public.hosts h
                JOIN public.users u ON u.id = h.user_id
              WHERE h.status = 'approved'
                AND h.approved_until > clock_timestamp()
                AND u.status = 'active'
                AND NOT u.is_demo
                AND (
                  $1::uuid IS NULL
                  OR h.id > $1
                )
              ORDER BY h.id
              LIMIT 21
            `,
            [after ?? null],
          )
        ).rows;
        return {
          data: rows.slice(0, 20),
          page: { nextCursor: rows.length > 20 ? rows[19].id : null },
        };
      }),
    publicDetail: (id: string) =>
      database.transaction(async (client) => {
        const host = (
          await client.query(
            `
              SELECT
                h.id,
                h.public_name AS "publicName",
                h.story,
                h.service_areas AS "serviceAreas",
                h.contact_choice AS "contactChoice"
              FROM public.hosts h
                JOIN public.users u ON u.id = h.user_id
              WHERE h.id = $1
                AND h.status = 'approved'
                AND h.approved_until > clock_timestamp()
                AND u.status = 'active'
                AND NOT u.is_demo
            `,
            [id],
          )
        ).rows[0];
        if (!host) {
          throw missing();
        }
        return { ...host, listingsAvailable: true };
      }),
  };
}
