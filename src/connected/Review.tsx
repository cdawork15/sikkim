import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAction, useApi, useResource, useSession } from '../api/react';
import { ApiError } from '../api/client';
import type {
  ExperienceRow,
  HostApplication,
  OwnedExperience,
} from '../api/types';
import {
  ErrorNotice,
  History,
  Loading,
  money,
  PagedList,
  RequireAccount,
} from './shared';

export function ReviewQueue() {
  const [params, setParams] = useSearchParams();
  const kind = params.get('kind') === 'experiences' ? 'experiences' : 'hosts';
  const statuses =
    kind === 'hosts'
      ? ['pending', 'draft', 'approved', 'rejected', 'suspended']
      : ['review', 'draft', 'published', 'rejected', 'hidden'];
  const status = statuses.includes(params.get('status') ?? '')
    ? params.get('status')!
    : statuses[0]!;
  return (
    <div className="page interior-page">
      <RequireAccount admin>
        <p className="eyebrow">Review team</p>
        <h1>Review workspace</h1>
        <Link className="button button-secondary" to="/review/media">
          Review photos and videos
        </Link>
        <div className="api-panel api-form">
          <label>
            Review
            <select
              value={kind}
              onChange={(event) =>
                setParams({ kind: event.target.value, status: 'pending' })
              }
            >
              <option value="hosts">Host profiles</option>
              <option value="experiences">Experiences</option>
            </select>
          </label>
          <label>
            Status
            <select
              value={status}
              onChange={(event) =>
                setParams({ kind, status: event.target.value })
              }
            >
              {statuses.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        {kind === 'hosts' ? (
          <PagedList<HostApplication>
            path={'/admin/hosts?status=' + status}
            privateRequest
            render={(host) => (
              <Link
                className="api-panel api-host"
                to={'/review/hosts/' + host.id}
              >
                <h2>{host.publicName}</h2>
                <p>
                  {host.status} · {host.isDemo ? 'Test host' : 'Real host'}
                </p>
              </Link>
            )}
          />
        ) : (
          <PagedList<ExperienceRow>
            path={'/admin/experiences?status=' + status}
            privateRequest
            render={(item) => (
              <Link
                className="api-panel api-host"
                to={'/review/experiences/' + item.id}
              >
                <h2>{item.title}</h2>
                <p>
                  {item.status} ·{' '}
                  {item.isDemo ? 'Test experience' : 'Real experience'}
                </p>
              </Link>
            )}
          />
        )}
      </RequireAccount>
    </div>
  );
}
export function ReviewDetail({ kind }: { kind: 'hosts' | 'experiences' }) {
  const { id = '' } = useParams();
  return (
    <div className="page interior-page">
      <RequireAccount admin>
        <ReviewContent key={kind + id} kind={kind} id={id} />
      </RequireAccount>
    </div>
  );
}
function ReviewContent({
  kind,
  id,
}: {
  kind: 'hosts' | 'experiences';
  id: string;
}) {
  const result = useResource<HostApplication | OwnedExperience>(
    '/admin/' + kind + '/' + encodeURIComponent(id),
    true,
  );
  const item = result.data;
  return (
    <>
      <Link to={'/review?kind=' + kind}>← Review queue</Link>
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
      {item && (
        <>
          <h1>{'publicName' in item ? item.publicName : item.title}</h1>
          <p className="api-notice">
            {item.status} · revision {item.revision} ·{' '}
            {item.isDemo ? 'Test data' : 'Real account'}
          </p>
          <section className="api-panel">
            <dl className="api-record">
              {Object.entries(item)
                .filter(
                  ([key]) =>
                    ![
                      'history',
                      'id',
                      'slug',
                      'revision',
                      'status',
                      'isDemo',
                      'uploadsAvailable',
                      'realVerificationAvailable',
                    ].includes(key),
                )
                .map(([key, value]) => (
                  <div key={key}>
                    <dt>
                      {key
                        .replace(/([A-Z])/g, ' $1')
                        .replace(/^./, (letter) => letter.toUpperCase())}
                    </dt>
                    <dd>
                      {key === 'pricePaise' && typeof value === 'number'
                        ? money(value)
                        : value == null
                          ? 'Not provided'
                          : typeof value === 'object' && !Array.isArray(value)
                            ? Object.entries(value)
                                .filter(
                                  ([name]) => !['id', 'version'].includes(name),
                                )
                                .map(([name, text]) => (
                                  <p key={name}>
                                    <strong>{name}: </strong>
                                    {String(text)}
                                  </p>
                                ))
                            : Array.isArray(value)
                              ? value.join(', ') || 'None'
                              : String(value)}
                    </dd>
                  </div>
                ))}
            </dl>
          </section>
          <Decision
            key={item.revision}
            kind={kind}
            item={item}
            reload={result.reload}
          />
          <History history={item.history} />
        </>
      )}
    </>
  );
}
function Decision({
  kind,
  item,
  reload,
}: {
  kind: 'hosts' | 'experiences';
  item: HostApplication | OwnedExperience;
  reload: () => void;
}) {
  const api = useApi();
  const { user } = useSession();
  const action = useAction();
  const [decision, setDecision] = useState(
    item.status === 'approved'
      ? 'suspended'
      : item.status === 'published'
        ? 'hidden'
        : 'rejected',
  );
  const isHost = kind === 'hosts';
  const eligible = isHost
    ? ['pending', 'approved'].includes(item.status)
    : ['review', 'published'].includes(item.status);
  const self = 'userId' in item && item.userId === user?.id;
  return (
    <>
      <ErrorNotice error={action.error} />
      {action.error instanceof ApiError && action.error.status === 409 && (
        <button className="button button-secondary" onClick={reload}>
          Reload latest submission
        </button>
      )}
      <form
        className="api-panel api-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void action.run(async () => {
            const body: Record<string, unknown> = {
              revision: item.revision,
              action: decision,
              reason: String(form.get('reason')).trim(),
            };
            if (decision === 'approved')
              body.expiresAt = new Date(
                String(form.get('expiresAt')),
              ).toISOString();
            if (decision === 'published') {
              body.providerReference = String(
                form.get('providerReference'),
              ).trim();
              body.sourceVerified = form.has('sourceVerified');
              body.featuredRank = form.get('rank')
                ? Number(form.get('rank'))
                : null;
            }
            await api.request('/admin/' + kind + '/' + item.id + '/decisions', {
              method: 'POST',
              private: true,
              body,
            });
            reload();
          });
        }}
      >
        <h2 className="api-wide">Review decision</h2>
        <p className="api-wide">
          Check the complete submission before recording a decision. Test
          accounts cannot publish real experiences.
        </p>
        <label>
          Decision
          <select
            value={decision}
            onChange={(event) => setDecision(event.target.value)}
          >
            <option
              value="rejected"
              disabled={item.status !== (isHost ? 'pending' : 'review')}
            >
              Reject
            </option>
            {isHost ? (
              <>
                <option
                  value="approved"
                  disabled={item.status !== 'pending' || !item.isDemo}
                >
                  Approve test host
                </option>
                <option value="suspended" disabled={item.status !== 'approved'}>
                  Suspend
                </option>
              </>
            ) : (
              <>
                <option
                  value="published"
                  disabled={item.isDemo || item.status !== 'review'}
                >
                  Publish
                </option>
                <option value="hidden" disabled={item.status !== 'published'}>
                  Hide
                </option>
              </>
            )}
          </select>
        </label>
        {decision === 'approved' && (
          <label>
            Approval valid until (your local time)
            <input name="expiresAt" type="datetime-local" required />
          </label>
        )}
        {decision === 'published' && (
          <>
            <label>
              Verification reference
              <input name="providerReference" required maxLength={1000} />
            </label>
            <label>
              Featured position (0–1000, optional)
              <input name="rank" type="number" min={0} max={1000} />
            </label>
            <label className="api-check api-wide">
              <input
                name="sourceVerified"
                type="checkbox"
                required={
                  'sourceKind' in item && item.sourceKind === 'district'
                }
              />
              I checked the district source
            </label>
          </>
        )}
        <label className="api-wide">
          Reason
          <textarea name="reason" required maxLength={1000} />
        </label>
        {self && (
          <p className="api-wide">You cannot review your own host profile.</p>
        )}
        <button
          className="button button-primary"
          disabled={action.busy || self || !eligible}
        >
          Record decision
        </button>
      </form>
    </>
  );
}
