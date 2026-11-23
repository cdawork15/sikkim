import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import {
  canJoin,
  covers,
  interests,
  sampleEvents,
  validDate,
  type CommunityEvent,
  type Membership,
} from './community/model';

import { isStoredPhoto, MAX_EVENT_PHOTOS } from './community/photos';

export const DEMO_KEY = 'sikkim:community-trips:v1';
type Message = { id: string; eventId: string; text: string; at: string };
export type DemoState = {
  events: CommunityEvent[];
  memberships: Record<string, Membership>;
  saved: string[];
  seen: string[];
  messages: Message[];
  // Retired planner data is preserved, but never rendered or treated as bookings.
  trips: unknown[];
};
const fresh = (): DemoState => ({
  events: sampleEvents(),
  memberships: {},
  saved: [],
  seen: [],
  messages: [],
  trips: [],
});
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');
const text = (v: unknown, max = 500) =>
  typeof v === 'string' && v.length <= max;
export function isDemoState(v: unknown): v is DemoState {
  if (
    !record(v) ||
    !Array.isArray(v.events) ||
    v.events.length > 60 ||
    !record(v.memberships) ||
    !strings(v.saved) ||
    !strings(v.seen) ||
    !Array.isArray(v.messages) ||
    v.messages.length > 200 ||
    !Array.isArray(v.trips) ||
    v.trips.length > 20
  )
    return false;
  if (
    !v.events.every(
      (e) =>
        record(e) &&
        [
          'id',
          'title',
          'description',
          'host',
          'area',
          'meeting',
          'start',
          'end',
        ].every((k) => text(e[k])) &&
        validDate(e.date) &&
        Number.isInteger(e.capacity) &&
        Number(e.capacity) >= 2 &&
        Number(e.capacity) <= 30 &&
        Number.isInteger(e.attendees) &&
        Number(e.attendees) >= 0 &&
        Number(e.attendees) <= Number(e.capacity) &&
        Number.isInteger(e.price) &&
        Number(e.price) >= 0 &&
        Number(e.price) <= 10000 &&
        interests.includes(e.interest as never) &&
        (covers.includes(String(e.image)) || isStoredPhoto(e.image)) &&
        (e.images === undefined ||
          (Array.isArray(e.images) &&
            e.images.length <= MAX_EVENT_PHOTOS &&
            e.images.every(isStoredPhoto) &&
            (e.images.length === 0
              ? covers.includes(String(e.image))
              : e.image === e.images[0]))) &&
        typeof e.mine === 'boolean' &&
        typeof e.live === 'boolean' &&
        typeof e.approval === 'boolean' &&
        (e.guests === undefined ||
          (Array.isArray(e.guests) &&
            e.guests.length <= 60 &&
            e.guests.every(
              (g) =>
                record(g) &&
                text(g.id) &&
                text(g.name, 80) &&
                ['joined', 'requested', 'waiting'].includes(String(g.status)),
            ) &&
            e.guests.filter((g) => record(g) && g.status === 'joined')
              .length === e.attendees)) &&
        ['published', 'cancelled'].includes(String(e.status)),
    )
  )
    return false;
  if (
    !Object.values(v.memberships).every((m) =>
      ['joined', 'waiting', 'requested'].includes(String(m)),
    )
  )
    return false;
  if (
    !v.messages.every(
      (m) =>
        record(m) &&
        text(m.id) &&
        text(m.eventId) &&
        text(m.text) &&
        typeof m.at === 'string' &&
        Number.isFinite(Date.parse(m.at)),
    )
  )
    return false;
  return true;
}

export function joinEvent(state: DemoState, id: string): DemoState {
  const event = state.events.find((e) => e.id === id);
  if (!event || event.mine || !canJoin(event) || state.memberships[id])
    return state;
  const membership =
    event.attendees >= event.capacity
      ? 'waiting'
      : event.approval
        ? 'requested'
        : 'joined';
  return { ...state, memberships: { ...state.memberships, [id]: membership } };
}
// Published events (with a revision) come from the API, whose count already
// includes the signed-in person. Device-only sample events add them locally.
export const joinedCount = (s: DemoState, e: CommunityEvent) =>
  e.attendees + (!e.revision && s.memberships[e.id] === 'joined' ? 1 : 0);
export const chatAllowed = (s: DemoState, e: CommunityEvent) =>
  e.status !== 'cancelled' && (e.mine || s.memberships[e.id] === 'joined');
function load(storageKey: string) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { state: fresh(), notice: '' };
    const parsed: unknown = JSON.parse(raw);
    if (isDemoState(parsed)) return { state: parsed, notice: '' };
    return {
      state: fresh(),
      notice:
        'Saved activities couldn’t be read. The collection has been reset on this device.',
    };
  } catch {
    return {
      state: fresh(),
      notice:
        'Browser storage is unavailable or unreadable. Changes stay for this visit.',
    };
  }
}
export const DemoContext = createContext<{
  state: DemoState;
  update: (fn: (s: DemoState) => DemoState) => void;
  notice: string;
  canWrite: boolean;
  remoteEvents?: {
    save: (event: CommunityEvent, existing: boolean) => Promise<CommunityEvent>;
    cancel: (event: CommunityEvent) => Promise<void>;
    join: (event: CommunityEvent) => Promise<void>;
    leave: (event: CommunityEvent) => Promise<void>;
    // Host tools for a published event (member requests, confirmations).
    Manage: ComponentType<{ event: CommunityEvent }>;
  };
} | null>(null);
export function DemoProvider({
  children,
  storageKey = DEMO_KEY,
  readOnly = false,
}: {
  children: ReactNode;
  storageKey?: string;
  readOnly?: boolean;
}) {
  const [initial] = useState(() =>
    readOnly ? { state: fresh(), notice: '' } : load(storageKey),
  );
  const [state, setState] = useState(initial.state);
  const [notice, setNotice] = useState(initial.notice);
  useEffect(() => {
    if (readOnly) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      setNotice(
        'Browser storage is unavailable. Community changes stay for this visit.',
      );
    }
  }, [state, storageKey, readOnly]);
  useEffect(() => {
    if (readOnly) return;
    const sync = (e: StorageEvent) => {
      if (e.key !== storageKey && e.key !== null) return;
      const next = load(storageKey);
      setState(next.state);
      setNotice(next.notice);
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [storageKey, readOnly]);
  return (
    <DemoContext.Provider
      value={{
        state,
        update: (fn) => {
          if (!readOnly) setState(fn);
        },
        notice,
        canWrite: !readOnly,
      }}
    >
      {children}
    </DemoContext.Provider>
  );
}
export function useDemo() {
  const value = useContext(DemoContext);
  if (!value) throw new Error('Demo provider missing');
  return value;
}
export function DemoNotice() {
  const { notice, remoteEvents } = useDemo();
  if (remoteEvents) return null;
  return (
    <>
      <p className="demo-caption">
        Example events. Changes stay on this device; no reservations or messages
        are sent.
      </p>
      {notice && (
        <p className="storage-notice" role="status">
          {notice}
        </p>
      )}
    </>
  );
}
