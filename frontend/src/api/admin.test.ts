import { describe, expect, it } from 'vitest';
import {
  formatDate,
  humanise,
  isFollowUpDue,
  leadStages,
  stageLabels,
  todayInIndia,
} from './admin';

describe('admin helpers', () => {
  it('uses the India calendar day for follow-ups', () => {
    // 20:00 UTC on 19 Nov is already 20 Nov in India.
    expect(todayInIndia(new Date('2026-11-19T20:00:00Z'))).toBe('2026-11-20');
  });

  it('flags follow-ups due today or earlier, except closed leads', () => {
    const today = '2026-11-20';
    expect(
      isFollowUpDue({ nextFollowUp: '2026-11-20', stage: 'idea' }, today),
    ).toBe(true);
    expect(
      isFollowUpDue({ nextFollowUp: '2026-11-19', stage: 'contacted' }, today),
    ).toBe(true);
    expect(
      isFollowUpDue({ nextFollowUp: '2026-11-21', stage: 'idea' }, today),
    ).toBe(false);
    expect(
      isFollowUpDue({ nextFollowUp: '2026-11-01', stage: 'live' }, today),
    ).toBe(false);
    expect(
      isFollowUpDue({ nextFollowUp: '2026-11-01', stage: 'declined' }, today),
    ).toBe(false);
    expect(isFollowUpDue({ nextFollowUp: null, stage: 'idea' }, today)).toBe(
      false,
    );
  });

  it('formats plain dates without shifting the day', () => {
    expect(formatDate('2026-11-20')).toBe('20 Nov 2026');
  });

  it('labels every stage and humanises codes', () => {
    for (const stage of leadStages) expect(stageLabels[stage]).toBeTruthy();
    expect(humanise('no_show')).toBe('No show');
  });
});
