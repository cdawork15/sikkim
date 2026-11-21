// Lead score: an explainable 0–100 measure of how likely a curator lead is to
// go live soon. It combines the six-criteria assessment (rated by staff, or
// suggested by the AI assistant and accepted by staff) with pipeline progress,
// readiness and how recently anyone worked the lead. Every point comes from a
// named factor so staff can see why a lead is hot or cold.
import type { LeadStage } from './model.js';

export const assessmentCriteria = [
  ['uniqueness', 'scoreUniqueness', 'Uniqueness'],
  ['story', 'scoreStory', 'Local story'],
  ['readiness', 'scoreReadiness', 'Host readiness'],
  ['access', 'scoreAccess', 'Access'],
  ['safety', 'scoreSafety', 'Safety'],
  ['photo', 'scorePhoto', 'Photo appeal'],
] as const;
export type CriterionKey = (typeof assessmentCriteria)[number][0];
export type CriterionField = (typeof assessmentCriteria)[number][1];

export type ScoreInput = {
  stage: LeadStage;
  verdict: string;
  contactConfirmed: boolean;
  agreementSigned: boolean;
  mediaReceived: boolean;
  rightsConfirmed: boolean;
  writeupFinal: boolean;
  nextFollowUp: string | null;
  lastActivityAt: Date | string;
} & { [K in CriterionField]: number | null };

export type ScoreFactor = { label: string; points: number; max: number };
export type LeadScore = {
  score: number;
  band: 'hot' | 'warm' | 'cold' | 'live' | 'closed';
  assessed: number;
  factors: ScoreFactor[];
};

const stagePoints: Record<LeadStage, number> = {
  idea: 0,
  contacted: 5,
  interested: 10,
  agreement_sent: 15,
  agreed: 20,
  onboarding: 25,
  live: 25,
  paused: 0,
  declined: 0,
};

const DAY = 86_400_000;

/** Today's date in India as YYYY-MM-DD (follow-ups are kept in IST). */
export function istToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

export function scoreLead(lead: ScoreInput, now: Date = new Date()): LeadScore {
  const ratings = assessmentCriteria
    .map(([, field]) => lead[field])
    .filter((value): value is number => typeof value === 'number');
  const average = ratings.length
    ? ratings.reduce((sum, value) => sum + value, 0) / ratings.length
    : null;
  const fit =
    lead.verdict === 'not_suitable' || average === null
      ? 0
      : Math.round(((average - 1) / 4) * 35);
  const verdict =
    lead.verdict === 'list_in_pilot' ? 5 : lead.verdict === 'later' ? 2 : 0;
  const readiness =
    (lead.contactConfirmed ? 5 : 0) +
    (lead.agreementSigned ? 4 : 0) +
    (lead.mediaReceived ? 4 : 0) +
    (lead.rightsConfirmed ? 3 : 0) +
    (lead.writeupFinal ? 4 : 0);
  const idleDays = Math.max(
    0,
    Math.floor((now.getTime() - new Date(lead.lastActivityAt).getTime()) / DAY),
  );
  const overdue =
    lead.nextFollowUp !== null && lead.nextFollowUp < istToday(now);
  const recency =
    idleDays <= 7 ? 15 : idleDays <= 14 ? 10 : idleDays <= 30 ? 5 : 0;
  const engagement = Math.max(0, recency - (overdue ? 5 : 0));

  const factors: ScoreFactor[] = [
    {
      label:
        average === null
          ? 'Assessment: not rated yet'
          : lead.verdict === 'not_suitable'
            ? 'Assessment: marked not suitable'
            : `Assessment: ${average.toFixed(1)} of 5 across ${ratings.length} criteria`,
      points: fit,
      max: 35,
    },
    { label: `Stage progress`, points: stagePoints[lead.stage], max: 25 },
    { label: 'Readiness checklist', points: readiness, max: 20 },
    {
      label:
        `Last activity ${idleDays === 0 ? 'within a day' : `${idleDays} day${idleDays === 1 ? '' : 's'} ago`}` +
        (overdue ? ' · follow-up overdue' : ''),
      points: engagement,
      max: 15,
    },
    { label: 'Verdict', points: verdict, max: 5 },
  ];
  let score = factors.reduce((sum, factor) => sum + factor.points, 0);
  if (lead.verdict === 'not_suitable') score = Math.min(score, 10);
  const band: LeadScore['band'] =
    lead.stage === 'live'
      ? 'live'
      : lead.stage === 'declined' || lead.stage === 'paused'
        ? 'closed'
        : score >= 70
          ? 'hot'
          : score >= 40
            ? 'warm'
            : 'cold';
  return { score, band, assessed: ratings.length, factors };
}
