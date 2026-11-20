import { districtExperiences } from './districtExperiences';

export const categories = [
  { id: 'all', label: 'All experiences', icon: 'compass' },
  { id: 'hiking', label: 'Hiking & trails', icon: 'mountain' },
  { id: 'nature', label: 'Nature', icon: 'leaf' },
  { id: 'culture', label: 'Culture', icon: 'landmark' },
  { id: 'food', label: 'Food & drink', icon: 'utensils' },
  { id: 'wellness', label: 'Slow living', icon: 'sun' },
] as const;

export type CategoryId = (typeof categories)[number]['id'];
export type Experience = {
  id: string;
  title: string;
  category: Exclude<CategoryId, 'all'>;
  area: string;
  duration: string;
  price: number;
  image: string;
  imageAlt: string;
  tag: string;
  description: string;
  imagePosition?: string;
  curation?: { district: string; row: number; verify: string };
};

// Synthetic editorial content. These are ideas, not live listings or offers.
export const experiences: readonly Experience[] = [
  {
    id: 'first-light',
    title: 'Chase the first light',
    category: 'hiking',
    area: 'Pakyong',
    duration: '3 hours',
    price: 650,
    image: '/images/himalayan-dawn.webp',
    imageAlt:
      'Concept artwork of layered Himalayan ridges in the first light of dawn',
    tag: 'For the early risers',
    description:
      'A gentle ridge walk, a flask of warm tea, and a little time to watch the mountains wake up. An idea for a slower kind of adventure around Pakyong.',
  },
  {
    id: 'monastery-mornings',
    title: 'A morning, a monastery',
    category: 'culture',
    area: 'Gangtok',
    duration: '2 hours',
    price: 450,
    image: '/images/monastery.webp',
    imageAlt:
      'Concept artwork of a red and golden Himalayan monastery with prayer flags',
    tag: 'A different perspective',
    description:
      'Step into a quieter rhythm. Explore Himalayan architecture and the stories behind a monastery courtyard, with time to listen, observe and ask thoughtful questions.',
  },
  {
    id: 'momo-table',
    title: 'Meet you at the momo table',
    category: 'food',
    area: 'Gangtok',
    duration: '2.5 hours',
    price: 850,
    image: '/images/momos.webp',
    imageAlt:
      'Concept artwork of handmade momos in a bamboo steamer with tomato chutney',
    tag: 'Made with a little love',
    description:
      'Fold, steam, share. An intimate introduction to making vegetarian momos, with a generous helping of conversation around a local kitchen table.',
  },
  {
    id: 'forest-notes',
    title: 'Take the quieter trail',
    category: 'nature',
    area: 'Rumtek',
    duration: '2 hours',
    price: 500,
    image: '/images/forest.webp',
    imageAlt:
      'Concept artwork of a misty green Himalayan forest and mossy stone trail',
    tag: 'Leave the noise behind',
    description:
      'A gentle wander under a canopy of green. Pause for the small things: fern patterns, birdsong and the sound of water finding its way through the forest.',
  },
  {
    id: 'mountain-pause',
    title: 'The art of doing a little less',
    category: 'wellness',
    area: 'Pakyong',
    duration: '1.5 hours',
    price: 400,
    image: '/images/forest.webp',
    imageAlt: 'Concept artwork of soft sunlight falling through a quiet forest',
    imagePosition: '75% center',
    tag: 'Room to breathe',
    description:
      'Make space for an unhurried morning outdoors. Easy breathing, a quiet sit and tea, with no experience or special equipment needed.',
  },
  {
    id: 'ridge-and-tea',
    title: 'One more ridge. One more tea.',
    category: 'hiking',
    area: 'Gangtok',
    duration: '4 hours',
    price: 950,
    image: '/images/himalayan-dawn.webp',
    imageAlt:
      'Concept artwork of distant snow peaks above green Himalayan foothills',
    imagePosition: '75% 30%',
    tag: 'Take the scenic way',
    description:
      'Follow an undulating foothill trail and finish with a well-earned cup of tea. A walking idea for curious travellers who like the long way round.',
  },
  ...districtExperiences,
];

export function isCategory(value: string | null): value is CategoryId {
  return categories.some((category) => category.id === value);
}

export function filterExperiences(category: CategoryId, query = '') {
  const term = query.trim().toLocaleLowerCase('en');
  return experiences.filter(
    (experience) =>
      (category === 'all' || experience.category === category) &&
      `${experience.title} ${experience.area} ${experience.category} ${experience.description}`
        .toLocaleLowerCase('en')
        .includes(term),
  );
}

export const formatPrice = (price: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(price);
