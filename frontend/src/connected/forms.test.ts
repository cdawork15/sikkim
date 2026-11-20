import { describe, expect, it } from 'vitest';
import { duration, money, paise } from './shared';
import { draftFromForm } from './Hosting';

describe('money and experience form conversion', () => {
  it('converts rupees into exact integer paise and rejects invalid prices', () => {
    expect(paise('100.10')).toBe(10010);
    expect(paise('0')).toBe(0);
    expect(paise('')).toBeNull();
    for (const invalid of ['-1', '1e3', '0.001', 'Infinity', '21474836.48'])
      expect(() => paise(invalid)).toThrow();
    expect(money(10010)).toContain('100.10');
    expect(duration(90)).toBe('1 hr 30 min');
  });
  it('sends the complete replaceable draft without policy metadata or read-only fields', () => {
    const form = new FormData();
    for (const [key, value] of Object.entries({
      title: ' Forest walk ',
      description: 'Walk',
      area: 'pakyong',
      meetingPoint: 'Village',
      durationMinutes: '90',
      price: '500.25',
      minParticipants: '1',
      maxParticipants: '8',
      difficulty: 'easy',
      inclusions: 'Tea\nGuide',
      exclusions: '',
      preparation: '',
      accessibility: 'unknown',
      accessibilityNotes: '',
      sourceKind: 'direct',
      sourceReference: '',
      cancellation: 'Terms',
      safety: 'Safety',
      participation: 'All adults',
    }))
      form.set(key, value);
    form.append('category', 'nature');
    const draft = draftFromForm(form);
    expect(draft).toMatchObject({
      title: 'Forest walk',
      pricePaise: 50025,
      durationMinutes: 90,
      inclusions: ['Tea', 'Guide'],
      categories: ['nature'],
      policy: {
        cancellation: 'Terms',
        safety: 'Safety',
        participation: 'All adults',
      },
    });
    expect(draft).not.toHaveProperty('revision');
    expect(draft.policy).not.toHaveProperty('id');
    form.set('safety', '');
    expect(() => draftFromForm(form)).toThrow('all three');
    form.set('cancellation', '');
    form.set('participation', '');
    expect(draftFromForm(form)).not.toHaveProperty('policy');
    expect(() => draftFromForm(form, true)).toThrow(
      'Existing policies cannot be cleared',
    );
  });
});
