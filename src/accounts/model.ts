import { createHash, randomBytes } from 'node:crypto';

export const interestCodes = [
  'hiking',
  'nature',
  'culture',
  'food',
  'wellness',
  'art',
  'music',
] as const;

export const demoAccounts = ['traveller-one', 'traveller-two'] as const;

export type DemoAccount = (typeof demoAccounts)[number];

export type ProfilePatch = {
  displayName?: string;
  language?: 'en' | 'hi' | 'ne';
};

export type PreferencePatch = {
  chosenArea?: string | null;
  tripStart?: string | null;
  tripDays?: number | null;
  travellers?: number;
  pace?: 'slow' | 'balanced';
  notificationsEnabled?: boolean;
  showInParticipantList?: boolean;
};

export const consentPurposes = ['personalisation', 'marketing'] as const;

export type ConsentPurpose = (typeof consentPurposes)[number];

export const demoPolicyVersion = 'demo-v1';

export class AccountError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const unauthenticated = () =>
  new AccountError(401, 'AUTH_REQUIRED', 'Sign in again to continue.');

export function bearerToken(header: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(header ?? '');
  if (!match?.[1]) {
    throw unauthenticated();
  }
  return match[1];
}

export const tokenHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export const newToken = () => randomBytes(32).toString('base64url');

export function validTripStart(value: string, now = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= today
  );
}
