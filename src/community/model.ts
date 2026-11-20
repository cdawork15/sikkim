import { AccountError } from '../accounts/model.js';
import { object, text } from '../catalogue/model.js';

export const eventProperties = {
  title: { ...text(60), minLength: 5 },
  description: { ...text(400), minLength: 20 },
  area: { ...text(60), minLength: 2 },
  meeting: { ...text(120), minLength: 5 },
  date: { type: 'string', format: 'date' },
  start: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  end: { type: 'string', pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$' },
  capacity: { type: 'integer', minimum: 2, maximum: 30 },
  price: { type: 'integer', minimum: 0, maximum: 10000 },
  interest: {
    type: 'string',
    enum: ['Food', 'Art', 'Nature', 'Music', 'Wellness', 'Culture'],
  },
  approval: { type: 'boolean' },
  images: {
    type: 'array',
    maxItems: 4,
    uniqueItems: true,
    items: text(200000),
  },
};
export const eventSchema = object(
  eventProperties,
  Object.keys(eventProperties),
);
export type EventInput = {
  title: string;
  description: string;
  area: string;
  meeting: string;
  date: string;
  start: string;
  end: string;
  capacity: number;
  price: number;
  interest: string;
  approval: boolean;
  images: string[];
};
export const unavailable = () =>
  new AccountError(404, 'NOT_FOUND', 'This event is not available.');
export const conflict = () =>
  new AccountError(
    409,
    'EVENT_CHANGED',
    'This event has changed. Reload it before trying again.',
  );
export const invalid = (message: string) =>
  new AccountError(400, 'INVALID_REQUEST', message);
export function details(input: EventInput) {
  const { images: _images, ...value } = input;
  value.title = value.title.trim();
  value.description = value.description.trim();
  value.area = value.area.trim();
  value.meeting = value.meeting.trim();
  if (
    value.title.length < 5 ||
    value.description.length < 20 ||
    value.area.length < 2 ||
    value.meeting.length < 5
  ) {
    throw invalid('Add a title, description, area and public meeting point.');
  }
  const start = Date.parse(`${value.date}T${value.start}:00+05:30`);
  const end = Date.parse(`${value.date}T${value.end}:00+05:30`);
  if (!Number.isFinite(start) || start <= Date.now() || end <= start) {
    throw invalid('Choose a future start and a later end time in India time.');
  }
  return value;
}
