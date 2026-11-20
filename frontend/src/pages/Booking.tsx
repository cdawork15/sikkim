import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Icon } from '../components/Icon';
import { experiences, formatPrice, type Experience } from '../data/experiences';
import {
  demoCancellation,
  getExperienceDetails,
} from '../data/experienceDetails';
import {
  bookingError,
  dateLabel,
  getDemoSlots,
  saveDemoBooking,
  type DemoBooking,
} from '../lib/booking';

export function Booking() {
  const { id } = useParams();
  const experience = experiences.find((item) => item.id === id);
  return experience ? (
    <BookingForm key={experience.id} experience={experience} />
  ) : (
    <div className="page booking-page">
      <EmptyState title="We couldn’t find this experience.">
        Choose another experience to try a demo booking.
      </EmptyState>
    </div>
  );
}

function BookingForm({ experience }: { experience: Experience }) {
  const navigate = useNavigate();
  const [slots] = useState(() => getDemoSlots());
  const [date, setDate] = useState(slots[0]!.date);
  const [slotId, setSlotId] = useState('');
  const [people, setPeople] = useState('1');
  const [error, setError] = useState('');
  const errorRef = useRef<HTMLParagraphElement>(null);
  const submitted = useRef(false);
  const slot = slots.find((item) => item.id === slotId);
  const count = Number(people);
  const validCount =
    Number.isInteger(count) && count >= 1 && count <= (slot?.remaining ?? 4);
  const dates = [...new Set(slots.map((item) => item.date))];
  const showError = (message: string) => {
    setError(message);
    requestAnimationFrame(() => errorRef.current?.focus());
  };
  const confirm = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitted.current) return;
    const message = bookingError(slot, count);
    if (message) {
      showError(message);
      return;
    }
    submitted.current = true;
    const booking: DemoBooking = {
      reference: `DEMO-${crypto.randomUUID()}`,
      experienceId: experience.id,
      date: slot!.date,
      time: slot!.time,
      participants: count,
      createdAt: new Date().toISOString(),
    };
    const persisted = saveDemoBooking(booking);
    navigate(`/demo-bookings/${booking.reference}`, {
      replace: true,
      state: { temporary: !persisted },
    });
  };
  return (
    <div className="page booking-page">
      <Link
        to={`/experiences/${experience.id}`}
        className="text-link back-link"
      >
        <Icon name="arrow-left" size={17} />
        Back to details
      </Link>
      <div className="booking-layout">
        <aside className="booking-summary">
          <img
            src={experience.image}
            alt={experience.imageAlt}
            width="768"
            height="512"
          />
          <div>
            <p className="eyebrow accent">YOUR NEXT EXPERIENCE</p>
            <h2>{experience.title}</h2>
            <p>
              {experience.area} · {experience.duration}
            </p>
            <p>
              Hosted by {getExperienceDetails(experience).host} · Sample host
            </p>
          </div>
        </aside>
        <form className="booking-form" onSubmit={confirm} noValidate>
          <p className="eyebrow accent">DEMO BOOKING</p>
          <h1>Book your spot</h1>
          <p className="booking-intro">
            Try the journey. No payment, no real reservation.
          </p>
          <fieldset>
            <legend>Select a date</legend>
            <div className="date-options">
              {dates.map((day) => {
                const daySlots = slots.filter((item) => item.date === day);
                const status = daySlots.every((item) => item.unavailable)
                  ? 'Unavailable'
                  : daySlots.every((item) => item.remaining === 0)
                    ? 'Full'
                    : 'Available';
                return (
                  <label
                    key={day}
                    className={`slot-option ${date === day ? 'selected' : ''}`}
                  >
                    <input
                      type="radio"
                      name="date"
                      value={day}
                      checked={date === day}
                      onChange={() => {
                        setDate(day);
                        setSlotId('');
                        setError('');
                      }}
                    />
                    <span>{dateLabel(day)}</span>
                    <small>{status}</small>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <fieldset>
            <legend>
              Select a time <span>(India time)</span>
            </legend>
            <div className="time-options">
              {slots
                .filter((item) => item.date === date)
                .map((item) => (
                  <label
                    key={item.id}
                    className={`slot-option ${slotId === item.id ? 'selected' : ''} ${item.unavailable || !item.remaining ? 'unavailable' : ''}`}
                  >
                    <input
                      type="radio"
                      name="time"
                      value={item.id}
                      checked={slotId === item.id}
                      disabled={item.unavailable || !item.remaining}
                      onChange={() => {
                        setSlotId(item.id);
                        setError('');
                      }}
                    />
                    <span>{item.time}</span>
                    <small>
                      {item.unavailable
                        ? 'Unavailable'
                        : item.remaining
                          ? `${item.remaining} places left`
                          : 'Full'}
                    </small>
                  </label>
                ))}
            </div>
            {slots
              .filter((item) => item.date === date)
              .every((item) => item.unavailable || !item.remaining) && (
              <p className="field-help" role="status">
                No places on this date. Try another date.
              </p>
            )}
          </fieldset>
          <div className="participants-field">
            <label htmlFor="participants">How many people?</label>
            <div className="participant-stepper">
              <button
                type="button"
                aria-label="Remove one person"
                disabled={!Number.isInteger(count) || count <= 1}
                onClick={() => {
                  setPeople(String(count - 1));
                  setError('');
                }}
              >
                −
              </button>
              <input
                id="participants"
                type="number"
                inputMode="numeric"
                min="1"
                max={slot?.remaining ?? 4}
                step="1"
                value={people}
                aria-describedby="participant-help booking-error"
                aria-invalid={Boolean(error && slot)}
                onChange={(event) => {
                  setPeople(event.target.value);
                  setError('');
                }}
              />
              <button
                type="button"
                aria-label="Add one person"
                disabled={
                  !Number.isInteger(count) || count >= (slot?.remaining ?? 4)
                }
                onClick={() => {
                  setPeople(String(count + 1));
                  setError('');
                }}
              >
                +
              </button>
            </div>
            <p id="participant-help" className="field-help">
              {slot
                ? `Choose 1–${slot.remaining} people for this time.`
                : 'Choose a time to see the available places.'}{' '}
              All availability is made up for this demo.
            </p>
          </div>
          <div className="price-summary">
            <span>
              {formatPrice(experience.price)} × {validCount ? count : '—'}{' '}
              {count === 1 ? 'person' : 'people'}
            </span>
            <strong>
              {validCount ? formatPrice(experience.price * count) : '—'}
            </strong>
            <span>Demo total · Nothing will be charged</span>
          </div>
          <details className="detail-disclosure">
            <summary>Cancellation rules</summary>
            <p>{demoCancellation}</p>
          </details>
          <p
            id="booking-error"
            className="form-error"
            role="alert"
            tabIndex={-1}
            ref={errorRef}
          >
            {error}
          </p>
          <button
            type="submit"
            className="button button-primary confirm-booking"
          >
            Confirm demo booking
            <Icon name="arrow-right" size={17} />
          </button>
          <p className="field-help">
            This local demo needs no location permission or payment details. It
            works offline after the app has loaded.
          </p>
        </form>
      </div>
    </div>
  );
}
