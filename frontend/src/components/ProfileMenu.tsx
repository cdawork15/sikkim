import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Icon } from './Icon';

export type MenuAccount = {
  displayName: string;
  roles: string[];
  email?: string | null;
  phone?: string | null;
};

export function roleLabel(roles: string[]) {
  if (roles.includes('super')) return 'Super admin';
  if (roles.includes('admin')) return 'Admin';
  if (roles.includes('host')) return 'Host';
  return 'Traveller';
}

/** Shows Indian mobile numbers as +91 98000 12345; other numbers unchanged. */
export const formatPhone = (phone?: string | null) => {
  const match = phone?.match(/^\+91(\d{5})(\d{5})$/);
  return match ? `+91 ${match[1]} ${match[2]}` : (phone ?? null);
};

export const initialOf = (name: string) =>
  name.trim().charAt(0).toUpperCase() || '?';

/** Header avatar that opens the account menu: profile, shortcuts and sign-out. */
export function ProfileMenu({
  account,
  onSignOut,
}: {
  account: MenuAccount;
  onSignOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();

  useEffect(() => setOpen(false), [pathname, search]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const staff =
    account.roles.includes('admin') || account.roles.includes('super');
  const links: [string, string][] = [
    ['/account', 'Profile and preferences'],
    ['/essentials/bookings', 'Your bookings'],
    ['/saved', 'Saved'],
    ['/reels/new', 'Share a reel'],
    ['/hosting', 'Host workspace'],
    ...(staff
      ? ([['/admin', 'Operations and CRM']] as [string, string][])
      : []),
    ['/settings', 'Privacy & settings'],
  ];

  return (
    <div className="profile-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="guest-link profile-trigger"
        aria-label={`${account.displayName}, account menu`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen(!open)}
      >
        <span className="guest-avatar" aria-hidden="true">
          {initialOf(account.displayName)}
        </span>
        <span>{account.displayName}</span>
        <Icon name="chevron" size={14} />
      </button>
      {open && (
        <div className="profile-dropdown" id={panelId}>
          <div className="profile-dropdown-head">
            <span className="guest-avatar" aria-hidden="true">
              {initialOf(account.displayName)}
            </span>
            <div>
              <strong>{account.displayName}</strong>
              <span>
                {account.email ?? formatPhone(account.phone) ?? 'Signed in'}
              </span>
              <span className="profile-role">{roleLabel(account.roles)}</span>
            </div>
          </div>
          <nav aria-label="Your account">
            {links.map(([to, label]) => (
              <Link key={to} to={to}>
                {label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            className="profile-signout"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void onSignOut()
                .then(() => navigate('/welcome', { replace: true }))
                .finally(() => setBusy(false));
            }}
          >
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      )}
    </div>
  );
}
