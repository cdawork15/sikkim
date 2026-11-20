import { mediaUrl } from '../api/media';
import { useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ApiError } from '../api/client';
import { useResource, useSession } from '../api/react';
import type { Experience, ReviewEvent } from '../api/types';
import { Icon } from '../components/Icon';

export function ErrorNotice({
  error,
  retry,
}: {
  error?: Error;
  retry?: () => void;
}) {
  if (!error) return null;
  return (
    <div className="api-notice" role="alert">
      <p>{error.message}</p>
      {error instanceof ApiError && error.requestId && (
        <small>Reference: {error.requestId}</small>
      )}
      {retry && (
        <button className="button button-secondary" onClick={retry}>
          Try again
        </button>
      )}
    </div>
  );
}
export function Loading() {
  return (
    <p role="status" className="api-notice">
      Loading…
    </p>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="api-empty">{children}</div>;
}
export const isStaff = (roles: string[] = []) =>
  roles.includes('admin') || roles.includes('super');
export const isSuper = (roles: string[] = []) => roles.includes('super');
/** Staff land in Operations after signing in, unless a page asked for them. */
export const landingFor = (
  account: { roles: string[] },
  destination: string,
) =>
  destination === '/account' && isStaff(account.roles) ? '/admin' : destination;

export function RequireAccount({
  children,
  admin = false,
  superOnly = false,
}: {
  children: ReactNode;
  /** Staff only: admin or super. */
  admin?: boolean;
  /** Super admins only. */
  superOnly?: boolean;
}) {
  const { user } = useSession();
  const location = useLocation();
  if (!user)
    return (
      <section className="account-gate" aria-label="Sign in required">
        <div className="account-gate-scene">
          <img
            src="/videos/nathu.webp"
            alt="Snow-covered mountains near Nathu La, Sikkim"
          />
          <span className="account-gate-place">
            <Icon name="pin" size={14} /> Nathu La, Sikkim
          </span>
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
          <h1>Make yourself at home.</h1>
          <p>Save the places you love. Come back when you’re ready.</p>
          <div className="account-gate-perks">
            <span>
              <Icon name="bookmark" size={17} /> Keep your favourites
            </span>
            <span>
              <Icon name="compass" size={17} /> Find something new
            </span>
          </div>
          <div className="account-gate-actions">
            <Link
              className="button button-primary"
              to={
                '/welcome?next=' +
                encodeURIComponent(location.pathname + location.search)
              }
            >
              Sign in <Icon name="arrow-right" size={18} />
            </Link>
            <Link className="account-gate-browse" to="/explore">
              Keep exploring
            </Link>
          </div>
          <p className="account-gate-guest-note">
            No account needed to browse.
          </p>
        </div>
      </section>
    );
  if ((admin && !isStaff(user.roles)) || (superOnly && !isSuper(user.roles)))
    return (
      <Empty>
        <h1>
          {superOnly ? 'Super admin access required' : 'Staff access required'}
        </h1>
        <p>This area is only available to the Sikkim Experiences team.</p>
      </Empty>
    );
  return children;
}
export function money(paise: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: paise % 100 ? 2 : 0,
  }).format(paise / 100);
}
export function paise(value: string): number | null {
  if (!value.trim()) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value))
    throw new Error('Enter a price with up to two decimal places.');
  const [whole = '0', fraction = ''] = value.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 2147483647)
    throw new Error('The price is too high.');
  return result;
}
export function duration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours} hr` : '', remainder ? `${remainder} min` : '']
    .filter(Boolean)
    .join(' ');
}
export function isPreviewExperience(experience: Experience) {
  return experience.slug.startsWith('preview-');
}
export function experienceSummary(experience: Experience) {
  return isPreviewExperience(experience)
    ? experience.description.replace(
        /^Design preview only — not a real offer\. /,
        '',
      )
    : experience.description;
}
export function isPreviewHost(story: string) {
  return story.startsWith('Fictional host for local design preview only.');
}
export function previewImage(experience?: Experience) {
  if (!import.meta.env.DEV || !experience?.slug.startsWith('preview-'))
    return undefined;
  if (experience.categories.includes('food')) return '/images/momos.webp';
  if (
    experience.categories.includes('culture') ||
    experience.categories.includes('art') ||
    experience.categories.includes('music')
  )
    return '/images/monastery.webp';
  if (experience.categories.includes('wellness')) return '/images/forest.webp';
  return '/images/himalayan-dawn.webp';
}
export function Artwork({ experience }: { experience?: Experience }) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const media =
    experience?.media?.find((item) => item.placement === 'cover') ??
    experience?.media?.[0];
  const realSource = mediaUrl(media?.urls.image ?? media?.urls.poster);
  const source = realSource ?? previewImage(experience);
  if (source && source !== failedUrl)
    return (
      <div className="api-preview-image">
        <img
          src={source}
          alt={media?.altText ?? ''}
          loading="lazy"
          onError={() => setFailedUrl(source)}
        />
      </div>
    );
  return (
    <div className="api-artwork" aria-label="Photo coming soon">
      <Icon name="mountain" size={48} />
      <span>Discover Sikkim</span>
    </div>
  );
}
export function Card({ experience }: { experience: Experience }) {
  return (
    <Link
      className="experience-card"
      to={'/experiences/' + encodeURIComponent(experience.slug)}
    >
      <Artwork experience={experience} />
      <div className="card-body">
        <p className="card-location">
          {experience.area} · {duration(experience.durationMinutes)}
        </p>
        <h3>{experience.title}</h3>
        <p>{experience.hostName}</p>
        <div className="card-bottom">
          <strong>
            {money(experience.pricePaise)} <small>/ person</small>
          </strong>
          <Icon name="arrow-right" />
        </div>
      </div>
    </Link>
  );
}
export function History({ history }: { history?: ReviewEvent[] }) {
  if (!history?.length) return null;
  return (
    <section className="api-panel">
      <h2>Updates</h2>
      {history.map((event, index) => (
        <p key={index}>
          <strong>{event.action}</strong> ·{' '}
          {new Date(event.createdAt).toLocaleDateString()}
          <br />
          {event.reason}
        </p>
      ))}
    </section>
  );
}
export function PagedList<T extends { id: string }>({
  path,
  privateRequest = false,
  cursorName = 'after',
  render,
}: {
  path: string;
  privateRequest?: boolean;
  cursorName?: string;
  render: (row: T) => ReactNode;
}) {
  const { generation } = useSession();
  return (
    <Pages<T>
      key={path + (privateRequest ? generation : '')}
      path={path}
      privateRequest={privateRequest}
      cursorName={cursorName}
      render={render}
    />
  );
}
function Pages<T extends { id: string }>({
  path,
  privateRequest,
  cursorName,
  render,
}: {
  path: string;
  privateRequest: boolean;
  cursorName: string;
  render: (row: T) => ReactNode;
}) {
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  return (
    <>
      {cursors.map((cursor, index) => (
        <Page<T>
          key={cursor ?? 'first'}
          path={
            path +
            (cursor
              ? `${path.includes('?') ? '&' : '?'}${cursorName}=${encodeURIComponent(cursor)}`
              : '')
          }
          privateRequest={privateRequest}
          render={render}
          last={index === cursors.length - 1}
          first={index === 0}
          more={(next) =>
            setCursors((values) =>
              values.includes(next) ? values : [...values, next],
            )
          }
        />
      ))}
    </>
  );
}
function Page<T extends { id: string }>({
  path,
  privateRequest,
  render,
  last,
  first,
  more,
}: {
  path: string;
  privateRequest: boolean;
  render: (row: T) => ReactNode;
  last: boolean;
  first: boolean;
  more: (cursor: string) => void;
}) {
  const result = useResource<T[]>(path, privateRequest);
  return (
    <>
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
      {result.data && (
        <>
          <div className="api-grid">
            {result.data.map((row) => (
              <div key={row.id}>{render(row)}</div>
            ))}
          </div>
          {first && !result.data.length && (
            <Empty>Nothing to show yet. Please check back soon.</Empty>
          )}
          {last && result.page?.nextCursor && (
            <button
              type="button"
              className="button button-secondary api-more"
              onClick={() => more(result.page!.nextCursor!)}
            >
              Show more
            </button>
          )}
        </>
      )}
    </>
  );
}
