import type { Experience } from './experiences';

// Fictional profiles for the demo. No provider or identity is verified.
export const hosts: Record<
  Experience['category'],
  {
    name: string;
    area: string;
    focus: string;
    story: string;
    image: string;
  }
> = {
  hiking: {
    name: 'Tashi',
    area: 'Pakyong & Gangtok',
    focus: 'Trails and mountain stories',
    story:
      'A walking host who loves quiet trails and mountain stories. This profile imagines small groups, time for photographs and a shared tea break.',
    image: '/images/himalayan-dawn.webp',
  },
  culture: {
    name: 'Pema',
    area: 'Gangtok',
    focus: 'Architecture and local traditions',
    story:
      'A culture host sharing stories of architecture and local traditions. This profile imagines slow courtyard walks and space to ask questions.',
    image: '/images/monastery.webp',
  },
  food: {
    name: 'Doma',
    area: 'Gangtok',
    focus: 'Cooking and conversation',
    story:
      'A home cook bringing people together around a momo table. This profile imagines learning to fold momos before sitting down to a shared tasting.',
    image: '/images/momos.webp',
  },
  nature: {
    name: 'Sonam',
    area: 'Rumtek',
    focus: 'Forest walks and small discoveries',
    story:
      'A nature host with an eye for the quieter details of a forest. This profile imagines stopping for fern patterns, birdsong and the sound of water.',
    image: '/images/forest.webp',
  },
  wellness: {
    name: 'Mingma',
    area: 'Pakyong',
    focus: 'Slow mornings outdoors',
    story:
      'A host for slow mornings, simple breathing and time outdoors. This profile imagines an unhurried pause and tea, with everyone moving at their own pace.',
    image: '/images/forest.webp',
  },
};
export function getHost(category: string | undefined) {
  return Object.entries(hosts).find(([key]) => key === category)?.[1];
}
