import { AccountError } from '../accounts/model.js';
import { object, text, uuid, revision } from '../catalogue/model.js';

export const unavailable = (
  message = 'This booking or date is not available.',
) => new AccountError(404, 'NOT_FOUND', message);
export const conflict = (message: string, code = 'BOOKING_CHANGED') =>
  new AccountError(409, code, message);
export const noQuery = object({});
export const idParams = object({ id: uuid }, ['id']);
export const pageQuery = object({ after: uuid });
const instant = { type: 'string', format: 'date-time', maxLength: 35 };
const hours = { type: 'integer', minimum: 0, maximum: 720 };
export const slotSchema = object(
  {
    requestKey: uuid,
    startsAt: instant,
    endsAt: instant,
    bookingDeadline: instant,
    timezone: { type: 'string', enum: ['Asia/Kolkata'] },
    capacity: { type: 'integer', minimum: 1, maximum: 1000 },
    cancellationHours: hours,
    rescheduleHours: hours,
  },
  [
    'requestKey',
    'startsAt',
    'endsAt',
    'bookingDeadline',
    'timezone',
    'capacity',
    'cancellationHours',
    'rescheduleHours',
  ],
);
export type SlotInput = {
  requestKey: string;
  startsAt: string;
  endsAt: string;
  bookingDeadline: string;
  timezone: 'Asia/Kolkata';
  capacity: number;
  cancellationHours: number;
  rescheduleHours: number;
};
export const holdSchema = object(
  {
    slotId: uuid,
    requestKey: uuid,
    quantity: { type: 'integer', minimum: 1, maximum: 1000 },
  },
  ['slotId', 'requestKey', 'quantity'],
);
export type HoldInput = {
  slotId: string;
  requestKey: string;
  quantity: number;
};
export const confirmationSchema = object(
  {
    holdId: uuid,
    contactName: text(80),
    contactEmail: { type: 'string', format: 'email', maxLength: 254 },
    guests: { type: 'array', minItems: 1, maxItems: 1000, items: text(80) },
  },
  ['holdId', 'contactName', 'contactEmail', 'guests'],
);
export type Confirmation = {
  holdId: string;
  contactName: string;
  contactEmail: string;
  guests: string[];
};
export const changeSchema = object({ revision, reason: text(1000) }, [
  'revision',
  'reason',
]);
export type Change = { revision: number; reason: string };
export type Move = Change & { slotId: string; requestKey: string };
export type Slot = {
  id: string;
  experience_id: string;
  starts_at: Date;
  ends_at: Date;
  booking_deadline: Date;
  cancellation_hours: number;
  reschedule_hours: number;
  timezone: string;
  capacity: number;
  price_paise: number;
  policy_id: string;
  experience_revision: number;
  status: string;
  revision: number;
  currency: string;
};

// Always calculate availability from live holds, not a counter or a cleanup job.
// Every writer first takes the same experience lock before checking these totals.
export const remainingSeats = `s.capacity
  - COALESCE((SELECT sum(b.quantity) FROM public.bookings b
      WHERE b.slot_id = s.id AND b.status = 'confirmed'), 0)
  - COALESCE((SELECT sum(sh.quantity) FROM public.seat_holds sh
      WHERE sh.slot_id = s.id AND sh.status = 'active'
        AND sh.expires_at > clock_timestamp()), 0)`;
export const availableSlot = `s.status = 'open'
  AND s.booking_deadline > clock_timestamp()
  AND s.starts_at > clock_timestamp()
  AND s.experience_revision = e.revision AND s.policy_id = e.policy_id
  AND s.price_paise = e.price_paise
  AND e.source_reference <> 'local-design-preview'
  AND (${remainingSeats}) >= e.min_participants`;
