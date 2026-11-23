import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  ChatMessage,
  GroupMember,
  GroupMembership,
} from '../api/community';
import type { BookingSummary } from '../api/bookings';
import { bookingDate, bookingTime } from '../api/bookings';
import { useAction, useApi, useResource, useSession } from '../api/react';
import { dateLabel } from '../lib/booking';
import { useDemo } from '../features/DemoState';
import type { CommunityEvent } from '../features/community/model';
import {
  FeatureBack,
  MissingEvent,
} from '../features/community/CommunityParts';
import { ErrorNotice, Loading } from './shared';

// New messages are fetched while the chat is open and the tab is visible.
const CHAT_POLL_MS = 4000;

const eventEnd = (e: CommunityEvent) =>
  Date.parse(`${e.date}T${e.end}:00+05:30`);
const eventStart = (e: CommunityEvent) =>
  Date.parse(`${e.date}T${e.start}:00+05:30`);

/** Host tools on a published event: confirm requests, remove people. */
export function GroupManage({ event }: { event: CommunityEvent }) {
  const api = useApi();
  const action = useAction();
  const result = useResource<GroupMember[]>(
    `/community/events/${event.id}/members`,
    true,
  );
  const members = result.data ?? [];
  const closed = event.status === 'cancelled';
  const confirmed = members.filter((m) => m.status === 'confirmed').length;
  const decide = (member: GroupMember, decision: 'confirm' | 'decline') =>
    void action.run(async () => {
      const response = await api.request<GroupMember[]>(
        `/community/events/${event.id}/members/${member.userId}/${decision}`,
        { method: 'POST', private: true, body: {} },
      );
      result.replace(response.data);
    });
  return (
    <section className="feature-panel event-management">
      <h2>Manage your group</h2>
      <p>
        {confirmed} confirmed · {Math.max(0, event.capacity - confirmed)} places
        remaining
      </p>
      <p className="muted">
        {event.approval
          ? 'Confirm each request. Only confirmed people can see and send messages in the group chat.'
          : 'People who join are confirmed while places remain; others wait and move up when a place frees. Only confirmed people can use the group chat.'}
      </p>
      {result.loading && <Loading />}
      <ErrorNotice error={result.error ?? action.error} retry={result.reload} />
      {(['requested', 'confirmed', 'waiting'] as const).map((status) => {
        const list = members.filter((m) => m.status === status);
        return (
          <section key={status}>
            <h3>
              {status === 'requested'
                ? 'Requests'
                : status === 'confirmed'
                  ? 'Confirmed'
                  : 'Waiting list'}
            </h3>
            {list.length === 0 && <p className="muted">Nobody here yet.</p>}
            {list.map((m) => (
              <div className="feature-list-row" key={m.userId}>
                <span>{m.name}</span>
                <div className="guest-actions">
                  {status !== 'confirmed' && (
                    <button
                      className="button button-secondary"
                      disabled={closed || action.busy}
                      aria-label={`Confirm ${m.name}`}
                      onClick={() => decide(m, 'confirm')}
                    >
                      Confirm
                    </button>
                  )}
                  <button
                    className="button button-secondary"
                    disabled={closed || action.busy}
                    aria-label={`${status === 'requested' ? 'Decline' : 'Remove'} ${m.name}`}
                    onClick={() => decide(m, 'decline')}
                  >
                    {status === 'requested' ? 'Decline' : 'Remove'}
                  </button>
                </div>
              </div>
            ))}
          </section>
        );
      })}
    </section>
  );
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const seen = new Set(current.map((m) => m.id));
  return [...current, ...incoming.filter((m) => !seen.has(m.id))].sort(
    (a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1),
  );
}

/** The group chat: the host and confirmed members only. */
export function GroupChat() {
  const { id = '' } = useParams();
  const { state } = useDemo();
  const event = state.events.find((e) => e.id === id);
  const membership = useResource<GroupMembership>(
    event?.revision ? `/community/events/${id}/membership` : null,
    true,
  );
  if (!event) return <MissingEvent />;
  const back = `/community/events/${event.id}`;
  if (!event.revision || (membership.data && !membership.data.canChat))
    return (
      <div className="page feature-page form-page">
        <FeatureBack to={back} children="event" />
        <h1>
          {membership.data?.status === 'requested'
            ? 'Waiting for the host to confirm you'
            : membership.data?.status === 'waiting'
              ? 'You’re on the waiting list'
              : 'Join this event to open chat'}
        </h1>
        <p>
          The group chat is open to the host and the people they have confirmed.
          It opens for you as soon as you’re confirmed.
        </p>
        <Link className="button button-primary" to={back}>
          View event
        </Link>
      </div>
    );
  return (
    <div className="page feature-page form-page">
      <FeatureBack to={back} children="event" />
      <h1>{event.title}</h1>
      <p className="muted">
        Group chat · only the host and confirmed members can read and send
        messages.
      </p>
      {membership.loading && <Loading />}
      <ErrorNotice error={membership.error} retry={membership.reload} />
      {membership.data?.canChat && (
        <ChatRoom eventId={event.id} readOnly={event.status === 'cancelled'} />
      )}
    </div>
  );
}

function ChatRoom({
  eventId,
  readOnly,
}: {
  eventId: string;
  readOnly: boolean;
}) {
  const api = useApi();
  const action = useAction();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<Error>();
  const [text, setText] = useState('');
  const last = useRef<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    let timer: number | undefined;
    const controller = new AbortController();
    async function poll() {
      if (document.visibilityState === 'visible') {
        try {
          const response = await api.request<ChatMessage[]>(
            `/community/events/${eventId}/messages` +
              (last.current ? `?after=${last.current}` : ''),
            { private: true, signal: controller.signal },
          );
          if (stopped) return;
          if (response.data.length) {
            last.current = response.data.at(-1)!.id;
            setMessages((current) => mergeMessages(current, response.data));
          }
          setLoaded(true);
          setLoadError(undefined);
        } catch (failure) {
          if (stopped || controller.signal.aborted) return;
          setLoadError(
            failure instanceof Error
              ? failure
              : new Error('Could not load messages.'),
          );
        }
      }
      if (!stopped) timer = window.setTimeout(poll, CHAT_POLL_MS);
    }
    void poll();
    return () => {
      stopped = true;
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [api, eventId]);

  useEffect(() => {
    end.current?.scrollIntoView?.({ block: 'nearest' });
  }, [messages.length]);

  return (
    <>
      {!loaded && !loadError && <Loading />}
      <ErrorNotice error={loadError} />
      <div
        className="chat-log"
        role="log"
        aria-label="Group messages"
        aria-live="polite"
      >
        {loaded && messages.length === 0 && (
          <p className="muted">No messages yet. Say hello to the group.</p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              'chat-message' +
              (m.mine ? ' mine' : m.host ? ' announcement' : '')
            }
          >
            <strong>
              {m.mine ? 'You' : m.author}
              {m.host ? ' · Host' : ''}
            </strong>
            <p>{m.body}</p>
            <small>
              {new Date(m.createdAt).toLocaleString('en-IN', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </small>
          </div>
        ))}
        <div ref={end} />
      </div>
      {readOnly ? (
        <p role="status" className="feature-panel">
          This event is cancelled. The group chat is read-only.
        </p>
      ) : (
        <form
          className="feature-form"
          onSubmit={(ev) => {
            ev.preventDefault();
            const body = text.trim();
            if (!body) return;
            void action.run(async () => {
              const response = await api.request<ChatMessage>(
                `/community/events/${eventId}/messages`,
                { method: 'POST', private: true, body: { body } },
              );
              setMessages((current) => mergeMessages(current, [response.data]));
              setText('');
            });
          }}
        >
          <label>
            Message
            <textarea
              maxLength={1000}
              value={text}
              onChange={(ev) => setText(ev.target.value)}
              placeholder="Write to the group"
            />
          </label>
          <ErrorNotice error={action.error} />
          <button
            className="button button-primary"
            disabled={action.busy || !text.trim()}
          >
            {action.busy ? 'Sending…' : 'Send'}
          </button>
        </form>
      )}
    </>
  );
}

type Plan = {
  key: string;
  at: number;
  title: string;
  when: string;
  tag: string;
  links: { to: string; label: string }[];
};

/** Community tab: your upcoming trips, tickets and groups in one place. */
export function UpcomingPlans() {
  const { user } = useSession();
  const { state } = useDemo();
  const bookings = useResource<BookingSummary[]>(
    user ? '/me/bookings?status=upcoming' : null,
    true,
  );
  if (!user) return null;
  const now = Date.now();
  const plans: Plan[] = [
    ...(bookings.data ?? []).map((b) => ({
      key: 'b' + b.id,
      at: Date.parse(b.startsAt),
      title: b.title,
      when: `${bookingDate(b.startsAt)} · ${bookingTime(b.startsAt)} IST`,
      tag: `Booked · ${b.quantity} ${b.quantity === 1 ? 'person' : 'people'}`,
      links: [{ to: '/essentials/bookings/' + b.id, label: 'View ticket' }],
    })),
    ...state.events
      .filter(
        (e) =>
          e.revision &&
          e.status === 'published' &&
          eventEnd(e) > now &&
          (e.mine || state.memberships[e.id]),
      )
      .map((e) => {
        const membership = state.memberships[e.id];
        const chat = e.mine || membership === 'joined';
        return {
          key: 'e' + e.id,
          at: eventStart(e),
          title: e.title,
          when: `${dateLabel(e.date)} · ${e.start} IST`,
          tag: e.mine
            ? 'Hosting'
            : membership === 'joined'
              ? 'Confirmed'
              : membership === 'waiting'
                ? 'Waiting list'
                : 'Waiting for host',
          links: [
            { to: `/community/events/${e.id}`, label: 'View event' },
            ...(chat
              ? [
                  {
                    to: `/community/events/${e.id}/chat`,
                    label: 'Group chat',
                  },
                ]
              : []),
          ],
        };
      }),
  ].sort((a, b) => a.at - b.at);
  if (!plans.length) return null;
  return (
    <section className="feature-panel" aria-labelledby="upcoming-plans">
      <h2 id="upcoming-plans">Your upcoming plans</h2>
      {plans.map((plan) => (
        <div className="feature-list-row" key={plan.key}>
          <span>
            <strong>{plan.title}</strong>
            <br />
            <span className="muted">
              {plan.when} · {plan.tag}
            </span>
          </span>
          <span className="guest-actions">
            {plan.links.map((link) => (
              <Link key={link.to} className="text-link" to={link.to}>
                {link.label}
              </Link>
            ))}
          </span>
        </div>
      ))}
    </section>
  );
}
