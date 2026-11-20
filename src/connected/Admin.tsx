import { useState, type FormEvent, type ReactNode } from 'react';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import {
  formatDate,
  formatDateTime,
  humanise,
  isFollowUpDue,
  leadStages,
  noteKindLabels,
  siteVisitLabels,
  stageLabels,
  verdictLabels,
  type AdminBooking,
  type AdminUser,
  type AdminUserDetail,
  type Lead,
  type LeadDetail,
  type Overview,
} from '../api/admin';
import { ApiError } from '../api/client';
import { useAction, useApi, useResource, useSession } from '../api/react';
import type { CatalogueOptions, HostApplication } from '../api/types';
import { Icon } from '../components/Icon';
import { Empty, ErrorNotice, Loading, RequireAccount } from './shared';
import './admin.css';

const tabs = [
  ['overview', 'Overview'],
  ['pipeline', 'Pipeline'],
  ['approvals', 'Approvals'],
  ['hosts', 'Hosts'],
  ['users', 'Users'],
  ['bookings', 'Bookings'],
] as const;
type Tab = (typeof tabs)[number][0];

/* ------------------------------------------------------------------ shell */

export function AdminWorkspace() {
  return (
    <div className="page interior-page ops-page">
      <RequireAccount admin>
        <Operations />
      </RequireAccount>
    </div>
  );
}

function Operations() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = tabs.some(([key]) => key === requested)
    ? (requested as Tab)
    : 'overview';
  const overview = useResource<Overview>('/admin/overview', true);
  const counts: Partial<Record<Tab, number>> = overview.data
    ? {
        pipeline: overview.data.pipeline.followUpsDue,
        approvals:
          overview.data.queue.hosts +
          overview.data.queue.experiences +
          overview.data.queue.media,
      }
    : {};
  return (
    <>
      <header className="ops-header">
        <div>
          <p className="ops-kicker">Admin workspace</p>
          <h1>Operations</h1>
        </div>
        <Link className="button button-secondary ops-exit" to="/account">
          Exit
        </Link>
      </header>
      <div className="ops-tabs" role="tablist" aria-label="Admin sections">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setParams({ tab: key })}
          >
            {label}
            {counts[key] ? ` (${counts[key]})` : ''}
          </button>
        ))}
      </div>
      <section className="ops-body" role="tabpanel" aria-label={tab}>
        {tab === 'overview' && <OverviewTab result={overview} />}
        {tab === 'pipeline' && <PipelineTab />}
        {tab === 'approvals' && <ApprovalsTab overview={overview.data} />}
        {tab === 'hosts' && <HostsTab />}
        {tab === 'users' && <UsersTab />}
        {tab === 'bookings' && <BookingsTab />}
      </section>
    </>
  );
}

/* --------------------------------------------------------------- helpers */

function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: ReactNode;
  note?: string;
}) {
  return (
    <div className="ops-metric">
      <span>{label}</span>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

function Badge({
  tone = 'plain',
  children,
}: {
  tone?: 'plain' | 'ok' | 'warn' | 'red';
  children: ReactNode;
}) {
  return <span className={`ops-badge ${tone}`}>{children}</span>;
}

const stageTone = (stage: string) =>
  stage === 'live' || stage === 'agreed' || stage === 'onboarding'
    ? 'ok'
    : stage === 'declined'
      ? 'red'
      : stage === 'paused'
        ? 'warn'
        : 'plain';
const statusTone = (status: string) =>
  ['approved', 'active', 'confirmed', 'published', 'checked_in'].includes(
    status,
  )
    ? 'ok'
    : ['pending', 'review', 'draft', 'issued'].includes(status)
      ? 'warn'
      : ['suspended', 'rejected', 'cancelled', 'no_show', 'revoked'].includes(
            status,
          )
        ? 'red'
        : 'plain';

/** Cursor-paged list for the admin API (`page.nextCursor` + `after`). */
function CursorList<T extends { id: string }>({
  path,
  render,
  empty,
}: {
  path: string;
  render: (row: T) => ReactNode;
  empty: ReactNode;
}) {
  const [cursors, setCursors] = useState<string[]>([]);
  return (
    <div className="ops-list" key={path}>
      <CursorPage<T>
        path={path}
        render={render}
        empty={empty}
        last={!cursors.length}
        more={(next) =>
          setCursors((list) => (list.includes(next) ? list : [...list, next]))
        }
      />
      {cursors.map((cursor, index) => (
        <CursorPage<T>
          key={cursor}
          path={`${path}${path.includes('?') ? '&' : '?'}after=${encodeURIComponent(cursor)}`}
          render={render}
          last={index === cursors.length - 1}
          more={(next) =>
            setCursors((list) => (list.includes(next) ? list : [...list, next]))
          }
        />
      ))}
    </div>
  );
}
function CursorPage<T extends { id: string }>({
  path,
  render,
  empty,
  last,
  more,
}: {
  path: string;
  render: (row: T) => ReactNode;
  empty?: ReactNode;
  last: boolean;
  more: (cursor: string) => void;
}) {
  const result = useResource<T[]>(path, true);
  return (
    <>
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
      {result.data?.map((row) => (
        <div key={row.id}>{render(row)}</div>
      ))}
      {empty && result.data?.length === 0 && <Empty>{empty}</Empty>}
      {last && result.page?.nextCursor && (
        <button
          type="button"
          className="button button-secondary ops-more"
          onClick={() => more(result.page!.nextCursor!)}
        >
          Show more
        </button>
      )}
    </>
  );
}

function SearchBar({
  value,
  onSearch,
  placeholder,
}: {
  value: string;
  onSearch: (value: string) => void;
  placeholder: string;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <form
      className="ops-search"
      role="search"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(draft.trim());
      }}
    >
      <Icon name="search" size={18} />
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        value={draft}
        maxLength={120}
        onChange={(event) => setDraft(event.target.value)}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setDraft('');
            onSearch('');
          }}
        >
          <Icon name="close" size={16} />
        </button>
      )}
    </form>
  );
}

/** Keeps a tab's filters in the URL so links and reloads keep them. */
function useFilters(tab: Tab, keys: string[]) {
  const [params, setParams] = useSearchParams();
  const values = Object.fromEntries(
    keys.map((key) => [key, params.get(key) ?? '']),
  );
  const set = (key: string, value: string) => {
    const next: Record<string, string> = { tab };
    for (const k of keys) {
      const v = k === key ? value : values[k];
      if (v) next[k] = v;
    }
    setParams(next);
  };
  const query = new URLSearchParams(
    Object.entries(values).filter(([, v]) => v) as [string, string][],
  ).toString();
  return { values, set, query: query ? '?' + query : '' };
}

/* -------------------------------------------------------------- overview */

function OverviewTab({
  result,
}: {
  result: ReturnType<typeof useResource<Overview>>;
}) {
  const data = result.data;
  if (result.loading) return <Loading />;
  if (!data) return <ErrorNotice error={result.error} retry={result.reload} />;
  const b = data.bookings;
  const areaTotal = b.byArea.reduce((sum, row) => sum + row.bookings, 0);
  const stageMax = Math.max(1, ...data.pipeline.stages.map((s) => s.count));
  const measures: [keyof (typeof data.pipeline.tracker)[number], string][] = [
    ['longlisted', 'Experiences longlisted'],
    ['rated', 'Rated'],
    ['listInPilot', 'Verdict “list in pilot”'],
    ['siteVisitsPending', 'Site visits pending'],
    ['mediaReceived', 'Photos or videos received'],
    ['writeupFinal', 'Write-up final'],
    ['onboardedOrLive', 'Curator onboarded or live'],
  ];
  const tracker = data.pipeline.tracker;
  return (
    <>
      <div className="ops-metrics">
        <Metric
          label="Bookings (30 days)"
          value={b.last30Days.total}
          note={`${b.last30Days.guests} guests`}
        />
        <Metric
          label="Next 7 days"
          value={b.next7Days.bookings}
          note={`${b.next7Days.guests} guests`}
        />
        <Metric
          label="Active hosts"
          value={data.hosts.active}
          note={
            data.hosts.expiringSoon
              ? `${data.hosts.expiringSoon} approvals expire soon`
              : undefined
          }
        />
        <Metric
          label="Published listings"
          value={data.listings.published}
          note={`${data.listings.drafts} drafts`}
        />
        <Metric
          label="Active travellers"
          value={data.people.active}
          note={`${data.people.newLast30Days} new in 30 days`}
        />
        <Metric label="Community events" value={data.community.published} />
        <Metric
          label="Check-ins (30 days)"
          value={b.last30Days.checkedIn}
          note={`${b.last30Days.noShows} no-shows · ${b.last30Days.cancelled} cancelled`}
        />
        <Metric label="Follow-ups due" value={data.pipeline.followUpsDue} />
      </div>

      <div className="ops-panel">
        <h2>Bookings by area</h2>
        {areaTotal === 0 ? (
          <p className="ops-muted">No bookings in the last 30 days yet.</p>
        ) : (
          b.byArea.map((row) => {
            const percent = Math.round((row.bookings / areaTotal) * 100);
            return (
              <div className="ops-bar-row" key={row.area}>
                <div>
                  <span>{row.area}</span>
                  <span>
                    {row.bookings} · {percent}%
                  </span>
                </div>
                <div className="ops-bar" aria-hidden="true">
                  <i style={{ width: `${percent}%` }} />
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="ops-panel">
        <div className="ops-panel-head">
          <h2>Curator pipeline</h2>
          <Link to="/admin?tab=pipeline">Open pipeline</Link>
        </div>
        {data.pipeline.stages.map((row) => (
          <Link
            className="ops-bar-row"
            key={row.stage}
            to={`/admin?tab=pipeline&stage=${row.stage}`}
          >
            <div>
              <span>{row.label}</span>
              <span>{row.count}</span>
            </div>
            <div className="ops-bar" aria-hidden="true">
              <i style={{ width: `${(row.count / stageMax) * 100}%` }} />
            </div>
          </Link>
        ))}
      </div>

      <div className="ops-panel">
        <h2>Pilot tracker</h2>
        {tracker.length === 0 ? (
          <p className="ops-muted">
            Add curator leads in Pipeline to fill the tracker.
          </p>
        ) : (
          <div className="ops-table-wrap">
            <table className="ops-table">
              <thead>
                <tr>
                  <th scope="col">Measure</th>
                  {tracker.map((row) => (
                    <th scope="col" key={row.district}>
                      {row.district}
                    </th>
                  ))}
                  <th scope="col">Total</th>
                </tr>
              </thead>
              <tbody>
                {measures.map(([key, label]) => (
                  <tr key={key}>
                    <th scope="row">{label}</th>
                    {tracker.map((row) => (
                      <td key={row.district}>{row[key]}</td>
                    ))}
                    <td>
                      {tracker.reduce((sum, row) => sum + Number(row[key]), 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* -------------------------------------------------------------- pipeline */

function useOptions() {
  return useResource<CatalogueOptions>('/catalogue/options');
}

function PipelineTab() {
  const { values, set, query } = useFilters('pipeline', [
    'q',
    'stage',
    'district',
    'followUpDue',
  ]);
  const options = useOptions();
  return (
    <>
      <div className="ops-toolbar">
        <SearchBar
          value={values.q ?? ''}
          onSearch={(v) => set('q', v)}
          placeholder="Search name, idea, contact or ID"
        />
        <Link className="button button-primary" to="/admin/leads/new">
          + Add lead
        </Link>
      </div>
      <div className="ops-filters">
        <select
          aria-label="Stage"
          value={values.stage}
          onChange={(e) => set('stage', e.target.value)}
        >
          <option value="">All stages</option>
          {leadStages.map((stage) => (
            <option key={stage} value={stage}>
              {stageLabels[stage]}
            </option>
          ))}
        </select>
        <select
          aria-label="District"
          value={values.district}
          onChange={(e) => set('district', e.target.value)}
        >
          <option value="">All districts</option>
          {options.data?.areas.map((area) => (
            <option key={area.code} value={area.name}>
              {area.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ops-toggle"
          aria-pressed={values.followUpDue === 'true'}
          onClick={() =>
            set('followUpDue', values.followUpDue === 'true' ? '' : 'true')
          }
        >
          Follow-ups due
        </button>
      </div>
      <CursorList<Lead>
        path={'/admin/leads' + query}
        empty={
          <>
            <h2>No leads here yet</h2>
            <p>Add the curators and experiences you are talking to.</p>
          </>
        }
        render={(lead) => <LeadRow lead={lead} />}
      />
    </>
  );
}

function LeadRow({ lead }: { lead: Lead }) {
  const due = isFollowUpDue(lead);
  return (
    <Link className="ops-row" to={`/admin/leads/${lead.id}`}>
      <div className="ops-row-main">
        <strong>
          {lead.code && <span className="ops-code">{lead.code}</span>}
          {lead.name}
        </strong>
        <span>
          {[lead.experienceIdea, lead.locality || lead.district]
            .filter(Boolean)
            .join(' · ') || 'No details yet'}
        </span>
        <span className="ops-row-meta">
          {lead.ownerName ? `Owner: ${lead.ownerName}` : 'No owner'}
          {lead.nextFollowUp && (
            <>
              {' · '}
              <span className={due ? 'ops-due' : undefined}>
                Follow up {formatDate(lead.nextFollowUp)}
              </span>
            </>
          )}
        </span>
      </div>
      <Badge tone={stageTone(lead.stage)}>{stageLabels[lead.stage]}</Badge>
    </Link>
  );
}

/* ------------------------------------------------------------- approvals */

function ApprovalsTab({ overview }: { overview?: Overview }) {
  const queue = overview?.queue;
  return (
    <>
      <div className="ops-metrics">
        <Link
          className="ops-metric ops-link"
          to="/review?kind=hosts&status=pending"
        >
          <span>Host profiles</span>
          <strong>{queue?.hosts ?? '–'}</strong>
          <small>Check identity, then approve</small>
        </Link>
        <Link
          className="ops-metric ops-link"
          to="/review?kind=experiences&status=review"
        >
          <span>Experiences</span>
          <strong>{queue?.experiences ?? '–'}</strong>
          <small>Check details and policies</small>
        </Link>
        <Link className="ops-metric ops-link" to="/review/media">
          <span>Photos and videos</span>
          <strong>{queue?.media ?? '–'}</strong>
          <small>Check rights and content</small>
        </Link>
      </div>
      <h2 className="ops-section-title">Hosts waiting for a decision</h2>
      <CursorList<HostApplication>
        path="/admin/hosts?status=pending"
        empty={<h2>Approval queue is clear</h2>}
        render={(host) => <HostRow host={host} />}
      />
    </>
  );
}

/* ----------------------------------------------------------------- hosts */

const hostStatuses = [
  'approved',
  'pending',
  'suspended',
  'rejected',
  'draft',
] as const;

function HostsTab() {
  const { values, set } = useFilters('hosts', ['status']);
  const status = hostStatuses.includes(
    values.status as (typeof hostStatuses)[number],
  )
    ? values.status!
    : 'approved';
  return (
    <>
      <div className="ops-chips" role="group" aria-label="Host status">
        {hostStatuses.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={status === value}
            onClick={() => set('status', value)}
          >
            {humanise(value)}
          </button>
        ))}
      </div>
      <CursorList<HostApplication>
        path={`/admin/hosts?status=${status}`}
        empty={<h2>No {status} hosts</h2>}
        render={(host) => <HostRow host={host} />}
      />
    </>
  );
}

function HostRow({ host }: { host: HostApplication }) {
  const expiry = host.approvedUntil ? new Date(host.approvedUntil) : null;
  const expiringSoon = expiry && expiry.getTime() - Date.now() < 30 * 86400000;
  return (
    <Link className="ops-row" to={`/review/hosts/${host.id}`}>
      <div className="ops-row-main">
        <strong>{host.publicName || 'Unnamed host'}</strong>
        <span>{host.serviceAreas?.join(', ') || 'No service area yet'}</span>
        <span className="ops-row-meta">
          {host.isDemo ? 'Test account' : 'Real account'}
          {expiry && (
            <>
              {' · '}
              <span className={expiringSoon ? 'ops-due' : undefined}>
                Approved until {formatDate(host.approvedUntil!)}
              </span>
            </>
          )}
        </span>
      </div>
      <Badge tone={statusTone(host.status)}>{humanise(host.status)}</Badge>
    </Link>
  );
}

/* ----------------------------------------------------------------- users */

function UsersTab() {
  const { values, set, query } = useFilters('users', ['q', 'role']);
  return (
    <>
      <div className="ops-toolbar">
        <SearchBar
          value={values.q ?? ''}
          onSearch={(v) => set('q', v)}
          placeholder="Search name or email"
        />
      </div>
      <div className="ops-chips" role="group" aria-label="Role">
        {[
          ['', 'Everyone'],
          ['admin', 'Admins'],
          ['host', 'Hosts'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={(values.role ?? '') === value}
            onClick={() => set('role', value!)}
          >
            {label}
          </button>
        ))}
      </div>
      <CursorList<AdminUser>
        path={'/admin/users' + query}
        empty={<h2>No people match</h2>}
        render={(user) => (
          <Link className="ops-row" to={`/admin/users/${user.id}`}>
            <div className="ops-row-main">
              <strong>{user.displayName}</strong>
              <span>
                {user.email ?? (user.isDemo ? 'Test account' : 'No email')}
              </span>
              <span className="ops-row-meta">
                {[
                  ...user.roles.map(humanise),
                  user.hostStatus ? `Host: ${humanise(user.hostStatus)}` : '',
                  `${user.bookings} bookings`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </div>
            <Badge tone={statusTone(user.status)}>
              {humanise(user.status)}
            </Badge>
          </Link>
        )}
      />
    </>
  );
}

/* -------------------------------------------------------------- bookings */

function BookingsTab() {
  const { values, set, query } = useFilters('bookings', ['q', 'status']);
  return (
    <>
      <div className="ops-toolbar">
        <SearchBar
          value={values.q ?? ''}
          onSearch={(v) => set('q', v)}
          placeholder="Reference, guest name, email or experience"
        />
      </div>
      <div className="ops-chips" role="group" aria-label="Booking status">
        {[
          ['', 'All'],
          ['confirmed', 'Confirmed'],
          ['cancelled', 'Cancelled'],
          ['no_show', 'No-show'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={(values.status ?? '') === value}
            onClick={() => set('status', value!)}
          >
            {label}
          </button>
        ))}
      </div>
      <CursorList<AdminBooking>
        path={'/admin/bookings' + query}
        empty={<h2>No bookings found</h2>}
        render={(booking) => (
          <div className="ops-row">
            <div className="ops-row-main">
              <strong>
                <span className="ops-code">{booking.reference}</span>
                {booking.experienceTitle}
              </strong>
              <span>
                {formatDateTime(booking.startsAt)} · {booking.quantity} guest
                {booking.quantity === 1 ? '' : 's'} · {booking.hostName}
              </span>
              <span className="ops-row-meta">
                {booking.contactName} · {booking.contactEmail}
                {booking.ticketStatus
                  ? ` · Ticket ${humanise(booking.ticketStatus)}`
                  : ''}
              </span>
            </div>
            <Badge tone={statusTone(booking.status)}>
              {humanise(booking.status)}
            </Badge>
          </div>
        )}
      />
    </>
  );
}

/* ----------------------------------------------------------- lead editor */

export function LeadPage() {
  const { id } = useParams();
  return (
    <div className="page interior-page ops-page">
      <RequireAccount admin>
        <Link className="ops-back" to="/admin?tab=pipeline">
          <Icon name="arrow-left" size={16} /> Pipeline
        </Link>
        {id ? <ExistingLead key={id} id={id} /> : <LeadForm />}
      </RequireAccount>
    </div>
  );
}

function ExistingLead({ id }: { id: string }) {
  const result = useResource<LeadDetail>(
    `/admin/leads/${encodeURIComponent(id)}`,
    true,
  );
  if (result.loading) return <Loading />;
  if (!result.data)
    return <ErrorNotice error={result.error} retry={result.reload} />;
  const lead = result.data;
  return (
    <>
      <header className="ops-lead-head">
        <div>
          {lead.code && <span className="ops-code">{lead.code}</span>}
          <h1>{lead.name}</h1>
          <p className="ops-muted">
            {[lead.experienceIdea, lead.locality, lead.district]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <Badge tone={stageTone(lead.stage)}>{stageLabels[lead.stage]}</Badge>
      </header>
      <StageChanger lead={lead} saved={(next) => result.replace(next)} />
      <div className="ops-lead-grid">
        <LeadForm
          lead={lead}
          saved={(next) => result.replace(next)}
          reload={result.reload}
        />
        <Notes
          key={`notes-${lead.revision}-${lead.notes.length}`}
          lead={lead}
          reload={result.reload}
        />
      </div>
    </>
  );
}

function StageChanger({
  lead,
  saved,
}: {
  lead: LeadDetail;
  saved: (lead: LeadDetail) => void;
}) {
  const api = useApi();
  const action = useAction();
  return (
    <div className="ops-panel">
      <h2>Move to stage</h2>
      <div className="ops-chips" role="group" aria-label="Stage">
        {leadStages.map((stage) => (
          <button
            key={stage}
            type="button"
            aria-pressed={lead.stage === stage}
            disabled={action.busy || lead.stage === stage}
            onClick={() =>
              void action.run(async () => {
                const response = await api.request<Lead>(
                  `/admin/leads/${lead.id}`,
                  {
                    method: 'PATCH',
                    private: true,
                    body: { revision: lead.revision, stage },
                  },
                );
                const detail = await api.request<LeadDetail>(
                  `/admin/leads/${lead.id}`,
                  { private: true },
                );
                saved({ ...detail.data, ...response.data });
              }, `Moved to ${stageLabels[stage]}.`)
            }
          >
            {stageLabels[stage]}
          </button>
        ))}
      </div>
      <ErrorNotice error={action.error} />
      {action.message && (
        <p role="status" className="ops-muted">
          {action.message}
        </p>
      )}
    </div>
  );
}

type FormValues = Record<string, FormDataEntryValue | null>;

function leadBody(form: FormValues, checks: Record<string, boolean>) {
  const text = (key: string) => String(form[key] ?? '').trim();
  return {
    code: text('code') || null,
    name: text('name'),
    experienceIdea: text('experienceIdea'),
    district: text('district'),
    locality: text('locality'),
    categoryCode: text('categoryCode') || null,
    contactName: text('contactName'),
    phone: text('phone'),
    email: text('email'),
    contactSource: text('contactSource'),
    verdict: text('verdict'),
    siteVisit: text('siteVisit'),
    ownerId: text('ownerId') || null,
    hostId: text('hostId') || null,
    nextFollowUp: text('nextFollowUp') || null,
    ...checks,
  };
}

const checklist = [
  ['contactConfirmed', 'Contact confirmed by phone'],
  ['agreementSigned', 'Curator agreement signed'],
  ['mediaReceived', 'Photos or videos received'],
  ['rightsConfirmed', 'Media rights note received'],
  ['writeupFinal', 'Write-up final'],
] as const;

function LeadForm({
  lead,
  saved,
  reload,
}: {
  lead?: LeadDetail;
  saved?: (lead: LeadDetail) => void;
  reload?: () => void;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const action = useAction();
  const options = useOptions();
  const admins = useResource<AdminUser[]>('/admin/users?role=admin', true);
  const approvedHosts = useResource<HostApplication[]>(
    '/admin/hosts?status=approved',
    true,
  );
  const pendingHosts = useResource<HostApplication[]>(
    '/admin/hosts?status=pending',
    true,
  );
  const hosts = [...(approvedHosts.data ?? []), ...(pendingHosts.data ?? [])];
  const [checks, setChecks] = useState<Record<string, boolean>>(
    Object.fromEntries(
      checklist.map(([key]) => [key, lead ? Boolean(lead[key]) : false]),
    ),
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = Object.fromEntries(
      new FormData(event.currentTarget).entries(),
    );
    void action.run(
      async () => {
        const body = leadBody(form, checks);
        if (lead) {
          await api.request<Lead>(`/admin/leads/${lead.id}`, {
            method: 'PATCH',
            private: true,
            body: { ...body, revision: lead.revision },
          });
          const detail = await api.request<LeadDetail>(
            `/admin/leads/${lead.id}`,
            { private: true },
          );
          saved?.(detail.data);
        } else {
          const created = await api.request<Lead>('/admin/leads', {
            method: 'POST',
            private: true,
            body,
          });
          navigate(`/admin/leads/${created.data.id}`, { replace: true });
        }
      },
      lead ? 'Saved.' : '',
    );
  };
  // Selects use defaultValue, so render only once their options exist;
  // otherwise a save would submit the placeholder and clear the field.
  const lists = [options, admins, approvedHosts, pendingHosts];
  const failed = lists.find((list) => list.error);
  if (failed) return <ErrorNotice error={failed.error} retry={failed.reload} />;
  if (lists.some((list) => !list.data)) return <Loading />;
  return (
    <form className="ops-panel ops-form" onSubmit={submit}>
      {!lead && <h1 className="ops-form-title">Add a curator lead</h1>}
      <fieldset>
        <legend>Experience</legend>
        <label>
          Curator or business name
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={lead?.name}
          />
        </label>
        <label>
          Tracker ID
          <input
            name="code"
            maxLength={16}
            placeholder="PKG-02"
            pattern="[A-Za-z]{2,5}-[0-9]{1,4}"
            defaultValue={lead?.code ?? ''}
          />
        </label>
        <label className="ops-wide">
          Experience idea
          <input
            name="experienceIdea"
            maxLength={200}
            defaultValue={lead?.experienceIdea}
          />
        </label>
        <label>
          District
          <select name="district" defaultValue={lead?.district ?? ''}>
            <option value="">Not set</option>
            {options.data?.areas.map((area) => (
              <option key={area.code} value={area.name}>
                {area.name}
              </option>
            ))}
            {lead?.district &&
              !options.data?.areas.some((a) => a.name === lead.district) && (
                <option value={lead.district}>{lead.district}</option>
              )}
          </select>
        </label>
        <label>
          Village or locality
          <input name="locality" maxLength={80} defaultValue={lead?.locality} />
        </label>
        <label>
          Category
          <select name="categoryCode" defaultValue={lead?.categoryCode ?? ''}>
            <option value="">Not set</option>
            {options.data?.categories.map((category) => (
              <option key={category.code} value={category.code}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Contact</legend>
        <label>
          Contact person
          <input
            name="contactName"
            maxLength={80}
            defaultValue={lead?.contactName}
          />
        </label>
        <label>
          Phone
          <input
            name="phone"
            type="tel"
            maxLength={20}
            inputMode="tel"
            defaultValue={lead?.phone}
          />
        </label>
        <label>
          Email
          <input
            name="email"
            type="email"
            maxLength={254}
            defaultValue={lead?.email}
          />
        </label>
        <label>
          Where the contact came from
          <input
            name="contactSource"
            maxLength={200}
            defaultValue={lead?.contactSource}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>Assessment and readiness</legend>
        <label>
          Verdict
          <select name="verdict" defaultValue={lead?.verdict ?? 'undecided'}>
            {Object.entries(verdictLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Site visit
          <select
            name="siteVisit"
            defaultValue={lead?.siteVisit ?? 'not_needed'}
          >
            {Object.entries(siteVisitLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="ops-checks ops-wide">
          {checklist.map(([key, label]) => (
            <label key={key} className="ops-check">
              <input
                type="checkbox"
                checked={checks[key] ?? false}
                onChange={(event) =>
                  setChecks((current) => ({
                    ...current,
                    [key]: event.target.checked,
                  }))
                }
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>Follow-up</legend>
        <label>
          Owner
          <select name="ownerId" defaultValue={lead?.ownerId ?? ''}>
            <option value="">No owner</option>
            {admins.data?.map((admin) => (
              <option key={admin.id} value={admin.id}>
                {admin.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Next follow-up
          <input
            name="nextFollowUp"
            type="date"
            defaultValue={lead?.nextFollowUp ?? ''}
          />
        </label>
        <label className="ops-wide">
          Linked host profile
          <select name="hostId" defaultValue={lead?.hostId ?? ''}>
            <option value="">Not linked yet</option>
            {lead?.hostId && !hosts.some((h) => h.id === lead.hostId) && (
              <option value={lead.hostId}>
                {lead.hostName ?? 'Current host'}
              </option>
            )}
            {hosts.map((host) => (
              <option key={host.id} value={host.id}>
                {host.publicName} ({humanise(host.status)})
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <ErrorNotice error={action.error} />
      {action.error instanceof ApiError &&
        action.error.status === 409 &&
        reload && (
          <button
            type="button"
            className="button button-secondary"
            onClick={reload}
          >
            Load the latest version
          </button>
        )}
      {action.message && (
        <p role="status" className="ops-muted">
          {action.message}
        </p>
      )}
      <button
        className="button button-primary ops-submit"
        disabled={action.busy}
      >
        {action.busy ? 'Saving…' : lead ? 'Save changes' : 'Add lead'}
      </button>
    </form>
  );
}

function Notes({ lead, reload }: { lead: LeadDetail; reload: () => void }) {
  const api = useApi();
  const action = useAction();
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<'note' | 'call' | 'visit' | 'message'>(
    'call',
  );
  return (
    <section className="ops-panel ops-notes" aria-label="Activity">
      <h2>Activity</h2>
      <form
        className="ops-form ops-note-form"
        onSubmit={(event) => {
          event.preventDefault();
          void action.run(async () => {
            await api.request(`/admin/leads/${lead.id}/notes`, {
              method: 'POST',
              private: true,
              body: { kind, body: body.trim() },
            });
            setBody('');
            reload();
          });
        }}
      >
        <label>
          Type
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as typeof kind)}
          >
            {(['call', 'visit', 'message', 'note'] as const).map((value) => (
              <option key={value} value={value}>
                {noteKindLabels[value]}
              </option>
            ))}
          </select>
        </label>
        <label className="ops-wide">
          What happened
          <textarea
            required
            maxLength={2000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <ErrorNotice error={action.error} />
        <button
          className="button button-primary"
          disabled={action.busy || !body.trim()}
        >
          Add to activity
        </button>
      </form>
      <ol className="ops-timeline">
        {lead.notes.map((note) => (
          <li key={note.id}>
            <Badge tone={note.kind === 'stage' ? 'warn' : 'plain'}>
              {noteKindLabels[note.kind]}
            </Badge>
            <p>{note.body}</p>
            <small>
              {note.authorName} · {formatDateTime(note.createdAt)}
            </small>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ------------------------------------------------------------ user page */

export function AdminUserPage() {
  const { id = '' } = useParams();
  return (
    <div className="page interior-page ops-page">
      <RequireAccount admin>
        <Link className="ops-back" to="/admin?tab=users">
          <Icon name="arrow-left" size={16} /> Users
        </Link>
        <UserDetail key={id} id={id} />
      </RequireAccount>
    </div>
  );
}

function UserDetail({ id }: { id: string }) {
  const api = useApi();
  const { user: me } = useSession();
  const result = useResource<AdminUserDetail>(
    `/admin/users/${encodeURIComponent(id)}`,
    true,
  );
  const action = useAction();
  if (result.loading) return <Loading />;
  const person = result.data;
  if (!person)
    return <ErrorNotice error={result.error} retry={result.reload} />;
  const next = person.status === 'suspended' ? 'active' : 'suspended';
  const self = me?.id === person.id;
  return (
    <>
      <header className="ops-lead-head">
        <div>
          <h1>{person.displayName}</h1>
          <p className="ops-muted">
            {person.email ?? (person.isDemo ? 'Test account' : 'No email')}
          </p>
        </div>
        <Badge tone={statusTone(person.status)}>
          {humanise(person.status)}
        </Badge>
      </header>
      <div className="ops-metrics">
        <Metric
          label="Roles"
          value={
            person.roles.length
              ? person.roles.map(humanise).join(', ')
              : 'Traveller'
          }
        />
        <Metric
          label="Signed in on"
          value={`${person.activeSessions} device${person.activeSessions === 1 ? '' : 's'}`}
        />
        <Metric label="Joined" value={formatDate(person.createdAt)} />
        <Metric label="Bookings" value={person.bookings.length} />
      </div>
      <p className="ops-muted ops-hint">
        Admin access is granted on the server with{' '}
        <code>npm run admin -- grant --email=…</code>, so it never depends on
        the app alone.
      </p>
      {person.host && (
        <Link className="ops-row" to={`/review/hosts/${person.host.id}`}>
          <div className="ops-row-main">
            <strong>Host profile: {person.host.publicName || 'Unnamed'}</strong>
            <span>
              {person.host.approvedUntil
                ? `Approved until ${formatDate(person.host.approvedUntil)}`
                : 'Not approved yet'}
            </span>
          </div>
          <Badge tone={statusTone(person.host.status)}>
            {humanise(person.host.status)}
          </Badge>
        </Link>
      )}
      <div className="ops-panel">
        <h2>Recent bookings</h2>
        {person.bookings.length === 0 && (
          <p className="ops-muted">No bookings yet.</p>
        )}
        {person.bookings.map((booking) => (
          <div className="ops-line" key={booking.id}>
            <span>
              <span className="ops-code">{booking.reference}</span>{' '}
              {booking.experienceTitle}
            </span>
            <span>{formatDateTime(booking.startsAt)}</span>
            <Badge tone={statusTone(booking.status)}>
              {humanise(booking.status)}
            </Badge>
          </div>
        ))}
      </div>
      <div className="ops-panel">
        <h2>Recent activity</h2>
        {person.activity.length === 0 && (
          <p className="ops-muted">No recorded activity.</p>
        )}
        {person.activity.map((entry, index) => (
          <div className="ops-line" key={index}>
            <span>{humanise(entry.action.replace(/\./g, ' · '))}</span>
            <span>{formatDateTime(entry.createdAt)}</span>
          </div>
        ))}
      </div>
      {!self && ['active', 'suspended'].includes(person.status) && (
        <div className="ops-panel">
          <h2>
            {next === 'suspended' ? 'Suspend account' : 'Restore account'}
          </h2>
          <p className="ops-muted">
            {next === 'suspended'
              ? 'Suspending signs this person out on every device and blocks sign-in until restored.'
              : 'Restoring lets this person sign in again.'}
          </p>
          <ErrorNotice error={action.error} />
          <button
            type="button"
            className={`button ${next === 'suspended' ? 'ops-danger' : 'button-primary'}`}
            disabled={action.busy}
            onClick={() => {
              if (
                next === 'suspended' &&
                !window.confirm(`Suspend ${person.displayName}?`)
              )
                return;
              void action.run(async () => {
                await api.request(`/admin/users/${person.id}/status`, {
                  method: 'POST',
                  private: true,
                  body: { status: next },
                });
                result.reload();
              });
            }}
          >
            {next === 'suspended' ? 'Suspend account' : 'Restore account'}
          </button>
        </div>
      )}
    </>
  );
}
