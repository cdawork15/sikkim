import { indiaToday } from '../../lib/booking';

export const interests = [
  'Food',
  'Art',
  'Nature',
  'Music',
  'Wellness',
  'Culture',
] as const;
export type Interest = (typeof interests)[number];
export type Guest = { id: string; name: string; status: Membership };
export type CommunityEvent = {
  id: string;
  ownerId?: string;
  revision?: number;
  title: string;
  description: string;
  host: string;
  area: string;
  meeting: string;
  date: string;
  start: string;
  end: string;
  capacity: number;
  attendees: number;
  price: number;
  interest: Interest;
  image: string;
  images?: string[];
  mine: boolean;
  status: 'published' | 'cancelled';
  live: boolean;
  approval: boolean;
  guests?: Guest[];
};
export type Membership = 'joined' | 'requested' | 'waiting';
export const covers = [
  '/images/himalayan-dawn.webp',
  '/images/momos.webp',
  '/images/forest.webp',
  '/images/monastery.webp',
];
export function addDays(date: string, offset: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
export function validDate(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function eventError(e: CommunityEvent, step?: number) {
  if (
    (step === undefined || step === 0) &&
    (e.title.trim().length < 5 ||
      e.title.length > 60 ||
      e.description.trim().length < 20 ||
      e.description.length > 400 ||
      !interests.includes(e.interest))
  )
    return 'Add a title (5–60 characters), description (20–400 characters) and an interest.';
  if (step === undefined || step === 1) {
    if (
      !validDate(e.date) ||
      !/^\d{2}:\d{2}$/.test(e.start) ||
      !/^\d{2}:\d{2}$/.test(e.end) ||
      !Number.isFinite(Date.parse(`${e.date}T${e.start}:00+05:30`)) ||
      !Number.isFinite(Date.parse(`${e.date}T${e.end}:00+05:30`)) ||
      e.end <= e.start ||
      Date.parse(`${e.date}T${e.start}:00+05:30`) <= Date.now()
    )
      return 'Choose a future date and an end time after the start time (India time).';
    if (
      e.area.trim().length < 2 ||
      e.area.length > 60 ||
      e.meeting.trim().length < 5 ||
      e.meeting.length > 120
    )
      return 'Add an area and a public meeting point (5–120 characters).';
  }
  if (
    (step === undefined || step === 2) &&
    (!Number.isInteger(e.capacity) ||
      e.capacity < Math.max(2, e.attendees) ||
      e.capacity > 30 ||
      !Number.isInteger(e.price) ||
      e.price < 0 ||
      e.price > 10000)
  )
    return 'Choose 2–30 places and a whole-rupee price from ₹0 to ₹10,000. Keep enough places for existing participants.';
  return '';
}
export function newEvent(): CommunityEvent {
  return {
    id: crypto.randomUUID(),
    title: '',
    description: '',
    host: 'You',
    area: '',
    meeting: '',
    date: addDays(indiaToday(), 1),
    start: '16:00',
    end: '18:00',
    capacity: 10,
    attendees: 0,
    price: 0,
    interest: 'Culture',
    image: covers[0]!,
    mine: true,
    status: 'published',
    live: false,
    approval: false,
  };
}
export function sampleEvents(): CommunityEvent[] {
  const rows: [string, string, string, Interest, number, number, number][] = [
    ['Sunset tea on the ridge', 'Tashi', 'Pakyong', 'Nature', 0, 4, 10],
    ['Fold, steam and share momos', 'Doma', 'Gangtok', 'Food', 450, 5, 8],
    ['A little clay, a little creativity', 'Pema', 'Pakyong', 'Art', 600, 8, 8],
    ['A quiet morning together', 'Mingma', 'Gangtok', 'Wellness', 0, 3, 10],
    ['Stories around a local table', 'Sonam', 'Aritar', 'Culture', 0, 6, 10],
    ['An acoustic evening', 'Karma', 'Gangtok', 'Music', 200, 5, 10],
    ['Walk and talk in the forest', 'Tashi', 'Pakyong', 'Nature', 0, 4, 8],
    ['Sketch a mountain morning', 'Pema', 'Gangtok', 'Art', 300, 2, 8],
    ['Share a recipe, share a story', 'Doma', 'Aritar', 'Food', 0, 6, 10],
    ['Slow Sunday stretches', 'Mingma', 'Pakyong', 'Wellness', 250, 4, 10],
  ];
  return rows.map(
    ([title, host, area, interest, price, attendees, capacity], i) => ({
      id: `community-${i + 1}`,
      title,
      host,
      area,
      interest,
      price,
      attendees,
      capacity,
      description: `Join a small group for ${title.toLowerCase()}. Meet fellow travellers and share an unhurried moment.`,
      meeting: `${area} · Meeting point to be confirmed`,
      date: addDays(indiaToday(), i === 0 ? 0 : i + 1),
      start: '16:00',
      end: '18:00',
      image:
        covers[
          interest === 'Food'
            ? 1
            : interest === 'Culture'
              ? 3
              : interest === 'Wellness'
                ? 2
                : 0
        ]!,
      mine: false,
      status: 'published',
      live: i === 0,
      approval: i === 4,
    }),
  );
}
export function canJoin(e: CommunityEvent) {
  return (
    e.status === 'published' &&
    (e.live || Date.parse(`${e.date}T${e.end}:00+05:30`) > Date.now())
  );
}

export function isUpcoming(e: CommunityEvent, now = Date.now()) {
  return (
    e.status === 'published' &&
    !e.live &&
    Date.parse(`${e.date}T${e.start}:00+05:30`) > now
  );
}
