import type { Policy } from './types';

export type BookingSlot = {
  id: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  bookingDeadline: string;
  capacity: number;
  availablePlaces: number;
  pricePaise: number;
  currency: string;
  cancellationHours: number;
  rescheduleHours: number;
  status: 'open' | 'closed' | 'cancelled';
  revision: number;
};
export type SeatHold = {
  id: string;
  slotId: string;
  quantity: number;
  expiresAt: string;
  status: 'active' | 'used' | 'released' | 'expired';
};
export type BookingSummary = {
  id: string;
  reference: string;
  title: string;
  quantity: number;
  status: 'confirmed' | 'cancelled' | 'no_show';
  revision: number;
  startsAt: string;
  endsAt: string;
  timezone: string;
  totalPaise: number;
  currency: string;
};
export type Booking = Omit<
  BookingSummary,
  'title' | 'startsAt' | 'endsAt' | 'timezone'
> & {
  experienceId: string;
  contactName: string;
  contactEmail: string;
  guests: string[];
  slot: BookingSlot;
  snapshot: {
    title: string;
    slug: string;
    hostName: string;
    meetingPoint: string;
    preparation: string;
    inclusions: string[];
    exclusions: string[];
    pricePaise: number;
    feesPaise: number;
    totalPaise: number;
    currency: string;
    policy: Policy & { cancellationHours: number; rescheduleHours: number };
  };
  history: {
    id: string;
    action: string;
    reason: string | null;
    createdAt: string;
  }[];
};
export type BookingTicket = {
  reference: string;
  status: 'issued' | 'checked_in' | 'revoked' | 'expired';
  verificationToken: string | null;
  shareText: string;
};
export type Attendance = Pick<
  BookingSummary,
  'id' | 'reference' | 'quantity' | 'status' | 'revision'
> & {
  contactName: string;
  guests: string[];
  ticketStatus: 'issued' | 'checked_in' | null;
};

export function bookingDate(instant: string) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(instant));
}
export function bookingTime(instant: string) {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant));
}
export function cutoffLabel(hours: number) {
  return hours === 0
    ? 'Before the start time'
    : `At least ${hours} ${hours === 1 ? 'hour' : 'hours'} before the start`;
}
export function canChoose(slot: BookingSlot, quantity: number) {
  return (
    slot.status === 'open' &&
    slot.pricePaise === 0 &&
    slot.availablePlaces >= quantity &&
    Date.parse(slot.bookingDeadline) > Date.now()
  );
}
