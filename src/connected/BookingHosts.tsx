import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAction, useApi, useResource } from '../api/react';
import type { OwnedExperience } from '../api/types';
import type { Attendance, BookingSlot } from '../api/bookings';
import { BookingHeading, BookingPage, SlotTime } from './bookingShared';
import { Empty, ErrorNotice, Loading, money, PagedList } from './shared';

export function HostDates() {
  const { id = '' } = useParams();
  return (
    <BookingPage>
      <Dates key={id} id={id} />
    </BookingPage>
  );
}
function Dates({ id }: { id: string }) {
  const result = useResource<OwnedExperience>('/me/experiences/' + id, true);
  const [version, setVersion] = useState(0);
  return (
    <>
      <BookingHeading
        back="/hosting/experiences"
        label="Your experiences"
        title="Make room for a good day."
      >
        <p>{result.data?.title}</p>
      </BookingHeading>
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
      {result.data && (
        <>
          {result.data.status === 'published' && !result.data.isDemo ? (
            <CreateDate
              experience={result.data}
              onDone={() => setVersion((value) => value + 1)}
            />
          ) : (
            <Empty>
              Dates can be added once your host profile and experience are
              approved.
            </Empty>
          )}
          <h2>Your dates</h2>
          <PagedList<BookingSlot>
            key={version}
            path={'/me/experiences/' + id + '/slots'}
            privateRequest
            render={(slot) => (
              <Link
                className="booking-list-card"
                to={'/hosting/slots/' + slot.id}
              >
                <div className="booking-slot-summary">
                  <span className="booking-status">{slot.status}</span>
                  <SlotTime slot={slot} />
                  <p>
                    {slot.availablePlaces} of {slot.capacity} places available ·{' '}
                    {slot.pricePaise === 0 ? 'Free' : money(slot.pricePaise)}
                  </p>
                  <span className="text-link">Manage date & guests →</span>
                </div>
              </Link>
            )}
          />
        </>
      )}
    </>
  );
}
function CreateDate({
  experience,
  onDone,
}: {
  experience: OwnedExperience;
  onDone: () => void;
}) {
  const api = useApi();
  const action = useAction();
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<object | undefined>(undefined);
  return (
    <details className="booking-create-date">
      <summary>Add a date</summary>
      <p>
        All times are in India time (IST). Price and duration come from your
        approved experience.
      </p>
      <ErrorNotice error={action.error} />
      {action.message && <p role="status">{action.message}</p>}
      <form
        className="api-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const fields = new FormData(form);
          void action.run(async () => {
            if (!attempt.current) {
              const startsAt = new Date(
                String(fields.get('startsAt')) + ':00+05:30',
              );
              const deadline = new Date(
                String(fields.get('bookingDeadline')) + ':00+05:30',
              );
              if (
                !Number.isFinite(+startsAt) ||
                !Number.isFinite(+deadline) ||
                +startsAt <= Date.now() ||
                +deadline <= Date.now() ||
                +deadline > +startsAt
              )
                throw new Error(
                  'Choose a future start and a booking deadline before it.',
                );
              attempt.current = {
                requestKey: crypto.randomUUID(),
                startsAt: startsAt.toISOString(),
                endsAt: new Date(
                  +startsAt + experience.durationMinutes! * 60000,
                ).toISOString(),
                bookingDeadline: deadline.toISOString(),
                timezone: 'Asia/Kolkata',
                capacity: Number(fields.get('capacity')),
                cancellationHours: Number(fields.get('cancellationHours')),
                rescheduleHours: Number(fields.get('rescheduleHours')),
              };
            }
            try {
              await api.request('/me/experiences/' + experience.id + '/slots', {
                method: 'POST',
                private: true,
                body: attempt.current,
              });
              attempt.current = undefined;
              setUncertain(false);
              form.reset();
              onDone();
            } catch (error) {
              if (
                error instanceof ApiError &&
                error.status >= 400 &&
                error.status < 500
              ) {
                attempt.current = undefined;
                setUncertain(false);
              } else setUncertain(true);
              throw error;
            }
          }, 'Date added.');
        }}
      >
        <fieldset
          className="api-form api-wide"
          disabled={action.busy || uncertain}
        >
          <legend>Date and places</legend>
          <label>
            Start date & time (IST)
            <input type="datetime-local" name="startsAt" required />
          </label>
          <label>
            Bookings close (IST)
            <input type="datetime-local" name="bookingDeadline" required />
          </label>
          <label>
            Places
            <input
              type="number"
              name="capacity"
              min={experience.minParticipants}
              max={experience.maxParticipants}
              defaultValue={experience.maxParticipants}
              required
            />
          </label>
          <div>
            <p>
              {experience.durationMinutes} minutes ·{' '}
              {experience.pricePaise === 0
                ? 'Free'
                : money(experience.pricePaise ?? 0) + ' per person'}
            </p>
          </div>
          <label>
            Cancellation deadline (hours before start)
            <input
              type="number"
              name="cancellationHours"
              min={0}
              max={720}
              defaultValue={24}
              required
            />
          </label>
          <label>
            Date-change deadline (hours before start)
            <input
              type="number"
              name="rescheduleHours"
              min={0}
              max={720}
              defaultValue={24}
              required
            />
          </label>
        </fieldset>
        <p className="api-wide">
          Guests see these deadlines before booking. Date, time and terms cannot
          be edited later. Paid dates cannot accept reservations yet.
        </p>
        <div className="api-actions api-wide">
          <button className="button button-primary" disabled={action.busy}>
            {action.busy
              ? 'Adding date…'
              : uncertain
                ? 'Retry adding date'
                : 'Add date'}
          </button>
        </div>
      </form>
    </details>
  );
}
export function HostBookingDate() {
  const { id = '' } = useParams();
  return (
    <BookingPage>
      <DateWorkspace key={id} id={id} />
    </BookingPage>
  );
}
function DateWorkspace({ id }: { id: string }) {
  const result = useResource<BookingSlot & { experienceId: string }>(
    '/me/slots/' + id,
    true,
  );
  const experience = useResource<OwnedExperience>(
    result.data ? '/me/experiences/' + result.data.experienceId : null,
    true,
  );
  const [version, setVersion] = useState(0);
  const reload = () => {
    result.reload();
    setVersion((value) => value + 1);
  };
  return (
    <>
      <BookingHeading
        back={
          result.data
            ? '/hosting/experiences/' + result.data.experienceId + '/dates'
            : '/hosting/experiences'
        }
        label="Your dates"
        title="Ready to welcome your guests."
      >
        <p>{experience.data?.title}</p>
      </BookingHeading>
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
      <ErrorNotice error={experience.error} retry={experience.reload} />
      {result.data && (
        <>
          <div className="booking-layout">
            <section className="booking-main">
              <div className="booking-slot-summary">
                <SlotTime slot={result.data} />
                <p>
                  {result.data.availablePlaces} of {result.data.capacity} places
                  available
                </p>
                <span className="booking-status">{result.data.status}</span>
              </div>
              <DateControls
                key={result.data.revision}
                slot={result.data}
                maximum={
                  experience.data?.maxParticipants ?? result.data.capacity
                }
                onDone={(updated) => {
                  result.replace({
                    ...updated,
                    experienceId: result.data!.experienceId,
                  });
                  setVersion((value) => value + 1);
                }}
                reload={reload}
              />
            </section>
            <CheckIn onDone={() => setVersion((value) => value + 1)} />
          </div>
          <h2>Guest list</h2>
          <PagedList<Attendance>
            key={version}
            path={'/me/slots/' + id + '/bookings'}
            privateRequest
            render={(row) => (
              <GuestRow
                row={row}
                finished={Date.parse(result.data!.endsAt) <= Date.now()}
                onDone={reload}
              />
            )}
          />
        </>
      )}
    </>
  );
}
function DateControls({
  slot,
  maximum,
  onDone,
  reload,
}: {
  slot: BookingSlot;
  maximum: number;
  onDone: (slot: BookingSlot) => void;
  reload: () => void;
}) {
  const api = useApi();
  const action = useAction();
  const [capacity, setCapacity] = useState(String(slot.capacity));
  const [status, setStatus] = useState(slot.status);
  return (
    <>
      {slot.status !== 'cancelled' && (
        <>
          <ErrorNotice error={action.error} />
          <form
            className="api-form"
            onSubmit={(event) => {
              event.preventDefault();
              void action.run(async () => {
                const response = await api.request<BookingSlot>(
                  '/me/slots/' + slot.id,
                  {
                    method: 'PUT',
                    private: true,
                    body: {
                      revision: slot.revision,
                      capacity: Number(capacity),
                      status,
                    },
                  },
                );
                onDone(response.data);
              });
            }}
          >
            <label>
              Places
              <input
                name="capacity"
                type="number"
                required
                min={1}
                max={maximum}
                value={capacity}
                onChange={(event) => setCapacity(event.target.value)}
                disabled={action.busy}
              />
            </label>
            <label>
              Reservations
              <select
                name="status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as 'open' | 'closed')
                }
                disabled={action.busy}
              >
                <option value="open">Open</option>
                <option value="closed">Closed to new bookings</option>
              </select>
            </label>
            <div className="api-actions api-wide">
              <button
                className="button button-secondary"
                disabled={action.busy}
              >
                Save date settings
              </button>
            </div>
          </form>
          <details className="booking-terms">
            <summary>Cancel this date</summary>
            <p>
              This cancels every booking for this date and revokes all tickets.
              Use this for weather or host cancellations.
            </p>
            <form
              className="api-form"
              onSubmit={(event) => {
                event.preventDefault();
                const fields = new FormData(event.currentTarget);
                void action.run(async () => {
                  const response = await api.request<BookingSlot>(
                    '/me/slots/' + slot.id + '/cancel',
                    {
                      method: 'POST',
                      private: true,
                      body: {
                        revision: slot.revision,
                        reason: String(fields.get('reason')).trim(),
                      },
                    },
                  );
                  onDone(response.data);
                });
              }}
            >
              <label className="api-wide">
                Cancellation reason
                <input
                  name="reason"
                  required
                  maxLength={1000}
                  pattern=".*\S.*"
                  disabled={action.busy}
                />
              </label>
              <label className="api-check api-wide">
                <input type="checkbox" required disabled={action.busy} /> I
                understand that all bookings for this date will be cancelled.
              </label>
              <button className="button button-primary" disabled={action.busy}>
                Cancel date and bookings
              </button>
            </form>
          </details>
          {action.error && (
            <button
              className="booking-text-button"
              onClick={reload}
              disabled={action.busy}
            >
              Reload latest date
            </button>
          )}
        </>
      )}
    </>
  );
}
function CheckIn({ onDone }: { onDone: () => void }) {
  const api = useApi();
  const action = useAction();
  const [receipt, setReceipt] = useState<{
    reference: string;
    quantity: number;
  }>();
  return (
    <aside className="booking-ticket">
      <h2>Welcome your guests.</h2>
      <p>
        Scan the guest’s QR with a ticket scanner, or paste their ticket code
        below. One check-in covers the whole group.
      </p>
      <ErrorNotice error={action.error} />
      <form
        className="api-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const fields = new FormData(form);
          setReceipt(undefined);
          void action.run(async () => {
            const response = await api.request<{
              reference: string;
              quantity: number;
            }>('/me/check-ins', {
              method: 'POST',
              private: true,
              body: { token: String(fields.get('token')).trim() },
            });
            setReceipt(response.data);
            form.reset();
            onDone();
          });
        }}
      >
        <label className="api-wide">
          Ticket code
          <input
            name="token"
            required
            pattern="[a-f0-9]{64}"
            minLength={64}
            maxLength={64}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={action.busy}
          />
        </label>
        <button
          className="button button-primary api-wide"
          disabled={action.busy}
        >
          {action.busy ? 'Checking ticket…' : 'Check in group'}
        </button>
      </form>
      {receipt && (
        <p role="status">
          Checked in {receipt.quantity}{' '}
          {receipt.quantity === 1 ? 'person' : 'people'}. Reference{' '}
          {receipt.reference}.
        </p>
      )}
    </aside>
  );
}
function GuestRow({
  row,
  finished,
  onDone,
}: {
  row: Attendance;
  finished: boolean;
  onDone: () => void;
}) {
  const api = useApi();
  const action = useAction();
  return (
    <article className="booking-list-card">
      <div>
        <span className="booking-status">
          {row.ticketStatus === 'checked_in'
            ? 'Checked in'
            : row.status.replaceAll('_', ' ')}
        </span>
        <h3>{row.contactName}</h3>
        <p>
          {row.quantity} {row.quantity === 1 ? 'person' : 'people'} ·{' '}
          {row.guests.join(', ')}
        </p>
        <p className="booking-reference">{row.reference}</p>
        <ErrorNotice error={action.error} />
        {finished &&
          row.status === 'confirmed' &&
          row.ticketStatus !== 'checked_in' && (
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api.request(
                    '/me/host-bookings/' + row.id + '/no-show',
                    {
                      method: 'POST',
                      private: true,
                      body: { revision: row.revision },
                    },
                  );
                  onDone();
                })
              }
            >
              Mark as no-show
            </button>
          )}
      </div>
    </article>
  );
}
