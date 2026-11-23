import { Link, useSearchParams } from 'react-router-dom';
import { DemoNotice, useDemo, joinedCount } from '../features/DemoState';
import { EventCard } from '../features/community/CommunityParts';
import { interests, isUpcoming } from '../features/community/model';
export function Community({
  stories,
  plans,
}: {
  stories?: import('react').ReactNode;
  /** Signed-in app: your upcoming bookings and groups. */
  plans?: import('react').ReactNode;
}) {
  const { state } = useDemo();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'Upcoming';
  const interest = params.get('interest') ?? 'All';
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    setParams(next, { preventScrollReset: true });
  };
  let list = state.events.filter(
    (e) =>
      e.status !== 'cancelled' &&
      (interest === 'All' || e.interest === interest),
  );
  if (tab === 'Live') list = list.filter((e) => e.live);
  else if (tab === 'Upcoming') list = list.filter((e) => isUpcoming(e));
  else if (tab === 'Popular')
    list = [...list].sort(
      (a, b) =>
        joinedCount(state, b) / b.capacity - joinedCount(state, a) / a.capacity,
    );
  else if (tab === 'Joined') list = list.filter((e) => state.memberships[e.id]);
  else if (tab === 'Created') list = list.filter((e) => e.mine);
  else if (tab === 'Saved')
    list = list.filter((e) => state.saved.includes(e.id));
  if (tab === 'Created')
    list = state.events.filter(
      (e) => e.mine && (interest === 'All' || e.interest === interest),
    );
  return (
    <div className="page feature-page community-page">
      <header className="feature-row">
        <div>
          <p className="muted">Community</p>
          <h1>What’s happening</h1>
        </div>
        <Link className="button button-primary" to="/community/create">
          + Create
        </Link>
      </header>
      {plans}
      <div className="feature-tabs" role="group" aria-label="Event filter">
        {['Live', 'Upcoming', 'Popular', 'Joined', 'Created', 'Saved'].map(
          (t) => (
            <button
              key={t}
              aria-pressed={tab === t}
              onClick={() => change('tab', t)}
            >
              {t}
            </button>
          ),
        )}
      </div>
      {stories ?? (
        <section className="community-stories" aria-label="Host stories">
          <h2>Community stories</h2>
          <div className="story-rail">
            {state.events
              .filter((e) => !e.mine && e.status !== 'cancelled')
              .slice(0, 6)
              .map((e) => (
                <Link
                  key={e.id}
                  to={`/community/stories/${e.id}`}
                  aria-label={`Story from ${e.host}`}
                >
                  <span
                    className={`story-avatar ${state.seen.includes(e.id) ? 'seen' : ''}`}
                  >
                    <img src={e.image} alt="" />
                  </span>
                  <span>{e.host}</span>
                </Link>
              ))}
          </div>
        </section>
      )}
      <div
        className="feature-tabs interest-tabs"
        role="group"
        aria-label="Event interests"
      >
        {['All', ...interests].map((t) => (
          <button
            key={t}
            aria-pressed={interest === t}
            onClick={() => change('interest', t)}
          >
            {t}
          </button>
        ))}
      </div>
      <DemoNotice />
      {list.length ? (
        <div className="event-grid">
          {list.map((e) => (
            <EventCard key={e.id} event={e} />
          ))}
        </div>
      ) : (
        <section className="feature-panel empty-feature">
          <h2>
            {tab === 'Live' ? 'Nothing live right now' : 'No events here yet'}
          </h2>
          <p>Try another filter or create a gathering.</p>
          <Link className="button button-secondary" to="/community/create">
            Create an event
          </Link>
        </section>
      )}
    </div>
  );
}
