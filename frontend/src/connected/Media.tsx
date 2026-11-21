import { usePlaybackPreferences } from '../hooks/usePlaybackPreferences';
import { mediaUrl } from '../api/media';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { useAction, useApi, useResource, useSession } from '../api/react';
import type { Experience, MediaItem } from '../api/types';
import { Icon } from '../components/Icon';
import {
  Artwork,
  Card,
  Empty,
  ErrorNotice,
  Loading,
  PagedList,
  RequireAccount,
} from './shared';
import { ExperienceActions } from './ExperienceActions';
import { MediaPlayer } from './MediaPlayer';
import { holdReelClip, ReelSourcePicker } from './ReelCapture';

type Reel = { experience: Experience; media: MediaItem };
type CommunityReel = {
  id: string;
  caption: string;
  place: string;
  creator: { name: string };
  experience: { id: string; slug: string; title: string } | null;
  media: MediaItem;
};
type FeedItem =
  | { key: string; kind: 'experience'; row: Reel }
  | { key: string; kind: 'community'; row: CommunityReel };

/** Experience reels first, with traveller reels woven in every second slot. */
function mergeFeeds(experienceReels: Reel[], communityReels: CommunityReel[]) {
  const items: FeedItem[] = [];
  const max = Math.max(experienceReels.length, communityReels.length);
  for (let i = 0; i < max; i += 1) {
    const reel = experienceReels[i];
    const shared = communityReels[i];
    if (reel)
      items.push({
        key: 'e-' + reel.experience.id,
        kind: 'experience',
        row: reel,
      });
    if (shared)
      items.push({ key: 'c-' + shared.id, kind: 'community', row: shared });
  }
  return items;
}

function CommunityReelCard({
  row,
  index,
  onActive,
  retry,
}: {
  row: CommunityReel;
  index: number;
  onActive: (index: number) => void;
  retry: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting);
        setActive(visible);
        if (visible) onActive(index);
      },
      { threshold: 0.7 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [index, onActive]);
  return (
    <article
      ref={ref}
      className="connected-reel"
      aria-label={row.caption || 'Reel from ' + row.creator.name}
    >
      <MediaPlayer media={row.media} active={active} retry={retry} />
      <div className="reel-shade" />
      <div className="connected-reel-caption">
        <p className="reel-place">
          <Icon name="pin" size={14} />
          {row.place || row.media.place}
        </p>
        <p className="reel-creator">
          <span className="reel-avatar" aria-hidden="true">
            {row.creator.name.slice(0, 1).toUpperCase()}
          </span>
          {row.creator.name}
        </p>
        {row.caption && <h2>{row.caption}</h2>}
        {row.experience && (
          <Link
            className="reel-experience-link"
            to={'/experiences/' + row.experience.slug}
          >
            {row.experience.title} <Icon name="arrow-right" size={16} />
          </Link>
        )}
      </div>
      {active && (
        <aside className="reel-action-rail" aria-label="Reel actions">
          <ReelUploadButton />
        </aside>
      )}
    </article>
  );
}
function ReelCard({
  row,
  index,
  onActive,
  retry,
}: {
  row: Reel;
  index: number;
  onActive: (index: number) => void;
  retry: () => void;
}) {
  const ref = useRef<HTMLElement>(null);
  const [active, setActive] = useState(false);
  const [shareNotice, setShareNotice] = useState('');
  const [shareFallback, setShareFallback] = useState('');
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = Boolean(entry?.isIntersecting);
        setActive(visible);
        if (visible) onActive(index);
      },
      { threshold: 0.7 },
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [index, onActive]);
  async function share() {
    const url = new URL('/experiences/' + row.experience.slug, location.origin)
      .href;
    try {
      if (navigator.share)
        await navigator.share({ title: row.experience.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setShareNotice('Link copied');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setShareFallback(url);
    }
  }
  return (
    <article
      ref={ref}
      className="connected-reel"
      aria-label={row.experience.title}
    >
      <MediaPlayer media={row.media} active={active} retry={retry} />
      <div className="reel-shade" />
      <div className="connected-reel-caption">
        <p className="reel-place">
          <Icon name="pin" size={14} />
          {row.media.place}
        </p>
        <h2>{row.experience.title}</h2>
        <Link
          className="reel-experience-link"
          to={'/experiences/' + row.experience.slug}
        >
          View experience <Icon name="arrow-right" size={16} />
        </Link>
        <Link
          className="media-info-link"
          to={'/credits?experience=' + encodeURIComponent(row.experience.slug)}
          aria-label="About this media"
        >
          <Icon name="info" size={17} />
        </Link>
      </div>
      {active && (
        <aside className="reel-action-rail" aria-label="Reel actions">
          <ExperienceActions id={row.experience.id} compact />
          <button
            className="reel-share"
            aria-label="Share experience"
            onClick={() => void share()}
          >
            <Icon name="share" size={26} />
          </button>
          <ReelUploadButton />
          {shareNotice && <span role="status">{shareNotice}</span>}
        </aside>
      )}
      {shareFallback && (
        <div className="reel-share-fallback">
          <label>
            Copy this experience link
            <input
              readOnly
              value={shareFallback}
              onFocus={(event) => event.target.select()}
            />
          </label>
          <button onClick={() => setShareFallback('')}>Close</button>
        </div>
      )}
    </article>
  );
}
export function Reels() {
  const [after, setAfter] = useState<string>();
  const [index, setIndex] = useState(0);
  const feed = useRef<HTMLDivElement>(null);
  const [params] = useSearchParams();
  const { reducedMotion } = usePlaybackPreferences();
  const result = useResource<Reel[]>(
    '/reels' + (after ? '?after=' + after : ''),
  );
  // Traveller reels join the first page of the feed.
  const shared = useResource<CommunityReel[]>(
    after ? null : '/community-reels',
  );
  const rows =
    result.data && (after || shared.data || shared.error)
      ? mergeFeeds(result.data, after ? [] : (shared.data ?? []))
      : [];
  const ready =
    rows.length > 0 || (result.data?.length === 0 && !!(after || shared.data));
  useEffect(() => {
    if (!ready) return;
    const target = Math.max(
      0,
      rows.findIndex(
        (item) =>
          item.kind === 'experience' &&
          item.row.experience.id === params.get('reel'),
      ),
    );
    setIndex(target);
    feed.current?.scrollTo({
      top: target * feed.current.clientHeight,
      behavior: 'instant',
    });
  }, [ready, result.data, shared.data, params]);
  function move(direction: number) {
    if (!feed.current) return;
    const target = Math.max(0, Math.min(rows.length - 1, index + direction));
    feed.current.scrollTo({
      top: target * feed.current.clientHeight,
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
  }
  return (
    <section className="connected-reels-page" aria-label="Explore reels">
      <header className="reels-toolbar">
        <h1>Explore</h1>
        <nav aria-label="Explore views">
          <Link className="active" aria-current="page" to="/explore">
            Reels
          </Link>
          <Link to="/explore?view=list">Browse all</Link>
        </nav>
        <span className="reel-counter">
          {rows.length ? `${index + 1} / ${rows.length}` : ''}
        </span>
      </header>
      <div className="reels-stage">
        {result.loading && <Loading />}
        <ErrorNotice error={result.error} retry={result.reload} />
        {ready && rows.length === 0 && (
          <Empty>
            <h2>Fresh views are on their way.</h2>
            <Link className="button button-primary" to="/explore?view=list">
              Browse experiences
            </Link>
          </Empty>
        )}
        {rows.length > 0 && (
          <>
            <div
              ref={feed}
              className="connected-reels"
              aria-label="Experience reels"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  move(event.key === 'ArrowDown' ? 1 : -1);
                }
              }}
            >
              {rows.map((item, position) =>
                item.kind === 'experience' ? (
                  <ReelCard
                    key={item.key}
                    row={item.row}
                    index={position}
                    onActive={setIndex}
                    retry={result.reload}
                  />
                ) : (
                  <CommunityReelCard
                    key={item.key}
                    row={item.row}
                    index={position}
                    onActive={setIndex}
                    retry={shared.reload}
                  />
                ),
              )}
            </div>
            <div className="reel-step-controls">
              <button
                aria-label="Previous reel"
                disabled={index === 0}
                onClick={() => move(-1)}
              >
                <Icon name="arrow-down" className="reel-up" />
              </button>
              <button
                aria-label="Next reel"
                disabled={index === rows.length - 1}
                onClick={() => move(1)}
              >
                <Icon name="arrow-down" />
              </button>
            </div>
          </>
        )}
      </div>
      {(after || (result.page?.nextCursor && index === rows.length - 1)) && (
        <div className="reel-pagination">
          {after && (
            <button className="text-link" onClick={() => setAfter(undefined)}>
              First reels
            </button>
          )}
          {result.page?.nextCursor && (
            <button
              className="text-link"
              onClick={() => setAfter(result.page!.nextCursor!)}
            >
              More reels <Icon name="arrow-down" size={16} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

export function Saved() {
  const [revision, setRevision] = useState(0);
  const api = useApi();
  const action = useAction();
  return (
    <div className="page interior-page">
      <RequireAccount>
        <header className="page-heading">
          <div>
            <p className="eyebrow">Keep a little inspiration</p>
            <h1>Your saved experiences</h1>
          </div>
          <Link to="/explore" className="button button-secondary">
            Explore more
          </Link>
        </header>
        <ErrorNotice error={action.error} />
        <PagedList<{ id: string; experience: Experience | null }>
          key={revision}
          path="/me/saved"
          privateRequest
          render={(row) => (
            <section className="saved-experience">
              {row.experience ? (
                <Card experience={row.experience} />
              ) : (
                <Empty>
                  <h2>Experience unavailable</h2>
                  <p>This saved experience is no longer listed.</p>
                </Empty>
              )}
              <button
                className="button button-secondary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await api.request(`/me/saved/experiences/${row.id}`, {
                      method: 'DELETE',
                      private: true,
                    });
                    setRevision((value) => value + 1);
                  })
                }
              >
                Remove from saved
              </button>
            </section>
          )}
        />
      </RequireAccount>
    </div>
  );
}

type StorySummary = {
  id: string;
  title: string;
  hostName: string;
  cover: MediaItem;
};
type StoryData = {
  title: string;
  hostName: string;
  expiresAt: string;
  frames: { caption: string; media: MediaItem }[];
};
export function CommunityStories() {
  const [after, setAfter] = useState<string>();
  const stories = useResource<StorySummary[]>(
    '/stories' + (after ? '?after=' + after : ''),
  );
  const { user } = useSession();
  const views = useResource<{ id: string }[]>(
    user ? '/me/story-views' : null,
    true,
  );
  if (!stories.data?.length && !stories.error && !stories.loading) return null;
  return (
    <section className="community-stories" aria-label="Host stories">
      <h2>Community stories</h2>
      {stories.loading && <Loading />}
      <ErrorNotice error={stories.error} retry={stories.reload} />
      <div className="story-rail">
        {stories.data?.map((story) => (
          <Link
            key={story.id}
            to={'/community/host-stories/' + story.id}
            aria-label={`Story from ${story.hostName}`}
          >
            <span
              className={
                'story-avatar ' +
                (views.data?.some((view) => view.id === story.id) ? 'seen' : '')
              }
            >
              <img
                src={mediaUrl(
                  story.cover.urls.image ?? story.cover.urls.poster,
                )}
                alt=""
              />
            </span>
            <span>{story.hostName}</span>
          </Link>
        ))}
      </div>
      {stories.page?.nextCursor && (
        <button
          className="text-link"
          onClick={() => setAfter(stories.page!.nextCursor!)}
        >
          More stories
        </button>
      )}
      {after && (
        <button className="text-link" onClick={() => setAfter(undefined)}>
          First stories
        </button>
      )}
    </section>
  );
}
export function HostStory() {
  const { id = '' } = useParams();
  return <StoryViewer key={id} id={id} />;
}

function StoryViewer({ id }: { id: string }) {
  const story = useResource<StoryData>('/stories/' + id);
  const api = useApi();
  const { user, generation } = useSession();
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (!user || !story.data) return;
    const controller = new AbortController();
    void api
      .request('/me/stories/' + id + '/seen', {
        method: 'PUT',
        private: true,
        signal: controller.signal,
      })
      .catch(() => {});
    return () => controller.abort();
  }, [api, id, user?.id, generation, story.data]);
  useEffect(() => {
    if (!story.data) return;
    const delay = Math.max(0, Date.parse(story.data.expiresAt) - Date.now());
    const timer = setTimeout(story.reload, Math.min(delay, 86400000));
    return () => clearTimeout(timer);
  }, [story.data]);
  const frame = story.data?.frames[index];
  return (
    <div className="page interior-page">
      <Link to="/community">← Community</Link>
      {story.loading && <Loading />}
      <ErrorNotice error={story.error} retry={story.reload} />
      {frame && (
        <>
          <h1>{story.data!.title}</h1>
          <p>{story.data!.hostName}</p>
          <div className="connected-story">
            <MediaPlayer
              key={frame.media.id}
              media={frame.media}
              active
              retry={story.reload}
            />
          </div>
          <p>{frame.caption}</p>
          <Link
            className="media-info-link"
            to={'/credits?story=' + encodeURIComponent(id!)}
            aria-label="About this media"
          >
            <Icon name="info" size={17} />
          </Link>
          <div className="experience-actions">
            <button
              className="button button-secondary"
              disabled={index === 0}
              onClick={() => setIndex((i) => i - 1)}
            >
              Previous
            </button>
            <span aria-live="polite">
              {index + 1} of {story.data!.frames.length}
            </span>
            <button
              className="button button-secondary"
              disabled={index === story.data!.frames.length - 1}
              onClick={() => setIndex((i) => i + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function ExperienceGallery({
  experience,
  reload,
}: {
  experience: Experience;
  reload: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const media = [...experience.media].sort(
    (a, b) => Number(b.placement === 'cover') - Number(a.placement === 'cover'),
  );
  const selected = media.find((item) => item.id === selectedId) ?? media[0];
  if (!selected) return <Artwork experience={experience} />;
  const index = media.indexOf(selected);
  const move = (offset: number) =>
    setSelectedId(media[(index + offset + media.length) % media.length]?.id);
  return (
    <div className="experience-media" aria-label="Experience photos and videos">
      <figure className="experience-gallery">
        <MediaPlayer key={selected.id} media={selected} retry={reload} />
      </figure>
      {media.length > 1 && (
        <>
          <div className="gallery-navigation">
            <p aria-live="polite" aria-atomic="true">
              {selected.kind === 'video' ? 'Video' : 'Photo'} {index + 1} /{' '}
              {media.length}
            </p>
            <div>
              <button
                className="icon-button"
                aria-label="Previous media"
                onClick={() => move(-1)}
              >
                <Icon name="arrow-left" size={20} />
              </button>
              <button
                className="icon-button"
                aria-label="Next media"
                onClick={() => move(1)}
              >
                <Icon name="arrow-right" size={20} />
              </button>
            </div>
          </div>
          <div
            className="gallery-thumbnails"
            aria-label="Choose a photo or video"
          >
            {media.map((item, itemIndex) => (
              <button
                key={item.id}
                type="button"
                aria-label={`Show ${item.kind === 'video' ? 'video' : 'photo'} ${itemIndex + 1}`}
                aria-pressed={item.id === selected.id}
                onClick={() => setSelectedId(item.id)}
              >
                <img
                  src={mediaUrl(item.urls.image ?? item.urls.poster)}
                  alt=""
                  loading="lazy"
                />
                {item.kind === 'video' && (
                  <span>
                    <Icon name="play" size={18} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </>
      )}
      <Link
        className="media-info-link"
        to={'/credits?experience=' + encodeURIComponent(experience.slug)}
        aria-label="About this media"
      >
        <Icon name="info" size={17} />
      </Link>
    </div>
  );
}

/**
 * Icon in the reel action rail, under Share: post your own reel from the
 * Camera or Photos. The choice panel is portalled so rail styles don't apply.
 */
function ReelUploadButton() {
  const { user } = useSession();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ right: number; bottom: number }>();
  const button = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!sheet.current?.contains(target) && !button.current?.contains(target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.camera-dialog'))
        return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  if (!user)
    return (
      <Link
        className="reel-upload-button"
        to="/welcome?next=/reels/new"
        aria-label="Share your reel"
        title="Share your reel"
      >
        <Icon name="create" size={26} />
      </Link>
    );
  return (
    <>
      <button
        ref={button}
        type="button"
        className="reel-upload-button"
        aria-label="Share your reel"
        title="Share your reel"
        aria-expanded={open}
        aria-controls="reel-upload-options"
        onClick={() => {
          const box = button.current!.getBoundingClientRect();
          // Open beside the icon, lined up with its bottom edge.
          setPlace({
            right: window.innerWidth - box.left + 10,
            bottom: window.innerHeight - box.bottom,
          });
          setOpen(!open);
        }}
      >
        <Icon name="create" size={26} />
      </button>
      {open &&
        createPortal(
          <div
            ref={sheet}
            id="reel-upload-options"
            className="reel-upload-sheet"
            role="group"
            aria-label="Share your reel from"
            style={place}
          >
            <p>Share your reel from</p>
            <ReelSourcePicker
              onPick={(clip) => {
                holdReelClip(clip);
                navigate('/reels/new');
              }}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
