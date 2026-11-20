import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { experiences } from '../data/experiences';
import { useSaved } from '../hooks/useSaved';
import { isReelsLocation } from '../lib/explore';
import { essentialsSections } from '../pages/essentials-shared';
import { Brand } from './Brand';
import { Icon, type IconName } from './Icon';

const navigation: {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
}[] = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/explore', label: 'Explore', icon: 'compass' },
  { to: '/community', label: 'Community', icon: 'users' },
  { to: '/essentials', label: 'Essentials', icon: 'map' },
];

export type AppContext = {
  savedIds: string[];
  toggleSaved: (id: string) => void;
};

export function AppShell({
  account,
  sessionNotice,
  connected = false,
}: {
  account?: { displayName: string; roles: string[] } | null;
  sessionNotice?: string;
  connected?: boolean;
} = {}) {
  const { savedIds, toggleSaved, storageNotice } = useSaved();
  const [announcement, setAnnouncement] = useState('');
  const { pathname, search } = useLocation();
  const reelView = connected && isReelsLocation(pathname, search);
  const main = useRef<HTMLElement>(null);
  const previousPath = useRef(pathname);

  useEffect(() => {
    const pageNames: Record<string, string> = {
      '/account': 'Your account',
      '/settings': 'Privacy & settings',
      '/review': 'Review workspace',
      '/review/media': 'Media review',
    };
    const name =
      pageNames[pathname] ??
      (pathname === '/'
        ? 'Find your kind of Sikkim'
        : pathname.startsWith('/experiences/')
          ? pathname.endsWith('/book')
            ? connected
              ? 'Book experience'
              : 'Demo booking'
            : 'Experience details'
          : pathname.startsWith('/demo-bookings/')
            ? 'Demo ticket'
            : pathname.startsWith('/essentials/bookings/')
              ? 'Your booking'
              : pathname.startsWith('/hosting')
                ? 'Host workspace'
                : pathname.startsWith('/essentials')
                  ? (essentialsSections.find(
                      (section) => pathname === '/essentials/' + section.id,
                    )?.label ?? 'Travel essentials')
                  : pathname === '/credits'
                    ? 'About our media'
                    : pathname === '/saved'
                      ? 'Saved experiences'
                      : pathname === '/welcome'
                        ? 'Welcome'
                        : pathname.startsWith('/hosts')
                          ? 'Hosts'
                          : pathname.startsWith('/community')
                            ? 'Community'
                            : 'Explore');
    document.title = `${name} — Sikkim Experiences`;
    if (previousPath.current === pathname) return;
    previousPath.current = pathname;
    window.scrollTo({ top: 0, behavior: 'instant' });
    main.current?.focus({ preventScroll: true });
  }, [pathname, connected]);

  const onToggle = (id: string) => {
    toggleSaved(id);
    const title =
      experiences.find((item) => item.id === id)?.title ?? 'Experience';
    setAnnouncement(
      `${title} ${savedIds.includes(id) ? 'removed from' : 'saved to'} your saved experiences.`,
    );
  };

  return (
    <div
      className={`app-shell ${connected ? 'connected-shell' : ''} ${reelView ? 'reels-shell' : ''} ${pathname === '/welcome' ? 'welcome-shell' : ''} ${pathname === '/' ? 'home-shell' : ''} ${pathname.startsWith('/experiences/') && !pathname.endsWith('/book') ? 'detail-shell' : ''}`}
    >
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-inner">
          <Brand />
          <nav aria-label="Main navigation" className="main-nav">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `nav-link ${isActive ? 'active' : ''}`
                }
              >
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="header-actions">
            <Link
              to="/explore?view=list"
              className="header-search"
              aria-label="Search experiences"
            >
              <Icon name="search" />
            </Link>
            <Link
              to="/saved"
              className="header-save"
              aria-label={
                connected
                  ? 'Saved experiences'
                  : `Saved experiences (${savedIds.length})`
              }
            >
              <Icon name="bookmark" />
              {!connected && savedIds.length > 0 && (
                <span className="save-count">{savedIds.length}</span>
              )}
            </Link>
            <span className="header-divider" />
            <Link to={account ? '/account' : '/welcome'} className="guest-link">
              <span className="guest-avatar">
                {account?.displayName.charAt(0) ?? 'G'}
              </span>
              <span>{account?.displayName ?? 'Guest explorer'}</span>
              <Icon name="chevron" size={14} />
            </Link>
          </div>
        </div>
      </header>
      <main id="main" ref={main} tabIndex={-1}>
        {sessionNotice && (
          <p className="storage-notice" role="status">
            {sessionNotice}
          </p>
        )}
        {storageNotice && (
          <p className="storage-notice" role="status">
            {storageNotice}
          </p>
        )}
        <Outlet
          context={{ savedIds, toggleSaved: onToggle } satisfies AppContext}
        />
      </main>
      <footer className="site-footer">
        <div className="footer-top">
          <Brand />
          <span>Places. People. Possibilities.</span>
          <Link to="/welcome">
            Your next chapter <Icon name="arrow-right" size={16} />
          </Link>
        </div>
        {connected && (
          <div className="footer-bottom">
            <Link to="/hosting">Host workspace</Link>
            <Link to="/settings">Privacy & settings</Link>
            {(account?.roles.includes('admin') ||
              account?.roles.includes('super')) && (
              <>
                <Link to="/admin">Operations</Link>
                <Link to="/review">Review workspace</Link>
              </>
            )}
          </div>
        )}
      </footer>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </div>
    </div>
  );
}
