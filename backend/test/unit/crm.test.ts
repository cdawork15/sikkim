import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AssistantError,
  anthropicAssistant,
  parseBrief,
  type LeadContext,
} from '../../src/ai/assistant.js';
import { autoStage } from '../../src/admin/automation.js';
import { csvCell, tasksCalendar } from '../../src/admin/crm.js';
import { monthKey, projectRevenue } from '../../src/admin/forecast.js';
import {
  istToday,
  scoreLead,
  type ScoreInput,
} from '../../src/admin/scoring.js';
import { aiConfig, ConfigurationError } from '../../src/config.js';

const now = new Date('2026-11-21T06:00:00Z');
const base: ScoreInput = {
  stage: 'idea',
  verdict: 'undecided',
  contactConfirmed: false,
  agreementSigned: false,
  mediaReceived: false,
  rightsConfirmed: false,
  writeupFinal: false,
  nextFollowUp: null,
  lastActivityAt: now,
  scoreUniqueness: null,
  scoreStory: null,
  scoreReadiness: null,
  scoreAccess: null,
  scoreSafety: null,
  scorePhoto: null,
};

test('lead score explains every point and bands leads', () => {
  const fresh = scoreLead(base, now);
  assert.equal(fresh.score, 15); // only recent activity
  assert.equal(fresh.band, 'cold');
  assert.equal(fresh.assessed, 0);
  assert.equal(
    fresh.factors.reduce((s, f) => s + f.max, 0),
    100,
  );

  const strong = scoreLead(
    {
      ...base,
      stage: 'agreed',
      verdict: 'list_in_pilot',
      contactConfirmed: true,
      agreementSigned: true,
      mediaReceived: true,
      scoreUniqueness: 5,
      scoreStory: 5,
      scoreReadiness: 4,
      scoreAccess: 4,
      scoreSafety: 5,
      scorePhoto: 5,
    },
    now,
  );
  // fit round((4.67-1)/4*35)=32, stage 20, readiness 13, recency 15, verdict 5
  assert.equal(strong.score, 85);
  assert.equal(strong.band, 'hot');

  const idle = scoreLead(
    {
      ...base,
      lastActivityAt: new Date('2026-10-01T00:00:00Z'),
      nextFollowUp: '2026-11-01',
    },
    now,
  );
  assert.equal(idle.factors[3]!.points, 0);
  assert.match(idle.factors[3]!.label, /overdue/);

  const unsuitable = scoreLead(
    { ...base, stage: 'agreed', verdict: 'not_suitable', scoreUniqueness: 5 },
    now,
  );
  assert.ok(unsuitable.score <= 10);
  assert.equal(scoreLead({ ...base, stage: 'live' }, now).band, 'live');
  assert.equal(scoreLead({ ...base, stage: 'declined' }, now).band, 'closed');
});

test('IST dates and month keys', () => {
  assert.equal(istToday(new Date('2026-11-21T19:00:00Z')), '2026-11-22');
  assert.equal(monthKey('2026-11', 0), '2026-11');
  assert.equal(monthKey('2026-11', 2), '2027-01');
  assert.equal(monthKey('2026-01', -1), '2025-12');
});

test('revenue projection combines run rate, bookings and weighted pipeline', () => {
  const result = projectRevenue({
    currentMonth: '2026-11',
    actual: [
      { month: '2026-08', paise: 300_00 },
      { month: '2026-09', paise: 600_00 },
      { month: '2026-10', paise: 900_00 },
      { month: '2026-11', paise: 50_00 },
    ],
    booked: [
      { month: '2026-11', paise: 1000_00 },
      { month: '2026-12', paise: 100_00 },
    ],
    pipeline: [
      { stage: 'agreed', expectedMonthlyPaise: 1000_00 },
      { stage: 'idea', expectedMonthlyPaise: 2000_00 },
    ],
  });
  assert.equal(result.runRatePaise, 600_00);
  assert.equal(result.pipelineTotalPaise, 3000_00);
  assert.equal(result.weightedPipelinePaise, 700_00 + 100_00);
  assert.deepEqual(
    result.months.map((m) => [m.month, m.bookedPaise, m.projectedPaise]),
    [
      ['2026-11', 1000_00, 1000_00],
      ['2026-12', 100_00, 600_00 + 800_00],
      ['2027-01', 0, 600_00 + 800_00],
    ],
  );
});

test('signing the agreement moves early leads to Agreed', () => {
  assert.equal(
    autoStage('interested', { agreementSigned: true }, false),
    'agreed',
  );
  assert.equal(autoStage('onboarding', { agreementSigned: true }, false), null);
  assert.equal(autoStage('interested', { agreementSigned: true }, true), null);
  assert.equal(
    autoStage(
      'interested',
      { agreementSigned: true, stage: 'contacted' },
      false,
    ),
    null,
  );
});

test('CSV cells are quoted and cannot run as formulas', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+91 98000'), "'+91 98000");
  assert.equal(csvCell(null), '');
});

test('calendar export is valid iCalendar with escaping and folding', () => {
  const ics = tasksCalendar(
    [
      {
        id: '00000000-0000-4000-8000-000000000001',
        title: 'Call; confirm, visit\\date ' + 'x'.repeat(80),
        dueOn: '2026-11-30',
        leadName: 'Studio Maato',
        leadCode: 'PKG-02',
      },
    ],
    now,
  );
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261130\r\n/);
  assert.match(ics, /DTEND;VALUE=DATE:20261201\r\n/);
  assert.match(ics, /SUMMARY:Call\\; confirm\\, visit\\\\date/);
  assert.match(ics, /DTSTAMP:20261121T060000Z/);
  for (const line of ics.split('\r\n'))
    assert.ok(Buffer.byteLength(line) <= 75);
  assert.match(ics, /END:VCALENDAR\r\n$/);
});

const goodBrief = {
  summary: 'Pottery studio, interested, no visit yet.',
  nextAction: 'Book the site visit.',
  risks: ['No photos yet', '', 7],
  followUpMessage: 'Namaste! — Sikkim Experiences team',
  assessment: {
    uniqueness: { rating: 4, reason: 'Rare craft' },
    story: { rating: null, reason: 'Not enough detail' },
    readiness: { rating: 3, reason: '' },
    access: { rating: 3, reason: '' },
    safety: { rating: null, reason: '' },
    photo: { rating: 5, reason: '' },
  },
  confidence: 'medium',
};

test('AI brief output is validated before use', () => {
  const brief = parseBrief(goodBrief);
  assert.deepEqual(brief.risks, ['No photos yet']);
  assert.equal(brief.assessment.story.rating, null);
  assert.throws(
    () =>
      parseBrief({
        ...goodBrief,
        assessment: {
          ...goodBrief.assessment,
          photo: { rating: 9, reason: '' },
        },
      }),
    AssistantError,
  );
  assert.throws(
    () => parseBrief({ ...goodBrief, summary: ' ' }),
    AssistantError,
  );
  assert.throws(
    () => parseBrief({ ...goodBrief, confidence: 'sure' }),
    AssistantError,
  );
  assert.throws(() => parseBrief('nope'), AssistantError);
});

const context: LeadContext = {
  name: 'Studio Maato',
  experienceIdea: 'Pottery',
  district: 'Pakyong',
  locality: '',
  category: null,
  stage: 'Interested',
  verdict: 'undecided',
  siteVisit: 'pending',
  checklist: {},
  ratings: {},
  nextFollowUp: null,
  openTasks: [],
  notes: [],
  today: '2026-11-21',
};

test('Anthropic assistant sends a structured request and reads the reply', async () => {
  const calls: Record<string, unknown>[] = [];
  const reply = (stop_reason: string, text: string) => ({
    model: 'claude-opus-5-5',
    stop_reason,
    content: [{ type: 'text', text }],
    usage: { input_tokens: 120, output_tokens: 80 },
  });
  let next = reply('end_turn', JSON.stringify(goodBrief));
  const client = {
    beta: {
      messages: {
        create: (async (params: Record<string, unknown>) => {
          calls.push(params);
          return next;
        }) as never,
      },
    },
  };
  const assistant = anthropicAssistant({
    model: 'claude-opus-5-5',
    apiKey: 'unused-with-injected-client',
    refusalFallback: true,
    client,
  });
  const result = await assistant.brief(context);
  assert.equal(result.inputTokens, 120);
  assert.equal(result.brief.assessment.uniqueness.rating, 4);
  const params = calls[0]!;
  assert.equal(params.model, 'claude-opus-5-5');
  assert.equal(params.fallbacks, 'default');
  assert.deepEqual(params.betas, ['server-side-fallback-2026-07-01']);
  const output = params.output_config as { format: { type: string } };
  assert.equal(output.format.type, 'json_schema');
  const sent = JSON.stringify(params.messages);
  assert.doesNotMatch(sent, /phone|email/i);

  next = reply('refusal', '');
  await assert.rejects(
    assistant.brief(context),
    (e: AssistantError) => e.reason === 'refused',
  );
  next = reply('end_turn', 'not json');
  await assert.rejects(
    assistant.brief(context),
    (e: AssistantError) => e.reason === 'invalid_output',
  );

  const plain = anthropicAssistant({
    model: 'claude-opus-5-5',
    apiKey: 'unused',
    refusalFallback: false,
    client,
  });
  next = reply('end_turn', JSON.stringify(goodBrief));
  await plain.brief(context);
  assert.equal(calls.at(-1)!.fallbacks, undefined);
});

test('AI configuration is off by default and strict when on', () => {
  assert.equal(aiConfig({}).provider, 'disabled');
  assert.throws(() => aiConfig({ AI_PROVIDER: 'openai' }), ConfigurationError);
  assert.throws(
    () => aiConfig({ AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-opus-5-5' }),
    /ANTHROPIC_API_KEY/,
  );
  assert.throws(
    () =>
      aiConfig({ AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'k'.repeat(30) }),
    /AI_MODEL/,
  );
  const on = aiConfig({
    AI_PROVIDER: 'anthropic',
    AI_MODEL: 'claude-opus-5-5',
    ANTHROPIC_API_KEY: 'k'.repeat(30),
    AI_ASSIST_HOURLY_LIMIT: '5',
    AI_REFUSAL_FALLBACK: 'off',
  });
  assert.equal(on.hourlyLimit, 5);
  assert.equal(on.refusalFallback, false);
  assert.throws(
    () => aiConfig({ AI_ASSIST_HOURLY_LIMIT: '0' }),
    ConfigurationError,
  );
});
