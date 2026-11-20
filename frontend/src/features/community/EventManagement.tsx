import { useState } from 'react';
import { useDemo } from '../DemoState';
import type { CommunityEvent, Guest } from './model';

export function EventManagement({ event }: { event: CommunityEvent }) {
  const { update } = useDemo();
  const [notice, setNotice] = useState('');
  const guests = event.guests ?? [];
  const closed = event.status === 'cancelled';
  const change = (fn: (guests: Guest[], event: CommunityEvent) => Guest[]) =>
    update((state) => ({
      ...state,
      events: state.events.map((e) => {
        if (e.id !== event.id || e.status === 'cancelled') return e;
        const next = fn(e.guests ?? [], e);
        return {
          ...e,
          guests: next,
          attendees: next.filter((g) => g.status === 'joined').length,
        };
      }),
    }));
  const add = () =>
    change((list, e) =>
      list.length >= 60
        ? list
        : [
            ...list,
            {
              id: crypto.randomUUID(),
              name: `Sample guest ${Math.max(0, ...list.map((g) => Number(g.name.replace('Sample guest ', '')) || 0)) + 1}`,
              status: e.approval
                ? 'requested'
                : e.attendees < e.capacity
                  ? 'joined'
                  : 'waiting',
            },
          ],
    );
  const remove = (id: string) =>
    change((list) => {
      const wasJoined = list.find((g) => g.id === id)?.status === 'joined';
      const next = list.filter((g) => g.id !== id);
      const first = wasJoined
        ? next.find((g) => g.status === 'waiting')?.id
        : undefined;
      return next.map((g) => (g.id === first ? { ...g, status: 'joined' } : g));
    });
  return (
    <section className="feature-panel event-management">
      <h2>Manage your gathering</h2>
      <p>
        {event.attendees} participants · {event.capacity - event.attendees}{' '}
        places remaining
      </p>
      <p className="demo-caption">
        Simulate guests on this browser. Removing a participant gives their
        place to the first person waiting. No real people are contacted.
      </p>
      {(['requested', 'joined', 'waiting'] as const).map((status) => (
        <section key={status}>
          <h3>
            {status === 'requested'
              ? 'Requests'
              : status === 'joined'
                ? 'Participants'
                : 'Waiting list'}
          </h3>
          {guests.filter((g) => g.status === status).length === 0 && (
            <p className="muted">Nobody here yet.</p>
          )}
          {guests
            .filter((g) => g.status === status)
            .map((g) => (
              <div className="feature-list-row" key={g.id}>
                <span>{g.name}</span>
                <div className="guest-actions">
                  {status === 'requested' && (
                    <button
                      className="button button-secondary"
                      disabled={closed}
                      aria-label={`Approve ${g.name}`}
                      onClick={() =>
                        change((list, e) =>
                          list.map((x) =>
                            x.id === g.id
                              ? {
                                  ...x,
                                  status:
                                    e.attendees < e.capacity
                                      ? 'joined'
                                      : 'waiting',
                                }
                              : x,
                          ),
                        )
                      }
                    >
                      Approve
                    </button>
                  )}
                  <button
                    className="button button-secondary"
                    disabled={closed}
                    aria-label={`${status === 'requested' ? 'Decline' : 'Remove'} ${g.name}`}
                    onClick={() => remove(g.id)}
                  >
                    {status === 'requested' ? 'Decline' : 'Remove'}
                  </button>
                </div>
              </div>
            ))}
        </section>
      ))}
      <div className="feature-actions">
        <button
          className="button button-secondary"
          disabled={closed || guests.length >= 60}
          onClick={add}
        >
          {event.approval
            ? 'Simulate a join request'
            : 'Simulate a guest joining'}
        </button>
        <button
          className="button button-secondary"
          disabled={closed}
          onClick={() =>
            setNotice(
              'Announcement saved on this device. No notification was sent.',
            )
          }
        >
          Try notifying everyone
        </button>
      </div>
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
