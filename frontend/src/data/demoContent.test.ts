import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { experiences } from './experiences';
import { getHost, hosts } from './hosts';
import { getExperienceDetails } from './experienceDetails';
import { sampleEvents } from '../features/community/model';

describe('complete demo content', () => {
  it('has the required catalogue with valid local artwork and five linked hosts', () => {
    expect(experiences.length).toBeGreaterThanOrEqual(20);
    expect(new Set(experiences.map((e) => e.id)).size).toBe(experiences.length);
    expect(sampleEvents()).toHaveLength(10);
    expect(Object.keys(hosts)).toHaveLength(5);
    for (const [category, host] of Object.entries(hosts)) {
      const hosted = experiences.filter(
        (e) => e.category === category && !e.curation,
      );
      expect(hosted.length).toBeGreaterThan(0);
      for (const e of hosted)
        expect(getExperienceDetails(e).host).toBe(host.name);
      expect(existsSync(`public${host.image}`)).toBe(true);
    }
    for (const e of experiences)
      expect(existsSync(`public${e.image}`)).toBe(true);
    expect(getHost('__proto__')).toBeUndefined();
  });
  it('does not assign fictional hosts to unverified district proposals', () => {
    for (const e of experiences.filter((e) => e.curation)) {
      expect(getExperienceDetails(e).host).toBe('Host to be confirmed');
    }
  });
});
