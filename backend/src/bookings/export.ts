import type { PoolClient } from 'pg';

export async function bookingAccountData(client: PoolClient, userId: string) {
  const reservations = (
    await client.query(
      `
    SELECT id,reference,experience_id,slot_id,quantity,contact_name,contact_email,
      guests,snapshot,total_paise,currency,status,revision,created_at
    FROM public.bookings WHERE user_id=$1 ORDER BY id
  `,
      [userId],
    )
  ).rows;
  const holds = (
    await client.query(
      `
    SELECT id,slot_id,quantity,expires_at,created_at,
      CASE WHEN status='active' AND expires_at<=clock_timestamp() THEN 'expired' ELSE status END AS status
    FROM public.seat_holds WHERE user_id=$1 ORDER BY id
  `,
      [userId],
    )
  ).rows;
  const changes = (
    await client.query(
      `
    SELECT c.sequence::text,c.booking_id,c.action,c.old_slot_id,c.new_slot_id,c.reason,c.created_at
    FROM public.booking_changes c JOIN public.bookings b ON b.id=c.booking_id
    WHERE b.user_id=$1 ORDER BY c.sequence
  `,
      [userId],
    )
  ).rows;
  return { reservations, holds, changes };
}
