import type { PoolClient } from 'pg';
import type { Database } from '../db/database.js';
import { audit } from '../db/audit.js';
import { AccountError } from './model.js';
import { hashPassword, normalizeEmail, verifyPassword } from './password.js';

export type Credentials = { email: string; password: string };
export type Registration = Credentials & { displayName: string };

export function passwordAccounts<T>(
  database: Database,
  createSession: (
    client: PoolClient,
    userId: string,
    requestId: string,
  ) => Promise<T>,
) {
  return {
    async register(input: Registration, requestId: string) {
      const email = normalizeEmail(input.email);
      const passwordHash = await hashPassword(input.password);
      return database.transaction(async (client) => {
        // Serialize duplicate sign-ups, including requests arriving at separate API processes.
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('sikkim-password:' || $1))",
          [email],
        );
        const existing = await client.query(
          `
            SELECT id FROM public.auth_identities
            WHERE provider = 'password' AND subject = $1
          `,
          [email],
        );
        if (existing.rowCount) {
          throw new AccountError(
            409,
            'SIGN_UP_UNAVAILABLE',
            'Unable to create this account. Try signing in instead.',
          );
        }
        const user = (
          await client.query<{ id: string }>(
            'INSERT INTO public.users (display_name) VALUES ($1) RETURNING id',
            [input.displayName.trim()],
          )
        ).rows[0]!;
        await client.query(
          `
            INSERT INTO public.auth_identities (user_id, provider, subject)
            VALUES ($1, 'password', $2)
          `,
          [user.id, email],
        );
        await client.query(
          'INSERT INTO public.auth_passwords (user_id, password_hash) VALUES ($1, $2)',
          [user.id, passwordHash],
        );
        await client.query(
          'INSERT INTO public.user_preferences (user_id) VALUES ($1)',
          [user.id],
        );
        await audit(client, user.id, 'account.created', requestId);
        return createSession(client, user.id, requestId);
      });
    },
    async login(input: Credentials, requestId: string) {
      return database.transaction(async (client) => {
        // Use the same account-before-session lock order as refresh/logout/deletion.
        const user = (
          await client.query<{
            id: string;
            status: string;
            isDemo: boolean;
            passwordHash: string;
          }>(
            `
              SELECT u.id, u.status, u.is_demo AS "isDemo",
                p.password_hash AS "passwordHash"
              FROM public.auth_identities a
              JOIN public.users u ON u.id = a.user_id
              JOIN public.auth_passwords p ON p.user_id = u.id
              WHERE a.provider = 'password' AND a.subject = $1
              FOR UPDATE OF u
            `,
            [normalizeEmail(input.email)],
          )
        ).rows[0];
        // Unknown and disabled accounts still do the same password work.
        const matches = await verifyPassword(
          input.password,
          user?.passwordHash,
        );
        if (!matches || !user || user.isDemo || user.status !== 'active') {
          throw new AccountError(
            401,
            'LOGIN_FAILED',
            'Email or password is incorrect.',
          );
        }
        return createSession(client, user.id, requestId);
      });
    },
  };
}
