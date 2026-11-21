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
  task: 'Task',
  automation: 'Automatic',
  ai: 'AI',
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
  scoreUniqueness: number | null;
  scoreStory: number | null;
  scoreReadiness: number | null;
  scoreAccess: number | null;
  scoreSafety: number | null;
  scorePhoto: number | null;
  expectedMonthlyPaise: number | null;
  lastActivityAt: string;
  stageChangedAt: string;
  score: LeadScore;
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type ScoreBand = 'hot' | 'warm' | 'cold' | 'live' | 'closed';
export type LeadScore = {
  score: number;
  band: ScoreBand;
  assessed: number;
  factors: { label: string; points: number; max: number }[];
};
export const bandLabels: Record<ScoreBand, string> = {
  hot: 'Hot',
  warm: 'Warm',
  cold: 'Cold',
  live: 'Live',
  closed: 'Closed',
};

// The six assessment criteria (1–5), in the order of the proposal.
export const assessmentCriteria = [
  ['scoreUniqueness', 'uniqueness', 'Uniqueness'],
  ['scoreStory', 'story', 'Local story'],
  ['scoreReadiness', 'readiness', 'Host readiness'],
  ['scoreAccess', 'access', 'Access'],
  ['scoreSafety', 'safety', 'Safety'],
  ['scorePhoto', 'photo', 'Photo appeal'],
] as const;
export type CriterionKey = (typeof assessmentCriteria)[number][1];

export type TaskStatus = 'open' | 'done' | 'cancelled';
export type CrmTask = {
  id: string;
  title: string;
  dueOn: string | null;
  status: TaskStatus;
  source: 'staff' | 'automation';
  assigneeId: string | null;
  assigneeName: string | null;
  leadId: string;
  leadName: string;
  leadCode: string | null;
  leadStage: LeadStage;
  createdAt: string;
  completedAt: string | null;
};

export type LeadBrief = {
  summary: string;
  nextAction: string;
  risks: string[];
  followUpMessage: string;
  assessment: Record<CriterionKey, { rating: number | null; reason: string }>;
  confidence: 'low' | 'medium' | 'high';
};
export type BriefRun = {
  id: string;
  brief: LeadBrief;
  model: string;
  createdAt: string;
  requestedBy: string;
};

export type LeadNote = {
  id: string;
  kind: NoteKind;
  body: string;
  createdAt: string;
  authorName: string;
};

export type LeadDetail = Lead & {
  notes: LeadNote[];
  tasks: CrmTask[];
  assistant: { enabled: boolean; latest: BriefRun | null };
};

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
  accounts: {
    total: number;
    last24Hours: number;
    last7Days: number;
    suspended: number;
    withEmail: number;
    withPhone: number;
    admins: number;
    supers: number;
    signups: { day: string; accounts: number }[];
  };
  reels: { live: number; pending: number };
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
  phone: string | null;
  signInMethods: string[];
  lastSignInAt: string | null;
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

export type Queue = {
  hosts: number;
  experiences: number;
  media: number;
  followUpsDue: number;
  tasksDue: number;
};

type Paise = number;
export type CrmReport = {
  generatedAt: string;
  scoring: {
    hot: number;
    warm: number;
    cold: number;
    topLeads: {
      id: string;
      code: string | null;
      name: string;
      stage: LeadStage;
      ownerName: string | null;
      score: number;
      band: ScoreBand;
    }[];
  };
  health: {
    stale: number;
    followUpsOverdue: number;
    tasksOverdue: number;
    unassessed: number;
    unowned: number;
    stages: {
      stage: LeadStage;
      label: string;
      count: number;
      avgDaysInStage: number | null;
    }[];
    funnel: { stage: LeadStage; label: string; count: number }[];
  };
  team: {
    id: string;
    name: string;
    openLeads: number;
    hotLeads: number;
    averageScore: number | null;
    activities30d: number;
    tasksDone30d: number;
    tasksOverdue: number;
    wentLive90d: number;
  }[];
  forecast: {
    currency: 'INR';
    currentMonth: string;
    history: { month: string; paise: Paise }[];
    next30Days: { paise: Paise; bookings: number };
    leadsWithoutValue: number;
    liveMonthlyPaise: Paise;
    stageProbability: Record<LeadStage, number>;
    runRatePaise: Paise;
    pipelineTotalPaise: Paise;
    weightedPipelinePaise: Paise;
    byStage: {
      stage: LeadStage;
      leads: number;
      probability: number;
      totalPaise: Paise;
      weightedPaise: Paise;
    }[];
    months: { month: string; bookedPaise: Paise; projectedPaise: Paise }[];
  };
};

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
export const formatRupees = (paise: number) => rupees.format(paise / 100);
export const formatMonth = (month: string) =>
  new Intl.DateTimeFormat('en-IN', { month: 'short', year: 'numeric' }).format(
    new Date(month + '-01T00:00:00+05:30'),
  );

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
