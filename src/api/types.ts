export type Envelope<T> = {
  data: T;
  page?: { nextCursor: string | null };
  meta?: {
    order: string;
    dateFilteringAvailable: boolean;
    mediaAvailable: boolean;
  };
};

export type Preferences = {
  chosenArea: string | null;
  tripStart: string | null;
  tripDays: number | null;
  travellers: number;
  pace: 'slow' | 'balanced';
  notificationsEnabled: boolean;
  showInParticipantList: boolean;
  searchFilters: SearchFilters;
};

export type Account = {
  id: string;
  displayName: string;
  language: 'en' | 'hi' | 'ne';
  isDemo: boolean;
  interests: string[];
  roles: string[];
  preferences: Preferences;
  onboardingComplete: boolean;
  contentLanguage: string;
};

export type Session = {
  accessToken: string;
  expiresAt: string;
  absoluteExpiresAt: string;
  user: Account;
};

export type Settings = {
  auth: { mode: string; realSignInAvailable: boolean; guestBrowsing: boolean };
  languages: { content: string[]; preferences: string[]; fallback: string };
  locationRequired: boolean;
  privacy: {
    demo: boolean;
    version: string | null;
    permanentDeletionAvailable: boolean;
    choices: {
      purpose: string;
      labelKey: string;
      label: string;
      defaultAccepted: boolean;
    }[];
  };
  help: { status: string; contact: string | null };
  safety: { message: string; noticeKey: string };
};

export type Interest = { code: string; labelKey: string; label: string };
export type Consent = {
  purpose: string;
  version: string;
  accepted: boolean;
  recordedAt: string;
};
export type CatalogueOptions = {
  areas: {
    code: string;
    name: string;
    latitude: number | null;
    longitude: number | null;
  }[];
  categories: { code: string; name: string; labelKey: string }[];
  dateFilteringAvailable: boolean;
  mediaAvailable: boolean;
  bookingAvailable: boolean;
  recommendationMethod: string;
};

export type SearchFilters = {
  q?: string;
  area?: string;
  category?: string;
  minPricePaise?: number;
  maxPricePaise?: number;
  accessibility?: string;
  difficulty?: string;
  date?: string;
  sort?: string;
};
export type Searches = {
  filters: SearchFilters;
  recent: { query: string; searchedAt: string }[];
};
export type Policy = {
  id?: string;
  version?: number;
  cancellation: string;
  safety: string;
  participation: string;
};
export type Experience = {
  id: string;
  slug: string;
  title: string;
  description: string;
  areaCode: string;
  area: string;
  durationMinutes: number;
  pricePaise: number;
  currency: string;
  accessibility: string;
  difficulty: string;
  hostId: string;
  hostName: string;
  featuredRank: number | null;
  categories: string[];
  media: MediaItem[];
  rating: null;
  availability: { status: string; bookable: boolean };
};
export type ExperienceDetail = Experience & {
  meetingPoint: string;
  minParticipants: number;
  maxParticipants: number;
  inclusions: string[];
  exclusions: string[];
  preparation: string;
  accessibilityNotes: string;
  hostStory: string;
  policy: Policy;
};
export type HomeData = {
  rows: { id: string; title: string; experiences: Experience[] }[];
  recommendationMethod: string;
  availabilityConnected: boolean;
};
export type Host = {
  id: string;
  publicName: string;
  story: string;
  serviceAreas: string[];
  contactChoice: 'hidden' | 'in_app';
};
export type ReviewEvent = {
  revision: number;
  action: string;
  reason: string | null;
  createdAt: string;
  providerReference?: string;
  sourceVerified?: boolean;
};
export type HostApplication = Host & {
  userId: string;
  status: string;
  revision: number;
  approvedUntil: string | null;
  isDemo: boolean;
  history: ReviewEvent[];
  uploadsAvailable: boolean;
  realVerificationAvailable: boolean;
};
export type ExperienceDraft = {
  title: string;
  description: string;
  area: string | null;
  categories: string[];
  meetingPoint: string;
  durationMinutes: number | null;
  pricePaise: number | null;
  minParticipants: number;
  maxParticipants: number;
  difficulty: string;
  inclusions: string[];
  exclusions: string[];
  preparation: string;
  accessibility: string;
  accessibilityNotes: string;
  sourceKind: 'direct' | 'district';
  sourceReference: string;
  policy?: Policy | null;
};
export type OwnedExperience = ExperienceDraft & {
  id: string;
  slug: string;
  hostId: string;
  revision: number;
  status: string;
  isDemo: boolean;
  history: ReviewEvent[];
  featuredRank: number | null;
};
export type ExperienceRow = Pick<
  OwnedExperience,
  'id' | 'slug' | 'title' | 'status' | 'revision' | 'pricePaise' | 'isDemo'
>;

export type MediaItem = {
  id: string;
  kind: 'image' | 'video';
  altText: string;
  place: string;
  placement?: string;
  credit: { author: string; sourceUrl: string; licenceUrl: string };
  urls: { image?: string; video?: string; poster?: string; captions?: string };
};
