import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { audit } from '../db/audit.js';
import { joins, visible } from '../catalogue/visibility.js';
import { conflict, unavailable, type Slot } from './model.js';

export async function lockExperience(client: PoolClient, id: string) {
  // One short lock per experience also gives reschedules a consistent lock order.
  // Independent experiences remain concurrent; no process-local locks are used.
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 6))', [
    id,
  ]);
}

export async function slot(client: PoolClient, id: string): Promise<Slot> {
  const row = (
    await client.query<Slot>(
      'SELECT * FROM public.experience_slots WHERE id=$1',
      [id],
    )
  ).rows[0];
  if (!row) throw unavailable();
  return row;
}

export async function ownedExperience(
  client: PoolClient,
  id: string,
  userId: string,
) {
  if (
    !(
      await client.query(
        `
    SELECT 1 FROM public.experiences e JOIN public.hosts h ON h.id=e.host_id
    WHERE e.id=$1 AND h.user_id=$2
  `,
        [id, userId],
      )
    ).rowCount
  )
    throw unavailable();
}

export async function bookableExperience(client: PoolClient, id: string) {
  // Coordinate with host suspension and listing edits, without locking another
  // traveller's user row (accountAccess already owns the caller's account lock).
  await client.query(
    `SELECT h.id FROM public.hosts h
    JOIN public.experiences e ON e.host_id=h.id WHERE e.id=$1 FOR SHARE OF h`,
    [id],
  );
  await client.query(
    'SELECT id FROM public.experiences WHERE id=$1 FOR SHARE',
    [id],
  );
  const row = (
    await client.query(
      `
    SELECT e.*, h.public_name AS host_name, p.version AS policy_version,
      p.cancellation, p.safety, p.participation
    ${joins} JOIN public.policies p ON p.id=e.policy_id
    WHERE e.id=$1 AND ${visible} AND e.source_reference <> 'local-design-preview'
  `,
      [id],
    )
  ).rows[0];
  if (!row)
    throw unavailable('This experience cannot accept reservations right now.');
  return row;
}

export async function validSlot(
  client: PoolClient,
  selected: Slot,
  quantity: number,
) {
  const experience = await bookableExperience(client, selected.experience_id);
  const now = (await client.query('SELECT clock_timestamp() AS now')).rows[0]
    .now as Date;
  if (
    selected.status !== 'open' ||
    selected.starts_at <= now ||
    selected.booking_deadline <= now
  ) {
    throw conflict('Choose an open future date.', 'SLOT_UNAVAILABLE');
  }
  if (
    selected.experience_revision !== experience.revision ||
    selected.policy_id !== experience.policy_id ||
    selected.price_paise !== experience.price_paise
  ) {
    throw conflict(
      'The experience has changed. Ask the host for a new date.',
      'SLOT_CHANGED',
    );
  }
  if (selected.price_paise !== 0) {
    throw conflict(
      'Paid bookings are not available yet.',
      'PAYMENT_UNAVAILABLE',
    );
  }
  if (
    quantity < experience.min_participants ||
    quantity > experience.max_participants
  ) {
    throw conflict(
      'Choose a group size within the experience limits.',
      'GROUP_SIZE_INVALID',
    );
  }
  return experience;
}

export async function occupied(client: PoolClient, id: string) {
  const row = (
    await client.query<{ count: string }>(
      `
    SELECT COALESCE(sum(quantity), 0)::text AS count FROM (
      SELECT quantity FROM public.bookings WHERE slot_id=$1 AND status='confirmed'
      UNION ALL
      SELECT quantity FROM public.seat_holds
      WHERE slot_id=$1 AND status='active' AND expires_at > clock_timestamp()
    ) occupied
  `,
      [id],
    )
  ).rows[0]!;
  return Number(row.count);
}

export async function requireCapacity(
  client: PoolClient,
  selected: Slot,
  quantity: number,
) {
  if ((await occupied(client, selected.id)) + quantity > selected.capacity) {
    throw conflict(
      'There are not enough places left. Choose another date.',
      'SOLD_OUT',
    );
  }
}

// One confirmed booking per traveller per date. Callers hold the experience
// lock, so two tabs cannot both pass this check.
export async function requireNotBooked(
  client: PoolClient,
  userId: string,
  slotId: string,
  exceptBookingId: string | null = null,
) {
  const existing = await client.query(
    `SELECT 1 FROM public.bookings WHERE user_id=$1 AND slot_id=$2
      AND status='confirmed' AND ($3::uuid IS NULL OR id<>$3) LIMIT 1`,
    [userId, slotId, exceptBookingId],
  );
  if (existing.rowCount)
    throw conflict(
      'You already have a booking on this date. Open it from your bookings to see your ticket.',
      'ALREADY_BOOKED',
    );
}

export function publicSlot(selected: Slot, available: number) {
  return {
    id: selected.id,
    startsAt: selected.starts_at,
    endsAt: selected.ends_at,
    timezone: selected.timezone,
    bookingDeadline: selected.booking_deadline,
    capacity: selected.capacity,
    availablePlaces: Math.max(0, available),
    pricePaise: selected.price_paise,
    currency: selected.currency,
    cancellationHours: selected.cancellation_hours,
    rescheduleHours: selected.reschedule_hours,
    status: selected.status,
    revision: selected.revision,
    paymentAvailable: false,
  };
}

export async function booking(
  client: PoolClient,
  id: string,
  userId: string,
  host = false,
) {
  const row = (
    await client.query(
      `
    SELECT b.*, h.user_id AS host_user_id, s.starts_at, s.ends_at, s.status AS slot_status
    FROM public.bookings b
    JOIN public.experiences e ON e.id=b.experience_id
    JOIN public.hosts h ON h.id=e.host_id
    JOIN public.experience_slots s ON s.id=b.slot_id
    WHERE b.id=$1 AND ${host ? 'h.user_id' : 'b.user_id'}=$2
  `,
      [id, userId],
    )
  ).rows[0];
  if (!row) throw unavailable();
  return row;
}

export async function detail(client: PoolClient, id: string, userId: string) {
  const row = await booking(client, id, userId);
  const currentSlot = await slot(client, row.slot_id);
  const history = (
    await client.query(
      `
    SELECT sequence::text AS id, action, old_slot_id AS "oldSlotId",
      new_slot_id AS "newSlotId", reason, created_at AS "createdAt"
    FROM public.booking_changes WHERE booking_id=$1 ORDER BY sequence
  `,
      [id],
    )
  ).rows;
  return {
    id: row.id,
    reference: row.reference,
    experienceId: row.experience_id,
    quantity: row.quantity,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    guests: row.guests,
    totalPaise: row.total_paise,
    currency: row.currency,
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    snapshot: row.snapshot,
    slot: publicSlot(
      currentSlot,
      currentSlot.capacity - (await occupied(client, currentSlot.id)),
    ),
    history,
  };
}

export async function issueTicket(client: PoolClient, id: string) {
  await client.query(
    'INSERT INTO public.tickets(booking_id, token) VALUES($1,$2)',
    [id, randomBytes(32).toString('hex')],
  );
}

export async function revokeTicket(client: PoolClient, id: string) {
  await client.query(
    "UPDATE public.tickets SET status='revoked' WHERE booking_id=$1 AND status='issued'",
    [id],
  );
}

export async function change(
  client: PoolClient,
  bookingId: string,
  actor: string,
  action: string,
  oldSlot: string | null,
  newSlot: string,
  requestId: string,
  reason: string | null = null,
  key: string | null = null,
  hash: string | null = null,
) {
  await client.query(
    `
    INSERT INTO public.booking_changes
      (booking_id,actor_id,action,old_slot_id,new_slot_id,reason,request_key,request_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
  `,
    [bookingId, actor, action, oldSlot, newSlot, reason, key, hash],
  );
  await audit(
    client,
    actor,
    'booking.' + action,
    requestId,
    'booking',
    bookingId,
  );
}

export async function requireUnattended(client: PoolClient, id: string) {
  if (
    (
      await client.query(
        "SELECT 1 FROM public.tickets WHERE booking_id=$1 AND status='checked_in'",
        [id],
      )
    ).rowCount
  ) {
    throw conflict('This booking has already been checked in.');
  }
}

export async function requireBeforeCutoff(
  client: PoolClient,
  startsAt: Date,
  hours: number,
) {
  const allowed = (
    await client.query(
      `
    SELECT clock_timestamp() < $1::timestamptz - $2 * interval '1 hour' AS allowed
  `,
      [startsAt, hours],
    )
  ).rows[0].allowed;
  if (!allowed)
    throw conflict(
      'The deadline in your booking terms has passed.',
      'DEADLINE_PASSED',
    );
}
