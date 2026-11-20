import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { BookingSlot } from '../api/bookings';
import { bookingDate, bookingTime, canChoose } from '../api/bookings';
import { useSession } from '../api/react';
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
export function SlotPicker({
  experienceId,
  quantity,
  selected,
  onSelect,
  disabled = false,
  excludeId,
  policy,
}: {
  experienceId: string;
  quantity: number;
  selected?: BookingSlot;
  onSelect: (slot: BookingSlot) => void;
  disabled?: boolean;
  excludeId?: string;
  policy?: { cancellationHours: number; rescheduleHours: number };
}) {
  return (
    <fieldset className="booking-date-picker" disabled={disabled}>
      <legend>Available dates</legend>
      <p>Times are shown in India time (IST).</p>
      <PagedList<BookingSlot>
        path={'/experiences/' + experienceId + '/slots'}
        render={(slot) => {
          const allowed =
            canChoose(slot, quantity) &&
            slot.id !== excludeId &&
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
