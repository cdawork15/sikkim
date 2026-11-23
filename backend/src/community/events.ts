import type { PoolClient } from 'pg';
import { unavailable, type EventInput } from './model.js';

// `attendees` counts confirmed members only: requests and the waiting list
// do not take a place.
export const select = `SELECT e.id, e.owner_id AS "ownerId", e.details, e.status,
  e.revision, u.display_name AS host,
  (SELECT count(*)::int FROM public.community_members m
     WHERE m.event_id=e.id AND m.status='confirmed') AS attendees,
  ARRAY(SELECT '/v1/community/photos/' || p.id FROM public.community_photos p
        WHERE p.event_id=e.id ORDER BY p.position) AS images
  FROM public.community_events e JOIN public.users u ON u.id=e.owner_id`;
export type EventRow = {
  id: string;
  ownerId: string;
  details: Omit<EventInput, 'images'>;
  status: string;
  revision: number;
  host: string;
  attendees: number;
  images: string[];
};
export const eventTimes = (
  details: Pick<EventInput, 'date' | 'start' | 'end'>,
) => ({
  start: Date.parse(`${details.date}T${details.start}:00+05:30`),
  end: Date.parse(`${details.date}T${details.end}:00+05:30`),
});
export function publicEvent(row: EventRow) {
  const { start, end } = eventTimes(row.details);
  return {
    ...row.details,
    id: row.id,
    ownerId: row.ownerId,
    host: row.host,
    status: row.status,
    revision: row.revision,
    images: row.images,
    image: row.images[0] ?? '/images/himalayan-dawn.webp',
    attendees: row.attendees,
    mine: false,
    live: row.status === 'published' && start <= Date.now() && end > Date.now(),
  };
}
export async function read(client: PoolClient, id: string) {
  const row = (
    await client.query<EventRow>(
      `${select} WHERE e.id=$1 AND u.status='active'`,
      [id],
    )
  ).rows[0];
  if (!row) throw unavailable();
  return publicEvent(row);
}
