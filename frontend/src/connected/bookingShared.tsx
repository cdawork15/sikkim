import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { BookingSlot, BookingSummary } from '../api/bookings';
import { bookingDate, bookingTime, canChoose } from '../api/bookings';
import { useResource, useSession } from '../api/react';
import { Icon } from '../components/Icon';
import { PagedList, RequireAccount } from './shared';

export function BookingPage({ children }: { children: ReactNode }) {
  const { generation } = useSession();
  return (
    <div className="page interior-page connected-booking">
      <RequireAccount>
        <div key={generation}>{children}</div>
      </RequireAccount>
    </div>
  );
}
export function BookingHeading({
  back,
  label,
  title,
  children,
}: {
  back: string;
  label: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="booking-heading">
      <Link className="text-link" to={back}>
        <Icon name="arrow-left" size={17} /> {label}
      </Link>
      <p className="eyebrow">SIKKIM EXPERIENCES</p>
      <h1>{title}</h1>
      {children}
    </header>
  );
}
export function SlotTime({
  slot,
}: {
  slot: Pick<BookingSlot, 'startsAt' | 'endsAt'>;
}) {
  return (
    <>
      <strong>{bookingDate(slot.startsAt)}</strong>
      <span>
        {bookingTime(slot.startsAt)}–{bookingTime(slot.endsAt)} IST
      </span>
    </>
  );
}
// The signed-in traveller's upcoming bookings for one experience. A traveller
// can hold one booking per date; the API refuses a second (ALREADY_BOOKED).
export function useUpcomingBookings(experienceId: string | undefined) {
  const { user } = useSession();
  const result = useResource<BookingSummary[]>(
    experienceId && user
      ? '/me/bookings?status=upcoming&experienceId=' +
          encodeURIComponent(experienceId)
      : null,
    true,
  );
  return result.data ?? [];
}
export function AlreadyBooked({
  bookings,
  children,
}: {
  bookings: BookingSummary[];
  children?: ReactNode;
}) {
  if (!bookings.length) return null;
  return (
    <div className="booking-hold" role="status">
      <h2>You’ve already booked this experience.</h2>
      {bookings.map((item) => (
        <p key={item.id}>
          <SlotTime slot={item} /> · {item.quantity}{' '}
          {item.quantity === 1 ? 'person' : 'people'} ·{' '}
          <Link className="text-link" to={'/essentials/bookings/' + item.id}>
            View booking and ticket
          </Link>
        </p>
      ))}
      {children}
    </div>
  );
}
export function SlotPicker({
  experienceId,
  quantity,
  selected,
  onSelect,
  disabled = false,
  excludeId,
  bookedSlotIds = [],
  policy,
}: {
  experienceId: string;
  quantity: number;
  selected?: BookingSlot;
  onSelect: (slot: BookingSlot) => void;
  disabled?: boolean;
  excludeId?: string;
  bookedSlotIds?: string[];
  policy?: { cancellationHours: number; rescheduleHours: number };
}) {
  return (
    <fieldset className="booking-date-picker" disabled={disabled}>
      <legend>Available dates</legend>
      <p>Times are shown in India time (IST).</p>
      <PagedList<BookingSlot>
        path={'/experiences/' + experienceId + '/slots'}
        render={(slot) => {
          const booked = bookedSlotIds.includes(slot.id);
          const allowed =
            canChoose(slot, quantity) &&
            slot.id !== excludeId &&
            !booked &&
            (!policy ||
              (slot.cancellationHours === policy.cancellationHours &&
                slot.rescheduleHours === policy.rescheduleHours));
          return (
            <label
              className={
                'booking-date' +
                (selected?.id === slot.id ? ' selected' : '') +
                (!allowed ? ' unavailable' : '')
              }
            >
              <input
                type="radio"
                name="booking-date"
                value={slot.id}
                checked={selected?.id === slot.id}
                disabled={!allowed || disabled}
                onChange={() => onSelect(slot)}
              />
              <span>
                <SlotTime slot={slot} />
                <small>
                  {slot.pricePaise !== 0
                    ? 'Paid booking is not available yet'
                    : slot.id === excludeId
                      ? 'Your current date'
                      : booked
                        ? 'You’re already booked on this date'
                        : allowed
                          ? `${slot.availablePlaces} places left · Free`
                          : 'Unavailable for this booking'}
                </small>
              </span>
            </label>
          );
        }}
      />
    </fieldset>
  );
}
export function useBookingClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
