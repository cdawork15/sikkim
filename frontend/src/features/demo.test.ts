import { describe, expect, it } from 'vitest';
import {
  isDemoState,
  joinEvent,
  chatAllowed,
  type DemoState,
} from './DemoState';
import {
  sampleEvents,
  newEvent,
  eventError,
  isUpcoming,
} from './community/model';
const state = (): DemoState => ({
  events: sampleEvents(),
  memberships: {},
  saved: [],
  seen: [],
  messages: [],
  trips: [],
});
describe('community transitions', () => {
  it('joins once and grants chat only to joined participants', () => {
    const s = state();
    const joined = joinEvent(s, 'community-1');
    expect(joined.memberships['community-1']).toBe('joined');
    expect(joinEvent(joined, 'community-1')).toBe(joined);
    expect(chatAllowed(s, s.events[0]!)).toBe(false);
    expect(chatAllowed(joined, s.events[0]!)).toBe(true);
  });
  it('waitlists full events and waits for host approval where required', () => {
    expect(joinEvent(state(), 'community-3').memberships['community-3']).toBe(
      'waiting',
    );
    expect(joinEvent(state(), 'community-5').memberships['community-5']).toBe(
      'requested',
    );
  });
  it('blocks cancelled and ended events and owner self-joining', () => {
    for (const patch of [
      { status: 'cancelled' as const },
      { mine: true },
      { live: false, date: '2020-01-01' },
    ]) {
      const s = state();
      s.events[0] = { ...s.events[0]!, ...patch };
      expect(joinEvent(s, s.events[0]!.id)).toBe(s);
    }
    const s = state();
    s.memberships['community-1'] = 'joined';
    s.events[0]!.status = 'cancelled';
    expect(chatAllowed(s, s.events[0]!)).toBe(false);
  });
  it('only shows future published events as upcoming using India time', () => {
    const event = {
      ...newEvent(),
      date: '2026-11-10',
      start: '16:00',
      end: '18:00',
    };
    const start = Date.parse('2026-11-10T10:30:00Z');
    expect(isUpcoming(event, start - 1)).toBe(true);
    expect(isUpcoming(event, start)).toBe(false);
    expect(isUpcoming(event, start + 3 * 3600000)).toBe(false);
    expect(isUpcoming({ ...event, status: 'cancelled' }, start - 1)).toBe(
      false,
    );
    expect(isUpcoming({ ...event, live: true }, start - 1)).toBe(false);
  });
  it('validates event fields and group capacity', () => {
    const e = {
      ...newEvent(),
      title: 'A sample event',
      description: 'A small gathering with a sample host.',
      area: 'Pakyong',
      meeting: 'Public square',
    };
    expect(eventError(e)).toBe('');
    expect(eventError({ ...e, end: '14:00' })).toContain('end time');
    expect(eventError({ ...e, capacity: 1 })).toContain('2–30');
    expect(eventError({ ...e, price: NaN })).toContain('whole-rupee price');
    expect(eventError({ ...e, attendees: 8, capacity: 4 })).toContain(
      'participants',
    );
  });
  it('accepts bounded uploaded photos and rejects unsafe or inconsistent covers', () => {
    const photo = 'data:image/jpeg;base64,/9j/AA==';
    const s = state();
    s.events[0] = { ...s.events[0]!, image: photo, images: [photo] };
    expect(isDemoState(s)).toBe(true);
    for (const images of [
      Array(5).fill(photo),
      ['javascript:alert(1)'],
      ['https://example.com/photo.jpg'],
      ['data:image/svg+xml;base64,AAAA'],
      ['data:image/jpeg;base64,' + 'A'.repeat(200000)],
    ]) {
      expect(isDemoState({ ...s, events: [{ ...s.events[0], images }] })).toBe(
        false,
      );
    }
    expect(
      isDemoState({
        ...s,
        events: [{ ...s.events[0], image: '/images/forest.webp' }],
      }),
    ).toBe(false);
  });
  it('rejects corrupted nested storage instead of trusting it', () => {
    expect(isDemoState(state())).toBe(true);
    expect(isDemoState({ ...state(), events: [{ id: 'bad' }] })).toBe(false);
    expect(isDemoState({ ...state(), messages: [{ text: {} }] })).toBe(false);
    expect(isDemoState({ ...state(), trips: 'broken' })).toBe(false);
  });
});
