import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { ApiError } from '../api/client';
import { useAction, useApi, useResource } from '../api/react';
import type {
  Booking,
  BookingSlot,
  BookingSummary,
  BookingTicket,
} from '../api/bookings';
import { bookingDate, bookingTime, cutoffLabel } from '../api/bookings';
import { Icon } from '../components/Icon';
import { Empty, ErrorNotice, Loading, money, PagedList } from './shared';
import {
  BookingHeading,
  BookingPage,
  SlotPicker,
  SlotTime,
  useBookingClock,
} from './bookingShared';

export function MyBookings() {
  const [params, setParams] = useSearchParams();
  const status = ['upcoming', 'past', 'cancelled'].includes(
    params.get('status') ?? '',
  )
    ? params.get('status')!
    : 'upcoming';
  return (
    <BookingPage>
      <BookingHeading
        back="/essentials"
        label="Travel Essentials"
        title="Your next good memory."
      >
        <p>Your bookings and tickets, all in one place.</p>
      </BookingHeading>
      <nav className="booking-tabs" aria-label="Booking lists">
        {['upcoming', 'past', 'cancelled'].map((value) => (
          <button
            key={value}
            className={'api-chip' + (status === value ? ' active' : '')}
            aria-pressed={status === value}
            onClick={() => setParams({ status: value })}
          >
            {value.charAt(0).toUpperCase() + value.slice(1)}
          </button>
        ))}
      </nav>
      <PagedList<BookingSummary>
        path={'/me/bookings?status=' + status}
        privateRequest
        render={(item) => (
          <Link
            className="booking-list-card"
            to={'/essentials/bookings/' + item.id}
          >
            <div className="booking-list-icon">
              <Icon name="ticket" size={30} />
            </div>
            <div>
              <span className="booking-status">
                {item.status.replaceAll('_', ' ')}
              </span>
              <h2>{item.title}</h2>
              <p>
                {bookingDate(item.startsAt)} · {bookingTime(item.startsAt)} IST
              </p>
              <p>
                {item.quantity} {item.quantity === 1 ? 'person' : 'people'} ·{' '}
                {money(item.totalPaise)}
              </p>
              <span className="text-link">
                View booking <Icon name="arrow-right" size={16} />
              </span>
            </div>
          </Link>
        )}
      />
      <Link className="text-link" to="/explore?view=list">
        Find your next experience <Icon name="arrow-right" size={16} />
      </Link>
    </BookingPage>
  );
}
export function BookingDetails() {
  const { id = '' } = useParams();
  return (
    <BookingPage>
      <BookingRecord key={id} id={id} />
    </BookingPage>
  );
}
function BookingRecord({ id }: { id: string }) {
  const result = useResource<Booking>('/me/bookings/' + id, true);
  const ticket = useResource<BookingTicket>(
    '/me/bookings/' + id + '/ticket',
    true,
  );
  const [editing, setEditing] = useState<'cancel' | 'move' | null>(null);
  const reloadRef = useRef(() => {});
  reloadRef.current = () => {
    result.reload();
    ticket.reload();
  };
  useEffect(() => {
    const refresh = () => reloadRef.current();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, []);
  const booking = result.data;
  return (
    <>
      <BookingHeading
        back="/essentials/bookings"
        label="My bookings"
        title={
          booking?.status === 'confirmed' ? 'You’re going.' : 'Your booking.'
        }
      />
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
      {booking && (
        <>
          <div className="booking-layout">
            <article className="booking-main booking-record">
              <span className="booking-status">
                {booking.status.replaceAll('_', ' ')}
              </span>
              <h2>{booking.snapshot.title}</h2>
              <p>With {booking.snapshot.hostName}</p>
              <div className="booking-facts">
                <div>
                  <Icon name="clock" />
                  <div>
                    <SlotTime slot={booking.slot} />
                  </div>
                </div>
                <div>
                  <Icon name="users" />
                  <span>
                    {booking.quantity}{' '}
                    {booking.quantity === 1 ? 'person' : 'people'} ·{' '}
                    {booking.guests.join(', ')}
                  </span>
                </div>
                <div>
                  <Icon name="pin" />
                  <span>{booking.snapshot.meetingPoint}</span>
                </div>
              </div>
              <p className="booking-reference">
                Reference <strong>{booking.reference}</strong>
              </p>
              <div className="booking-total">
                <span>Total</span>
                <strong>
                  {booking.totalPaise === 0
                    ? 'Free'
                    : money(booking.totalPaise)}
                </strong>
              </div>
              {booking.status === 'confirmed' &&
                ticket.data?.status !== 'checked_in' && (
                  <div className="api-actions booking-no-print">
                    <button
                      className="button button-secondary"
                      onClick={() => setEditing('move')}
                    >
                      Change date
                    </button>
                    <button
                      className="booking-text-button"
                      onClick={() => setEditing('cancel')}
                    >
                      Cancel booking
                    </button>
                  </div>
                )}
              <section className="booking-terms">
                <h3>Before you go</h3>
                <p>{booking.snapshot.preparation}</p>
                <p>{booking.snapshot.policy.safety}</p>
                <h3>Your booking terms</h3>
                <p>{booking.snapshot.policy.cancellation}</p>
                <p>
                  Cancel:{' '}
                  {cutoffLabel(booking.snapshot.policy.cancellationHours)}.
                  <br />
                  Change date:{' '}
                  {cutoffLabel(booking.snapshot.policy.rescheduleHours)}.
                </p>
              </section>
            </article>
            <aside className="booking-ticket">
              <h2>Your ticket</h2>
              {ticket.loading && <Loading />}
              <ErrorNotice error={ticket.error} retry={ticket.reload} />
              {ticket.data && (
                <TicketCard ticket={ticket.data} booking={booking} />
              )}
            </aside>
          </div>
          {editing && booking.status === 'confirmed' && (
            <BookingChange
              key={editing + booking.revision}
              mode={editing}
              booking={booking}
              onClose={() => setEditing(null)}
              onDone={() => {
                setEditing(null);
                result.reload();
                ticket.reload();
              }}
            />
          )}
          <details className="booking-history booking-no-print">
            <summary>Booking updates</summary>
            {booking.history.map((event) => (
              <p key={event.id}>
                <strong>{event.action.replaceAll('_', ' ')}</strong> ·{' '}
                {bookingDate(event.createdAt)}
                <br />
                {event.reason}
              </p>
            ))}
          </details>
          <Link
            className="text-link booking-no-print"
            to={'/experiences/' + encodeURIComponent(booking.snapshot.slug)}
          >
            View experience
          </Link>
        </>
      )}
    </>
  );
}
function TicketCard({
  ticket,
  booking,
}: {
  ticket: BookingTicket;
  booking: Booking;
}) {
  const [qr, setQr] = useState<{ token: string; url: string }>();
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState('');
  const [manualShare, setManualShare] = useState(false);
  const now = useBookingClock();
  const token = ticket.verificationToken;
  const valid =
    booking.status === 'confirmed' &&
    ticket.status === 'issued' &&
    Date.parse(booking.slot.endsAt) > now;
  useEffect(() => {
    let active = true;
    setFailed(false);
    if (token)
      void QRCode.toDataURL(token, {
        width: 240,
        margin: 4,
        errorCorrectionLevel: 'M',
      }).then(
        (url) => {
          if (active) setQr({ token, url });
        },
        () => {
          if (active) setFailed(true);
        },
      );
    return () => {
      active = false;
    };
  }, [token]);
  return (
    <>
      {valid && token ? (
        <>
          <div className="booking-qr">
            {qr?.token === token ? (
              <img
                src={qr.url}
                width="240"
                height="240"
                alt="Your private booking ticket QR code"
              />
            ) : (
              <p role="status">
                {failed
                  ? 'QR unavailable. Use the ticket code below.'
                  : 'Preparing your ticket…'}
              </p>
            )}
          </div>
          <p>Show this to your host. One ticket covers your whole group.</p>
          <details className="booking-no-print">
            <summary>Show ticket code</summary>
            <label className="booking-token">
              Ticket code
              <input
                readOnly
                value={token}
                onFocus={(event) => event.target.select()}
              />
            </label>
            <p>Only share this code with your host.</p>
          </details>
        </>
      ) : (
        <Empty>
          {ticket.status === 'checked_in'
            ? 'Checked in. Enjoy your experience.'
            : booking.status === 'cancelled'
              ? 'This ticket has been cancelled.'
              : 'This ticket is no longer valid.'}
        </Empty>
      )}
      <div className="api-actions booking-no-print">
        <button
          className="button button-secondary"
          onClick={() => window.print()}
        >
          Print booking
        </button>
        <button
          className="button button-secondary"
          onClick={() =>
            void (async () => {
              try {
                if (navigator.share)
                  await navigator.share({
                    title: booking.snapshot.title,
                    text: ticket.shareText,
                  });
                else await navigator.clipboard.writeText(ticket.shareText);
                setMessage(
                  'Travel details shared. Your ticket code stays private.',
                );
              } catch (error) {
                if (error instanceof Error && error.name === 'AbortError')
                  return;
                setManualShare(true);
              }
            })()
          }
        >
          Share travel details
        </button>
      </div>
      <p role="status">{message}</p>
      {manualShare && (
        <label className="booking-token booking-no-print">
          Copy travel details
          <textarea
            readOnly
            value={ticket.shareText}
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
      <a
        className="text-link booking-no-print"
        target="_blank"
        rel="noreferrer"
        href={
          'https://www.google.com/maps/search/?api=1&query=' +
          encodeURIComponent(booking.snapshot.meetingPoint)
        }
      >
        Meeting point <Icon name="external" size={16} />
      </a>
    </>
  );
}
function BookingChange({
  booking,
  mode,
  onClose,
  onDone,
}: {
  booking: Booking;
  mode: 'cancel' | 'move';
  onClose: () => void;
  onDone: () => void;
}) {
  const api = useApi();
  const action = useAction();
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    section.current?.focus();
    section.current?.scrollIntoView({ block: 'start' });
  }, []);
  const [selected, setSelected] = useState<BookingSlot>();
  const [uncertain, setUncertain] = useState(false);
  const attempt = useRef<
    | { revision: number; reason: string; slotId?: string; requestKey?: string }
    | undefined
  >(undefined);
  const hours =
    mode === 'cancel'
      ? booking.snapshot.policy.cancellationHours
      : booking.snapshot.policy.rescheduleHours;
  const expired =
    Date.now() >= Date.parse(booking.slot.startsAt) - hours * 3600000;
  return (
    <section
      ref={section}
      tabIndex={-1}
      className="booking-change booking-no-print"
    >
      <h2>
        {mode === 'cancel' ? 'Cancel this booking?' : 'Find another date.'}
      </h2>
      <p>
        {mode === 'cancel'
          ? 'Your places will be released and the ticket will stop working.'
          : 'Your current places stay reserved until the date change succeeds.'}
      </p>
      <ErrorNotice error={action.error} />
      {expired && !uncertain ? (
        <p>The deadline in your booking terms has passed.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            attempt.current ??= {
              revision: booking.revision,
              reason: String(form.get('reason')).trim(),
              ...(mode === 'move'
                ? { slotId: selected!.id, requestKey: crypto.randomUUID() }
                : {}),
            };
            void action.run(async () => {
              try {
                await api.request(
                  '/me/bookings/' +
                    booking.id +
                    (mode === 'cancel' ? '/cancel' : '/reschedule'),
                  { method: 'POST', private: true, body: attempt.current },
                );
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
            });
          }}
        >
          {mode === 'move' && (
            <SlotPicker
              experienceId={booking.experienceId}
              quantity={booking.quantity}
              selected={selected}
              onSelect={setSelected}
              excludeId={booking.slot.id}
              policy={booking.snapshot.policy}
              disabled={action.busy || uncertain}
            />
          )}
          <div className="api-form">
            <label className="api-wide">
              Reason
              <input
                name="reason"
                required
                maxLength={1000}
                pattern=".*\S.*"
                disabled={action.busy || uncertain}
              />
            </label>
          </div>
          {uncertain && (
            <p>
              We haven’t received confirmation. Retry to check the same request.
            </p>
          )}
          <div className="api-actions">
            <button
              className="button button-primary"
              disabled={action.busy || (mode === 'move' && !selected)}
            >
              {action.busy
                ? 'Saving…'
                : uncertain
                  ? 'Retry change'
                  : mode === 'cancel'
                    ? 'Yes, cancel booking'
                    : 'Confirm new date'}
            </button>
          </div>
        </form>
      )}
      <button
        className="booking-text-button"
        disabled={action.busy || uncertain}
        onClick={onClose}
      >
        Keep my booking
      </button>
    </section>
  );
}
