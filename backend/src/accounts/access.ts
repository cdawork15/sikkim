import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { tokenHash, unauthenticated } from './model.js';
type Principal = { userId: string; sessionId: string };

export function accountAccess(database: Database, config: Config) {
  // One short transaction serializes each account's actions with logout/suspension.
  return function authenticated<T>(
    token: string,
    operation: (client: PoolClient, principal: Principal) => Promise<T>,
  ) {
    return database.transaction(async (client) => {
      const hash = tokenHash(token);
      // Always lock the account before any session. Logout-all also follows this
      // order, so two devices cannot deadlock while removing each other's sessions.
      const user = (
        await client.query<{ userId: string }>(
          `
            SELECT u.id AS "userId"
            FROM public.users u
              JOIN public.auth_sessions s ON s.user_id = u.id
            WHERE s.token_hash = $1
              AND s.expires_at > clock_timestamp()
              AND s.absolute_expires_at > clock_timestamp()
              AND u.status = 'active'
              AND (
                NOT u.is_demo
                OR $2
              )
            FOR UPDATE OF u
          `,
          [hash, config.demoAuth],
        )
      ).rows[0];
      if (!user) {
        throw unauthenticated();
      }
      // Recheck after waiting for the account lock: another request may have
      // renewed, expired or removed this session while this request was waiting.
      const session = (
        await client.query<{ id: string }>(
          `
            SELECT id
            FROM public.auth_sessions
            WHERE user_id = $1
              AND token_hash = $2
              AND expires_at > clock_timestamp()
              AND absolute_expires_at > clock_timestamp()
            FOR UPDATE
          `,
          [user.userId, hash],
        )
      ).rows[0];
      if (!session) {
        throw unauthenticated();
      }
      return operation(client, { userId: user.userId, sessionId: session.id });
    });
  };
}
