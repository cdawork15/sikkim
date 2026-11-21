// Workflow automation for the curator CRM. Runs inside the same transaction as
// the change that triggers it, so a lead and its automatic follow-ups are
// always saved together.
//
//   routing   a new lead without an owner goes to the staff member who
//             already works that district, else whoever has the fewest open leads
//   playbook  entering a stage creates that stage's follow-up task for the owner
//             and cancels automatic tasks left over from earlier stages
//   records   signing the agreement moves an early-stage lead to "Agreed";
//             finishing a task counts as activity on the lead
import type { PoolClient } from 'pg';
import { stageLabels, type LeadStage } from './model.js';

export const playbook: Partial<
  Record<LeadStage, { rule: string; title: string; days: number }>
> = {
  idea: {
    rule: 'stage.idea',
    title: 'Make the first call and confirm the contact',
    days: 3,
  },
  contacted: {
    rule: 'stage.contacted',
    title: 'Call back to confirm interest and the experience details',
    days: 3,
  },
  interested: {
    rule: 'stage.interested',
    title: 'Rate the six assessment criteria and plan a site visit',
    days: 5,
  },
  agreement_sent: {
    rule: 'stage.agreement_sent',
    title: 'Chase the signed curator agreement',
    days: 4,
  },
  agreed: {
    rule: 'stage.agreed',
    title: 'Collect photos, reel footage, the rights note and the write-up',
    days: 7,
  },
  onboarding: {
    rule: 'stage.onboarding',
    title: 'Build the listing draft and submit it for review',
    days: 5,
  },
};

const preAgreement: LeadStage[] = [
  'idea',
  'contacted',
  'interested',
  'agreement_sent',
];

const today = `(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date`;

/** Picks an owner for a new lead. Returns null when there is no active staff. */
export async function routeLead(
  client: PoolClient,
  district: string,
): Promise<string | null> {
  const row = (
    await client.query<{ id: string }>(
      `
        SELECT u.id
        FROM public.users u
        WHERE u.status = 'active'
          AND EXISTS (
            SELECT 1 FROM public.user_roles r
            WHERE r.user_id = u.id AND r.role IN ('admin', 'super')
          )
        ORDER BY
          EXISTS (
            SELECT 1 FROM public.crm_leads l
            WHERE l.owner_id = u.id AND $1 <> '' AND lower(l.district) = lower($1)
              AND l.stage NOT IN ('live', 'paused', 'declined')
          ) DESC,
          (
            SELECT count(*) FROM public.crm_leads l
            WHERE l.owner_id = u.id AND l.stage NOT IN ('live', 'paused', 'declined')
          ) ASC,
          u.created_at,
          u.id
        LIMIT 1
      `,
      [district],
    )
  ).rows[0];
  return row?.id ?? null;
}

/** The agreement rule: returns the stage the lead should move to, if any. */
export function autoStage(
  current: LeadStage,
  change: { stage?: LeadStage; agreementSigned?: boolean },
  wasSigned: boolean,
): LeadStage | null {
  if (change.stage !== undefined) return null;
  if (
    change.agreementSigned === true &&
    !wasSigned &&
    preAgreement.includes(current)
  )
    return 'agreed';
  return null;
}

async function note(
  client: PoolClient,
  leadId: string,
  authorId: string,
  body: string,
) {
  await client.query(
    `INSERT INTO public.crm_lead_notes (lead_id, author_id, kind, body)
     VALUES ($1, $2, 'automation', $3)`,
    [leadId, authorId, body],
  );
}

/** Applies the stage playbook after a lead enters `stage`. */
export async function enterStage(
  client: PoolClient,
  leadId: string,
  stage: LeadStage,
  actorId: string,
  { keepFollowUp = false }: { keepFollowUp?: boolean } = {},
) {
  const step = playbook[stage];
  const cancelled = await client.query(
    `
      UPDATE public.crm_tasks
      SET status = 'cancelled', completed_at = clock_timestamp(), completed_by = $2
      WHERE lead_id = $1 AND status = 'open' AND source = 'automation'
        AND rule IS DISTINCT FROM $3
    `,
    [leadId, actorId, step?.rule ?? null],
  );
  if (cancelled.rowCount) {
    await note(
      client,
      leadId,
      actorId,
      `Closed ${cancelled.rowCount} automatic task${cancelled.rowCount === 1 ? '' : 's'} from the previous stage.`,
    );
  }
  if (!step) return;
  const existing = await client.query(
    `SELECT 1 FROM public.crm_tasks
     WHERE lead_id = $1 AND status = 'open' AND rule = $2`,
    [leadId, step.rule],
  );
  if (existing.rowCount) return;
  const task = (
    await client.query<{ dueOn: string }>(
      `
        INSERT INTO public.crm_tasks
          (lead_id, title, due_on, assignee_id, source, rule, created_by)
        SELECT l.id, $2, ${today} + $3::int, coalesce(l.owner_id, $4), 'automation', $5, $4
        FROM public.crm_leads l WHERE l.id = $1
        RETURNING to_char(due_on, 'YYYY-MM-DD') AS "dueOn"
      `,
      [leadId, step.title, step.days, actorId, step.rule],
    )
  ).rows[0]!;
  // Keep the lead's follow-up date useful: fill it when empty or already past,
  // unless staff set the date in the same change.
  if (!keepFollowUp)
    await client.query(
      `
      UPDATE public.crm_leads
      SET next_follow_up = $2::date
      WHERE id = $1 AND (next_follow_up IS NULL OR next_follow_up < ${today})
    `,
      [leadId, task.dueOn],
    );
  await note(
    client,
    leadId,
    actorId,
    `${stageLabels[stage]} playbook: “${step.title}” due ${task.dueOn}.`,
  );
}
