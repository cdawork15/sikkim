import { passwordAccounts } from './password-auth.js';
import { otpAccounts, type OtpDelivery } from './otp.js';
import { bookingAccountData } from '../bookings/export.js';
import { mediaAccountData } from '../media/actions.js';
import { catalogueAccountData } from '../catalogue/read.js';
import { hostAccountData } from '../hosts/service.js';
import { accountAccess } from './access.js';
import { audit } from '../db/audit.js';
import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import {
  AccountError,
  demoPolicyVersion,
  newToken,
  tokenHash,
  validTripStart,
  type ConsentPurpose,
  type DemoAccount,
  type PreferencePatch,
  type ProfilePatch,
} from './model.js';

async function profile(client: PoolClient, userId: string) {
  const user = (
    await client.query(
      `
        SELECT
          id,
          display_name AS "displayName",
          language,
          is_demo AS "isDemo",
          created_at AS "createdAt",
          updated_at AS "updatedAt"
        FROM public.users
        WHERE id = $1
      `,
      [userId],
    )
  ).rows[0];
  const preferences = (
    await client.query(
      `
        SELECT
          chosen_area AS "chosenArea",
          trip_start::text AS "tripStart",
          trip_days AS "tripDays",
          travellers,
          pace,
          notifications_enabled AS "notificationsEnabled",
          show_in_participant_list AS "showInParticipantList",
          search_filters AS "searchFilters"
        FROM public.user_preferences
        WHERE user_id = $1
      `,
      [userId],
    )
  ).rows[0];
  const interests = (
    await client.query<{ code: string }>(
      `
        SELECT i.code
        FROM public.interests i
          JOIN public.user_interests ui ON ui.interest_code = i.code
        WHERE ui.user_id = $1
        ORDER BY i.sort_order
      `,
      [userId],
    )
  ).rows.map((r) => r.code);
  const roles = (
    await client.query<{ role: string }>(
      'SELECT role FROM public.user_roles WHERE user_id=$1 ORDER BY role',
      [userId],
    )
  ).rows.map((r) => r.role);
  return {
    ...user,
    preferences,
    interests,
    roles: ['traveller', ...roles],
    onboardingComplete: interests.length > 0,
    contentLanguage: 'en',
  };
}

async function createSession(
  client: PoolClient,
  userId: string,
  requestId: string,
) {
  await client.query(
    `
      DELETE FROM public.auth_sessions
      WHERE user_id = $1 AND expires_at <= CURRENT_TIMESTAMP
    `,
    [userId],
  );
  await client.query(
    `
      DELETE FROM public.auth_sessions
      WHERE id IN (
        SELECT id FROM public.auth_sessions
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        OFFSET 4
      )
    `,
    [userId],
  );
  const accessToken = newToken();
  const session = (
    await client.query(
      `
        INSERT INTO public.auth_sessions (
          user_id, token_hash, expires_at, absolute_expires_at
        )
        VALUES (
          $1, $2,
          CURRENT_TIMESTAMP + interval '30 minutes',
          CURRENT_TIMESTAMP + interval '24 hours'
        )
        RETURNING id, expires_at AS "expiresAt",
          absolute_expires_at AS "absoluteExpiresAt"
      `,
      [userId, tokenHash(accessToken)],
    )
  ).rows[0];
  await audit(
    client,
    userId,
    'session.created',
    requestId,
    'session',
    session.id,
  );
  const user = await profile(client, userId);
  return {
    accessToken,
    tokenType: 'Bearer',
    expiresAt: session.expiresAt,
    absoluteExpiresAt: session.absoluteExpiresAt,
    demo: user.isDemo,
    user,
  };
}

export function accountService(
  database: Database,
  config: Config,
  deliver: OtpDelivery = async () => {
    throw new AccountError(
      503,
      'OTP_UNAVAILABLE',
      'Sign-in codes are not available right now.',
    );
  },
) {
  const authenticated = accountAccess(database, config);

  return {
    ...passwordAccounts(database, createSession),
    ...otpAccounts(database, config, deliver, createSession),
    interests: () =>
      database.transaction(
        async (client) =>
          (
            await client.query(
              `
                SELECT
                  code,
                  label_key AS "labelKey",
                  label_en AS label
                FROM public.interests
                ORDER BY sort_order
              `,
            )
          ).rows,
      ),

    async demoSession(account: DemoAccount, requestId: string) {
      if (!config.demoAuth) {
        throw new AccountError(
          404,
          'NOT_FOUND',
          'This endpoint does not exist.',
        );
      }
      return database.transaction(async (client) => {
        // Two simultaneous first sign-ins must create one account, not two.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('sikkim-demo:' || $1))",
          [account],
        );
        let user = (
          await client.query<{ id: string; status: string; isDemo: boolean }>(
            `
              SELECT
                u.id,
                u.status,
                u.is_demo AS "isDemo"
              FROM public.auth_identities a
                JOIN public.users u ON u.id = a.user_id
              WHERE a.provider = 'demo'
                AND a.subject = $1
              FOR UPDATE OF u
            `,
            [account],
          )
        ).rows[0];
        if (!user) {
          user = (
            await client.query<{ id: string; status: string; isDemo: boolean }>(
              `
                INSERT INTO public.users (display_name, is_demo)
                VALUES
                  ($1, true)
                RETURNING id,
                  status,
                  is_demo AS "isDemo"
              `,
              [
                account === 'traveller-one'
                  ? 'Demo traveller one'
                  : 'Demo traveller two',
              ],
            )
          ).rows[0]!;
          await client.query(
            `
              INSERT INTO public.auth_identities (user_id, provider, subject)
              VALUES
                ($1, 'demo', $2)
            `,
            [user.id, account],
          );
          await client.query(
            'INSERT INTO public.user_preferences (user_id) VALUES ($1)',
            [user.id],
          );
          await audit(client, user.id, 'account.demo_created', requestId);
        }
        if (!user.isDemo || user.status !== 'active') {
          throw new AccountError(
            403,
            'ACCOUNT_UNAVAILABLE',
            'This account cannot sign in.',
          );
        }
        return createSession(client, user.id, requestId);
      });
    },

    me: (token: string) =>
      authenticated(token, (client, principal) =>
        profile(client, principal.userId),
      ),

    updateProfile: (token: string, patch: ProfilePatch, requestId: string) =>
      authenticated(token, async (client, p) => {
        await client.query(
          `
            UPDATE public.users
            SET
              display_name = COALESCE($2, display_name),
              language = COALESCE($3, language),
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [p.userId, patch.displayName?.trim() ?? null, patch.language ?? null],
        );
        await audit(client, p.userId, 'profile.updated', requestId);
        return profile(client, p.userId);
      }),

    updatePreferences: (
      token: string,
      patch: PreferencePatch,
      requestId: string,
    ) =>
      authenticated(token, async (client, p) => {
        if (patch.tripStart && !validTripStart(patch.tripStart)) {
          throw new AccountError(
            400,
            'INVALID_REQUEST',
            'Choose a valid date today or later in India time.',
          );
        }
        const columns: Record<keyof PreferencePatch, string> = {
          chosenArea: 'chosen_area',
          tripStart: 'trip_start',
          tripDays: 'trip_days',
          travellers: 'travellers',
          pace: 'pace',
          notificationsEnabled: 'notifications_enabled',
          showInParticipantList: 'show_in_participant_list',
        };
        const entries = Object.entries(patch) as [
          keyof PreferencePatch,
          unknown,
        ][];
        const assignments = entries.map(
          ([key], i) => `${columns[key]}=$${i + 2}`,
        );
        await client.query(
          `UPDATE public.user_preferences SET ${assignments.join(',')} WHERE user_id=$1`,
          [
            p.userId,
            ...entries.map(([key, value]) =>
              key === 'chosenArea' && typeof value === 'string'
                ? value.trim()
                : value,
            ),
          ],
        );
        await audit(client, p.userId, 'preferences.updated', requestId);
        return profile(client, p.userId);
      }),

    updateInterests: (token: string, codes: string[], requestId: string) =>
      authenticated(token, async (client, p) => {
        await client.query(
          'DELETE FROM public.user_interests WHERE user_id=$1',
          [p.userId],
        );
        await client.query(
          `
            INSERT INTO public.user_interests (user_id, interest_code)
            SELECT
              $1,
              unnest($2::varchar[])
          `,
          [p.userId, codes],
        );
        await audit(client, p.userId, 'interests.updated', requestId);
        return profile(client, p.userId);
      }),

    refresh: (token: string, requestId: string) =>
      authenticated(token, async (client, p) => {
        const accessToken = newToken();
        const session = (
          await client.query(
            `
              UPDATE public.auth_sessions
              SET
                token_hash = $2,
                expires_at = LEAST(
                  CURRENT_TIMESTAMP + interval '30 minutes',
                  absolute_expires_at
                )
              WHERE id = $1
              RETURNING expires_at AS "expiresAt",
                absolute_expires_at AS "absoluteExpiresAt"
            `,
            [p.sessionId, tokenHash(accessToken)],
          )
        ).rows[0];
        await audit(
          client,
          p.userId,
          'session.renewed',
          requestId,
          'session',
          p.sessionId,
        );
        return { accessToken, tokenType: 'Bearer', ...session };
      }),

    logout: (token: string, all: boolean, requestId: string) =>
      authenticated(token, async (client, p) => {
        if (all) {
          await client.query(
            'DELETE FROM public.auth_sessions WHERE user_id=$1',
            [p.userId],
          );
        } else {
          await client.query('DELETE FROM public.auth_sessions WHERE id=$1', [
            p.sessionId,
          ]);
        }
        await audit(
          client,
          p.userId,
          all ? 'session.all_signed_out' : 'session.signed_out',
          requestId,
          'session',
          p.sessionId,
        );
      }),

    consents: (token: string) =>
      authenticated(
        token,
        async (client, p) =>
          (
            await client.query(
              `
                SELECT DISTINCT
                  ON (purpose) purpose,
                  policy_version AS version,
                  accepted,
                  recorded_at AS "recordedAt"
                FROM public.user_consents
                WHERE user_id = $1
                ORDER BY
                  purpose,
                  recorded_at DESC,
                  id DESC
              `,
              [p.userId],
            )
          ).rows,
      ),

    consent: (
      token: string,
      purpose: ConsentPurpose,
      accepted: boolean,
      version: string,
      requestId: string,
    ) =>
      authenticated(token, async (client, p) => {
        // These are demo choices, not approved production legal documents.
        const user = (
          await client.query<{ isDemo: boolean }>(
            'SELECT is_demo AS "isDemo" FROM public.users WHERE id = $1',
            [p.userId],
          )
        ).rows[0];
        if (!config.demoAuth || !user?.isDemo) {
          throw new AccountError(
            503,
            'POLICY_UNAVAILABLE',
            'Privacy choices are not ready yet.',
          );
        }
        if (version !== demoPolicyVersion) {
          throw new AccountError(
            409,
            'POLICY_CHANGED',
            'Reload the privacy choices before saving.',
          );
        }
        const previous = (
          await client.query(
            `
              SELECT
                purpose,
                policy_version AS version,
                accepted,
                recorded_at AS "recordedAt"
              FROM public.user_consents
              WHERE user_id = $1
                AND purpose = $2
              ORDER BY
                recorded_at DESC,
                id DESC
              LIMIT 1
            `,
            [p.userId, purpose],
          )
        ).rows[0];
        if (previous?.accepted === accepted && previous?.version === version) {
          return previous;
        }
        const result = (
          await client.query(
            `
              INSERT INTO public.user_consents (user_id, purpose, policy_version, accepted)
              VALUES
                ($1, $2, $3, $4)
              RETURNING purpose,
                policy_version AS version,
                accepted,
                recorded_at AS "recordedAt"
            `,
            [p.userId, purpose, version, accepted],
          )
        ).rows[0];
        await audit(
          client,
          p.userId,
          accepted ? 'consent.accepted' : 'consent.withdrawn',
          requestId,
        );
        return result;
      }),

    exportAccount: (token: string, requestId: string) =>
      authenticated(token, async (client, p) => {
        const user = await profile(client, p.userId);
        const host = await hostAccountData(
          client,
          p.userId,
          config.hostVerification === 'manual',
        );
        const catalogue = await catalogueAccountData(client, p.userId);
        const media = await mediaAccountData(client, p.userId);
        const bookings = await bookingAccountData(client, p.userId);
        const consents = (
          await client.query(
            `
              SELECT
                purpose,
                policy_version AS version,
                accepted,
                recorded_at AS "recordedAt"
              FROM public.user_consents
              WHERE user_id = $1
              ORDER BY
                recorded_at,
                id
            `,
            [p.userId],
          )
        ).rows;
        const identities = (
          await client.query(
            `
              SELECT
                provider,
                subject,
                created_at AS "createdAt"
              FROM public.auth_identities
              WHERE user_id = $1
              ORDER BY
                created_at,
                id
            `,
            [p.userId],
          )
        ).rows;
        const requests = (
          await client.query(
            `
              SELECT
                id,
                type,
                status,
                requested_at AS "requestedAt"
              FROM public.account_requests
              WHERE user_id = $1
              ORDER BY
                requested_at,
                id
            `,
            [p.userId],
          )
        ).rows;
        await audit(client, p.userId, 'account.exported', requestId);
        return {
          exportedAt: new Date().toISOString(),
          bookings,
          host,
          catalogue,
          media,
          user,
          consents,
          identities,
          requests,
        };
      }),

    requestDeletion: (token: string, requestId: string) =>
      authenticated(token, async (client, p) => {
        const request = (
          await client.query(
            `
              INSERT INTO public.account_requests (user_id, type)
              VALUES
                ($1, 'deletion')
              RETURNING id,
                type,
                status,
                requested_at AS "requestedAt"
            `,
            [p.userId],
          )
        ).rows[0];
        await client.query(
          `
            UPDATE public.users
            SET
              status = 'deletion_requested',
              updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
          `,
          [p.userId],
        );
        await client.query(
          'DELETE FROM public.auth_sessions WHERE user_id=$1',
          [p.userId],
        );
        await audit(client, p.userId, 'account.deletion_requested', requestId);
        return {
          ...request,
          message:
            'Request recorded and all sessions signed out. Data removal ' +
            'awaits review; nothing has been permanently deleted.',
        };
      }),
  };
}
