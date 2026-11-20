import { describe, expect, it } from 'vitest';
import { formatPhone, initialOf, roleLabel } from './ProfileMenu';

describe('profile menu helpers', () => {
  it('names the highest role', () => {
    expect(roleLabel(['traveller'])).toBe('Traveller');
    expect(roleLabel(['traveller', 'host'])).toBe('Host');
    expect(roleLabel(['traveller', 'admin', 'host'])).toBe('Admin');
    expect(roleLabel(['traveller', 'admin', 'super'])).toBe('Super admin');
  });
  it('spaces Indian mobile numbers and leaves others alone', () => {
    expect(formatPhone('+919800012345')).toBe('+91 98000 12345');
    expect(formatPhone('+447700900123')).toBe('+447700900123');
    expect(formatPhone(null)).toBeNull();
  });
  it('uses an upper-case initial', () => {
    expect(initialOf(' pema')).toBe('P');
    expect(initialOf('')).toBe('?');
  });
});
