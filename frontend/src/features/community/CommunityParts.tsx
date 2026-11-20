import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { formatPrice } from '../../data/experiences';
import { dateLabel } from '../../lib/booking';
import { joinedCount, useDemo } from '../DemoState';
import type { CommunityEvent } from './model';
export function EventCard({ event: e }: { event: CommunityEvent }) {
  const { state, update } = useDemo();
  const saved = state.saved.includes(e.id);
  return (
    <article className="event-card">
      <Link
        className="event-art"
        to={`/community/events/${e.id}`}
        tabIndex={-1}
        aria-hidden="true"
      >
        <img src={e.image} alt="" loading="lazy" />
        <span className="event-badge">
          {e.status === 'cancelled'
            ? 'Cancelled'
            : e.live
              ? 'Live'
              : e.interest}
        </span>
      </Link>
      <div className="event-card-copy">
        <div className="feature-row">
          <span className="muted">
            {e.host} · {e.area}
          </span>
          <button
            className="icon-button"
            aria-label={`${saved ? 'Unsave' : 'Save'} event ${e.title}`}
            aria-pressed={saved}
            onClick={() =>
              update((s) => ({
                ...s,
                saved: saved
                  ? s.saved.filter((id) => id !== e.id)
                  : [...s.saved, e.id],
              }))
            }
          >
            <Icon name="bookmark" />
          </button>
        </div>
        <h2>
          <Link to={`/community/events/${e.id}`}>{e.title}</Link>
        </h2>
        <p>
          {dateLabel(e.date)} · {e.start}–{e.end} IST
        </p>
        <div className="feature-row">
          <span>
            {joinedCount(state, e)}/{e.capacity} joined
          </span>
          <strong>{e.price ? formatPrice(e.price) : 'Free'}</strong>
        </div>
        {state.memberships[e.id] && (
          <p className="membership-status">
            {
              {
                joined: 'Joined',
                requested: 'Awaiting host approval',
                waiting: 'On the waiting list',
              }[state.memberships[e.id]!]
            }
          </p>
        )}
        <div className="capacity-bar" aria-hidden="true">
          <span
            style={{
              width: `${Math.min(100, (joinedCount(state, e) / e.capacity) * 100)}%`,
            }}
          />
        </div>
      </div>
    </article>
  );
}
export function FeatureBack({
  to = '/community',
  children = 'Community',
}: {
  to?: string;
  children?: string;
}) {
  return (
    <Link className="text-link feature-back" to={to}>
      <Icon name="arrow-left" size={18} />
      Back to {children}
    </Link>
  );
}
export function MissingEvent() {
  return (
    <div className="page feature-page">
      <FeatureBack />
      <h1>Event not found</h1>
      <p>This event may have been removed. Choose another from Community.</p>
    </div>
  );
}
