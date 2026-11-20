import type { PoolClient } from 'pg';
import { conflict, unavailable } from './model.js';
import {
  booking,
  change,
  lockExperience,
  requireUnattended,
  revokeTicket,
} from './store.js';

export async function ticket(client: PoolClient, userId: string, id: string) {
  const current = await booking(client, id, userId);
  const row = (
    await client.query(
      `
    SELECT id,token,status FROM public.tickets WHERE booking_id=$1 AND status<>'revoked'
  `,
      [id],
    )
  ).rows[0];
  const valid =
    current.status === 'confirmed' &&
    current.slot_status !== 'cancelled' &&
    current.ends_at > new Date();
  return {
    bookingId: current.id,
    reference: current.reference,
    title: current.snapshot.title,
    quantity: current.quantity,
    startsAt: current.starts_at,
    endsAt: current.ends_at,
    timezone: current.snapshot.timezone,
    meetingPoint: current.snapshot.meetingPoint,
    status: !valid
      ? current.status === 'cancelled'
        ? 'revoked'
        : 'expired'
      : (row?.status ?? 'revoked'),
    // A QR contains this opaque token only. It carries no name/email or public access URL.
    verificationToken: valid && row?.status === 'issued' ? row.token : null,
    directionsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(current.snapshot.meetingPoint)}`,
    shareText: `${current.snapshot.title} · ${current.starts_at.toISOString()} · ${current.snapshot.meetingPoint}`,
  };
}

export async function checkIn(
  client: PoolClient,
  userId: string,
  token: string,
  requestId: string,
) {
  const found = (
    await client.query(
      `
    SELECT t.id,t.booking_id,b.experience_id FROM public.tickets t
    JOIN public.bookings b ON b.id=t.booking_id
    JOIN public.experiences e ON e.id=b.experience_id
    JOIN public.hosts h ON h.id=e.host_id
    WHERE t.token=$1 AND h.user_id=$2 AND h.status='approved' AND h.approved_until>clock_timestamp()
  `,
      [token, userId],
    )
  ).rows[0];
  if (!found) throw unavailable();
  await lockExperience(client, found.experience_id);
  const current = await booking(client, found.booking_id, userId, true);
  // Recheck host authority after waiting for any cancellation/reschedule.
  const accepted = (
    await client.query(
      `
    UPDATE public.tickets t SET status='checked_in',checked_in_by=$2,checked_in_at=clock_timestamp()
    FROM public.bookings b, public.experience_slots s, public.hosts h, public.experiences e
    WHERE t.id=$1 AND t.status='issued' AND b.id=t.booking_id AND b.status='confirmed'
      AND s.id=b.slot_id AND s.status<>'cancelled'
      AND e.id=b.experience_id AND h.id=e.host_id AND h.user_id=$2
      AND h.status='approved' AND h.approved_until>clock_timestamp()
      AND clock_timestamp() >= s.starts_at-interval '2 hours'
      AND clock_timestamp() < s.ends_at
    RETURNING t.id,t.checked_in_at AS "checkedInAt"
  `,
      [found.id, userId],
    )
  ).rows[0];
  if (!accepted)
    throw conflict(
      'This ticket is expired, cancelled, already used, or outside its check-in time.',
      'TICKET_INVALID',
    );
  await change(
    client,
    current.id,
    userId,
    'checked_in',
    current.slot_id,
    current.slot_id,
    requestId,
  );
  return {
    ...accepted,
    bookingId: current.id,
    reference: current.reference,
    quantity: current.quantity,
  };
}

export async function noShow(
  client: PoolClient,
  userId: string,
  id: string,
  revision: number,
  requestId: string,
) {
  let current = await booking(client, id, userId, true);
  await lockExperience(client, current.experience_id);
  current = await booking(client, id, userId, true);
  if (current.status === 'no_show') return { id, status: 'no_show' };
  if (
    current.revision !== revision ||
    current.status !== 'confirmed' ||
    current.ends_at > new Date()
  ) {
    throw conflict(
      'Only a finished, confirmed booking can be marked as a no-show.',
    );
  }
  await requireUnattended(client, id);
  await client.query(
    "UPDATE public.bookings SET status='no_show',revision=revision+1 WHERE id=$1",
    [id],
  );
  await revokeTicket(client, id);
  await change(
    client,
    id,
    userId,
    'no_show',
    current.slot_id,
    current.slot_id,
    requestId,
  );
  return { id, status: 'no_show' };
}
