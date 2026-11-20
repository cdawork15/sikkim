import { randomBytes } from 'node:crypto';
import type { PoolClient } from 'pg';
import { filterKey, invalid } from '../catalogue/model.js';
import {
  conflict,
  unavailable,
  type Confirmation,
  type HoldInput,
  type Change,
  type Move,
} from './model.js';
import {
  booking,
  change,
  detail,
  issueTicket,
  lockExperience,
  requireBeforeCutoff,
  requireCapacity,
  requireUnattended,
  revokeTicket,
  slot,
  validSlot,
} from './store.js';

async function readHold(client: PoolClient, id: string, userId: string) {
  const hold = (
    await client.query(
      `SELECT *, expires_at <= clock_timestamp() AS expired
    FROM public.seat_holds WHERE id=$1 AND user_id=$2`,
      [id, userId],
    )
  ).rows[0];
  if (!hold) throw unavailable();
  return hold;
}

function holdData(hold: {
  id: string;
  slot_id: string;
  quantity: number;
  expires_at: Date;
  status: string;
  expired?: boolean;
}) {
  return {
    id: hold.id,
    slotId: hold.slot_id,
    quantity: hold.quantity,
    expiresAt: hold.expires_at,
    status: hold.status === 'active' && hold.expired ? 'expired' : hold.status,
  };
}

export async function createHold(
  client: PoolClient,
  userId: string,
  input: HoldInput,
) {
  const previous = (
    await client.query(
      'SELECT id,slot_id,quantity FROM public.seat_holds WHERE user_id=$1 AND request_key=$2',
      [userId, input.requestKey],
    )
  ).rows[0];
  if (previous) {
    if (
      previous.slot_id !== input.slotId ||
      previous.quantity !== input.quantity
    )
      throw conflict(
        'Use a new request key for a different reservation.',
        'REQUEST_KEY_REUSED',
      );
    return holdData(await readHold(client, previous.id, userId));
  }
  let selected = await slot(client, input.slotId);
  await lockExperience(client, selected.experience_id);
  selected = await slot(client, input.slotId);
  await validSlot(client, selected, input.quantity);
  await requireCapacity(client, selected, input.quantity);
  await client.query(
    "UPDATE public.seat_holds SET status='expired' WHERE slot_id=$1 AND status='active' AND expires_at<=clock_timestamp()",
    [selected.id],
  );
  const hold = (
    await client.query(
      `
    INSERT INTO public.seat_holds(slot_id,user_id,request_key,quantity,expires_at)
    VALUES($1,$2,$3,$4,LEAST(clock_timestamp()+interval '10 minutes',$5::timestamptz)) RETURNING *
  `,
      [
        selected.id,
        userId,
        input.requestKey,
        input.quantity,
        selected.booking_deadline,
      ],
    )
  ).rows[0];
  return holdData(hold);
}

export async function releaseHold(
  client: PoolClient,
  userId: string,
  id: string,
) {
  const hold = await readHold(client, id, userId);
  await lockExperience(
    client,
    (await slot(client, hold.slot_id)).experience_id,
  );
  await client.query(
    `UPDATE public.seat_holds SET status=CASE WHEN expires_at<=clock_timestamp()
    THEN 'expired' ELSE 'released' END WHERE id=$1 AND status='active'`,
    [id],
  );
  return holdData(await readHold(client, id, userId));
}

export async function confirm(
  client: PoolClient,
  userId: string,
  input: Confirmation,
  requestId: string,
) {
  let hold = await readHold(client, input.holdId, userId);
  let selected = await slot(client, hold.slot_id);
  await lockExperience(client, selected.experience_id);
  selected = await slot(client, hold.slot_id);
  hold = await readHold(client, input.holdId, userId);
  const contact = {
    contactName: input.contactName.trim(),
    contactEmail: input.contactEmail.trim().toLowerCase(),
    guests: input.guests.map((name) => name.trim()),
  };
  const hash = filterKey(contact);
  const existing = (
    await client.query(
      'SELECT id,confirmation_hash FROM public.bookings WHERE hold_id=$1 AND user_id=$2',
      [hold.id, userId],
    )
  ).rows[0];
  if (existing) {
    if (existing.confirmation_hash !== hash)
      throw conflict(
        'This reservation was already confirmed with different details.',
        'REQUEST_KEY_REUSED',
      );
    return detail(client, existing.id, userId);
  }
  if (hold.status !== 'active' || hold.expired)
    throw conflict(
      'Your reserved places have expired or been released. Choose the date again.',
      'HOLD_EXPIRED',
    );
  if (input.guests.length !== hold.quantity)
    throw invalid('Add one guest name for each reserved place.');
  const experience = await validSlot(client, selected, hold.quantity);
  // The hold is still counted. Require zero additional seats, not its quantity again.
  await requireCapacity(client, selected, 0);
  const snapshot = {
    title: experience.title,
    slug: experience.slug,
    hostName: experience.host_name,
    meetingPoint: experience.meeting_point,
    preparation: experience.preparation,
    inclusions: experience.inclusions,
    exclusions: experience.exclusions,
    pricePaise: selected.price_paise,
    feesPaise: 0,
    totalPaise: 0,
    currency: selected.currency,
    originalSlotId: selected.id,
    startsAt: selected.starts_at,
    endsAt: selected.ends_at,
    timezone: selected.timezone,
    policy: {
      id: experience.policy_id,
      version: experience.policy_version,
      cancellation: experience.cancellation,
      safety: experience.safety,
      participation: experience.participation,
      cancellationHours: selected.cancellation_hours,
      rescheduleHours: selected.reschedule_hours,
    },
  };
  const created = (
    await client.query(
      `
    INSERT INTO public.bookings(reference,user_id,hold_id,experience_id,slot_id,quantity,
      contact_name,contact_email,guests,snapshot,confirmation_hash)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id
  `,
      [
        'SK-' + randomBytes(10).toString('hex').toUpperCase(),
        userId,
        hold.id,
        selected.experience_id,
        selected.id,
        hold.quantity,
        contact.contactName,
        contact.contactEmail,
        JSON.stringify(contact.guests),
        snapshot,
        hash,
      ],
    )
  ).rows[0];
  const consumed = await client.query(
    `UPDATE public.seat_holds SET status='used'
    WHERE id=$1 AND status='active' AND expires_at>clock_timestamp() RETURNING id`,
    [hold.id],
  );
  if (!consumed.rowCount)
    throw conflict(
      'Your reserved places have expired. Choose the date again.',
      'HOLD_EXPIRED',
    );
  await issueTicket(client, created.id);
  await change(
    client,
    created.id,
    userId,
    'confirmed',
    null,
    selected.id,
    requestId,
  );
  return detail(client, created.id, userId);
}

export async function cancelBooking(
  client: PoolClient,
  userId: string,
  id: string,
  input: Change,
  requestId: string,
) {
  let current = await booking(client, id, userId);
  await lockExperience(client, current.experience_id);
  current = await booking(client, id, userId);
  if (current.status === 'cancelled') return detail(client, id, userId);
  if (current.revision !== input.revision || current.status !== 'confirmed')
    throw conflict('Reload your booking before changing it.');
  await requireUnattended(client, id);
  await requireBeforeCutoff(
    client,
    current.starts_at,
    current.snapshot.policy.cancellationHours,
  );
  await client.query(
    "UPDATE public.bookings SET status='cancelled',revision=revision+1 WHERE id=$1",
    [id],
  );
  await revokeTicket(client, id);
  await change(
    client,
    id,
    userId,
    'cancelled',
    current.slot_id,
    current.slot_id,
    requestId,
    input.reason.trim(),
  );
  return detail(client, id, userId);
}

export async function reschedule(
  client: PoolClient,
  userId: string,
  id: string,
  input: Move,
  requestId: string,
) {
  let current = await booking(client, id, userId);
  await lockExperience(client, current.experience_id);
  current = await booking(client, id, userId);
  const hash = filterKey([input.revision, input.slotId, input.reason.trim()]);
  const previous = (
    await client.query(
      'SELECT request_hash FROM public.booking_changes WHERE booking_id=$1 AND request_key=$2',
      [id, input.requestKey],
    )
  ).rows[0];
  if (previous) {
    if (previous.request_hash !== hash)
      throw conflict(
        'Use a new request key for a different change.',
        'REQUEST_KEY_REUSED',
      );
    return detail(client, id, userId);
  }
  if (current.revision !== input.revision || current.status !== 'confirmed')
    throw conflict('Reload your booking before changing it.');
  if (current.slot_id === input.slotId)
    throw invalid('Choose a different date.');
  await requireUnattended(client, id);
  await requireBeforeCutoff(
    client,
    current.starts_at,
    current.snapshot.policy.rescheduleHours,
  );
  const target = await slot(client, input.slotId);
  if (target.experience_id !== current.experience_id)
    throw invalid('Choose another date for the same experience.');
  await validSlot(client, target, current.quantity);
  // Keep the original policy and price. Different terms need a new booking.
  if (
    target.policy_id !== current.snapshot.policy.id ||
    target.price_paise !== current.snapshot.pricePaise ||
    target.cancellation_hours !== current.snapshot.policy.cancellationHours ||
    target.reschedule_hours !== current.snapshot.policy.rescheduleHours
  ) {
    throw conflict(
      'The new date has different terms. Make a separate booking.',
      'POLICY_CHANGED',
    );
  }
  await requireCapacity(client, target, current.quantity);
  await client.query(
    'UPDATE public.bookings SET slot_id=$2,revision=revision+1 WHERE id=$1',
    [id, target.id],
  );
  await revokeTicket(client, id);
  await issueTicket(client, id);
  await change(
    client,
    id,
    userId,
    'rescheduled',
    current.slot_id,
    target.id,
    requestId,
    input.reason.trim(),
    input.requestKey,
    hash,
  );
  return detail(client, id, userId);
}
