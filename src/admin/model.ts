import { AccountError } from '../accounts/model.js';

export const leadStages = [
  'idea',
  'contacted',
  'interested',
  'agreement_sent',
  'agreed',
  'onboarding',
  'live',
  'paused',
  'declined',
] as const;
export const leadVerdicts = [
  'undecided',
  'list_in_pilot',
  'later',
  'not_suitable',
] as const;
export const siteVisits = ['not_needed', 'pending', 'done'] as const;
export const noteKinds = ['note', 'call', 'visit', 'message'] as const;
export const roleFilters = ['super', 'admin', 'host'] as const;
export const bookingStatuses = ['confirmed', 'cancelled', 'no_show'] as const;

export type LeadStage = (typeof leadStages)[number];

export type LeadInput = {
  code?: string | null;
  name?: string;
  experienceIdea?: string;
  district?: string;
  locality?: string;
  categoryCode?: string | null;
  contactName?: string;
  phone?: string;
  email?: string;
  contactSource?: string;
  contactConfirmed?: boolean;
  stage?: LeadStage;
  verdict?: (typeof leadVerdicts)[number];
  siteVisit?: (typeof siteVisits)[number];
  mediaReceived?: boolean;
  rightsConfirmed?: boolean;
  agreementSigned?: boolean;
  writeupFinal?: boolean;
  ownerId?: string | null;
  hostId?: string | null;
  nextFollowUp?: string | null;
};

export type LeadPatch = LeadInput & { revision: number };

export type LeadFilter = {
  stage?: LeadStage;
  district?: string;
  q?: string;
  followUpDue?: boolean;
  after?: string;
};

// Writable lead fields: API name → column. Order matters for the INSERT.
export const leadColumns = {
  code: 'code',
  name: 'name',
  experienceIdea: 'experience_idea',
  district: 'district',
  locality: 'locality',
  categoryCode: 'category_code',
  contactName: 'contact_name',
  phone: 'phone',
  email: 'email',
  contactSource: 'contact_source',
  contactConfirmed: 'contact_confirmed',
  stage: 'stage',
  verdict: 'verdict',
  siteVisit: 'site_visit',
  mediaReceived: 'media_received',
  rightsConfirmed: 'rights_confirmed',
  agreementSigned: 'agreement_signed',
  writeupFinal: 'writeup_final',
  ownerId: 'owner_id',
  hostId: 'host_id',
  nextFollowUp: 'next_follow_up',
} as const satisfies Record<keyof LeadInput, string>;

export const stageLabels: Record<LeadStage, string> = {
  idea: 'Idea',
  contacted: 'Contacted',
  interested: 'Interested',
  agreement_sent: 'Agreement sent',
  agreed: 'Agreed',
  onboarding: 'Onboarding',
  live: 'Live',
  paused: 'Paused',
  declined: 'Declined',
};

export const forbidden = () =>
  new AccountError(403, 'FORBIDDEN', 'Only an authorised admin can do this.');
export const notFound = (what: string) =>
  new AccountError(404, 'NOT_FOUND', `${what} was not found.`);
export const stale = () =>
  new AccountError(
    409,
    'STALE_REVISION',
    'This record changed. Reload it before saving again.',
  );
export const invalid = (message: string) =>
  new AccountError(400, 'INVALID_REQUEST', message);

// Keyset cursor over (created_at DESC, id DESC), opaque to clients.
export function encodeCursor(createdAt: Date | string, id: string): string {
  const at = createdAt instanceof Date ? createdAt.toISOString() : createdAt;
  return Buffer.from(JSON.stringify([at, id])).toString('base64url');
}

export function decodeCursor(
  cursor: string | undefined,
): [string, string] | null {
  if (!cursor) return null;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    );
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      Number.isFinite(Date.parse(value[0])) &&
      typeof value[1] === 'string' &&
      /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value[1])
    ) {
      return [value[0], value[1]];
    }
  } catch {
    // fall through
  }
  throw invalid('Use the cursor returned by the previous page.');
}

// Normalise free-text input before it reaches SQL; empty strings clear values.
export function normaliseLead<T extends LeadInput>(input: T): T {
  const out: LeadInput = { ...input };
  for (const key of Object.keys(out) as (keyof LeadInput)[]) {
    const value = out[key];
    if (typeof value === 'string')
      (out as Record<string, unknown>)[key] = value.trim();
  }
  if (typeof out.code === 'string')
    out.code = out.code ? out.code.toUpperCase() : null;
  if (typeof out.email === 'string') out.email = out.email.toLowerCase();
  if (typeof out.categoryCode === 'string' && !out.categoryCode)
    out.categoryCode = null;
  if (out.name !== undefined && !out.name)
    throw invalid('Add the curator or business name.');
  if (out.code && !/^[A-Z]{2,5}-[0-9]{1,4}$/.test(out.code))
    throw invalid('Use a tracker ID like PKG-02.');
  if (out.phone && !/^\+?[0-9][0-9 ()-]{6,19}$/.test(out.phone))
    throw invalid('Enter a valid phone number.');
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email))
    throw invalid('Enter a valid email address.');
  if (out.nextFollowUp && !/^\d{4}-\d{2}-\d{2}$/.test(out.nextFollowUp))
    throw invalid('Use a follow-up date like 2026-12-01.');
  return out as T;
}
