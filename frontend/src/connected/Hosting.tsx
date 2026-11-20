import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useAction, useApi, useResource } from '../api/react';
import type {
  CatalogueOptions,
  ExperienceDraft,
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
  paise,
  RequireAccount,
} from './shared';

export function Hosting() {
  return (
    <div className="page interior-page">
      <RequireAccount>
        <HostWorkspace />
      </RequireAccount>
    </div>
  );
}
function HostWorkspace() {
  const host = useResource<HostApplication>('/me/host', true);
  const missing = host.error instanceof ApiError && host.error.status === 404;
  return (
    <>
      <p className="eyebrow">Share your Sikkim</p>
      <h1>Host workspace</h1>
      <nav className="media-navigation">
        <Link className="button button-secondary" to="/hosting/media">
          Photos and videos
        </Link>
        <Link className="button button-secondary" to="/hosting/stories">
          Community stories
        </Link>
      </nav>
      <p>Start with your profile, then prepare your experiences for review.</p>
      <Link className="button button-secondary" to="/hosting/experiences">
        Your experiences
      </Link>
      {host.loading && <Loading />}
      {!missing && <ErrorNotice error={host.error} retry={host.reload} />}
      {(missing || host.data) && (
        <HostForm
          key={host.data?.revision ?? 0}
          host={host.data}
          reload={host.reload}
        />
      )}
    </>
  );
}
function HostForm({
  host,
  reload,
}: {
  host?: HostApplication;
  reload: () => void;
}) {
  const api = useApi();
  const action = useAction();
  const editable = !host || ['draft', 'rejected'].includes(host.status);
  const canSubmit = !!(host?.isDemo || host?.realVerificationAvailable);
  return (
    <>
      <p className="api-notice">
        Status: {host?.status ?? 'Not started'}. This is a test onboarding flow.
        Real verification and document uploads are not available yet.
      </p>
      <ErrorNotice error={action.error} />
      {action.error instanceof ApiError && action.error.status === 409 && (
        <button className="button button-secondary" onClick={reload}>
          Reload latest profile
        </button>
      )}
      <form
        className="api-panel api-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void action.run(async () => {
            await api.request('/me/host', {
              method: 'PUT',
              private: true,
              body: {
                revision: host?.revision ?? 0,
                publicName: String(form.get('name')).trim(),
                story: String(form.get('story')).trim(),
                serviceAreas: lines(form.get('areas')),
                contactChoice: form.get('contact'),
              },
            });
            reload();
          });
        }}
      >
        <fieldset
          className="api-wide api-form"
          disabled={!editable || action.busy}
        >
          <legend>Host profile</legend>
          <label>
            Public name
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={host?.publicName ?? ''}
            />
          </label>
          <label>
            Contact preference
            <select
              name="contact"
              defaultValue={host?.contactChoice ?? 'hidden'}
            >
              <option value="hidden">Keep contact hidden</option>
              <option value="in_app">In-app messaging when available</option>
            </select>
          </label>
          <label className="api-wide">
            Your story
            <textarea
              name="story"
              required
              maxLength={2000}
              defaultValue={host?.story ?? ''}
            />
          </label>
          <label className="api-wide">
            Service areas (one per line, up to 10)
            <textarea
              name="areas"
              required
              defaultValue={host?.serviceAreas.join('\n') ?? ''}
            />
          </label>
          <button className="button button-primary">Save host profile</button>
        </fieldset>
      </form>
      {host && editable && (
        <button
          className="button button-primary"
          disabled={action.busy || !canSubmit}
          onClick={() =>
            void action.run(async () => {
              await api.request('/me/host/submit', {
                method: 'POST',
                private: true,
                body: { revision: host.revision },
              });
              reload();
            })
          }
        >
          {canSubmit
            ? 'Submit saved profile for review'
            : 'Verification isn’t available yet'}
        </button>
      )}
      <History history={host?.history} />
    </>
  );
}
export function ExperienceWorkspace() {
  return (
    <div className="page interior-page">
      <RequireAccount>
        <h1>Your experiences</h1>
        <div className="api-actions">
          <Link className="button button-primary" to="/hosting/experiences/new">
            Create experience
          </Link>
          <Link className="button button-secondary" to="/hosting">
            Host profile
          </Link>
        </div>
        <PagedList<ExperienceRow>
          path="/me/experiences"
          privateRequest
          render={(item) => (
            <article className="api-panel api-host">
              <Link to={'/hosting/experiences/' + item.id}>
                <h2>{item.title}</h2>
                <p>
                  {item.status} · revision {item.revision}
                </p>
                <p>
                  {item.pricePaise === null
                    ? 'Price not set'
                    : money(item.pricePaise)}
                </p>
              </Link>
              <Link
                className="button button-secondary"
                to={'/hosting/experiences/' + item.id + '/dates'}
              >
                Dates & guests
              </Link>
            </article>
          )}
        />
      </RequireAccount>
    </div>
  );
}
export function ExperienceEditor() {
  const { id } = useParams();
  return (
    <div className="page interior-page">
      <RequireAccount>
        <EditorLoader key={id ?? 'new'} id={id} />
      </RequireAccount>
    </div>
  );
}
function EditorLoader({ id }: { id?: string }) {
  const result = useResource<OwnedExperience>(
    id ? '/me/experiences/' + encodeURIComponent(id) : null,
    true,
  );
  return (
    <>
      <Link to="/hosting/experiences">← Your experiences</Link>
      <h1>{id ? 'Edit experience' : 'Create an experience'}</h1>
      {id && (
        <Link
          className="button button-secondary"
          to={'/hosting/experiences/' + id + '/media'}
        >
          Manage photos and reel
        </Link>
      )}
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
      {(!id || result.data) && (
        <ExperienceForm
          key={result.data?.revision ?? 0}
          item={result.data}
          reload={result.reload}
        />
      )}
    </>
  );
}
function lines(value: FormDataEntryValue | null) {
  return String(value ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}
function optionalNumber(value: FormDataEntryValue | null) {
  return value ? Number(value) : null;
}
export function draftFromForm(
  form: FormData,
  hasPolicy = false,
): ExperienceDraft {
  const policy = {
    cancellation: String(form.get('cancellation') ?? '').trim(),
    safety: String(form.get('safety') ?? '').trim(),
    participation: String(form.get('participation') ?? '').trim(),
  };
  if (
    Object.values(policy).some(Boolean) &&
    !Object.values(policy).every(Boolean)
  )
    throw new Error(
      'Fill in all three policy fields, or leave all three blank while drafting.',
    );
  if (hasPolicy && !Object.values(policy).some(Boolean))
    throw new Error(
      'Existing policies cannot be cleared. Update all three policy fields.',
    );
  return {
    title: String(form.get('title')).trim(),
    description: String(form.get('description')),
    area: String(form.get('area')) || null,
    categories: form.getAll('category').map(String),
    meetingPoint: String(form.get('meetingPoint')),
    durationMinutes: optionalNumber(form.get('durationMinutes')),
    pricePaise: paise(String(form.get('price'))),
    minParticipants: Number(form.get('minParticipants')),
    maxParticipants: Number(form.get('maxParticipants')),
    difficulty: String(form.get('difficulty')),
    inclusions: lines(form.get('inclusions')),
    exclusions: lines(form.get('exclusions')),
    preparation: String(form.get('preparation')),
    accessibility: String(form.get('accessibility')),
    accessibilityNotes: String(form.get('accessibilityNotes')),
    sourceKind: form.get('sourceKind') as ExperienceDraft['sourceKind'],
    sourceReference: String(form.get('sourceReference')),
    ...(Object.values(policy).every(Boolean) ? { policy } : {}),
  };
}
function ExperienceForm({
  item,
  reload,
}: {
  item?: OwnedExperience;
  reload: () => void;
}) {
  const api = useApi();
  const action = useAction();
  const navigate = useNavigate();
  const options = useResource<CatalogueOptions>('/catalogue/options');
  const editable = item?.status !== 'review';
  return (
    <>
      <p className="api-notice">
        {item ? `Status: ${item.status} · revision ${item.revision}. ` : ''}Save
        a draft first, then submit the saved version. Test accounts cannot
        publish real offers.
      </p>
      {item?.status === 'published' && (
        <p className="api-notice">
          Saving changes removes this experience from public browsing until it
          is approved again.
        </p>
      )}
      <ErrorNotice error={action.error} />
      <ErrorNotice error={options.error} retry={options.reload} />
      {action.error instanceof ApiError && action.error.status === 409 && (
        <button className="button button-secondary" onClick={reload}>
          Reload latest experience
        </button>
      )}
      <form
        className="api-panel"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void action.run(async () => {
            const draft = draftFromForm(form, Boolean(item?.policy));
            const result = await api.request<OwnedExperience>(
              item ? '/me/experiences/' + item.id : '/me/experiences',
              {
                method: item ? 'PUT' : 'POST',
                private: true,
                body: {
                  ...draft,
                  ...(item ? { revision: item.revision } : {}),
                },
              },
            );
            if (item) reload();
            else
              navigate('/hosting/experiences/' + result.data.id, {
                replace: true,
              });
          });
        }}
      >
        <fieldset
          className="api-form"
          disabled={!editable || action.busy || !options.data}
        >
          <legend>Experience details</legend>
          <label className="api-wide">
            Title
            <input
              name="title"
              required
              maxLength={120}
              defaultValue={item?.title ?? ''}
            />
          </label>
          <label className="api-wide">
            Description
            <textarea
              name="description"
              maxLength={5000}
              defaultValue={item?.description ?? ''}
            />
          </label>
          <label>
            Area
            <select name="area" defaultValue={item?.area ?? ''}>
              <option value="">Choose an area</option>
              {item?.area && (
                <option value={item.area}>
                  {options.data?.areas.find((area) => area.code === item.area)
                    ?.name ?? item.area}
                </option>
              )}
              {options.data?.areas
                .filter((area) => area.code !== item?.area)
                .map((area) => (
                  <option value={area.code} key={area.code}>
                    {area.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Meeting point
            <input
              name="meetingPoint"
              maxLength={1000}
              defaultValue={item?.meetingPoint ?? ''}
            />
          </label>
          <label>
            Duration (minutes)
            <input
              name="durationMinutes"
              type="number"
              min={1}
              max={10080}
              defaultValue={item?.durationMinutes ?? ''}
            />
          </label>
          <label>
            Price per person (₹)
            <input
              name="price"
              inputMode="decimal"
              defaultValue={
                item?.pricePaise == null ? '' : item.pricePaise / 100
              }
            />
          </label>
          <label>
            Minimum participants
            <input
              name="minParticipants"
              type="number"
              required
              min={1}
              max={1000}
              defaultValue={item?.minParticipants ?? 1}
            />
          </label>
          <label>
            Maximum participants
            <input
              name="maxParticipants"
              type="number"
              required
              min={1}
              max={1000}
              defaultValue={item?.maxParticipants ?? 1}
            />
          </label>
          <label>
            Difficulty
            <select
              name="difficulty"
              defaultValue={item?.difficulty ?? 'unknown'}
            >
              {['unknown', 'easy', 'moderate', 'challenging'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label>
            Accessibility
            <select
              name="accessibility"
              defaultValue={item?.accessibility ?? 'unknown'}
            >
              <option value="unknown">Not specified</option>
              <option value="accessible">Accessible</option>
              <option value="not_accessible">Not accessible</option>
            </select>
          </label>
          <div className="api-wide">
            <h3>Categories</h3>
            <div className="api-chips">
              {options.data?.categories.map((category) => (
                <label className="api-check api-chip" key={category.code}>
                  <input
                    type="checkbox"
                    name="category"
                    value={category.code}
                    defaultChecked={item?.categories.includes(category.code)}
                  />
                  {category.name}
                </label>
              ))}
            </div>
          </div>
          {(
            [
              {
                name: 'inclusions',
                title: 'Included (one per line)',
                max: 9030,
              },
              {
                name: 'exclusions',
                title: 'Not included (one per line)',
                max: 9030,
              },
              { name: 'preparation', title: 'How to prepare', max: 2000 },
              {
                name: 'accessibilityNotes',
                title: 'Accessibility notes',
                max: 2000,
              },
            ] as const
          ).map((field) => (
            <label key={field.name}>
              {field.title}
              <textarea
                name={field.name}
                maxLength={field.max}
                defaultValue={
                  Array.isArray(item?.[field.name])
                    ? (item[field.name] as string[]).join('\n')
                    : (item?.[field.name] ?? '')
                }
              />
            </label>
          ))}
          <label>
            Source
            <select
              name="sourceKind"
              defaultValue={item?.sourceKind ?? 'direct'}
            >
              <option value="direct">Created by host</option>
              <option value="district">District curation</option>
            </select>
          </label>
          <label>
            Source reference
            <input
              name="sourceReference"
              maxLength={1000}
              defaultValue={item?.sourceReference ?? ''}
            />
          </label>
          {(['cancellation', 'safety', 'participation'] as const).map(
            (name) => (
              <label className="api-wide" key={name}>
                {name.charAt(0).toUpperCase() + name.slice(1)} policy
                <textarea
                  name={name}
                  maxLength={3000}
                  defaultValue={item?.policy?.[name] ?? ''}
                />
              </label>
            ),
          )}
          <p className="api-wide api-muted">
            Add photos and a reel after saving. Once your host profile is
            approved and this experience is published, you can manage dates and
            guests.
          </p>
          <button className="button button-primary" disabled={!options.data}>
            Save draft
          </button>
        </fieldset>
      </form>
      {item && ['draft', 'rejected', 'hidden'].includes(item.status) && (
        <button
          className="button button-primary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await api.request('/me/experiences/' + item.id + '/submit', {
                method: 'POST',
                private: true,
                body: { revision: item.revision },
              });
              reload();
            })
          }
        >
          Submit saved experience for review
        </button>
      )}
      <History history={item?.history} />
    </>
  );
}
