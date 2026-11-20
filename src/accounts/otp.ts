import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { audit } from '../db/audit.js';
import { AccountError } from './model.js';
import { normalizeEmail } from './password.js';

export type OtpChannel = 'email' | 'phone';
export type OtpRequest = { channel: OtpChannel; destination: string };
export type OtpVerify = {
  challengeId: string;
  code: string;
  displayName?: string;
};
/** Sends a code. Implementations must not log or store the code elsewhere. */
export type OtpDelivery = (message: {
  channel: OtpChannel;
  destination: string;
  code: string;
}) => Promise<void>;

const CODE_TTL_MINUTES = 10;
const RESEND_SECONDS = 30;
const MAX_ATTEMPTS = 5;
const MAX_PER_WINDOW = 5; // codes per destination per 15 minutes

const unavailable = () =>
  new AccountError(
    503,
    'OTP_UNAVAILABLE',
    'Sign-in codes are not available right now.',
  );
const expired = () =>
  new AccountError(
    400,
    'OTP_EXPIRED',
    'This code has expired. Request a new one.',
  );

export function normalizeDestination(
  channel: OtpChannel,
  value: string,
  defaultCountryCode: string,
): string {
  const raw = value.trim();
  if (channel === 'email') {
    const email = normalizeEmail(raw);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      throw new AccountError(400, 'INVALID_REQUEST', 'Enter a valid email.');
    return email;
  }
  let digits = raw.replace(/[\s()-]/g, '');
  if (digits.startsWith('00')) digits = '+' + digits.slice(2);
  if (!digits.startsWith('+')) {
    // Local numbers (for example a 10-digit Indian mobile) get the default code.
    digits = '+' + defaultCountryCode + digits.replace(/^0+/, '');
  }
  if (!/^\+[1-9]\d{7,14}$/.test(digits))
    throw new AccountError(
      400,
      'INVALID_REQUEST',
      'Enter a valid mobile number.',
    );
  return digits;
}

export function otpAccounts<T>(
  database: Database,
  config: Config,
  deliver: OtpDelivery,
  createSession: (
    client: PoolClient,
    userId: string,
    requestId: string,
  ) => Promise<T>,
) {
  const hash = (challengeId: string, code: string) =>
    createHmac('sha256', config.otp.secret)
      .update(`${challengeId}:${code}`)
      .digest('hex');

  async function findOrCreateUser(
    client: PoolClient,
    channel: OtpChannel,
    destination: string,
    displayName: string | undefined,
    requestId: string,
  ) {
    // Email sign-ins also match accounts first created with a password.
    const providers = channel === 'email' ? ['email', 'password'] : ['phone'];
    const existing = (
      await client.query<{ id: string; status: string; isDemo: boolean }>(
        `
          SELECT u.id, u.status, u.is_demo AS "isDemo"
          FROM public.auth_identities a
            JOIN public.users u ON u.id = a.user_id
          WHERE a.provider = ANY($1) AND a.subject = $2
          ORDER BY a.created_at
          LIMIT 1
          FOR UPDATE OF u
        `,
        [providers, destination],
      )
    ).rows[0];
    if (existing) {
      if (existing.isDemo || existing.status !== 'active') {
        throw new AccountError(
          403,
          'ACCOUNT_UNAVAILABLE',
          'This account cannot sign in. Contact support.',
        );
      }
      if (channel === 'email') {
        await client.query(
          `
            INSERT INTO public.auth_identities (user_id, provider, subject)
            VALUES ($1, 'email', $2)
            ON CONFLICT (provider, subject) DO NOTHING
          `,
          [existing.id, destination],
        );
      }
      return { userId: existing.id, created: false };
    }
    const name = displayName?.trim() || 'Traveller';
    const user = (
      await client.query<{ id: string }>(
        'INSERT INTO public.users (display_name) VALUES ($1) RETURNING id',
        [name.slice(0, 80)],
      )
    ).rows[0]!;
    await client.query(
      `
        INSERT INTO public.auth_identities (user_id, provider, subject)
        VALUES ($1, $2, $3)
      `,
      [user.id, channel, destination],
    );
    await client.query(
      'INSERT INTO public.user_preferences (user_id) VALUES ($1)',
      [user.id],
    );
    await audit(client, user.id, `account.created.${channel}`, requestId);
    return { userId: user.id, created: true };
  }

  return {
    async requestCode(input: OtpRequest) {
      if (config.otp.delivery === 'disabled') throw unavailable();
      const destination = normalizeDestination(
        input.channel,
        input.destination,
        config.otp.defaultCountryCode,
      );
      return database.transaction(async (client) => {
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtext('sikkim-otp:' || $1))",
          [destination],
        );
        const recent = (
          await client.query<{ count: number; latest: Date | null }>(
            `
              SELECT count(*)::int AS count, max(created_at) AS latest
              FROM public.auth_otp_challenges
              WHERE channel = $1 AND destination = $2
                AND created_at > clock_timestamp() - interval '15 minutes'
            `,
            [input.channel, destination],
          )
        ).rows[0]!;
        const wait = recent.latest
          ? RESEND_SECONDS -
            Math.floor((Date.now() - recent.latest.getTime()) / 1000)
          : 0;
        if (recent.count >= MAX_PER_WINDOW || wait > 0) {
          throw new AccountError(
            429,
            'RATE_LIMITED',
            wait > 0
              ? `Wait ${wait} seconds before asking for another code.`
              : 'Too many codes requested. Try again in 15 minutes.',
          );
        }
        const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
        const challenge = (
          await client.query<{ id: string; expiresAt: Date }>(
            `
              INSERT INTO public.auth_otp_challenges
                (channel, destination, code_hash, expires_at)
              VALUES ($1, $2, repeat('0', 64),
                clock_timestamp() + make_interval(mins => $3))
              RETURNING id, expires_at AS "expiresAt"
            `,
            [input.channel, destination, CODE_TTL_MINUTES],
          )
        ).rows[0]!;
        await client.query(
          'UPDATE public.auth_otp_challenges SET code_hash = $2 WHERE id = $1',
          [challenge.id, hash(challenge.id, code)],
        );
        // Deliver inside the transaction: if sending fails, no code is stored.
        await deliver({ channel: input.channel, destination, code });
        return {
          challengeId: challenge.id,
          channel: input.channel,
          destination:
            input.channel === 'email'
              ? destination.replace(/^(.).*(@.*)$/, '$1•••$2')
              : destination.replace(/^(\+\d{1,3})\d+(\d{2})$/, '$1 ••••• $2'),
          expiresAt: challenge.expiresAt,
          resendAfterSeconds: RESEND_SECONDS,
        };
      });
    },

    async verifyCode(input: OtpVerify, requestId: string) {
      if (config.otp.delivery === 'disabled') throw unavailable();
      // A wrong code must still count as an attempt, so the attempt is
      // committed in its own transaction before the error is returned.
      const outcome = await database.transaction(async (client) => {
        const challenge = (
          await client.query<{
            id: string;
            channel: OtpChannel;
            destination: string;
            codeHash: string;
            attempts: number;
            usable: boolean;
          }>(
            `
              SELECT id, channel, destination, code_hash AS "codeHash", attempts,
                consumed_at IS NULL AND expires_at > clock_timestamp() AS usable
              FROM public.auth_otp_challenges
              WHERE id = $1
              FOR UPDATE
            `,
            [input.challengeId],
          )
        ).rows[0];
        if (!challenge || !challenge.usable) return { error: expired() };
        if (challenge.attempts >= MAX_ATTEMPTS)
          return {
            error: new AccountError(
              429,
              'OTP_LOCKED',
              'Too many wrong codes. Request a new one.',
            ),
          };
        const expected = Buffer.from(challenge.codeHash, 'hex');
        const actual = Buffer.from(hash(challenge.id, input.code), 'hex');
        if (!timingSafeEqual(expected, actual)) {
          await client.query(
            'UPDATE public.auth_otp_challenges SET attempts = attempts + 1 WHERE id = $1',
            [challenge.id],
          );
          return {
            error: new AccountError(
              400,
              'OTP_INVALID',
              'That code is not right. Check it and try again.',
            ),
          };
        }
        await client.query(
          'UPDATE public.auth_otp_challenges SET consumed_at = clock_timestamp() WHERE id = $1',
          [challenge.id],
        );
        const { userId, created } = await findOrCreateUser(
          client,
          challenge.channel,
          challenge.destination,
          input.displayName,
          requestId,
        );
        const session = await createSession(client, userId, requestId);
        return { session, created };
      });
      if ('error' in outcome) throw outcome.error;
      return { ...outcome.session, isNewAccount: outcome.created };
    },
  };
}
