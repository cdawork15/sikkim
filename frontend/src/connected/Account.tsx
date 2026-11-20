import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAction, useApi, useResource, useSession } from '../api/react';
import type {
  Account as AccountData,
  CatalogueOptions,
  Consent,
  Interest,
  Settings,
} from '../api/types';
import {
  ErrorNotice,
  isStaff,
  landingFor,
  Loading,
  RequireAccount,
} from './shared';
import { OtpSignIn } from './OtpSignIn';

export function Welcome() {
  const api = useApi();
  const settings = useResource<Settings>('/settings');
  const { user } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [signUp, setSignUp] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const submitting = useRef(false);
  const next = params.get('next') ?? '/account';
  const destination = /^\/(?![\/\\])/.test(next) ? next : '/account';
  const otpMode = settings.data?.auth.mode === 'otp';
  return (
    <div className="page interior-page">
      <section
        className="account-gate password-page"
        aria-label="Your Sikkim account"
      >
        <div className="account-gate-scene">
          <img
            src="/videos/nathu.webp"
            alt="Snow-covered mountains near Nathu La, Sikkim"
          />
          <span className="account-gate-place">Nathu La, Sikkim</span>
          <div className="account-gate-scene-copy" aria-hidden="true">
            <span>A LITTLE CLOSER TO SIKKIM</span>
            <strong>
              Some places
              <br />
              stay with you.
            </strong>
          </div>
        </div>
        <div className="account-gate-content">
          <span className="account-gate-eyebrow">
            <span /> YOUR NEXT CHAPTER
          </span>
          {otpMode && !usePassword ? (
            <>
              <h1>Experience Sikkim with the people who live here.</h1>
              <p>Sign in or create your account with a one-time code.</p>
            </>
          ) : (
            <>
              <h1>{signUp ? 'Make yourself at home.' : 'Welcome back.'}</h1>
              <p>
                {signUp
                  ? 'A few details, and you’re ready to explore.'
                  : 'Sign in to pick up where you left off.'}
              </p>
            </>
          )}
          {settings.loading && <Loading />}
          <ErrorNotice error={settings.error} retry={settings.reload} />
          <ErrorNotice error={error} />
          {user ? (
            <Link className="button button-primary" to={destination}>
              Continue as {user.displayName}
            </Link>
          ) : otpMode && !usePassword ? (
            <OtpSignIn
              destination={destination}
              onUsePassword={() => setUsePassword(true)}
            />
          ) : settings.data?.auth.mode === 'password' || usePassword ? (
            <>
              <form
                className="api-form password-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (submitting.current) return;
                  submitting.current = true;
                  setBusy(true);
                  setError(undefined);
                  const data = new FormData(event.currentTarget);
                  const credentials = {
                    email: String(data.get('email')).trim(),
                    password: String(data.get('password')),
                  };
                  const task = signUp
                    ? api.register({
                        ...credentials,
                        displayName: String(data.get('displayName')).trim(),
                      })
                    : api.login(credentials);
                  void task
                    .then((account) =>
                      navigate(landingFor(account, destination), {
                        replace: true,
                      }),
                    )
                    .catch((failure: unknown) =>
                      setError(
                        failure instanceof Error
                          ? failure
                          : new Error('Please try again.'),
                      ),
                    )
                    .finally(() => {
                      submitting.current = false;
                      setBusy(false);
                    });
                }}
              >
                {signUp && (
                  <label>
                    Your name
                    <input
                      name="displayName"
                      autoComplete="name"
                      required
                      maxLength={80}
                      pattern={'.*\\S.*'}
                      disabled={busy}
                    />
                  </label>
                )}
                <label>
                  Email
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    required
                    maxLength={254}
                    disabled={busy}
                  />
                </label>
                <label htmlFor="account-password">Password</label>
                <div className="password-input">
                  <input
                    id="account-password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={signUp ? 'new-password' : 'current-password'}
                    required
                    minLength={8}
                    maxLength={128}
                    aria-describedby={signUp ? 'password-hint' : undefined}
                    disabled={busy}
                  />
                  <button
                    type="button"
                    aria-label={
                      showPassword ? 'Hide password' : 'Show password'
                    }
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                {signUp && (
                  <p id="password-hint" className="password-note">
                    Use at least 8 characters. A few memorable words work well.
                  </p>
                )}
                <button className="button button-primary" disabled={busy}>
                  {busy
                    ? 'Please wait…'
                    : signUp
                      ? 'Create account'
                      : 'Sign in'}
                </button>
              </form>
              <p className="password-switch">
                {signUp ? 'Already have an account? ' : 'New here? '}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setSignUp(!signUp);
                    setShowPassword(false);
                    setError(undefined);
                  }}
                >
                  {signUp ? 'Sign in' : 'Create an account'}
                </button>
              </p>
              {signUp && (
                <p className="password-note">
                  Password reset isn’t available yet. Keep your password
                  somewhere safe.
                </p>
              )}
              {otpMode && (
                <p className="password-switch">
                  <button type="button" onClick={() => setUsePassword(false)}>
                    Use a one-time code instead
                  </button>
                </p>
              )}
            </>
          ) : (
            settings.data && (
              <p>
                Sign-in is unavailable right now. You can still explore as a
                guest.
              </p>
            )
          )}
          <Link className="account-gate-browse" to="/explore">
            Keep exploring
          </Link>
        </div>
      </section>
    </div>
  );
}
/** Staff shortcuts, shown first so the CRM is never hidden behind personal settings. */
function StaffPanel({ roles }: { roles: string[] }) {
  const superAdmin = roles.includes('super');
  const links: [string, string, string][] = [
    ['/admin?tab=pipeline', 'CRM pipeline', 'Curators, follow-ups and notes'],
    ['/admin?tab=approvals', 'Approvals', 'Hosts, trips and reels to review'],
    ['/hosting', 'Create a trip', 'Your trips, dates and guests'],
    ['/admin?tab=bookings', 'Bookings', 'Find any booking or ticket'],
    ...(superAdmin
      ? ([
          ['/admin?tab=overview', 'Overview', 'Accounts, bookings and growth'],
          ['/admin?tab=users', 'People', 'Every account and its details'],
        ] as [string, string, string][])
      : []),
  ];
  return (
    <section className="staff-panel" aria-label="Staff workspace">
      <div className="staff-panel-head">
        <div>
          <p className="ops-kicker">{superAdmin ? 'Super admin' : 'Admin'}</p>
          <h2>Operations and CRM</h2>
        </div>
        <Link className="button button-primary" to="/admin">
          Open Operations
        </Link>
      </div>
      <div className="staff-panel-links">
        {links.map(([to, title, note]) => (
          <Link key={to} to={to}>
            <strong>{title}</strong>
            <span>{note}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function Account() {
  return (
    <div className="page interior-page">
      <RequireAccount>
        <AccountContent />
      </RequireAccount>
    </div>
  );
}
function AccountContent() {
  const result = useResource<AccountData>('/me', true);
  return (
    <>
      <h1>Your account</h1>
      {result.data && isStaff(result.data.roles) && (
        <StaffPanel roles={result.data.roles} />
      )}
      <div className="api-actions">
        <Link className="button button-secondary" to="/hosting">
          Host workspace
        </Link>
        <Link className="button button-secondary" to="/settings">
          Privacy & settings
        </Link>
      </div>
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
      {result.data && (
        <Profile
          key={result.data.id}
          account={result.data}
          saved={result.replace}
        />
      )}
    </>
  );
}
function Profile({
  account,
  saved,
}: {
  account: AccountData;
  saved: (data: AccountData) => void;
}) {
  const api = useApi();
  const action = useAction();
  const interests = useResource<Interest[]>('/interests');
  const options = useResource<CatalogueOptions>('/catalogue/options');
  async function save(path: string, method: string, body: unknown) {
    const result = await api.request<AccountData>(path, {
      method,
      body,
      private: true,
    });
    api.updateUser(result.data);
    saved(result.data);
  }
  const preferences = account.preferences;
  return (
    <>
      <ErrorNotice error={action.error} />
      <ErrorNotice error={interests.error} retry={interests.reload} />
      <ErrorNotice error={options.error} retry={options.reload} />
      <form
        className="api-panel api-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void action.run(
            () =>
              save('/me', 'PATCH', {
                displayName: String(data.get('name')).trim(),
                language: data.get('language'),
              }),
            'Your profile is saved.',
          );
        }}
      >
        <h2 className="api-wide">About you</h2>
        <label>
          Name
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={account.displayName}
          />
        </label>
        <label>
          Preferred language
          <select name="language" defaultValue={account.language}>
            <option value="en">English</option>
            <option value="hi">Hindi</option>
            <option value="ne">Nepali</option>
          </select>
        </label>
        <p className="api-wide api-muted">
          Content is currently available in English. Your language preference
          will be saved.
        </p>
        <button className="button button-primary" disabled={action.busy}>
          Save profile
        </button>
        {action.message === 'Your profile is saved.' && (
          <p className="api-wide" role="status">
            {action.message}
          </p>
        )}
      </form>
      <form
        className="api-panel"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void action.run(
            () =>
              save('/me/interests', 'PUT', { codes: data.getAll('interest') }),
            'Your interests are saved.',
          );
        }}
      >
        <h2>Your interests</h2>
        <div className="api-chips">
          {interests.data?.map((interest) => (
            <label className="api-check api-chip" key={interest.code}>
              <input
                type="checkbox"
                name="interest"
                value={interest.code}
                defaultChecked={account.interests.includes(interest.code)}
              />
              {interest.label}
            </label>
          ))}
        </div>
        <button
          className="button button-primary"
          disabled={action.busy || !interests.data}
        >
          Save interests
        </button>
        {action.message === 'Your interests are saved.' && (
          <p className="api-wide" role="status">
            {action.message}
          </p>
        )}
      </form>
      <form
        className="api-panel api-form"
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void action.run(
            () =>
              save('/me/preferences', 'PATCH', {
                chosenArea: data.get('area') || null,
                tripStart: data.get('start') || null,
                tripDays: data.get('days') ? Number(data.get('days')) : null,
                travellers: Number(data.get('travellers')),
                pace: data.get('pace'),
                notificationsEnabled: data.has('notifications'),
                showInParticipantList: data.has('participants'),
              }),
            'Your preferences are saved.',
          );
        }}
      >
        <h2 className="api-wide">Your travel preferences</h2>
        <label>
          Preferred area
          <select name="area" defaultValue={preferences.chosenArea ?? ''}>
            <option value="">Not decided</option>
            {preferences.chosenArea && (
              <option value={preferences.chosenArea}>
                {options.data?.areas.find(
                  (area) => area.code === preferences.chosenArea,
                )?.name ?? preferences.chosenArea}
              </option>
            )}
            {options.data?.areas
              .filter((area) => area.code !== preferences.chosenArea)
              .map((area) => (
                <option key={area.code} value={area.code}>
                  {area.name}
                </option>
              ))}
          </select>
        </label>
        <label>
          Trip starts
          <input
            type="date"
            name="start"
            defaultValue={preferences.tripStart ?? ''}
          />
        </label>
        <label>
          Days
          <input
            type="number"
            name="days"
            min={2}
            max={10}
            defaultValue={preferences.tripDays ?? ''}
          />
        </label>
        <label>
          Travellers
          <input
            type="number"
            name="travellers"
            min={1}
            max={10}
            required
            defaultValue={preferences.travellers}
          />
        </label>
        <label>
          Pace
          <select name="pace" defaultValue={preferences.pace}>
            <option value="slow">Slow</option>
            <option value="balanced">Balanced</option>
          </select>
        </label>
        <div>
          <label className="api-check">
            <input
              type="checkbox"
              name="notifications"
              defaultChecked={preferences.notificationsEnabled}
            />
            Allow notifications when available
          </label>
          <label className="api-check">
            <input
              type="checkbox"
              name="participants"
              defaultChecked={preferences.showInParticipantList}
            />
            Show me in participant lists
          </label>
        </div>
        <p className="api-wide api-muted">
          Saving preferences does not create a trip or booking.
        </p>
        <button
          className="button button-primary"
          disabled={action.busy || !options.data}
        >
          Save preferences
        </button>
        {action.message === 'Your preferences are saved.' && (
          <p className="api-wide" role="status">
            {action.message}
          </p>
        )}
      </form>
    </>
  );
}
export function SettingsPage() {
  const settings = useResource<Settings>('/settings');
  const live = useResource<{ status: string }>('/health/live');
  const ready = useResource<{ status: string }>('/health/ready');
  const { user } = useSession();
  return (
    <div className="page interior-page api-narrow">
      <h1>Privacy & settings</h1>
      {settings.loading && <Loading />}
      <ErrorNotice error={settings.error} retry={settings.reload} />
      <section className="api-panel">
        <h2>Service connection</h2>
        <p role="status">
          {live.loading || ready.loading
            ? 'Checking…'
            : live.data?.status === 'ok' && ready.data?.status === 'ok'
              ? 'Connected and ready.'
              : 'The service is currently unavailable.'}
        </p>
        <button
          className="button button-secondary"
          onClick={() => {
            live.reload();
            ready.reload();
          }}
        >
          Check again
        </button>
      </section>
      {settings.data && (
        <>
          <p>{settings.data.safety.message}</p>
          <p>
            Location access is optional.{' '}
            {settings.data.help.contact
              ? `Help: ${settings.data.help.contact}`
              : 'A support contact has not been added yet.'}
          </p>
          {user ? (
            <Privacy settings={settings.data} />
          ) : (
            <Link
              className="button button-primary"
              to="/welcome?next=/settings"
            >
              Sign in to manage your account
            </Link>
          )}
        </>
      )}
    </div>
  );
}
function Privacy({ settings }: { settings: Settings }) {
  const api = useApi();
  const { user } = useSession();
  const action = useAction();
  const consents = useResource<Consent[]>('/me/consents', true);
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <ErrorNotice error={action.error} />
      {action.message && <p role="status">{action.message}</p>}
      <section className="api-panel">
        <h2>Your choices</h2>
        <p>
          {user?.isDemo
            ? 'These privacy choices are for this test account.'
            : 'Optional privacy choices are not available yet.'}
        </p>
        {consents.loading && <Loading />}
        <ErrorNotice error={consents.error} retry={consents.reload} />
        {user?.isDemo &&
          consents.data &&
          settings.privacy.choices.map((choice) => (
            <label className="api-check" key={choice.purpose}>
              <input
                type="checkbox"
                checked={
                  consents.data!.find((item) => item.purpose === choice.purpose)
                    ?.accepted ?? false
                }
                disabled={action.busy || !settings.privacy.version}
                onChange={(event) => {
                  const accepted = event.target.checked;
                  void action.run(async () => {
                    await api.request(
                      '/me/consents/' + encodeURIComponent(choice.purpose),
                      {
                        method: 'PUT',
                        private: true,
                        body: { accepted, version: settings.privacy.version },
                      },
                    );
                    consents.reload();
                  }, 'Choice saved.');
                }}
              />
              {choice.label}
            </label>
          ))}
      </section>
      <section className="api-panel">
        <h2>Your data</h2>
        <button
          className="button button-secondary"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const { data } = await api.request<unknown>('/me/export', {
                private: true,
              });
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], {
                  type: 'application/json',
                }),
              );
              const anchor = document.createElement('a');
              anchor.href = url;
              anchor.download = 'sikkim-account.json';
              anchor.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }, 'Account data downloaded.')
          }
        >
          Download my data
        </button>
        <h3>Request account deletion</h3>
        <p>
          This disables your account and signs out all sessions. Permanent
          deletion is not available yet.
        </p>
        <label className="api-check">
          <input
            type="checkbox"
            checked={confirm}
            onChange={(event) => setConfirm(event.target.checked)}
          />
          I understand that this account will be disabled.
        </label>
        <button
          className="button button-secondary"
          disabled={!confirm || action.busy}
          onClick={() =>
            void action.run(async () => {
              await api.request('/me/deletion-request', {
                method: 'POST',
                private: true,
              });
              api.forget(
                'Your account has been disabled and your deletion request recorded.',
              );
            })
          }
        >
          Request deletion
        </button>
      </section>
      <div className="api-actions">
        <button
          className="button button-secondary"
          disabled={action.busy}
          onClick={() => void action.run(() => api.logout())}
        >
          Sign out
        </button>
        <button
          className="button button-secondary"
          disabled={action.busy}
          onClick={() => void action.run(() => api.logout(true))}
        >
          Sign out everywhere
        </button>
      </div>
    </>
  );
}
