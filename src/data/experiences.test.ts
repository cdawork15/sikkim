import { describe, expect, it } from 'vitest';
import {
  experiences,
  filterExperiences,
  formatPrice,
  isCategory,
} from './experiences';
import { readSaved, SAVED_KEY, writeSaved } from '../lib/storage';

describe('discovery', () => {
  it('combines category and search while normalizing whitespace and case', () => {
    expect(
      filterExperiences('hiking', '  PAKYONG  ').map((item) => item.id),
    ).toEqual(['first-light', 'mankhim-lampokhari-walk', 'mankhim-sunrise']);
    expect(filterExperiences('culture', 'momo')).toEqual([]);
    expect(filterExperiences('all')).toHaveLength(experiences.length);
  });
  it('searches descriptions and returns an empty collection for no matches', () => {
    expect(
      filterExperiences('all', 'vegetarian').map((item) => item.id),
    ).toEqual(['momo-table']);
    expect(filterExperiences('all', 'unfindable')).toEqual([]);
  });
  it('rejects unrecognized URL categories and formats Indian prices', () => {
    expect(isCategory('food')).toBe(true);
    expect(isCategory('invalid')).toBe(false);
    expect(isCategory(null)).toBe(false);
    expect(formatPrice(650)).toBe('₹650');
  });
});

describe('saved ideas', () => {
  const valid = experiences.map((item) => item.id);
  it.each(['broken JSON', '{}', 'null', '42', '"first-light"'])(
    'recovers from invalid browser data: %s',
    (value) => {
      expect(readSaved({ getItem: () => value }, valid)).toEqual([]);
    },
  );
  it('removes duplicates, unknown listings and invalid values', () => {
    expect(
      readSaved(
        {
          getItem: () =>
            '["first-light", "unknown", 8, "first-light", "momo-table"]',
        },
        valid,
      ),
    ).toEqual(['first-light', 'momo-table']);
  });
  it('does not prevent browsing when storage is blocked or full', () => {
    expect(
      readSaved(
        {
          getItem: () => {
            throw new Error('blocked');
          },
        },
        valid,
      ),
    ).toEqual([]);
    expect(
      writeSaved(
        {
          setItem: () => {
            throw new Error('full');
          },
        },
        ['first-light'],
      ),
    ).toBe(false);
  });
  it('stores a portable list of listing IDs', () => {
    const records = new Map<string, string>();
    expect(
      writeSaved(
        {
          setItem: (key, value) => {
            records.set(key, value);
          },
        },
        ['first-light'],
      ),
    ).toBe(true);
    expect(records.get(SAVED_KEY)).toBe('["first-light"]');
  });
});
