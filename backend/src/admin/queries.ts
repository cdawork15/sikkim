// Shared CRM queries used by the lead service and the CRM service.
import type { PoolClient } from 'pg';

export const taskSelect = `
  t.id,
  t.title,
  to_char(t.due_on, 'YYYY-MM-DD') AS "dueOn",
  t.status,
  t.source,
  t.assignee_id AS "assigneeId",
  a.display_name AS "assigneeName",
  t.lead_id AS "leadId",
  l.name AS "leadName",
  l.code AS "leadCode",
  l.stage AS "leadStage",
  t.created_at AS "createdAt",
  t.completed_at AS "completedAt"
`;
export const taskFrom = `
  FROM public.crm_tasks t
    JOIN public.crm_leads l ON l.id = t.lead_id
    LEFT JOIN public.users a ON a.id = t.assignee_id
`;

export async function leadTasks(client: PoolClient, leadId: string) {
  return (
    await client.query(
      `
        SELECT ${taskSelect} ${taskFrom}
        WHERE t.lead_id = $1
        ORDER BY t.status = 'open' DESC, t.due_on ASC NULLS LAST,
          t.completed_at DESC NULLS LAST, t.created_at DESC
        LIMIT 50
      `,
      [leadId],
    )
  ).rows;
}

export async function latestBrief(client: PoolClient, leadId: string) {
  return (
    (
      await client.query(
        `
          SELECT r.id, r.result AS brief, r.model, r.created_at AS "createdAt",
            u.display_name AS "requestedBy"
          FROM public.crm_ai_runs r JOIN public.users u ON u.id = r.requested_by
          WHERE r.lead_id = $1
          ORDER BY r.created_at DESC
          LIMIT 1
        `,
        [leadId],
      )
    ).rows[0] ?? null
  );
}
