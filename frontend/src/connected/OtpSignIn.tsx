import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { OtpChallenge } from '../api/client';
import { useApi, useResource } from '../api/react';
import type { Interest } from '../api/types';
import { ErrorNotice, landingFor, RequireAccount } from './shared';

type Step = 'start' | 'code';

/**
 * Passwordless sign-in (prototype S01 → S02): email or phone, a 6-digit code,
 * then name and interests for new accounts.
 */
export function OtpSignIn({
  destination,
  onUsePassword,
}: {
  destination: string;
  onUsePassword?: () => void;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('start');
  const [channel, setChannel] = useState<'email' | 'phone'>('phone');
  const [value, setValue] = useState('');
  const [challenge, setChallenge] = useState<OtpChallenge>();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  const [wait, setWait] = useState(0);
  const lock = useRef(false);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [wait]);

  async function guarded(task: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await task();
    } catch (failure) {
      setError(
        failure instanceof Error ? failure : new Error('Please try again.'),
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  const send = () =>
    guarded(async () => {
      const next = await api.requestOtp(channel, value.trim());
      setChallenge(next);
      setCode('');
      setWait(next.resendAfterSeconds);
      setStep('code');
    });

  const verify = (event: FormEvent) => {
    event.preventDefault();
    if (!challenge) return;
    void guarded(async () => {
      const result = await api.verifyOtp(challenge.challengeId, code);
      // Signing in remounts the app tree, so onboarding lives on its own route.
      navigate(
        result.isNewAccount
          ? '/onboarding?next=' + encodeURIComponent(destination)
          : landingFor(result.user, destination),
        { replace: true },
      );
    });
  };

  return (
    <div className="otp-signin">
      <ErrorNotice error={error} />
      {step === 'start' ? (
        <form
          className="api-form password-form"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div
            className="ops-tabs otp-channel"
            role="tablist"
            aria-label="Sign in with"
          >
            {(['phone', 'email'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={channel === option}
                onClick={() => {
                  setChannel(option);
                  setValue('');
                  setError(undefined);
                }}
              >
                {option === 'phone' ? 'Mobile number' : 'Email'}
              </button>
            ))}
          </div>
          <label>
            {channel === 'phone' ? 'Mobile number' : 'Email'}
            <input
              name={channel}
              type={channel === 'phone' ? 'tel' : 'email'}
              inputMode={channel === 'phone' ? 'tel' : 'email'}
              autoComplete={channel === 'phone' ? 'tel' : 'email'}
              autoCapitalize="none"
              spellCheck={false}
              placeholder={
                channel === 'phone' ? '98000 00000' : 'you@example.com'
              }
              required
              maxLength={channel === 'phone' ? 20 : 254}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              disabled={busy}
            />
          </label>
          <button
            className="button button-primary"
            disabled={busy || !value.trim()}
          >
            {busy ? 'Sending…' : 'Send code'}
          </button>
          <p className="password-note">
            We’ll send a 6-digit code. New here? The same code creates your
            account.
          </p>
          {onUsePassword && (
            <p className="password-switch">
              Have a password?{' '}
              <button type="button" onClick={onUsePassword} disabled={busy}>
                Sign in with password
              </button>
            </p>
          )}
        </form>
      ) : (
        <form className="api-form password-form" onSubmit={verify}>
          <p className="otp-sent" role="status">
            Code sent to <strong>{challenge?.destination}</strong>
          </p>
          <label>
            6-digit code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
              }
              disabled={busy}
            />
          </label>
          <button
            className="button button-primary"
            disabled={busy || code.length !== 6}
          >
            {busy ? 'Checking…' : 'Verify and continue'}
          </button>
          <p className="password-switch">
            <button
              type="button"
              disabled={busy || wait > 0}
              onClick={() => void send()}
            >
              {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
            </button>
            {' · '}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setStep('start');
                setError(undefined);
              }}
            >
              Change {channel === 'phone' ? 'number' : 'email'}
            </button>
          </p>
        </form>
      )}
    </div>
  );
}

/** Prototype S02: name and interests right after a new account's first code. */
export function Onboarding() {
  const [params] = useSearchParams();
  const next = params.get('next') ?? '/';
  const destination = /^\/(?![\/\\])/.test(next) ? next : '/';
  return (
    <div className="page interior-page onboarding-page">
      <RequireAccount>
        <ProfileStep destination={destination} />
      </RequireAccount>
    </div>
  );
}

function ProfileStep({ destination }: { destination: string }) {
  const api = useApi();
  const navigate = useNavigate();
  const interests = useResource<Interest[]>('/interests');
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error>();
  return (
    <form
      className="api-form password-form otp-profile"
      onSubmit={(event) => {
        event.preventDefault();
        setBusy(true);
        setError(undefined);
        void (async () => {
          try {
            if (name.trim())
              await api.request('/me', {
                method: 'PATCH',
                private: true,
                body: { displayName: name.trim() },
              });
            await api.request('/me/interests', {
              method: 'PUT',
              private: true,
              body: { codes: chosen },
            });
            navigate(destination, { replace: true });
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure
                : new Error('Please try again.'),
            );
            setBusy(false);
          }
        })();
      }}
    >
      <h2>What are you here for?</h2>
      <p className="password-note">
        We use this to curate Home. Change it any time in your profile.
      </p>
      <ErrorNotice error={error} />
      <label>
        Your name
        <input
          name="displayName"
          autoComplete="name"
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
      </label>
      <div
        className="feature-tabs interest-pick"
        role="group"
        aria-label="Interests"
      >
        {interests.data?.map((interest) => (
          <button
            key={interest.code}
            type="button"
            aria-pressed={chosen.includes(interest.code)}
            onClick={() =>
              setChosen((list) =>
                list.includes(interest.code)
                  ? list.filter((c) => c !== interest.code)
                  : [...list, interest.code],
              )
            }
          >
            {interest.label}
          </button>
        ))}
      </div>
      <button className="button button-primary" disabled={busy}>
        {busy ? 'Saving…' : 'Start exploring'}
      </button>
    </form>
  );
}
