import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import type { Envelope } from '../api/types';
import { useApi, useSession } from '../api/react';
import { DemoContext, useDemo } from '../features/DemoState';
import type { CommunityEvent } from '../features/community/model';

const base = (import.meta.env.VITE_API_BASE_URL || '/v1').replace(/\/$/, '');
const photoUrl = (value: string) =>
  value.startsWith('/v1/') ? base + value.slice(3) : value;
const photoReference = (value: string) =>
  value.startsWith(base + '/community/photos/')
    ? '/v1' + value.slice(base.length)
    : value;

export function SharedCommunity({ children }: { children: ReactNode }) {
  const local = useDemo();
  const client = useApi();
  const { user } = useSession();
  const { pathname } = useLocation();
  const [events, setEvents] = useState<CommunityEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const community = pathname.startsWith('/community');
  const reload = () => setRefresh((value) => value + 1);
  const adapt = (event: CommunityEvent): CommunityEvent => ({
    ...event,
    mine: !!user && event.ownerId === user.id,
    images: event.images?.map(photoUrl),
    image: photoUrl(event.image),
  });
  useEffect(() => {
    if (!community) return;
    const controller = new AbortController();
    async function load() {
      const rows: CommunityEvent[] = [];
      let after: string | null = null;
      do {
        const response: Envelope<CommunityEvent[]> = await client.request<
          CommunityEvent[]
        >('/community/events' + (after ? '?after=' + after : ''), {
          signal: controller.signal,
        });
        rows.push(...response.data);
        after = response.page?.nextCursor ?? null;
      } while (after);
      if (!controller.signal.aborted) {
        setEvents(rows);
        setError('');
        setLoaded(true);
      }
    }
    void load().catch((failure) => {
      if (!controller.signal.aborted) {
        setError(
          failure instanceof Error ? failure.message : 'Could not load events.',
        );
      }
    });
    return () => controller.abort();
  }, [client, community, pathname, refresh]);
  useEffect(() => {
    if (!community) return;
    const focus = () => {
      if (document.visibilityState === 'visible') reload();
    };
    window.addEventListener('focus', focus);
    const timer = window.setInterval(focus, 30000);
    return () => {
      window.removeEventListener('focus', focus);
      clearInterval(timer);
    };
  }, [community]);
  const replace = (event: CommunityEvent) => {
    reload();
    setEvents((current) => [
      ...current.filter((item) => item.id !== event.id),
      event,
    ]);
  };
  const remoteEvents = {
    async save(event: CommunityEvent, existing: boolean) {
      const updating = existing && !!event.revision;
      const {
        title,
        description,
        area,
        meeting,
        date,
        start,
        end,
        capacity,
        price,
        interest,
        approval,
      } = event;
      const response = await client.request<CommunityEvent>(
        '/community/events' + (updating ? '/' + event.id : ''),
        {
          method: updating ? 'PUT' : 'POST',
          private: true,
          body: {
            title,
            description,
            area,
            meeting,
            date,
            start,
            end,
            capacity,
            price,
            interest,
            approval,
            images: (event.images ?? []).map(photoReference),
            ...(updating ? { revision: event.revision } : {}),
          },
        },
      );
      replace(response.data);
      if (existing && !updating)
        local.update((state) => ({
          ...state,
          events: state.events.filter((item) => item.id !== event.id),
        }));
      return adapt(response.data);
    },
    async cancel(event: CommunityEvent) {
      if (!event.revision) {
        local.update((state) => ({
          ...state,
          events: state.events.map((item) =>
            item.id === event.id ? { ...item, status: 'cancelled' } : item,
          ),
        }));
        return;
      }
      const response = await client.request<CommunityEvent>(
        `/community/events/${event.id}/cancel`,
        {
          method: 'POST',
          private: true,
          body: { revision: event.revision },
        },
      );
      replace(response.data);
    },
  };
  if (community && !loaded)
    return (
      <section className="page feature-page" aria-live="polite">
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button className="button button-primary" onClick={reload}>
              Try again
            </button>
          </>
        ) : (
          <p>Loading community…</p>
        )}
      </section>
    );
  return (
    <DemoContext.Provider
      value={{
        ...local,
        state: {
          ...local.state,
          events: [
            ...events.map(adapt),
            ...local.state.events.filter(
              (event) => event.mine && !event.revision,
            ),
          ],
        },
        remoteEvents,
      }}
    >
      {community && error && (
        <p className="page" role="status">
          Could not refresh events. Your changes are still here.{' '}
          <button className="text-link" onClick={reload}>
            Try again
          </button>
        </p>
      )}
      {children}
    </DemoContext.Provider>
  );
}
