import type { PoolClient } from 'pg';
import { filterKey, invalid } from '../catalogue/model.js';
import { joins, visible } from '../catalogue/visibility.js';
import { audit } from '../db/audit.js';
import {
  conflict,
  remainingSeats,
  type SlotInput,
  type Change,
  type Slot,
} from './model.js';
import {
  bookableExperience,
  change,
  lockExperience,
  occupied,
  ownedExperience,
  publicSlot,
  revokeTicket,
  slot,
} from './store.js';

export async function createSlot(
  client: PoolClient,
  userId: string,
  experienceId: string,
  input: SlotInput,
  requestId: string,
) {
  await lockExperience(client, experienceId);
  await ownedExperience(client, experienceId, userId);
  const hash = filterKey([
    new Date(input.startsAt).toISOString(),
    new Date(input.endsAt).toISOString(),
    new Date(input.bookingDeadline).toISOString(),
    input.timezone,
    input.capacity,
    input.cancellationHours,
    input.rescheduleHours,
  ]);
  const previous = (
    await client.query(
      'SELECT * FROM public.experience_slots WHERE experience_id=$1 AND request_key=$2',
      [experienceId, input.requestKey],
    )
  ).rows[0];
  if (previous) {
    if (previous.request_hash !== hash)
      throw conflict(
        'Use a new request key for a different date.',
        'REQUEST_KEY_REUSED',
      );
    return publicSlot(
      previous,
      previous.capacity - (await occupied(client, previous.id)),
    );
  }
  const experience = await bookableExperience(client, experienceId);
  const timing = (
    await client.query(
      `SELECT
    $1::timestamptz > clock_timestamp() AND $3::timestamptz > clock_timestamp()
    AND $3::timestamptz <= $1::timestamptz
    AND extract(epoch FROM ($2::timestamptz - $1::timestamptz))=$4 * 60 AS valid
  `,
      [
        input.startsAt,
        input.endsAt,
        input.bookingDeadline,
        experience.duration_minutes,
      ],
    )
  ).rows[0].valid;
  if (
    !timing ||
    input.capacity > experience.max_participants ||
    input.capacity < experience.min_participants
  ) {
    throw invalid(
      'Use future dates, the published duration and the approved group size.',
    );
  }
  const created = (
    await client.query<Slot>(
      `
    INSERT INTO public.experience_slots(experience_id,request_key,request_hash,starts_at,ends_at,
      timezone,booking_deadline,capacity,cancellation_hours,reschedule_hours,
      price_paise,currency,policy_id,experience_revision)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *
  `,
      [
        experienceId,
        input.requestKey,
        hash,
        input.startsAt,
        input.endsAt,
        input.timezone,
        input.bookingDeadline,
        input.capacity,
        input.cancellationHours,
        input.rescheduleHours,
        experience.price_paise,
        experience.currency,
        experience.policy_id,
        experience.revision,
      ],
    )
  ).rows[0]!;
  await audit(client, userId, 'slot.created', requestId, 'slot', created.id);
  return publicSlot(created, created.capacity);
}

export async function listSlots(
  client: PoolClient,
  experienceId: string,
  after?: string,
  userId?: string,
) {
  if (userId) await ownedExperience(client, experienceId, userId);
  const rows = (
    await client.query<Slot & { remaining: string }>(
      `
    SELECT s.*, (${remainingSeats})::text AS remaining
    FROM public.experience_slots s
    JOIN public.experiences e ON e.id=s.experience_id
    WHERE s.experience_id=$1 AND (
      $2::uuid IS NULL OR (s.starts_at, s.id) > (
        SELECT previous.starts_at, previous.id
        FROM public.experience_slots previous
        WHERE previous.id=$2 AND previous.experience_id=$1
      )
    )
    ${
      userId
        ? ''
        : `AND s.status='open' AND s.starts_at>clock_timestamp()
      AND s.booking_deadline>clock_timestamp() AND s.experience_revision=e.revision
      AND s.policy_id=e.policy_id AND s.price_paise=e.price_paise
      AND e.source_reference <> 'local-design-preview'
      AND EXISTS (SELECT 1 ${joins} WHERE e.id=s.experience_id AND ${visible})`
    }
    ORDER BY s.starts_at, s.id LIMIT 51
  `,
      [experienceId, after ?? null],
    )
  ).rows;
  return {
    data: rows
      .slice(0, 50)
      .map((row) => publicSlot(row, Number(row.remaining))),
    page: { nextCursor: rows.length > 50 ? rows[49]!.id : null },
  };
}

export async function updateSlot(
  client: PoolClient,
  userId: string,
  id: string,
  input: { revision: number; capacity: number; status: 'open' | 'closed' },
  requestId: string,
) {
  let selected = await slot(client, id);
  await lockExperience(client, selected.experience_id);
  await ownedExperience(client, selected.experience_id, userId);
  selected = await slot(client, id);
  if (selected.revision !== input.revision || selected.status === 'cancelled')
    throw conflict('Reload this date before changing it.');
  const experience = await bookableExperience(client, selected.experience_id);
  if (selected.starts_at <= new Date())
    throw conflict('Past dates cannot be changed.');
  if (
    input.capacity > experience.max_participants ||
    input.capacity < experience.min_participants ||
    input.capacity < (await occupied(client, id))
  ) {
    throw conflict(
      'Capacity must cover reserved places and stay within the approved group size.',
    );
  }
  const updated = (
    await client.query<Slot>(
      `
    UPDATE public.experience_slots SET capacity=$2,status=$3,revision=revision+1 WHERE id=$1 RETURNING *
  `,
      [id, input.capacity, input.status],
    )
  ).rows[0]!;
  await audit(client, userId, 'slot.updated', requestId, 'slot', id);
  return publicSlot(updated, updated.capacity - (await occupied(client, id)));
}

export async function cancelSlot(
  client: PoolClient,
  userId: string,
  id: string,
  input: Change,
  requestId: string,
) {
  let selected = await slot(client, id);
  await lockExperience(client, selected.experience_id);
  await ownedExperience(client, selected.experience_id, userId);
  selected = await slot(client, id);
  if (selected.status === 'cancelled') return publicSlot(selected, 0);
  if (selected.revision !== input.revision)
    throw conflict('Reload this date before cancelling it.');
  if (selected.ends_at <= new Date())
    throw conflict('A finished date cannot be cancelled.');
  if (
    (
      await client.query(
        `SELECT 1 FROM public.tickets t JOIN public.bookings b ON b.id=t.booking_id
    WHERE b.slot_id=$1 AND t.status='checked_in'`,
        [id],
      )
    ).rowCount
  ) {
    throw conflict(
      'Some guests have checked in. Contact support for this cancellation.',
    );
  }
  await client.query(
    "UPDATE public.experience_slots SET status='cancelled',revision=revision+1 WHERE id=$1",
    [id],
  );
  await client.query(
    "UPDATE public.seat_holds SET status='released' WHERE slot_id=$1 AND status='active'",
    [id],
  );
  const bookings = (
    await client.query(
      `UPDATE public.bookings SET status='cancelled',revision=revision+1
    WHERE slot_id=$1 AND status='confirmed' RETURNING id`,
      [id],
    )
  ).rows;
  for (const booking of bookings) {
    await revokeTicket(client, booking.id);
    await change(
      client,
      booking.id,
      userId,
      'cancelled',
      id,
      id,
      requestId,
      input.reason.trim(),
    );
  }
  await audit(client, userId, 'slot.cancelled', requestId, 'slot', id);
  return publicSlot(await slot(client, id), 0);
}
