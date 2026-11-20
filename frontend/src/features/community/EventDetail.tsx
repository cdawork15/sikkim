import { EventPhotos } from './EventPhotos';
import { EventManagement } from './EventManagement';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatPrice } from '../../data/experiences';
import { dateLabel } from '../../lib/booking';
import {
  chatAllowed,
  DemoNotice,
  joinedCount,
  joinEvent,
  useDemo,
} from '../DemoState';
import { canJoin } from './model';
import { FeatureBack, MissingEvent } from './CommunityParts';

export function EventDetail() {
  const { id } = useParams();
  const { state, update, canWrite, remoteEvents } = useDemo();
  const event = state.events.find((e) => e.id === id);
  const [confirm, setConfirm] = useState<'pay' | 'leave' | 'cancel' | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  if (!event) return <MissingEvent />;
  const e = event;
  const membership = state.memberships[e.id];
  const count = joinedCount(state, e);
  const full = count >= e.capacity;
  const leave = () => {
    update((s) => {
      const memberships = { ...s.memberships };
      delete memberships[e.id];
      return { ...s, memberships };
    });
    setConfirm(null);
  };
  const join = () => {
    update((s) => joinEvent(s, e.id));
    setConfirm(null);
  };
  return (
    <div className="page feature-page event-detail">
      <FeatureBack />
      <div className="event-detail-layout">
        <div>
          <EventPhotos
            key={e.id}
            photos={e.images?.length ? e.images : [e.image]}
            title={e.title}
          />
          <span className="event-badge">{e.live ? 'Live' : e.interest}</span>
        </div>
        <article>
          <h1>{e.title}</h1>
          {remoteEvents && e.mine && !e.revision && (
            <p role="status">
              This event is saved only on this device. Edit it and select
              Publish event to share it with everyone.
            </p>
          )}
          <p className="feature-host">Hosted by {e.mine ? 'you' : e.host}</p>
          <div className="feature-panel event-facts">
            <p>
              {dateLabel(e.date)} · {e.start}–{e.end} IST
            </p>
            <p>
              {e.mine || remoteEvents
                ? e.meeting
                : `${e.area} · Meeting point to be confirmed`}
            </p>
            <strong>
              {e.price ? `${formatPrice(e.price)} per person` : 'Free event'}
            </strong>
          </div>
          <p>
            {e.mine
              ? e.description
              : e.description.replace(
                  ' This is a fictional event for trying the app.',
                  '',
                )}
          </p>
          <h2>
            {count} of {e.capacity} joined
          </h2>
          <div
            className="participant-avatars"
            role="group"
            aria-label="Participants"
          >
            {['A', 'D', 'K', 'P']
              .slice(0, Math.min(e.attendees, 4))
              .map((n) => (
                <span key={n}>{n}</span>
              ))}
            {membership === 'joined' && <span>You</span>}
          </div>
          <DemoNotice />
          {e.status === 'cancelled' ? (
            <p role="status" className="feature-panel">
              This event is cancelled. Joining and chat are closed. No money was
              charged.
            </p>
          ) : (
            <>
              {membership && (
                <p role="status" className="membership-status">
                  {membership === 'joined'
                    ? 'Joined on this device. No reservation has been made.'
                    : membership === 'requested'
                      ? 'Request saved on this device. It hasn’t been sent to a host.'
                      : 'Added to the waiting list on this device. No place is reserved.'}
                </p>
              )}
              <div className="feature-actions">
                {remoteEvents && !e.mine ? (
                  <p className="muted">Joining is not open yet.</p>
                ) : !canWrite ? (
                  <Link
                    className="button button-primary"
                    to={
                      '/welcome?next=' +
                      encodeURIComponent(`/community/events/${e.id}`)
                    }
                  >
                    Sign in to join
                  </Link>
                ) : e.mine ? (
                  <>
                    <Link
                      className="button button-primary"
                      to={`/community/events/${e.id}/edit`}
                    >
                      Edit event
                    </Link>
                    <button
                      className="button button-secondary"
                      onClick={() => setConfirm('cancel')}
                    >
                      Cancel event
                    </button>
                  </>
                ) : membership ? (
                  <button
                    className="button button-secondary"
                    onClick={() => setConfirm('leave')}
                  >
                    {membership === 'joined'
                      ? 'Leave event'
                      : 'Withdraw request'}
                  </button>
                ) : (
                  <button
                    className="button button-primary"
                    disabled={!canJoin(e)}
                    onClick={() =>
                      e.price && !full && !e.approval
                        ? setConfirm('pay')
                        : join()
                    }
                  >
                    {!canJoin(e)
                      ? 'Event ended'
                      : full
                        ? 'Join waiting list'
                        : e.approval
                          ? 'Request to join'
                          : e.price
                            ? 'Try joining'
                            : 'Join free event'}
                  </button>
                )}
                {!remoteEvents && chatAllowed(state, e) && (
                  <Link
                    className="button button-white"
                    to={`/community/events/${e.id}/chat`}
                  >
                    Open group chat
                  </Link>
                )}
              </div>
              {membership === 'requested' && (
                <button
                  className="text-link"
                  onClick={() =>
                    update((s) => {
                      const current = s.events.find((x) => x.id === e.id)!;
                      return canJoin(current)
                        ? {
                            ...s,
                            memberships: {
                              ...s.memberships,
                              [e.id]:
                                current.attendees < current.capacity
                                  ? 'joined'
                                  : 'waiting',
                            },
                          }
                        : s;
                    })
                  }
                >
                  Simulate host approval
                </button>
              )}
            </>
          )}
          {confirm && (
            <section
              className="feature-panel confirm-panel"
              aria-label="Confirm event action"
            >
              <h2>
                {confirm === 'pay'
                  ? 'Try the payment step'
                  : confirm === 'leave'
                    ? 'Leave this event?'
                    : 'Cancel this event?'}
              </h2>
              <p>
                {confirm === 'pay'
                  ? `${formatPrice(e.price)} is a sample price. No card details or payment are required.`
                  : confirm === 'leave'
                    ? 'Your place and access to group chat will be removed.'
                    : 'The event will stay in Created, marked cancelled. Joining and chat will close.'}
              </p>
              <div className="feature-actions">
                <button
                  className="button button-primary"
                  disabled={saving}
                  onClick={async () => {
                    if (confirm === 'pay') join();
                    else if (confirm === 'leave') leave();
                    else {
                      if (remoteEvents) {
                        setSaving(true);
                        setError('');
                        try {
                          await remoteEvents.cancel(e);
                          setConfirm(null);
                        } catch (failure) {
                          setError(
                            failure instanceof Error
                              ? failure.message
                              : 'Could not cancel the event.',
                          );
                        } finally {
                          setSaving(false);
                        }
                        return;
                      }
                      update((s) => ({
                        ...s,
                        events: s.events.map((x) =>
                          x.id === e.id ? { ...x, status: 'cancelled' } : x,
                        ),
                      }));
                      setConfirm(null);
                    }
                  }}
                >
                  {confirm === 'pay'
                    ? 'Continue without payment'
                    : confirm === 'leave'
                      ? 'Confirm leave'
                      : 'Confirm cancellation'}
                </button>
                <button
                  className="button button-secondary"
                  onClick={() => setConfirm(null)}
                >
                  Keep browsing
                </button>
              </div>
            </section>
          )}
          {error && <p role="alert">{error}</p>}
          {!remoteEvents && canWrite && e.mine && <EventManagement event={e} />}
        </article>
      </div>
    </div>
  );
}
