import { createHmac, timingSafeEqual } from 'node:crypto';
import { AccountError } from '../accounts/model.js';
import { object, text, uuid, revision } from '../catalogue/model.js';

export const contentTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'video/quicktime',
] as const;
export type ContentType = (typeof contentTypes)[number];
export const variantNames = ['image', 'video', 'poster', 'captions'] as const;
export type Variant = (typeof variantNames)[number];

export const variantFiles: Record<Variant, string> = {
  image: 'image.webp',
  video: 'video.mp4',
  poster: 'poster.webp',
  captions: 'captions.vtt',
};

export const variantTypes: Record<Variant, string> = {
  image: 'image/webp',
  video: 'video/mp4',
  poster: 'image/webp',
  captions: 'text/vtt; charset=utf-8',
};

export const mediaMissing = () =>
  new AccountError(404, 'NOT_FOUND', 'This media is not available.');

export const mediaUnavailable = () =>
  new AccountError(
    503,
    'MEDIA_UNAVAILABLE',
    'Media storage is not connected. Please try again later.',
  );

export const mediaConflict = () =>
  new AccountError(
    409,
    'MEDIA_CHANGED',
    'Reload this media before trying again.',
  );

export const mediaInvalid = (message: string) =>
  new AccountError(400, 'INVALID_MEDIA', message);

export const idParams = object({ id: uuid }, ['id']);
export const noQuery = object({});
export const pageQuery = object({ after: uuid });
export const revisionBody = object({ revision }, ['revision']);

export type UploadIntent = {
  purpose: 'public_content' | 'private_evidence';
  contentType: ContentType;
  bytes: number;
  author: string;
  // Optional for people sharing their own footage; required by reviewers
  // only when the media comes from someone else.
  sourceUrl?: string;
  licenceUrl?: string;
  permissionNote: string;
  place: string;
  altText: string;
  captions?: string;
};

const https = { type: 'string', maxLength: 2000, pattern: '^https://' };

export const uploadSchema = object(
  {
    purpose: { type: 'string', enum: ['public_content', 'private_evidence'] },
    contentType: { type: 'string', enum: contentTypes },
    bytes: { type: 'integer', minimum: 1, maximum: 52428800 },
    author: text(160),
    sourceUrl: https,
    licenceUrl: https,
    permissionNote: text(2000),
    place: text(160),
    altText: text(500),
    captions: { type: 'string', maxLength: 20000 },
  },
  [
    'purpose',
    'contentType',
    'bytes',
    'author',
    'permissionNote',
    'place',
    'altText',
  ],
);

export function validateUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw mediaInvalid('Use a valid HTTPS source or licence link.');
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw mediaInvalid(
      'Use an HTTPS source or licence link without credentials.',
    );
  }

  return url.href;
}

const captionTimestamp = String.raw`(?:(\d{2}):)?([0-5]\d):([0-5]\d)\.(\d{3})`;
const captionTiming = new RegExp(
  '^' +
    captionTimestamp +
    ' --> ' +
    captionTimestamp +
    '(?: line:(?:100|[0-9]{1,2})%)?$',
);

/**
 * Phones can't always report a video's length before upload (for example HEVC
 * .mov files on desktop browsers), so the app may send a cue that runs past the
 * end. Trim cues to the real length once it is known; drop cues that start after it.
 */
export function fitCaptions(value: string, duration: number) {
  const limit = Math.min(60, duration);
  const stamp = (seconds: number) => {
    const ms = Math.round(seconds * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const pad = (n: number, width = 2) => String(n).padStart(width, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
  };
  const seconds = (text: string) => {
    const parts = text.split(':').map(Number);
    return parts.reduce((total, part) => total * 60 + part, 0);
  };
  const input = value.replace(/\r\n/g, '\n').trim();
  if (!input.startsWith('WEBVTT\n\n')) return value;
  const blocks = input
    .slice(8)
    .split(/\n\n+/)
    .flatMap((block) => {
      const [timing = '', ...lines] = block.split('\n');
      const match = timing.match(/^([\d:.]+) --> ([\d:.]+)$/);
      if (!match) return [block];
      const start = seconds(match[1]!);
      const end = seconds(match[2]!);
      if (start >= limit) return [];
      if (end <= limit) return [block];
      return [[`${match[1]} --> ${stamp(limit)}`, ...lines].join('\n')];
    });
  return blocks.length ? `WEBVTT\n\n${blocks.join('\n\n')}\n` : value;
}

// A deliberately small WebVTT subset: timed, plain-text English descriptions.
// Reject styling, embedded tags and external references instead of rendering
// uploads as HTML.
export function validateCaptions(value: string, duration = 60) {
  const input = value.replace(/\r\n/g, '\n').trim();
  if (!input.startsWith('WEBVTT\n\n')) {
    throw mediaInvalid('Add a plain-text WEBVTT caption file.');
  }

  const blocks = input.slice(8).split(/\n\n+/);
  let previous = 0;

  for (const block of blocks) {
    const [timing, ...lines] = block.split('\n');
    const match = timing?.match(captionTiming);
    if (
      !match ||
      !lines.length ||
      lines.some((line) => !line.trim() || /[<>\u0000-\u0008]/.test(line))
    ) {
      throw mediaInvalid(
        'Captions need valid timings and plain text, without markup.',
      );
    }

    const time = (offset: number) =>
      Number(match[offset] ?? 0) * 3600 +
      Number(match[offset + 1]) * 60 +
      Number(match[offset + 2]) +
      Number(match[offset + 3]) / 1000;
    const start = time(1);
    const end = time(5);

    if (
      start < previous ||
      end <= start ||
      end > Math.min(60, duration + 0.05)
    ) {
      throw mediaInvalid(
        'Caption timings must be ordered within a 60-second video.',
      );
    }

    previous = end;
  }

  return input + '\n';
}

export function signature(
  key: string,
  operation: string,
  id: string,
  revision: number,
  expires: number,
  variant = '',
) {
  return createHmac('sha256', key)
    .update([operation, id, revision, expires, variant].join(':'))
    .digest('base64url');
}

export function verifySignature(
  key: string,
  operation: string,
  id: string,
  revision: number,
  expires: string,
  supplied: string,
  variant = '',
) {
  const expiry = Number(expires);
  const now = Math.floor(Date.now() / 1000);

  if (
    !Number.isSafeInteger(expiry) ||
    expiry < now ||
    expiry > now + 900 ||
    !/^[\w-]{43}$/.test(supplied)
  ) {
    throw new AccountError(
      403,
      'MEDIA_LINK_EXPIRED',
      'This media link has expired. Reload it and try again.',
    );
  }

  const expected = signature(key, operation, id, revision, expiry, variant);

  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    throw new AccountError(
      403,
      'MEDIA_LINK_EXPIRED',
      'This media link is invalid. Reload it and try again.',
    );
  }
}
