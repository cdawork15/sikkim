// Curator CRM views: lead score, follow-up tasks, the AI brief and the
// super-admin insights (pipeline health, team performance, revenue forecast).
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  assessmentCriteria,
  formatDate,
  formatDateTime,
  formatMonth,
  formatRupees,
  stageLabels,
  todayInIndia,
  type AdminUser,
  type BriefRun,
  type CrmReport,
  type CrmTask,
  type Lead,
  type LeadDetail,
} from '../api/admin';
import { useAction, useApi, useResource } from '../api/react';
import { Empty, ErrorNotice, Loading } from './shared';
import {
  Badge,
  downloadFile,
  Metric,
  ScoreBadge,
  stageTone,
} from './adminParts';

/* ----------------------------------------------------------- lead score */

export function LeadScorePanel({ lead }: { lead: Lead }) {
  const { score } = lead;
  return (
    <section className="ops-panel" aria-label="Lead score">
      <div className="ops-panel-head">
        <h2>Lead score</h2>
        <ScoreBadge score={score} />
      </div>
      {score.factors.map((factor) => (
        <div className="ops-bar-row" key={factor.label}>
          <div>
            <span>{factor.label}</span>
            <span>
              {factor.points} / {factor.max}
            </span>
          </div>
          <div className="ops-bar" aria-hidden="true">
            <i style={{ width: `${(factor.points / factor.max) * 100}%` }} />
          </div>
        </div>
      ))}
    </section>
  );
}

/* ---------------------------------------------------------------- tasks */

const taskDue = (task: CrmTask, today = todayInIndia()) =>
  task.status === 'open' && !!task.dueOn && task.dueOn <= today;

function TaskLine({
  task,
  showLead,
  changed,
}: {
  task: CrmTask;
  showLead?: boolean;
  changed: () => void;
}) {
  const api = useApi();
  const action = useAction();
  const setStatus = (status: CrmTask['status']) =>
    void action.run(async () => {
      await api.request(`/admin/tasks/${task.id}`, {
        method: 'PATCH',
        private: true,
        body: { status },
      });
      changed();
    });
  return (
    <div className="ops-line ops-task">
      <span>
        <strong>{task.title}</strong>
        {showLead && (
          <>
            {' · '}
            <Link to={`/admin/leads/${task.leadId}`}>
              {task.leadCode ? `${task.leadCode} ` : ''}
              {task.leadName}
            </Link>
          </>
        )}
      </span>
      <span>
        {task.dueOn && (
          <span className={taskDue(task) ? 'ops-due' : undefined}>
            Due {formatDate(task.dueOn)}
          </span>
        )}
        {task.assigneeName ? ` · ${task.assigneeName}` : ''}
        {task.source === 'automation' ? ' · automatic' : ''}
        {task.status !== 'open' && ` · ${task.status}`}
      </span>
      {task.status === 'open' ? (
        <span className="ops-task-actions">
          <button
            type="button"
            className="button button-primary"
            disabled={action.busy}
            onClick={() => setStatus('done')}
          >
            Done
          </button>
          <button
            type="button"
            className="button button-secondary"
            disabled={action.busy}
            onClick={() => setStatus('cancelled')}
          >
            Drop
          </button>
        </span>
      ) : (
        <button
          type="button"
          className="button button-secondary"
          disabled={action.busy}
          onClick={() => setStatus('open')}
        >
          Reopen
        </button>
      )}
      <ErrorNotice error={action.error} />
    </div>
  );
}

export function LeadTasks({
  lead,
  reload,
}: {
  lead: LeadDetail;
  reload: () => void;
}) {
  const api = useApi();
  const action = useAction();
  const staff = useResource<AdminUser[]>('/admin/users?role=admin', true);
  const [title, setTitle] = useState('');
  const [dueOn, setDueOn] = useState('');
  const [assigneeId, setAssigneeId] = useState('');
  const open = lead.tasks.filter((task) => task.status === 'open');
  const closed = lead.tasks.filter((task) => task.status !== 'open');
  return (
    <section className="ops-panel" aria-label="Tasks">
      <h2>Tasks</h2>
      {open.length === 0 && <p className="ops-muted">No open tasks.</p>}
      {open.map((task) => (
        <TaskLine key={task.id} task={task} changed={reload} />
      ))}
      <form
        className="ops-form ops-note-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            await api.request(`/admin/leads/${lead.id}/tasks`, {
              method: 'POST',
              private: true,
              body: {
                title: title.trim(),
                dueOn: dueOn || null,
                ...(assigneeId ? { assigneeId } : {}),
              },
            });
            setTitle('');
            setDueOn('');
            reload();
          });
        }}
      >
        <label className="ops-wide">
          New task
          <input
            required
            maxLength={200}
            value={title}
            placeholder="Call back about the site visit"
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          Due
          <input
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
          />
        </label>
        <label>
          For
          <select
            value={assigneeId}
            onChange={(event) => setAssigneeId(event.target.value)}
          >
            <option value="">Lead owner</option>
            {staff.data?.map((person) => (
              <option key={person.id} value={person.id}>
                {person.displayName}
              </option>
            ))}
          </select>
        </label>
        <ErrorNotice error={action.error} />
        <button
          className="button button-primary"
          disabled={action.busy || !title.trim()}
        >
          Add task
        </button>
      </form>
      {closed.length > 0 && (
        <details className="ops-closed-tasks">
          <summary>Finished and dropped ({closed.length})</summary>
          {closed.map((task) => (
            <TaskLine key={task.id} task={task} changed={reload} />
          ))}
        </details>
      )}
    </section>
  );
}

export function TasksTab() {
  const [params, setParams] = useSearchParams();
  const api = useApi();
  const download = useAction();
  const scope = params.get('scope') === 'everyone' ? 'everyone' : 'mine';
  const status = (['done', 'cancelled'] as const).find(
    (s) => s === params.get('status'),
  );
  const path = `/admin/tasks?scope=${scope}&status=${status ?? 'open'}`;
  const tasks = useResource<CrmTask[]>(path, true);
  const today = todayInIndia();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.set('tab', 'tasks');
    setParams(next);
  };
  const groups: [string, CrmTask[]][] =
    status === undefined
      ? [
          [
            'Overdue',
            (tasks.data ?? []).filter((t) => t.dueOn && t.dueOn < today),
          ],
          ['Today', (tasks.data ?? []).filter((t) => t.dueOn === today)],
          [
            'Coming up',
            (tasks.data ?? []).filter((t) => !t.dueOn || t.dueOn > today),
          ],
        ]
      : [[status === 'done' ? 'Finished' : 'Dropped', tasks.data ?? []]];
  return (
    <>
      <div className="ops-toolbar">
        <div className="ops-chips" role="group" aria-label="Whose tasks">
          {(
            [
              ['mine', 'My tasks'],
              ['everyone', 'Everyone'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={scope === key}
              onClick={() => set('scope', key === 'mine' ? '' : key)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="button button-secondary"
          disabled={download.busy}
          onClick={() =>
            void download.run(() =>
              downloadFile(api, '/admin/crm/tasks.ics', 'crm-tasks.ics'),
            )
          }
        >
          Add my tasks to a calendar (.ics)
        </button>
      </div>
      <ErrorNotice error={download.error} />
      <div className="ops-chips" role="group" aria-label="Task status">
        {(
          [
            ['', 'Open'],
            ['done', 'Finished'],
            ['cancelled', 'Dropped'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={(status ?? '') === key}
            onClick={() => set('status', key)}
          >
            {label}
          </button>
        ))}
      </div>
      {tasks.loading && <Loading />}
      <ErrorNotice error={tasks.error} retry={tasks.reload} />
      {tasks.data?.length === 0 && (
        <Empty>
          <h2>Nothing here</h2>
          <p>
            Tasks appear when leads change stage, or when you add one on a lead.
          </p>
        </Empty>
      )}
      {groups.map(
        ([label, rows]) =>
          rows.length > 0 && (
            <div className="ops-panel" key={label}>
              <h2>
                {label} ({rows.length})
              </h2>
              {rows.map((task) => (
                <TaskLine
                  key={task.id}
                  task={task}
                  showLead
                  changed={tasks.reload}
                />
              ))}
            </div>
          ),
      )}
    </>
  );
}

/* ------------------------------------------------------------- AI brief */

export function AiBrief({
  lead,
  saved,
}: {
  lead: LeadDetail;
  saved: () => void;
}) {
  const api = useApi();
  const action = useAction();
  const apply = useAction();
  const [run, setRun] = useState<BriefRun | null>(lead.assistant.latest);
  const [copied, setCopied] = useState(false);
  if (!lead.assistant.enabled && !run) return null;
  const brief = run?.brief;
  const suggested = brief
    ? assessmentCriteria.filter(([, key]) => brief.assessment[key].rating)
    : [];
  const digits = lead.phone.replace(/\D/g, '');
  return (
    <section className="ops-panel ops-brief" aria-label="AI brief">
      <div className="ops-panel-head">
        <h2>AI brief</h2>
        {lead.assistant.enabled && (
          <button
            type="button"
            className="button button-secondary"
            disabled={action.busy}
            onClick={() =>
              void action.run(async () => {
                const response = await api.request<BriefRun>(
                  `/admin/leads/${lead.id}/ai-brief`,
                  { method: 'POST', private: true, body: {} },
                );
                setRun(response.data);
              })
            }
          >
            {action.busy ? 'Thinking…' : run ? 'Refresh' : 'Generate'}
          </button>
        )}
      </div>
      <ErrorNotice error={action.error} />
      {!brief ? (
        <p className="ops-muted">
          Summarises the lead, suggests the next step, drafts a follow-up and
          rates the six criteria. Phone numbers and emails are not sent.
        </p>
      ) : (
        <>
          <p>{brief.summary}</p>
          <p>
            <strong>Next step:</strong> {brief.nextAction}
          </p>
          {brief.risks.length > 0 && (
            <ul className="ops-brief-risks">
              {brief.risks.map((risk) => (
                <li key={risk}>{risk}</li>
              ))}
            </ul>
          )}
          <label className="ops-form ops-brief-message">
            <span>Follow-up message</span>
            <textarea readOnly value={brief.followUpMessage} rows={4} />
          </label>
          <div className="ops-brief-actions">
            <button
              type="button"
              className="button button-secondary"
              onClick={() =>
                void navigator.clipboard
                  ?.writeText(brief.followUpMessage)
                  .then(() => setCopied(true))
              }
            >
              {copied ? 'Copied' : 'Copy message'}
            </button>
            {digits.length >= 10 && (
              <a
                className="button button-secondary"
                href={`https://wa.me/${digits}?text=${encodeURIComponent(brief.followUpMessage)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in WhatsApp
              </a>
            )}
          </div>
          <h3 className="ops-brief-title">Suggested assessment</h3>
          {assessmentCriteria.map(([field, key, label]) => (
            <div className="ops-line" key={key}>
              <span>{label}</span>
              <span>
                {brief.assessment[key].rating
                  ? `${brief.assessment[key].rating} / 5`
                  : 'No evidence'}
                {lead[field] ? ` (now ${lead[field]})` : ''}
                {brief.assessment[key].reason
                  ? ` — ${brief.assessment[key].reason}`
                  : ''}
              </span>
            </div>
          ))}
          {suggested.length > 0 && (
            <button
              type="button"
              className="button button-primary"
              disabled={apply.busy}
              onClick={() =>
                void apply.run(async () => {
                  await api.request(`/admin/leads/${lead.id}`, {
                    method: 'PATCH',
                    private: true,
                    body: {
                      revision: lead.revision,
                      ...Object.fromEntries(
                        suggested.map(([field, key]) => [
                          field,
                          brief.assessment[key].rating,
                        ]),
                      ),
                    },
                  });
                  saved();
                }, 'Ratings saved.')
              }
            >
              Use these ratings
            </button>
          )}
          <ErrorNotice error={apply.error} />
          {apply.message && (
            <p role="status" className="ops-muted">
              {apply.message}
            </p>
          )}
          <small className="ops-muted">
            {run!.model} · {run!.requestedBy} · {formatDateTime(run!.createdAt)}{' '}
            · confidence {brief.confidence}. Check before you send or save.
          </small>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- insights */

export function InsightsTab() {
  const api = useApi();
  const download = useAction();
  const report = useResource<CrmReport>('/admin/crm/report', true);
  if (report.loading) return <Loading />;
  const data = report.data;
  if (!data) return <ErrorNotice error={report.error} retry={report.reload} />;
  const f = data.forecast;
  const h = data.health;
  const historyMax = Math.max(1, ...f.history.map((m) => m.paise));
  const funnelMax = Math.max(1, ...h.funnel.map((s) => s.count));
  return (
    <>
      <div className="ops-toolbar">
        <p className="ops-muted">Updated {formatDateTime(data.generatedAt)}</p>
        <button
          type="button"
          className="button button-secondary"
          disabled={download.busy}
          onClick={() =>
            void download.run(() =>
              downloadFile(api, '/admin/crm/leads.csv', 'curator-leads.csv'),
            )
          }
        >
          Export leads (.csv)
        </button>
      </div>
      <ErrorNotice error={download.error} />

      <h2 className="ops-section-title">Revenue forecast</h2>
      <div className="ops-metrics">
        <Metric
          label="Booked, next 30 days"
          value={formatRupees(f.next30Days.paise)}
          note={`${f.next30Days.bookings} booking${f.next30Days.bookings === 1 ? '' : 's'}`}
        />
        <Metric
          label="Monthly run rate"
          value={formatRupees(f.runRatePaise)}
          note="Average of the last 3 full months"
        />
        <Metric
          label="Weighted pipeline"
          value={formatRupees(f.weightedPipelinePaise)}
          note={`${formatRupees(f.pipelineTotalPaise)} before stage odds`}
        />
        <Metric
          label={`Projected, ${formatMonth(f.months[1]!.month)}`}
          value={formatRupees(f.months[1]!.projectedPaise)}
          note="Run rate or bookings, plus pipeline"
        />
      </div>
      <div className="ops-panel">
        <h2>Next three months</h2>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th scope="col">Month</th>
                <th scope="col">Already booked</th>
                <th scope="col">Projected</th>
              </tr>
            </thead>
            <tbody>
              {f.months.map((m) => (
                <tr key={m.month}>
                  <th scope="row">{formatMonth(m.month)}</th>
                  <td>{formatRupees(m.bookedPaise)}</td>
                  <td>{formatRupees(m.projectedPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="ops-muted">
          Booking value is seats × the price at booking (paid to hosts in the
          pilot). Pipeline counts each open lead’s expected monthly value × the
          chance its stage goes live, from next month.
          {f.leadsWithoutValue > 0 &&
            ` ${f.leadsWithoutValue} open leads have no expected value yet.`}
        </p>
      </div>
      <div className="ops-panel">
        <h2>Pipeline value by stage</h2>
        {f.byStage.map((row) => (
          <div className="ops-line" key={row.stage}>
            <span>
              {stageLabels[row.stage]} · {row.leads} leads ·{' '}
              {Math.round(row.probability * 100)}%
            </span>
            <span>
              {formatRupees(row.weightedPaise)} of{' '}
              {formatRupees(row.totalPaise)}
            </span>
          </div>
        ))}
      </div>
      <div className="ops-panel">
        <h2>Booking value, last 6 months</h2>
        {f.history.length === 0 ? (
          <p className="ops-muted">No completed bookings yet.</p>
        ) : (
          f.history.map((m) => (
            <div className="ops-bar-row" key={m.month}>
              <div>
                <span>{formatMonth(m.month)}</span>
                <span>{formatRupees(m.paise)}</span>
              </div>
              <div className="ops-bar" aria-hidden="true">
                <i style={{ width: `${(m.paise / historyMax) * 100}%` }} />
              </div>
            </div>
          ))
        )}
      </div>

      <h2 className="ops-section-title">Pipeline health</h2>
      <div className="ops-metrics">
        <Metric
          label="Hot leads"
          value={data.scoring.hot}
          note={`${data.scoring.warm} warm · ${data.scoring.cold} cold`}
        />
        <Metric
          label="Gone quiet"
          value={h.stale}
          note="No activity for 14 days"
        />
        <Metric
          label="Overdue"
          value={h.tasksOverdue}
          note={`tasks · ${h.followUpsOverdue} follow-ups`}
        />
        <Metric
          label="Not assessed"
          value={h.unassessed}
          note={`${h.unowned} without an owner`}
        />
      </div>
      <div className="ops-panel">
        <h2>Hottest leads</h2>
        {data.scoring.topLeads.length === 0 ? (
          <p className="ops-muted">No open leads yet.</p>
        ) : (
          data.scoring.topLeads.map((lead) => (
            <Link
              className="ops-line ops-link"
              key={lead.id}
              to={`/admin/leads/${lead.id}`}
            >
              <span>
                {lead.code && <span className="ops-code">{lead.code}</span>}
                {lead.name}
              </span>
              <span>
                <Badge tone={stageTone(lead.stage)}>
                  {stageLabels[lead.stage]}
                </Badge>{' '}
                {lead.score} · {lead.ownerName ?? 'No owner'}
              </span>
            </Link>
          ))
        )}
      </div>
      <div className="ops-panel">
        <h2>How far leads have got</h2>
        {h.funnel.map((row) => (
          <div className="ops-bar-row" key={row.stage}>
            <div>
              <span>{row.label} or later</span>
              <span>{row.count}</span>
            </div>
            <div className="ops-bar" aria-hidden="true">
              <i style={{ width: `${(row.count / funnelMax) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="ops-panel">
        <h2>Time in stage</h2>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th scope="col">Stage</th>
                <th scope="col">Leads</th>
                <th scope="col">Average days</th>
              </tr>
            </thead>
            <tbody>
              {h.stages.map((row) => (
                <tr key={row.stage}>
                  <th scope="row">{row.label}</th>
                  <td>{row.count}</td>
                  <td>{row.avgDaysInStage ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="ops-section-title">Team</h2>
      <div className="ops-panel">
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Open leads</th>
                <th scope="col">Hot</th>
                <th scope="col">Avg score</th>
                <th scope="col">Activity (30 d)</th>
                <th scope="col">Tasks done (30 d)</th>
                <th scope="col">Overdue</th>
                <th scope="col">Went live (90 d)</th>
              </tr>
            </thead>
            <tbody>
              {data.team.map((member) => (
                <tr key={member.id}>
                  <th scope="row">{member.name}</th>
                  <td>{member.openLeads}</td>
                  <td>{member.hotLeads}</td>
                  <td>{member.averageScore ?? '—'}</td>
                  <td>{member.activities30d}</td>
                  <td>{member.tasksDone30d}</td>
                  <td>{member.tasksOverdue}</td>
                  <td>{member.wentLive90d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
