import type { PoolClient } from 'pg';
import { AccountError } from './model.js';

// Account types:
//   traveller — every account (OTP sign-in); can book and share reels
//   admin     — staff: trips, reviews, curator pipeline, booking support
//   super     — everything an admin can do, plus people, analytics and settings
export const staffRoles = ['admin', 'super'] as const;

export async function hasAnyRole(
  client: PoolClient,
  userId: string,
  roles: readonly string[],
) {
  return Boolean(
    (
      await client.query(
        'SELECT 1 FROM public.user_roles WHERE user_id = $1 AND role = ANY($2)',
        [userId, roles],
      )
    ).rowCount,
  );
}

export async function requireStaff(
  client: PoolClient,
  userId: string,
  message = 'Only an authorised admin can do this.',
) {
  if (!(await hasAnyRole(client, userId, staffRoles)))
    throw new AccountError(403, 'FORBIDDEN', message);
}

export async function requireSuper(client: PoolClient, userId: string) {
  if (!(await hasAnyRole(client, userId, ['super'])))
    throw new AccountError(
      403,
      'FORBIDDEN',
      'Only a super admin can see this.',
    );
}
