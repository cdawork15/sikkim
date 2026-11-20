import { describe, expect, it } from 'vitest';
import { reelExperiences, reelMedia } from './reels';
import { readFileSync, statSync } from 'node:fs';

describe('reel media', () => {
  it('uses three real local clips with credits, captions and small files', () => {
    expect(reelExperiences).toHaveLength(3);
    for (const experience of reelExperiences) {
      const media = reelMedia(experience);
      expect(media.source).toContain('commons.wikimedia.org/wiki/File:');
      expect(statSync(`public${media.video}`).size).toBeLessThan(2_000_000);
      expect(statSync(`public${media.poster}`).size).toBeGreaterThan(1000);
      expect(readFileSync(`public${media.captions}`, 'utf8')).toContain(
        'WEBVTT',
      );
    }
  });
});
