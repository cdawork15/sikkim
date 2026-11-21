// Curator CRM beyond the lead record itself: follow-up tasks, the calendar
// feed, pipeline/team/revenue reporting, the CSV export and the AI brief.
import type { PoolClient } from 'pg';
import type { Config } from '../config.js';
import type { Database } from '../db/database.js';
import { accountAccess } from '../accounts/access.js';
import { AccountError } from '../accounts/model.js';
import {
  hasAnyRole,
  requireStaff,
  requireSuper,
  staffRoles,
} from '../accounts/roles.js';
import { audit } from '../db/audit.js';
import {
  AssistantError,
  type LeadAssistant,
  type LeadContext,
} from '../ai/assistant.js';
import { openStages, projectRevenue, stageProbability } from './forecast.js';
import {
  invalid,
  leadStages,
  notFound,
  stageLabels,
  type LeadStage,
  type TaskStatus,
} from './model.js';
import { assessmentCriteria, istToday } from './scoring.js';
import { taskFrom, taskSelect } from './queries.js';
import {
  addNote,
  leadFrom,
  leadSelect,
  readLead,
  withScore,
} from './service.js';

const today = `(clock_timestamp() AT TIME ZONE 'Asia/Kolkata')::date`;

async function readTask(client: PoolClient, id: string, lock = false) {
  if (lock)
    await client.query(
      'SELECT 1 FROM public.crm_tasks WHERE id = $1 FOR UPDATE',
      [id],
    );
  const task = (
    await client.query(`SELECT ${taskSelect} ${taskFrom} WHERE t.id = $1`, [id])
  ).rows[0];
  if (!task) throw notFound('Task');
  return task;
}

async function checkAssignee(client: PoolClient, assigneeId?: string | null) {
  if (assigneeId && !(await hasAnyRole(client, assigneeId, staffRoles)))
    throw invalid('Assign the task to an admin.');
}

const dateOnly = (value?: string | null) => {
  if (value && !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw invalid('Use a due date like 2026-12-01.');
  return value || null;
};

/* ------------------------------------------------------------- exports */

// RFC 5545 text escaping and 75-octet line folding.
const icsText = (value: string) =>
  value.replace(/[\\;,]/g, (c) => '\\' + c).replace(/\r?\n/g, '\\n');
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}
const icsDate = (date: string) => date.replace(/-/g, '');
const nextDay = (date: string) => {
  const d = new Date(date + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export function tasksCalendar(
  tasks: {
    id: string;
    title: string;
    dueOn: string;
    leadName: string;
    leadCode: string | null;
  }[],
  now = new Date(),
) {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sikkim Experiences//Curator CRM//EN',
    'CALSCALE:GREGORIAN',
    'X-WR-CALNAME:Sikkim Experiences CRM tasks',
  ];
  for (const task of tasks) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${task.id}@crm-tasks`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(task.dueOn)}`,
      `DTEND;VALUE=DATE:${icsDate(nextDay(task.dueOn))}`,
      `SUMMARY:${icsText(task.title)}`,
      `DESCRIPTION:${icsText(`Curator lead: ${task.leadCode ? task.leadCode + ' ' : ''}${task.leadName}`)}`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

// Cells that start with = + - @ (or a tab/CR) are prefixed so spreadsheet apps
// show them as text instead of running them as formulas.
export function csvCell(value: unknown) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/* ------------------------------------------------------------- service */

export function crmService(
  database: Database,
  config: Config,
  assistant: LeadAssistant | null,
) {
  const access = accountAccess(database, config);
  const asStaff = <T>(
    token: string,
    task: (client: PoolClient, userId: string) => Promise<T>,
  ) =>
    access(token, async (client, p) => {
      await requireStaff(client, p.userId);
      return task(client, p.userId);
    });
  const asSuper = <T>(
    token: string,
    task: (client: PoolClient, userId: string) => Promise<T>,
  ) =>
    access(token, async (client, p) => {
      await requireSuper(client, p.userId);
      return task(client, p.userId);
    });

  return {
    listTasks: (
      token: string,
      filter: { scope: 'mine' | 'everyone'; status: TaskStatus },
    ) =>
      asStaff(token, async (client, userId) => ({
        data: (
          await client.query(
            `
              SELECT ${taskSelect} ${taskFrom}
              WHERE t.status = $1 AND ($2::uuid IS NULL OR t.assignee_id = $2)
              ORDER BY
                CASE WHEN t.status = 'open' THEN t.due_on END ASC NULLS LAST,
                t.completed_at DESC NULLS LAST,
                t.created_at DESC, t.id DESC
              LIMIT 200
            `,
            [filter.status, filter.scope === 'mine' ? userId : null],
          )
        ).rows,
      })),

    createTask: (
      token: string,
      leadId: string,
      body: {
        title: string;
        dueOn?: string | null;
        assigneeId?: string | null;
      },
      requestId: string,
    ) =>
      asStaff(token, async (client, userId) => {
        const lead = await readLead(client, leadId, true);
        const title = body.title.trim();
        if (!title) throw invalid('Describe the task.');
        await checkAssignee(client, body.assigneeId);
        const id = (
          await client.query<{ id: string }>(
            `
              INSERT INTO public.crm_tasks (lead_id, title, due_on, assignee_id, created_by)
              VALUES ($1, $2, $3, $4, $5)
              RETURNING id
            `,
            [
              leadId,
              title,
              dateOnly(body.dueOn),
              body.assigneeId === undefined
                ? (lead.ownerId ?? userId)
                : body.assigneeId,
              userId,
            ],
          )
        ).rows[0]!.id;
        await audit(
          client,
          userId,
          'crm.task_created',
          requestId,
          'crm_task',
          id,
        );
        return readTask(client, id);
      }),

    updateTask: (
      token: string,
      id: string,
      body: {
        status?: TaskStatus;
        title?: string;
        dueOn?: string | null;
        assigneeId?: string | null;
      },
      requestId: string,
    ) =>
      asStaff(token, async (client, userId) => {
        const current = await readTask(client, id, true);
        if (body.title !== undefined && !body.title.trim())
          throw invalid('Describe the task.');
        await checkAssignee(client, body.assigneeId);
        const status = body.status ?? current.status;
        await client.query(
          `
            UPDATE public.crm_tasks SET
              title = coalesce($2, title),
              due_on = CASE WHEN $3 THEN $4::date ELSE due_on END,
              assignee_id = CASE WHEN $5 THEN $6::uuid ELSE assignee_id END,
              status = $7::text,
              completed_at = CASE
                WHEN $7::text = 'open' THEN NULL
                WHEN status = 'open' THEN clock_timestamp()
                ELSE completed_at END,
              completed_by = CASE
                WHEN $7::text = 'open' THEN NULL
                WHEN status = 'open' THEN $8::uuid
                ELSE completed_by END
            WHERE id = $1
          `,
          [
            id,
            body.title?.trim() ?? null,
            body.dueOn !== undefined,
            dateOnly(body.dueOn),
            body.assigneeId !== undefined,
            body.assigneeId ?? null,
            status,
            userId,
          ],
        );
        if (status === 'done' && current.status !== 'done') {
          // Finishing a follow-up is activity on the lead.
          await addNote(
            client,
            current.leadId,
            userId,
            'task',
            `Done: ${current.title}`,
          );
        }
        await audit(
          client,
          userId,
          'crm.task_updated',
          requestId,
          'crm_task',
          id,
        );
        return readTask(client, id);
      }),

    calendar: (token: string) =>
      asStaff(token, async (client, userId) => {
        const tasks = (
          await client.query(
            `
              SELECT ${taskSelect} ${taskFrom}
              WHERE t.status = 'open' AND t.assignee_id = $1 AND t.due_on IS NOT NULL
              ORDER BY t.due_on, t.id
              LIMIT 500
            `,
            [userId],
          )
        ).rows;
        return tasksCalendar(tasks);
      }),

    exportLeads: (token: string, requestId: string) =>
      asSuper(token, async (client, userId) => {
        const rows = (
          await client.query(
            `SELECT ${leadSelect} ${leadFrom} ORDER BY l.created_at, l.id LIMIT 10000`,
          )
        ).rows.map(withScore);
        const columns: [string, (row: (typeof rows)[number]) => unknown][] = [
          ['Tracker ID', (r) => r.code],
          ['Name', (r) => r.name],
          ['Experience idea', (r) => r.experienceIdea],
          ['District', (r) => r.district],
          ['Locality', (r) => r.locality],
          ['Category', (r) => r.categoryCode],
          ['Stage', (r) => stageLabels[r.stage as LeadStage]],
          ['Score', (r) => r.score.score],
          ['Band', (r) => r.score.band],
          ...assessmentCriteria.map(
            ([, field, label]) =>
              [label, (r: (typeof rows)[number]) => r[field]] as [
                string,
                (row: (typeof rows)[number]) => unknown,
              ],
          ),
          ['Verdict', (r) => r.verdict],
          ['Site visit', (r) => r.siteVisit],
          ['Contact person', (r) => r.contactName],
          ['Phone', (r) => r.phone],
          ['Email', (r) => r.email],
          ['Contact source', (r) => r.contactSource],
          ['Contact confirmed', (r) => (r.contactConfirmed ? 'yes' : 'no')],
          ['Agreement signed', (r) => (r.agreementSigned ? 'yes' : 'no')],
          ['Media received', (r) => (r.mediaReceived ? 'yes' : 'no')],
          ['Rights confirmed', (r) => (r.rightsConfirmed ? 'yes' : 'no')],
          ['Write-up final', (r) => (r.writeupFinal ? 'yes' : 'no')],
          [
            'Expected monthly value (INR)',
            (r) =>
              r.expectedMonthlyPaise === null
                ? ''
                : r.expectedMonthlyPaise / 100,
          ],
          ['Owner', (r) => r.ownerName],
          ['Next follow-up', (r) => r.nextFollowUp],
          ['Last activity', (r) => new Date(r.lastActivityAt).toISOString()],
          ['Created', (r) => new Date(r.createdAt).toISOString()],
        ];
        await audit(client, userId, 'crm.leads_exported', requestId);
        return (
          [
            columns.map(([label]) => csvCell(label)).join(','),
            ...rows.map((row) =>
              columns.map(([, get]) => csvCell(get(row))).join(','),
            ),
          ].join('\r\n') + '\r\n'
        );
      }),

    report: (token: string) =>
      asSuper(token, async (client) => {
        const leads = (
          await client.query(
            `SELECT ${leadSelect} ${leadFrom} WHERE l.stage <> 'declined' LIMIT 5000`,
          )
        ).rows.map(withScore);
        const open = leads.filter((l) => openStages.includes(l.stage));
        const bands = { hot: 0, warm: 0, cold: 0 };
        for (const lead of open) {
          if (lead.score.band in bands)
            bands[lead.score.band as keyof typeof bands]++;
        }
        const topLeads = [...open]
          .sort(
            (a, b) =>
              b.score.score - a.score.score || a.name.localeCompare(b.name),
          )
          .slice(0, 8)
          .map((l) => ({
            id: l.id,
            code: l.code,
            name: l.name,
            stage: l.stage,
            ownerName: l.ownerName,
            score: l.score.score,
            band: l.score.band,
          }));

        const now = Date.now();
        const days = (at: Date | string) =>
          (now - new Date(at).getTime()) / 86_400_000;
        const stages = leadStages.map((stage) => {
          const rows =
            stage === 'declined' ? [] : leads.filter((l) => l.stage === stage);
          return {
            stage,
            label: stageLabels[stage],
            count: rows.length,
            avgDaysInStage: rows.length
              ? Math.round(
                  rows.reduce((s, l) => s + days(l.stageChangedAt), 0) /
                    rows.length,
                )
              : null,
          };
        });
        const declined = (
          await client.query(
            `SELECT count(*)::int AS count FROM public.crm_leads WHERE stage = 'declined'`,
          )
        ).rows[0].count as number;
        stages.find((s) => s.stage === 'declined')!.count = declined;
        const order = (stage: LeadStage) => leadStages.indexOf(stage);
        const funnel = (
          ['contacted', 'interested', 'agreed', 'live'] as const
        ).map((stage) => ({
          stage,
          label: stageLabels[stage],
          count: leads.filter(
            (l) =>
              (openStages.includes(l.stage) || l.stage === 'live') &&
              order(l.stage) >= order(stage),
          ).length,
        }));
        const health = (
          await client.query(`
            SELECT
              (SELECT count(*)::int FROM public.crm_leads
                WHERE stage NOT IN ('live', 'paused', 'declined')
                  AND last_activity_at < clock_timestamp() - interval '14 days') AS stale,
              (SELECT count(*)::int FROM public.crm_leads
                WHERE next_follow_up < ${today}
                  AND stage NOT IN ('live', 'paused', 'declined')) AS "followUpsOverdue",
              (SELECT count(*)::int FROM public.crm_tasks
                WHERE status = 'open' AND due_on < ${today}) AS "tasksOverdue",
              (SELECT count(*)::int FROM public.crm_leads
                WHERE stage NOT IN ('live', 'paused', 'declined')
                  AND score_uniqueness IS NULL AND score_story IS NULL
                  AND score_readiness IS NULL AND score_access IS NULL
                  AND score_safety IS NULL AND score_photo IS NULL) AS unassessed,
              (SELECT count(*)::int FROM public.crm_leads
                WHERE stage NOT IN ('live', 'paused', 'declined')
                  AND owner_id IS NULL) AS unowned
          `)
        ).rows[0];

        const team = (
          await client.query(`
            SELECT
              u.id,
              u.display_name AS name,
              (SELECT count(*)::int FROM public.crm_leads l
                WHERE l.owner_id = u.id AND l.stage NOT IN ('live', 'paused', 'declined')) AS "openLeads",
              (SELECT count(*)::int FROM public.crm_lead_notes n
                WHERE n.author_id = u.id AND n.kind IN ('note', 'call', 'visit', 'message', 'task')
                  AND n.created_at > clock_timestamp() - interval '30 days') AS "activities30d",
              (SELECT count(*)::int FROM public.crm_tasks t
                WHERE t.completed_by = u.id AND t.status = 'done'
                  AND t.completed_at > clock_timestamp() - interval '30 days') AS "tasksDone30d",
              (SELECT count(*)::int FROM public.crm_tasks t
                WHERE t.assignee_id = u.id AND t.status = 'open' AND t.due_on < ${today}) AS "tasksOverdue",
              (SELECT count(*)::int FROM public.crm_leads l
                WHERE l.owner_id = u.id AND l.stage = 'live'
                  AND l.stage_changed_at > clock_timestamp() - interval '90 days') AS "wentLive90d"
            FROM public.users u
            WHERE u.status = 'active'
              AND EXISTS (SELECT 1 FROM public.user_roles r
                WHERE r.user_id = u.id AND r.role IN ('admin', 'super'))
            ORDER BY u.display_name, u.id
          `)
        ).rows.map((member) => ({
          ...member,
          hotLeads: open.filter(
            (l) => l.ownerId === member.id && l.score.band === 'hot',
          ).length,
          averageScore: (() => {
            const mine = open.filter((l) => l.ownerId === member.id);
            return mine.length
              ? Math.round(
                  mine.reduce((s, l) => s + l.score.score, 0) / mine.length,
                )
              : null;
          })(),
        }));

        // Revenue: booking value by IST month (seats × slot price).
        const money = async (sql: string) =>
          (await client.query(sql)).rows.map((r) => ({
            month: r.month as string,
            paise: Number(r.paise),
          }));
        const monthStart = `(date_trunc('month', clock_timestamp() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
        const actual = await money(`
          SELECT to_char(s.starts_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month,
            sum(b.quantity::bigint * s.price_paise) AS paise
          FROM public.bookings b JOIN public.experience_slots s ON s.id = b.slot_id
          WHERE b.status = 'confirmed'
            AND s.starts_at < clock_timestamp()
            AND s.starts_at >= ${monthStart} - interval '6 months'
          GROUP BY 1 ORDER BY 1
        `);
        const booked = await money(`
          SELECT to_char(s.starts_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM') AS month,
            sum(b.quantity::bigint * s.price_paise) AS paise
          FROM public.bookings b JOIN public.experience_slots s ON s.id = b.slot_id
          WHERE b.status = 'confirmed'
            AND s.starts_at >= clock_timestamp()
            AND s.starts_at < ${monthStart} + interval '3 months'
          GROUP BY 1 ORDER BY 1
        `);
        const ahead = (
          await client.query(`
            SELECT coalesce(sum(b.quantity::bigint * s.price_paise), 0) AS paise,
              count(*)::int AS bookings
            FROM public.bookings b JOIN public.experience_slots s ON s.id = b.slot_id
            WHERE b.status = 'confirmed'
              AND s.starts_at BETWEEN clock_timestamp() AND clock_timestamp() + interval '30 days'
          `)
        ).rows[0];
        const currentMonth = istToday().slice(0, 7);
        const projection = projectRevenue({
          currentMonth,
          actual,
          booked,
          pipeline: open
            .filter((l) => l.expectedMonthlyPaise !== null)
            .map((l) => ({
              stage: l.stage,
              expectedMonthlyPaise: l.expectedMonthlyPaise,
            })),
        });
        return {
          generatedAt: new Date().toISOString(),
          scoring: { ...bands, topLeads },
          health: { ...health, stages, funnel },
          team,
          forecast: {
            currency: 'INR',
            currentMonth,
            history: actual,
            next30Days: {
              paise: Number(ahead.paise),
              bookings: ahead.bookings,
            },
            leadsWithoutValue: open.filter(
              (l) => l.expectedMonthlyPaise === null,
            ).length,
            liveMonthlyPaise: leads
              .filter((l) => l.stage === 'live')
              .reduce((s, l) => s + (l.expectedMonthlyPaise ?? 0), 0),
            stageProbability,
            ...projection,
          },
        };
      }),

    generateBrief: async (token: string, leadId: string, requestId: string) => {
      if (!assistant)
        throw new AccountError(
          503,
          'AI_DISABLED',
          'The AI assistant is not switched on for this workspace.',
        );
      const context = await asStaff(token, async (client, userId) => {
        const used = (
          await client.query(
            `SELECT count(*)::int AS count FROM public.crm_ai_runs
             WHERE requested_by = $1 AND created_at > clock_timestamp() - interval '1 hour'`,
            [userId],
          )
        ).rows[0].count as number;
        if (used >= config.ai.hourlyLimit)
          throw new AccountError(
            429,
            'AI_LIMIT',
            'You have used this hour’s AI briefs. Try again later.',
          );
        const lead = await readLead(client, leadId);
        const category = lead.categoryCode
          ? ((
              await client.query(
                'SELECT name FROM public.categories WHERE code = $1',
                [lead.categoryCode],
              )
            ).rows[0]?.name ?? null)
          : null;
        const notes = (
          await client.query(
            `SELECT kind, body, to_char(created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS "createdAt"
             FROM public.crm_lead_notes
             WHERE lead_id = $1 AND kind <> 'ai'
             ORDER BY created_at DESC, id DESC LIMIT 40`,
            [leadId],
          )
        ).rows;
        const tasks = (
          await client.query(
            `SELECT title, to_char(due_on, 'YYYY-MM-DD') AS "dueOn"
             FROM public.crm_tasks WHERE lead_id = $1 AND status = 'open'
             ORDER BY due_on NULLS LAST LIMIT 20`,
            [leadId],
          )
        ).rows;
        // Phone numbers, email addresses and contact names stay out of the prompt.
        const context: LeadContext = {
          name: lead.name,
          experienceIdea: lead.experienceIdea,
          district: lead.district,
          locality: lead.locality,
          category,
          stage: stageLabels[lead.stage as LeadStage],
          verdict: lead.verdict,
          siteVisit: lead.siteVisit,
          checklist: {
            contactConfirmed: lead.contactConfirmed,
            agreementSigned: lead.agreementSigned,
            mediaReceived: lead.mediaReceived,
            rightsConfirmed: lead.rightsConfirmed,
            writeupFinal: lead.writeupFinal,
          },
          ratings: Object.fromEntries(
            assessmentCriteria.map(([key, field]) => [key, lead[field]]),
          ),
          nextFollowUp: lead.nextFollowUp,
          openTasks: tasks,
          notes,
          today: istToday(),
        };
        return context;
      });
      // The model call runs outside any database transaction or lock.
      let result;
      try {
        result = await assistant.brief(context);
      } catch (error) {
        if (error instanceof AssistantError) {
          if (error.reason === 'refused')
            throw new AccountError(
              422,
              'AI_DECLINED',
              'The AI could not brief this lead.',
            );
          if (error.reason === 'invalid_output')
            throw new AccountError(
              502,
              'AI_FAILED',
              'The AI brief could not be read. Try again.',
            );
        }
        throw new AccountError(
          503,
          'AI_UNAVAILABLE',
          'The AI service is not reachable. Try again later.',
        );
      }
      return asStaff(token, async (client, userId) => {
        await readLead(client, leadId, true);
        const run = (
          await client.query<{ id: string }>(
            `
              INSERT INTO public.crm_ai_runs
                (lead_id, requested_by, provider, model, result, input_tokens, output_tokens)
              VALUES ($1, $2, $3, $4, $5, $6, $7)
              RETURNING id
            `,
            [
              leadId,
              userId,
              assistant.provider,
              result.model,
              JSON.stringify(result.brief),
              result.inputTokens,
              result.outputTokens,
            ],
          )
        ).rows[0]!;
        await addNote(
          client,
          leadId,
          userId,
          'ai',
          `AI brief generated (${result.model}).`,
        );
        await audit(
          client,
          userId,
          'crm.ai_brief',
          requestId,
          'crm_lead',
          leadId,
        );
        return (
          await client.query(
            `SELECT r.id, r.result AS brief, r.model, r.created_at AS "createdAt",
               u.display_name AS "requestedBy"
             FROM public.crm_ai_runs r JOIN public.users u ON u.id = r.requested_by
             WHERE r.id = $1`,
            [run.id],
          )
        ).rows[0];
      });
    },
  };
}
