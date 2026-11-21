// Revenue forecast for the curator pipeline.
//
// Bookings are free in the pilot (travellers pay hosts in cash), so "revenue"
// here is booking value: seats × the slot price shown at booking time. When
// payments and commission go live, the same figures feed the finance module.
//
//   actual       booking value of past slots that were not cancelled or no-shows
//   booked       confirmed bookings for slots that have not happened yet
//   run rate     average monthly actual over the last three full months
//   pipeline     expected monthly value of open leads × stage probability
//   projected    max(booked for that month, run rate), plus the weighted
//                pipeline from next month on (new listings need time to go live)
import type { LeadStage } from './model.js';

/** Probability that a lead in this stage goes live (pilot planning values). */
export const stageProbability: Record<LeadStage, number> = {
  idea: 0.05,
  contacted: 0.1,
  interested: 0.25,
  agreement_sent: 0.5,
  agreed: 0.7,
  onboarding: 0.9,
  live: 1,
  paused: 0,
  declined: 0,
};

export const openStages: LeadStage[] = [
  'idea',
  'contacted',
  'interested',
  'agreement_sent',
  'agreed',
  'onboarding',
];

export type MonthValue = { month: string; paise: number };

/** YYYY-MM for a month offset from the given IST month. */
export function monthKey(base: string, offset: number): string {
  const [year, month] = base.split('-').map(Number) as [number, number];
  const index = year * 12 + (month - 1) + offset;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}

export function projectRevenue({
  currentMonth,
  actual,
  booked,
  pipeline,
}: {
  currentMonth: string;
  actual: MonthValue[];
  booked: MonthValue[];
  pipeline: { stage: LeadStage; expectedMonthlyPaise: number }[];
}) {
  const valueFor = (rows: MonthValue[], month: string) =>
    rows.find((row) => row.month === month)?.paise ?? 0;
  const fullMonths = [1, 2, 3].map((n) => monthKey(currentMonth, -n));
  const runRatePaise = Math.round(
    fullMonths.reduce((sum, month) => sum + valueFor(actual, month), 0) / 3,
  );
  const byStage = openStages.map((stage) => {
    const rows = pipeline.filter((row) => row.stage === stage);
    const totalPaise = rows.reduce(
      (sum, row) => sum + row.expectedMonthlyPaise,
      0,
    );
    return {
      stage,
      leads: rows.length,
      probability: stageProbability[stage],
      totalPaise,
      weightedPaise: Math.round(totalPaise * stageProbability[stage]),
    };
  });
  const pipelineTotalPaise = byStage.reduce((s, r) => s + r.totalPaise, 0);
  const weightedPipelinePaise = byStage.reduce(
    (s, r) => s + r.weightedPaise,
    0,
  );
  const months = [0, 1, 2].map((offset) => {
    const month = monthKey(currentMonth, offset);
    const bookedPaise = valueFor(booked, month);
    return {
      month,
      bookedPaise,
      projectedPaise:
        Math.max(bookedPaise, runRatePaise) +
        (offset > 0 ? weightedPipelinePaise : 0),
    };
  });
  return {
    runRatePaise,
    pipelineTotalPaise,
    weightedPipelinePaise,
    byStage,
    months,
  };
}
