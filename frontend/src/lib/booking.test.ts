import { describe, expect, it } from 'vitest';
import {
  bookingError,
  getDemoSlots,
  indiaToday,
  isDemoBooking,
} from './booking';

const now = new Date('2026-11-01T20:00:00Z');

describe('demo booking rules', () => {
  it('uses India dates and creates future dates across month boundaries', () => {
    expect(indiaToday(now)).toBe('2026-11-02');
    const slots = getDemoSlots(new Date('2026-12-31T20:00:00Z'));
    expect(slots[0]!.date).toBe('2027-01-02');
    expect(new Set(slots.map((slot) => slot.id)).size).toBe(8);
  });
  it('rejects missing, full, unavailable and expired slots', () => {
    const slots = getDemoSlots(now);
    expect(bookingError(undefined, 1, now)).toContain('Choose');
    expect(bookingError(slots[2], 1, now)).toContain('full');
    expect(bookingError(slots[4], 1, now)).toContain('unavailable');
    expect(bookingError(slots[0], 1, new Date('2026-11-10'))).toContain(
      'passed',
    );
  });
  it.each([0, -1, 1.5, NaN, Infinity, 5])(
    'rejects an invalid group size: %s',
    (count) => {
      expect(bookingError(getDemoSlots(now)[0], count, now)).not.toBe('');
    },
  );
  it('allows exactly the available places, but not one extra', () => {
    const slot = getDemoSlots(now)[1]!;
    expect(bookingError(slot, 2, now)).toBe('');
    expect(bookingError(slot, 3, now)).toContain('Only 2');
  });
  it('rejects malformed stored tickets', () => {
    const valid = {
      reference: 'DEMO-12345678-1234-1234-1234-123456789abc',
      experienceId: 'first-light',
      date: '2026-11-03',
      time: '06:00',
      participants: 2,
      createdAt: now.toISOString(),
    };
    expect(isDemoBooking(valid)).toBe(true);
    for (const change of [
      { experienceId: 'missing' },
      { date: 'bad' },
      { date: '2026-02-30' },
      { time: '27:00' },
      { participants: 2.5 },
      { participants: 99 },
      { reference: 'anything' },
    ])
      expect(isDemoBooking({ ...valid, ...change })).toBe(false);
    expect(isDemoBooking(null)).toBe(false);
  });
});
