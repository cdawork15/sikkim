import type { Experience } from './experiences';

// Selected from the user-supplied District Curation, 2 November 2026.
// Prices, durations and imagery are illustrative, not provider offers.
export const districtExperiences: readonly Experience[] = [
  {
    id: 'rhenock-museum',
    title: 'Ram Ghauri Sangralaya visit',
    category: 'culture',
    area: 'Rhenock, Pakyong',
    duration: '1 hour',
    price: 350,
    image: '/images/monastery.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Ram Ghauri Sangralaya visit',
    tag: 'District curation · Demo',
    description:
      'Museum visit and local-history talk. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 2,
      verify: 'Exact name, opening hours, custodian, entry arrangement',
    },
  },
  {
    id: 'aritar-gumpa',
    title: 'Aritar Gumpa Visit',
    category: 'culture',
    area: 'Aritar, Pakyong',
    duration: '1.5 hours',
    price: 450,
    image: '/images/monastery.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Aritar Gumpa Visit',
    tag: 'District curation · Demo',
    description:
      'Approved Buddhist heritage visit. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 4,
      verify: 'Monastery permission; photography and participation rules',
    },
  },
  {
    id: 'rai-community-lunch',
    title: 'Rai Community Lunch',
    category: 'food',
    area: 'Mankhim, Pakyong',
    duration: '2 hours',
    price: 750,
    image: '/images/momos.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Rai Community Lunch',
    tag: 'District curation · Demo',
    description:
      'Traditional Rai meal, household traditions. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 5,
      verify: 'Identify SHG; agree payment',
    },
  },
  {
    id: 'mankhim-lampokhari-walk',
    title: 'Mankhim to Lampokhari Walk',
    category: 'hiking',
    area: 'Mankhim, Pakyong',
    duration: '2 hours',
    price: 600,
    image: '/images/himalayan-dawn.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Mankhim to Lampokhari Walk',
    tag: 'District curation · Demo',
    description:
      'Small-group guided walk. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 6,
      verify: 'Route, gradient, duration, access rights, safety',
    },
  },
  {
    id: 'mankhim-sunrise',
    title: 'Mankhim Sunrise',
    category: 'hiking',
    area: 'Mankhim, Pakyong',
    duration: '2 hours',
    price: 550,
    image: '/images/himalayan-dawn.webp',
    imageAlt: 'Illustrative concept image, not a photograph of Mankhim Sunrise',
    tag: 'District curation · Demo',
    description:
      'Early-morning sunrise and landscape talk. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 9,
      verify: 'Identify guide',
    },
  },
  {
    id: 'dalapchand-village',
    title: 'Dalapchand Village Walk',
    category: 'culture',
    area: 'Dalapchand, Pakyong',
    duration: '2 hours',
    price: 650,
    image: '/images/monastery.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Dalapchand Village Walk',
    tag: 'District curation · Demo',
    description:
      'Village life and settlement heritage. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 10,
      verify: 'Identify guide',
    },
  },
  {
    id: 'hot-stone-herbal-bath',
    title: 'Hot Stone and Herbal Bath',
    category: 'wellness',
    area: 'Pakyong · location to confirm',
    duration: '1.5 hours',
    price: 900,
    image: '/images/forest.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Hot Stone and Herbal Bath',
    tag: 'District curation · Demo',
    description:
      'Wooden-tub soak with river stones and herbs. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 18,
      verify: 'Exact location (Yakten or Karthok), format, price',
    },
  },
  {
    id: 'orchid-research-centre',
    title: 'Inside the Orchid Research Centre',
    category: 'nature',
    area: 'Pakyong',
    duration: '1.5 hours',
    price: 500,
    image: '/images/forest.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Inside the Orchid Research Centre',
    tag: 'District curation · Demo',
    description:
      'Orchid collection visit, potting demonstration. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 19,
      verify: 'Institutional permission for visitors',
    },
  },
  {
    id: 'pakyong-momo-making',
    title: 'Momo-Making',
    category: 'food',
    area: 'Pakyong district',
    duration: '2 hours',
    price: 800,
    image: '/images/momos.webp',
    imageAlt: 'Illustrative concept image, not a photograph of Momo-Making',
    tag: 'District curation · Demo',
    description:
      'Prepare, fold, steam and eat momos. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 21,
      verify: 'Identify families',
    },
  },
  {
    id: 'bee-to-bottle',
    title: 'Bee to Bottle',
    category: 'nature',
    area: 'Jitlang, Rangpo, Pakyong',
    duration: '2 hours',
    price: 700,
    image: '/images/forest.webp',
    imageAlt: 'Illustrative concept image, not a photograph of Bee to Bottle',
    tag: 'District curation · Demo',
    description:
      'Hive visit, extraction, filtering, bottling. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 24,
      verify: 'Specific beekeeper; visitor access',
    },
  },
  {
    id: 'first-pot-namcheybong',
    title: 'Throw Your First Pot',
    category: 'culture',
    area: 'Namcheybong, Pakyong',
    duration: '2 hours',
    price: 950,
    image: '/images/monastery.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Throw Your First Pot',
    tag: 'District curation · Demo',
    description:
      'Pottery instruction, hands-on work. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 28,
      verify: 'Group and tourism arrangements (not found online)',
    },
  },
  {
    id: 'lepcha-loom-rhenock',
    title: 'Lepcha Bamboo-Loom Weaving',
    category: 'culture',
    area: 'Rhenock, Pakyong',
    duration: '2 hours',
    price: 750,
    image: '/images/monastery.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Lepcha Bamboo-Loom Weaving',
    tag: 'District curation · Demo',
    description:
      'Weaving demonstration by Lepcha women. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Pakyong',
      row: 29,
      verify: 'Host availability; visitor participation',
    },
  },
  {
    id: 'gangtok-cupcake-workshop',
    title: 'Cupcake Workshop',
    category: 'food',
    area: 'New Market, Gangtok',
    duration: '2 hours',
    price: 900,
    image: '/images/momos.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Cupcake Workshop',
    tag: 'District curation · Demo',
    description:
      'Bake, decorate and package cupcakes. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Gangtok',
      row: 1,
      verify: 'Workshop format',
    },
  },
  {
    id: 'gangtok-handmade-paper',
    title: 'Make Your Own Handmade Paper',
    category: 'culture',
    area: 'Zero Point, Gangtok',
    duration: '2 hours',
    price: 650,
    image: '/images/monastery.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Make Your Own Handmade Paper',
    tag: 'District curation · Demo',
    description:
      'Argeli-bark paper making. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Gangtok',
      row: 6,
      verify: 'Workshop format',
    },
  },
  {
    id: 'gangtok-yoga',
    title: 'Yoga Sessions',
    category: 'wellness',
    area: 'Upper Development Area, Gangtok',
    duration: '1 hour',
    price: 500,
    image: '/images/forest.webp',
    imageAlt: 'Illustrative concept image, not a photograph of Yoga Sessions',
    tag: 'District curation · Demo',
    description:
      'Yoga class. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Gangtok',
      row: 10,
      verify: 'Visitor sessions',
    },
  },
  {
    id: 'kewzing-momo-thukpa',
    title: 'Momo and Thukpa Class',
    category: 'food',
    area: 'Kewzing, Namchi',
    duration: '2.5 hours',
    price: 850,
    image: '/images/momos.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Momo and Thukpa Class',
    tag: 'District curation · Demo',
    description:
      'Cooking class, then lunch. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Namchi',
      row: 1,
      verify: 'Current availability',
    },
  },
  {
    id: 'sumbuk-garden-harvest',
    title: 'Vegetable Planting and Harvesting',
    category: 'nature',
    area: 'Sumbuk, Namchi',
    duration: '2 hours',
    price: 600,
    image: '/images/forest.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Vegetable Planting and Harvesting',
    tag: 'District curation · Demo',
    description:
      'Seasonal garden work. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Namchi',
      row: 8,
      verify: 'Seasonal schedule',
    },
  },
  {
    id: 'tendong-legend-trek',
    title: 'Tendong Hill Legend Trek',
    category: 'hiking',
    area: 'Damthang, Namchi',
    duration: '3 hours',
    price: 950,
    image: '/images/himalayan-dawn.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Tendong Hill Legend Trek',
    tag: 'District curation · Demo',
    description:
      '3-hour trek  with the Lepcha flood legend. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Namchi',
      row: 24,
      verify: 'Identify guide',
    },
  },
  {
    id: 'varsey-rhododendron',
    title: 'Varsey Rhododendron Trek',
    category: 'hiking',
    area: 'Okhrey, Soreng',
    duration: '4 hours',
    price: 1200,
    image: '/images/himalayan-dawn.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Varsey Rhododendron Trek',
    tag: 'District curation · Demo',
    description:
      'Guided forest trek. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Soreng',
      row: 18,
      verify: 'Guide; coordinate with nature curator',
    },
  },
  {
    id: 'kaluk-orange-harvest',
    title: 'Orange Harvest Day',
    category: 'nature',
    area: 'Kaluk, Soreng',
    duration: '2 hours',
    price: 700,
    image: '/images/forest.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Orange Harvest Day',
    tag: 'District curation · Demo',
    description:
      'Pick and pack mandarins. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Soreng',
      row: 24,
      verify: 'Season (November to January)',
    },
  },
  {
    id: 'darap-carpet-weaving',
    title: 'Carpet-Weaving Demonstration',
    category: 'culture',
    area: 'Darap, Gyalshing',
    duration: '2 hours',
    price: 800,
    image: '/images/monastery.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Carpet-Weaving Demonstration',
    tag: 'District curation · Demo',
    description:
      'Watch and try carpet weaving. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Gyalshing',
      row: 5,
      verify: 'Identify weavers',
    },
  },
  {
    id: 'norbugang-dubdi-trail',
    title: 'Coronation Trail: Norbugang to Dubdi',
    category: 'hiking',
    area: 'Yuksom, Gyalshing',
    duration: '3 hours',
    price: 900,
    image: '/images/himalayan-dawn.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Coronation Trail: Norbugang to Dubdi',
    tag: 'District curation · Demo',
    description:
      'Heritage walk to  Dubdi Monastery. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Gyalshing',
      row: 18,
      verify: 'Identify guide',
    },
  },
  {
    id: 'dzongu-lepcha-stories',
    title: 'Lepcha Storytelling and Language',
    category: 'culture',
    area: 'Dzongu, Mangan',
    duration: '2 hours',
    price: 650,
    image: '/images/monastery.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Lepcha Storytelling and Language',
    tag: 'District curation · Demo',
    description:
      'Language intro, oral traditions, community history. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Mangan',
      row: 2,
      verify:
        'Knowledge holders; cultural consent. Develop with Lepcha community knowledge holders and agree what may be shared.',
    },
  },
  {
    id: 'singhik-cardamom',
    title: 'Cardamom Cultivation',
    category: 'nature',
    area: 'Upper Singhik, Mangan',
    duration: '2 hours',
    price: 700,
    image: '/images/forest.webp',
    imageAlt:
      'Illustrative concept image, not a photograph of Cardamom Cultivation',
    tag: 'District curation · Demo',
    description:
      'Growing, harvesting and drying. A proposed experience from the district curation; arrangements are not confirmed.',
    curation: {
      district: 'Mangan',
      row: 7,
      verify:
        'Actual farm activity; season. Develop with Lepcha community knowledge holders and agree what may be shared.',
    },
  },
];
