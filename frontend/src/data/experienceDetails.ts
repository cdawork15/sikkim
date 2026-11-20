import type { Experience } from './experiences';
import { hosts } from './hosts';

type Detail = {
  host: string;
  hostStory: string;
  included: string[];
  excluded: string[];
  preparation: string;
  level: string;
  gallery: string[];
};

// Fictional hosts and arrangements for the booking demo, not verified offers.
const details: Record<
  Experience['category'],
  Omit<Detail, 'host' | 'hostStory'>
> = {
  hiking: {
    included: ['Guided ridge walk', 'Tea break', 'Time for photographs'],
    excluded: ['Travel to the meeting point', 'Equipment and insurance'],
    preparation:
      'This sample walk includes uneven ground. Comfortable walking shoes, water and a warm layer are suggested. A real host would confirm route conditions and suitability before travel.',
    level: 'Moderate walk',
    gallery: ['/images/himalayan-dawn.webp', '/images/forest.webp'],
  },
  culture: {
    included: ['Hosted courtyard walk', 'Time for questions'],
    excluded: ['Transport', 'Any entry charges or donations'],
    preparation:
      'A real host would confirm access and visitor rules. Respect quiet areas and ask before photographing people or religious spaces.',
    level: 'Easy pace',
    gallery: ['/images/monastery.webp', '/images/himalayan-dawn.webp'],
  },
  food: {
    included: [
      'Vegetarian momo-making session',
      'Ingredients and a shared tasting',
    ],
    excluded: ['Transport', 'Extra food and drinks'],
    preparation:
      'This sample session involves hot steam and kitchen tools. Ingredients and allergy needs must be checked with a real host before booking; this demo cannot confirm allergy suitability.',
    level: 'Beginner friendly',
    gallery: ['/images/momos.webp', '/images/monastery.webp'],
  },
  nature: {
    included: ['Hosted forest walk', 'Short nature stops'],
    excluded: ['Transport', 'Equipment and insurance'],
    preparation:
      'Paths may be uneven or wet. A real host would confirm weather, access and suitability. Wildlife sightings are never guaranteed.',
    level: 'Gentle walk',
    gallery: ['/images/forest.webp', '/images/himalayan-dawn.webp'],
  },
  wellness: {
    included: ['Quiet outdoor session', 'Tea'],
    excluded: ['Transport', 'Personal equipment'],
    preparation:
      'Join only at a pace that feels comfortable. This sample is a leisure activity, not medical care. A real host would confirm accessibility and suitability.',
    level: 'Relaxed pace',
    gallery: ['/images/forest.webp', '/images/himalayan-dawn.webp'],
  },
};

export const getExperienceDetails = (experience: Experience): Detail => {
  const host = hosts[experience.category];
  const base = {
    ...details[experience.category],
    host: host.name,
    hostStory: host.story,
  };
  if (!experience.curation) return base;
  return {
    ...base,
    host: 'Host to be confirmed',
    hostStory:
      'No provider has agreed to this listing. Host, format and availability need confirmation.',
    included: ['Demo session only; actual inclusions need agreement'],
    excluded: ['No real service, transport or entry is reserved'],
    preparation: experience.curation.verify,
    level: 'Proposed experience',
    gallery: [experience.image],
  };
};
export const demoCancellation =
  'Demo policy: cancel at least 24 hours before the start for a full sample refund. Later cancellations receive no sample refund. Host cancellations receive a full sample refund. No money changes hands in this demo.';
