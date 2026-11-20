// Types and labels for the admin workspace (/v1/admin/*).

export const leadStages = [
  'idea',
  'contacted',
  'interested',
  'agreement_sent',
  'agreed',
  'onboarding',
  'live',
  'paused',
  'declined',
] as const;
export type LeadStage = (typeof leadStages)[number];

export const stageLabels: Record<LeadStage, string> = {
  idea: 'Idea',
  contacted: 'Contacted',
  interested: 'Interested',
  agreement_sent: 'Agreement sent',
  agreed: 'Agreed',
  onboarding: 'Onboarding',
  live: 'Live',
  paused: 'Paused',
  declined: 'Declined',
};

export const verdictLabels = {
  undecided: 'Not rated yet',
  list_in_pilot: 'List in pilot',
  later: 'Later',
  not_suitable: 'Not suitable',
} as const;
export type LeadVerdict = keyof typeof verdictLabels;

export const siteVisitLabels = {
  not_needed: 'Not needed',
  pending: 'Pending',
  done: 'Done',
} as const;
export type SiteVisit = keyof typeof siteVisitLabels;

export const noteKindLabels = {
  note: 'Note',
  call: 'Call',
  visit: 'Visit',
  message: 'Message',
  stage: 'Stage',
} as const;
export type NoteKind = keyof typeof noteKindLabels;

export type Lead = {
  id: string;
  code: string | null;
  name: string;
  experienceIdea: string;
  district: string;
  locality: string;
  categoryCode: string | null;
  contactName: string;
  phone: string;
  email: string;
  contactSource: string;
  contactConfirmed: boolean;
  stage: LeadStage;
  verdict: LeadVerdict;
  siteVisit: SiteVisit;
  mediaReceived: boolean;
  rightsConfirmed: boolean;
  agreementSigned: boolean;
  writeupFinal: boolean;
  ownerId: string | null;
  ownerName: string | null;
  hostId: string | null;
  hostName: string | null;
  hostStatus: string | null;
  nextFollowUp: string | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type LeadNote = {
  id: string;
  kind: NoteKind;
  body: string;
  createdAt: string;
  authorName: string;
};

export type LeadDetail = Lead & { notes: LeadNote[] };

export type TrackerRow = {
  district: string;
  longlisted: number;
  rated: number;
  listInPilot: number;
  siteVisitsPending: number;
  mediaReceived: number;
  writeupFinal: number;
  onboardedOrLive: number;
};

export type Overview = {
  queue: { hosts: number; experiences: number; media: number };
  bookings: {
    last30Days: {
      total: number;
      guests: number;
      cancelled: number;
      noShows: number;
      checkedIn: number;
    };
    next7Days: { bookings: number; guests: number };
    byArea: { area: string; bookings: number }[];
  };
  people: { active: number; newLast30Days: number };
  hosts: { active: number; expiringSoon: number };
  listings: { published: number; drafts: number };
  community: { published: number };
  pipeline: {
    stages: { stage: LeadStage; label: string; count: number }[];
    tracker: TrackerRow[];
    followUpsDue: number;
  };
};

export type AdminUser = {
  id: string;
  displayName: string;
  email: string | null;
  status: string;
  isDemo: boolean;
  createdAt: string;
  roles: string[];
  hostStatus: string | null;
  bookings: number;
};

export type AdminUserDetail = AdminUser & {
  language: string;
  activeSessions: number;
  host: {
    id: string;
    publicName: string;
    status: string;
    approvedUntil: string | null;
  } | null;
  bookings: {
    id: string;
    reference: string;
    status: string;
    quantity: number;
    experienceTitle: string;
    startsAt: string;
  }[];
  activity: { action: string; entityType: string; createdAt: string }[];
};

export type AdminBooking = {
  id: string;
  reference: string;
  status: string;
  quantity: number;
  contactName: string;
  contactEmail: string;
  createdAt: string;
  experienceTitle: string;
  experienceSlug: string;
  hostName: string;
  startsAt: string;
  ticketStatus: string | null;
};

const dateTime = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const dateOnly = new Intl.DateTimeFormat('en-IN', {
  timeZone: 'Asia/Kolkata',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export const formatDateTime = (value: string) =>
  dateTime.format(new Date(value)) + ' IST';
export const formatDate = (value: string) =>
  dateOnly.format(
    new Date(
      /^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T00:00:00+05:30' : value,
    ),
  );

// Today's date in India, as YYYY-MM-DD, for follow-up comparisons.
export const todayInIndia = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

export const isFollowUpDue = (
  lead: Pick<Lead, 'nextFollowUp' | 'stage'>,
  today = todayInIndia(),
) =>
  !!lead.nextFollowUp &&
  lead.nextFollowUp <= today &&
  lead.stage !== 'live' &&
  lead.stage !== 'declined';

export const humanise = (value: string) =>
  value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
