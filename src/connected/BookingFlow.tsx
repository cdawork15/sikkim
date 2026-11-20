import { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAction, useApi, useResource, useSession } from '../api/react';
import type { ExperienceDetail } from '../api/types';
import type { Booking, BookingSlot, SeatHold } from '../api/bookings';
import { cutoffLabel } from '../api/bookings';
import { Artwork, Empty, ErrorNotice, Loading, money } from './shared';
import {
  BookingHeading,
  BookingPage,
  SlotPicker,
  SlotTime,
  useBookingClock,
} from './bookingShared';

export function BookingFlow() {
  const { slug = '' } = useParams();
  return (
    <BookingPage>
      <BookingLoader key={slug} slug={slug} />
    </BookingPage>
  );
}
function BookingLoader({ slug }: { slug: string }) {
  const result = useResource<ExperienceDetail>(
    '/experiences/' + encodeURIComponent(slug),
  );
  return (
    <>
      <BookingHeading
        back={'/experiences/' + encodeURIComponent(slug)}
        label="Back to experience"
        title="A little closer to your next experience."
      />
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
      {result.data && <Reservation experience={result.data} />}
    </>
  );
}
function Reservation({ experience }: { experience: ExperienceDetail }) {
  const api = useApi();
  const { user } = useSession();
  const action = useAction();
  const navigate = useNavigate();
  const now = useBookingClock();
  const [selected, setSelected] = useState<BookingSlot>();
  const [quantity, setQuantity] = useState(experience.minParticipants);
  const [held, setHeld] = useState<SeatHold>();
  const [attempted, setAttempted] = useState(false);
  const holdAttempt = useRef<
    { slotId: string; quantity: number; requestKey: string } | undefined
  >(undefined);
  const confirmation = useRef<
    | {
        holdId: string;
        contactName: string;
        contactEmail: string;
        guests: string[];
      }
    | undefined
  >(undefined);
  const [pickerRevision, setPickerRevision] = useState(0);
  const remaining = held
    ? Math.max(0, Math.ceil((Date.parse(held.expiresAt) - now) / 1000))
    : 0;
  const holdLocked = Boolean(holdAttempt.current);

  async function reserve() {
    if (!selected) return;
    holdAttempt.current ??= {
      slotId: selected.id,
      quantity,
      requestKey: crypto.randomUUID(),
    };
    const response = await api.request<SeatHold>('/me/seat-holds', {
      method: 'POST',
      private: true,
      body: holdAttempt.current,
    });
    if (
      response.data.status !== 'active' ||
      Date.parse(response.data.expiresAt) <= Date.now()
    ) {
      holdAttempt.current = undefined;
      setPickerRevision((value) => value + 1);
      setSelected(undefined);
      throw new Error(
        'Those reserved places have expired. Choose a date again.',
      );
    }
    setHeld(response.data);
  }
  async function changeDate() {
    // Resolve a timed-out hold request using the same key before releasing it.
    const hold =
      held ??
      (holdAttempt.current
        ? (
            await api.request<SeatHold>('/me/seat-holds', {
              method: 'POST',
              private: true,
              body: holdAttempt.current,
            })
          ).data
        : null);
    if (hold)
      await api.request('/me/seat-holds/' + hold.id + '/release', {
        method: 'POST',
        private: true,
        body: {},
      });
    holdAttempt.current = undefined;
    confirmation.current = undefined;
    setHeld(undefined);
    setAttempted(false);
    setSelected(undefined);
    setPickerRevision((value) => value + 1);
  }
  return (
    <div className="booking-layout">
      <section className="booking-main">
        <div className="booking-progress" aria-label="Booking progress">
          <span className={!held ? 'active' : ''}>1 · Date & group</span>
          <span className={held ? 'active' : ''}>2 · Guest details</span>
          <span>3 · Your ticket</span>
        </div>
        <ErrorNotice error={action.error} />
        {!held ? (
          <>
            <div className="booking-group">
              <div>
                <h2>Who’s coming?</h2>
                <p>
                  {experience.minParticipants}–{experience.maxParticipants}{' '}
                  people per booking
                </p>
              </div>
              <label>
                People
                <input
                  aria-label="Number of people"
                  type="number"
                  min={experience.minParticipants}
                  max={experience.maxParticipants}
                  value={quantity}
                  disabled={action.busy || holdLocked}
                  onChange={(event) => {
                    setQuantity(Number(event.target.value));
                    setSelected(undefined);
                  }}
                />
              </label>
            </div>
            <SlotPicker
              key={pickerRevision}
              experienceId={experience.id}
              quantity={quantity}
              selected={selected}
              onSelect={setSelected}
              disabled={
                action.busy ||
                holdLocked ||
                !Number.isInteger(quantity) ||
                quantity < experience.minParticipants ||
                quantity > experience.maxParticipants
              }
            />
            {!experience.availability.bookable && (
              <Empty>
                {experience.pricePaise > 0
                  ? 'Paid bookings are not available yet.'
                  : 'There are no bookable dates right now. Please check back soon.'}
              </Empty>
            )}
            <div className="api-actions">
              <button
                className="button button-primary"
                disabled={!selected || action.busy}
                onClick={() =>
                  void action.run(async () => {
                    try {
                      await reserve();
                    } catch (error) {
                      if (
                        error instanceof ApiError &&
                        error.status >= 400 &&
                        error.status < 500
                      ) {
                        holdAttempt.current = undefined;
                        setSelected(undefined);
                        setPickerRevision((value) => value + 1);
                      }
                      throw error;
                    }
                  })
                }
              >
                {action.busy
                  ? 'Reserving places…'
                  : holdLocked
                    ? 'Retry reservation'
                    : 'Continue'}
              </button>
              {holdLocked && (
                <button
                  className="button button-secondary"
                  disabled={action.busy}
                  onClick={() => void action.run(changeDate)}
                >
                  Choose another date
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="booking-hold">
              <h2>Your places are reserved for now.</h2>
              <p>
                {remaining > 0
                  ? `Complete your booking within ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}.`
                  : 'The reservation time has ended. Choose a date again unless you are retrying a confirmation.'}
              </p>
            </div>
            <form
              className="api-form booking-guest-form"
              onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                confirmation.current ??= {
                  holdId: held.id,
                  contactName: String(form.get('contactName')).trim(),
                  contactEmail: String(form.get('contactEmail')).trim(),
                  guests: Array.from({ length: quantity }, (_, index) =>
                    String(form.get('guest-' + index)).trim(),
                  ),
                };
                setAttempted(true);
                void action.run(async () => {
                  try {
                    const response = await api.request<Booking>(
                      '/me/bookings',
                      {
                        method: 'POST',
                        private: true,
                        body: confirmation.current,
                      },
                    );
                    navigate('/essentials/bookings/' + response.data.id, {
                      replace: true,
                    });
                  } catch (error) {
                    // A connection failure may follow a successful commit. Keep the exact
                    // payload and hold ID so retry returns that booking, even after expiry.
                    if (
                      error instanceof ApiError &&
                      error.status >= 400 &&
                      error.status < 500
                    ) {
                      confirmation.current = undefined;
                      setAttempted(false);
                    }
                    throw error;
                  }
                });
              }}
            >
              <fieldset
                className="api-form api-wide"
                disabled={action.busy || attempted}
              >
                <legend>Guest details</legend>
                <label>
                  Contact name
                  <input
                    name="contactName"
                    autoComplete="name"
                    defaultValue={user?.displayName}
                    required
                    maxLength={80}
                    pattern=".*\S.*"
                  />
                </label>
                <label>
                  Contact email
                  <input
                    name="contactEmail"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                  />
                </label>
                {Array.from({ length: quantity }, (_, index) => (
                  <label key={index}>
                    Guest {index + 1} name
                    <input
                      name={'guest-' + index}
                      defaultValue={index === 0 ? user?.displayName : ''}
                      required
                      maxLength={80}
                      pattern=".*\S.*"
                    />
                  </label>
                ))}
                <div className="booking-terms api-wide">
                  <h3>Before you confirm</h3>
                  <p>{experience.policy.cancellation}</p>
                  <p>
                    Cancel: {cutoffLabel(selected!.cancellationHours)}.<br />
                    Change date: {cutoffLabel(selected!.rescheduleHours)}.
                  </p>
                  <p>{experience.policy.safety}</p>
                  <p>{experience.policy.participation}</p>
                  <label className="api-check">
                    <input type="checkbox" required /> I’ve read the terms and
                    checked the guest details.
                  </label>
                </div>
              </fieldset>
              <div className="api-actions api-wide">
                <button
                  className="button button-primary"
                  disabled={action.busy || (!remaining && !attempted)}
                >
                  {action.busy
                    ? 'Confirming…'
                    : attempted
                      ? 'Retry confirmation'
                      : 'Confirm free booking'}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  disabled={action.busy || attempted}
                  onClick={() => void action.run(changeDate)}
                >
                  Change date or group
                </button>
              </div>
              {attempted && !action.busy && (
                <p className="api-wide">
                  We haven’t received confirmation yet. Retry with the same
                  details to check your booking safely.
                </p>
              )}
            </form>
          </>
        )}
      </section>
      <aside className="booking-summary">
        <Artwork experience={experience} />
        <div>
          <p className="eyebrow">{experience.area}</p>
          <h2>{experience.title}</h2>
          <p>With {experience.hostName}</p>
          {selected && (
            <div className="booking-slot-summary">
              <SlotTime slot={selected} />
              <span>
                {quantity} {quantity === 1 ? 'person' : 'people'}
              </span>
            </div>
          )}
          <div className="booking-total">
            <span>Total</span>
            <strong>
              {experience.pricePaise === 0
                ? 'Free'
                : money(experience.pricePaise * quantity)}
            </strong>
          </div>
          <p>
            {experience.pricePaise === 0
              ? 'No payment needed. Your ticket appears after confirmation.'
              : 'Paid booking is not available yet.'}
          </p>
        </div>
      </aside>
    </div>
  );
}
