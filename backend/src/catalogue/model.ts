import { createHash } from 'node:crypto';
import { AccountError, validTripStart } from '../accounts/model.js';

export const object = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({ type: 'object', additionalProperties: false, properties, required });

export const text = (maxLength: number) => ({
  type: 'string',
  maxLength,
  minLength: 1,
  pattern: '\\S',
});

export const revision = { type: 'integer', minimum: 1, maximum: 2147483646 };

export const uuid = { type: 'string', format: 'uuid' };
const nullable = (value: Record<string, unknown>) => ({
  anyOf: [value, { type: 'null' }],
});
const strings = {
  type: 'array',
  maxItems: 30,
  uniqueItems: true,
  items: text(300),
};

export const policySchema = object(
  { cancellation: text(3000), safety: text(3000), participation: text(3000) },
  ['cancellation', 'safety', 'participation'],
);

export const draftProperties = {
  title: text(120),
  description: { type: 'string', maxLength: 5000 },
  area: nullable(text(40)),
  meetingPoint: { type: 'string', maxLength: 1000 },
  durationMinutes: nullable({ type: 'integer', minimum: 1, maximum: 10080 }),
  pricePaise: nullable({ type: 'integer', minimum: 0, maximum: 2147483647 }),
  minParticipants: { type: 'integer', minimum: 1, maximum: 1000 },
  maxParticipants: { type: 'integer', minimum: 1, maximum: 1000 },
  difficulty: {
    type: 'string',
    enum: ['unknown', 'easy', 'moderate', 'challenging'],
  },
  inclusions: strings,
  exclusions: strings,
  preparation: { type: 'string', maxLength: 2000 },
  accessibility: {
    type: 'string',
    enum: ['unknown', 'accessible', 'not_accessible'],
  },
  accessibilityNotes: { type: 'string', maxLength: 2000 },
  sourceKind: { type: 'string', enum: ['direct', 'district'] },
  sourceReference: { type: 'string', maxLength: 1000 },
  categories: {
    type: 'array',
    maxItems: 7,
    uniqueItems: true,
    items: text(24),
  },
  policy: policySchema,
};

export type Draft = {
  title: string;
  description?: string;
  area?: string | null;
  meetingPoint?: string;
  durationMinutes?: number | null;
  pricePaise?: number | null;
  minParticipants?: number;
  maxParticipants?: number;
  difficulty?: string;
  inclusions?: string[];
  exclusions?: string[];
  preparation?: string;
  accessibility?: string;
  accessibilityNotes?: string;
  sourceKind?: string;
  sourceReference?: string;
  categories?: string[];
  policy?: { cancellation: string; safety: string; participation: string };
};

export type Review = {
  revision: number;
  action: 'published' | 'rejected' | 'hidden';
  reason: string;
  providerReference?: string;
  sourceVerified?: boolean;
  featuredRank?: number | null;
};

export const sorts = [
  'recommended',
  'price_asc',
  'price_desc',
  'duration',
  'newest',
] as const;

export type Sort = (typeof sorts)[number];

export type Filters = {
  q?: string;
  area?: string;
  category?: string;
  minPricePaise?: number;
  maxPricePaise?: number;
  accessibility?: string;
  difficulty?: string;
  date?: string;
  sort: Sort;
};

export type Query = Record<string, string | undefined>;

export const filterProperties = {
  q: text(120),
  area: text(40),
  category: text(24),
  minPricePaise: { type: 'string', pattern: '^[0-9]{1,10}$' },
  maxPricePaise: { type: 'string', pattern: '^[0-9]{1,10}$' },
  accessibility: {
    type: 'string',
    enum: ['unknown', 'accessible', 'not_accessible'],
  },
  difficulty: {
    type: 'string',
    enum: ['unknown', 'easy', 'moderate', 'challenging'],
  },
  date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
  sort: { type: 'string', enum: sorts },
};

export const listSchema = object({
  ...filterProperties,
  limit: { type: 'string', pattern: '^[0-9]{1,3}$' },
  cursor: { type: 'string', maxLength: 1024 },
});

export const invalid = (message = 'Check the request fields and try again.') =>
  new AccountError(400, 'INVALID_REQUEST', message);

export const missing = () =>
  new AccountError(
    404,
    'NOT_FOUND',
    'This experience is not available. Return to browse for other experiences.',
  );

export const changed = () =>
  new AccountError(
    409,
    'EXPERIENCE_CHANGED',
    'Reload the experience before trying again.',
  );

export function filters(query: Query, allowDate = false): Filters {
  const result: Filters = { sort: (query.sort ?? 'recommended') as Sort };
  for (const key of [
    'q',
    'area',
    'category',
    'accessibility',
    'difficulty',
    'date',
  ] as const) {
    if (query[key] !== undefined) {
      result[key] = query[key]!.trim();
    }
  }
  for (const key of ['minPricePaise', 'maxPricePaise'] as const) {
    if (query[key] !== undefined) {
      const n = Number(query[key]);
      if (!Number.isSafeInteger(n) || n < 0 || n > 2147483647) {
        throw invalid();
      }
      result[key] = n;
    }
  }
  if (
    result.minPricePaise !== undefined &&
    result.maxPricePaise !== undefined &&
    result.minPricePaise > result.maxPricePaise
  ) {
    throw invalid('Minimum price cannot exceed maximum price.');
  }
  if (result.date) {
    if (!validTripStart(result.date)) {
      throw invalid('Choose a valid date today or later.');
    }
    if (!allowDate) {
      throw new AccountError(
        503,
        'AVAILABILITY_UNAVAILABLE',
        'Date availability is not connected yet. Browse without a date.',
      );
    }
  }
  return result;
}

export function pageSize(value: string | undefined) {
  const n = value === undefined ? 20 : Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw invalid();
  }
  return n;
}

export function filterKey(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function cursor(
  value: string | undefined,
  key: string,
): { id: string; value: number } | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (
      parsed.key !== key ||
      parsed.v !== 1 ||
      typeof parsed.value !== 'number' ||
      !Number.isFinite(parsed.value) ||
      Math.abs(parsed.value) > 1e12 ||
      typeof parsed.id !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        parsed.id,
      )
    ) {
      throw Error();
    }
    return { id: parsed.id, value: parsed.value };
  } catch {
    throw invalid(
      'This page link does not match the filters. Start from the first page.',
    );
  }
}

export function nextCursor(key: string, id: string, value: number) {
  return Buffer.from(JSON.stringify({ v: 1, key, id, value })).toString(
    'base64url',
  );
}
