import { experiences } from '../data/experiences';

export type Slot = {
  id: string;
  date: string;
  time: string;
  remaining: number;
  unavailable: boolean;
};
export type DemoBooking = {
  reference: string;
  experienceId: string;
  date: string;
  time: string;
  participants: number;
  createdAt: string;
};
export const BOOKING_KEY = 'sikkim:demo-bookings:v1';
const memory = new Map<string, DemoBooking>();
export const indiaToday = (now = new Date()) =>
  new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
export const dateLabel = (date: string) =>
  new Intl.DateTimeFormat('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));

export function getDemoSlots(now = new Date()): Slot[] {
  const today = indiaToday(now);
  return [1, 2, 3, 4].flatMap((offset) => {
    const day = new Date(`${today}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() + offset);
    const date = day.toISOString().slice(0, 10);
    return ['06:00', '09:00'].map((time, index) => ({
      id: `${date}/${time}`,
      date,
      time,
      remaining: offset === 2 ? 0 : index === 0 ? 4 : 2,
      unavailable: offset === 3,
    }));
  });
}

export function bookingError(
  slot: Slot | undefined,
  count: number,
  now = new Date(),
) {
  if (!slot) return 'Choose an available date and time.';
  if (slot.unavailable)
    return 'This time is unavailable. Please choose another date.';
  if (slot.remaining === 0)
    return 'This time is full. Please choose another date.';
  if (new Date(`${slot.date}T${slot.time}:00+05:30`).getTime() <= now.getTime())
    return 'This time has passed. Please choose another date.';
  if (!Number.isInteger(count) || count < 1)
    return 'Enter a whole number of people, starting at 1.';
  if (count > slot.remaining)
    return `Only ${slot.remaining} places are available for this time.`;
  return '';
}

export function isDemoBooking(value: unknown): value is DemoBooking {
  if (!value || typeof value !== 'object') return false;
  const b = value as Partial<DemoBooking>;
  return (
    typeof b.reference === 'string' &&
    /^DEMO-[0-9a-f-]{36}$/.test(b.reference) &&
    experiences.some((e) => e.id === b.experienceId) &&
    typeof b.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(b.date) &&
    Number.isFinite(Date.parse(`${b.date}T12:00:00Z`)) &&
    new Date(`${b.date}T12:00:00Z`).toISOString().slice(0, 10) === b.date &&
    ['06:00', '09:00'].includes(b.time ?? '') &&
    Number.isInteger(b.participants) &&
    b.participants! >= 1 &&
    b.participants! <= 4 &&
    typeof b.createdAt === 'string' &&
    Number.isFinite(Date.parse(b.createdAt))
  );
}

function readAll(): DemoBooking[] {
  const raw: unknown = JSON.parse(localStorage.getItem(BOOKING_KEY) ?? '[]');
  return Array.isArray(raw) ? raw.filter(isDemoBooking).slice(-20) : [];
}
export function saveDemoBooking(booking: DemoBooking): boolean {
  memory.set(booking.reference, booking);
  try {
    let previous: DemoBooking[];
    try {
      previous = readAll();
    } catch {
      previous = [];
    }
    localStorage.setItem(
      BOOKING_KEY,
      JSON.stringify(
        [
          ...previous.filter((b) => b.reference !== booking.reference),
          booking,
        ].slice(-20),
      ),
    );
    return true;
  } catch {
    return false;
  }
}
export function findDemoBooking(reference: string): DemoBooking | undefined {
  const cached = memory.get(reference);
  if (cached) return cached;
  try {
    return readAll().find((b) => b.reference === reference);
  } catch {
    return undefined;
  }
}

export function listDemoBookings(): DemoBooking[] {
  let stored: DemoBooking[] = [];
  try {
    stored = readAll();
  } catch {
    /* In-memory tickets remain usable. */
  }
  return [
    ...new Map(
      [...stored, ...memory.values()].map((b) => [b.reference, b]),
    ).values(),
  ];
}
