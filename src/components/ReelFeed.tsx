import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import type { AppContext } from './AppShell';
import { reelExperiences as experiences, reelMedia } from '../data/reels';
import { getExperienceDetails } from '../data/experienceDetails';
import { useStoredExperiences } from '../hooks/useSaved';
import { ReelMedia } from './ReelMedia';
import { QuickPreview } from './QuickPreview';
import { ShareExperience } from './ShareExperience';
import { Icon } from './Icon';

export function ReelFeed() {
  const [params, setParams] = useSearchParams();
  const { savedIds, toggleSaved } = useOutletContext<AppContext>();
  const {
    savedIds: likedIds,
    toggleSaved: toggleLike,
    storageNotice,
  } = useStoredExperiences('sikkim:liked:v1', 'likes');
  const [muted, setMuted] = useState(false);
  const [preview, setPreview] = useState(false);
  const feed = useRef<HTMLDivElement>(null);
  const requested = params.get('reel');
  const found = experiences.findIndex((item) => item.id === requested);
  const index = requested === 'end' ? experiences.length : Math.max(0, found);
  const experience = experiences[index];

  // Restore direct links without animating through earlier clips.
  useLayoutEffect(() => {
    const container = feed.current!;
    const target = container.children[index] as HTMLElement;
    if (
      Math.abs(container.scrollTop - target.offsetTop) >
      container.clientHeight / 2
    )
      container.scrollTo({ top: target.offsetTop, behavior: 'instant' });
  }, [index]);

  const go = (next: number) => {
    const target = feed.current?.children[
      Math.max(0, Math.min(next, experiences.length))
    ] as HTMLElement;
    feed.current?.scrollTo({
      top: target.offsetTop,
      behavior:
        Math.abs(next - index) > 1 ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
    });
  };

  return (
    <div className="reels-page">
      <h1 className="sr-only">Explore short previews</h1>
      <p className="sr-only" id="swipe-help">
        Scroll or swipe up for the next video. Use the up and down arrow keys or
        navigation buttons. Like and Save keep your favourites.
      </p>
      <div
        className="reel-feed"
        ref={feed}
        aria-label="Experience reels"
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget &&
            !(event.target as HTMLElement).matches('.reel-card')
          )
            return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            event.currentTarget.focus({ preventScroll: true });
            go(index + (event.key === 'ArrowDown' ? 1 : -1));
          }
        }}
        onScroll={() => {
          const container = feed.current!;
          const next = Math.min(
            experiences.length,
            Math.round(container.scrollTop / container.clientHeight),
          );
          if (next !== index) {
            setPreview(false);
            setParams(
              next === experiences.length
                ? { reel: 'end' }
                : next
                  ? { reel: experiences[next]!.id }
                  : {},
              { replace: true, preventScrollReset: true },
            );
          }
        }}
      >
        {experiences.map((item, position) => {
          const media = reelMedia(item);
          const host = getExperienceDetails(item);
          const active = position === index;
          const liked = likedIds.includes(item.id);
          const saved = savedIds.includes(item.id);
          return (
            <section
              className="reel-slide"
              key={item.id}
              inert={!active}
              aria-hidden={!active}
            >
              <article
                className="reel-card"
                aria-label={item.title}
                aria-describedby="swipe-help"
                tabIndex={active ? 0 : -1}
              >
                {active ? (
                  <ReelMedia
                    key={item.id}
                    experience={item}
                    active={!preview}
                    muted={muted}
                    onMute={() => setMuted((value) => !value)}
                  />
                ) : (
                  <img className="reel-poster" src={media.poster} alt="" />
                )}
                <div className="reel-gradient" />
                <span
                  className="sr-only"
                  aria-label={`Video ${position + 1} of ${experiences.length}`}
                >
                  {position + 1} / {experiences.length}
                </span>
                <div className="reel-actions" aria-label="Experience actions">
                  <button
                    type="button"
                    aria-pressed={liked}
                    onClick={() => toggleLike(item.id)}
                  >
                    <Icon name="heart" />
                    <span>{liked ? 'Liked' : 'Like'}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={saved}
                    onClick={() => toggleSaved(item.id)}
                  >
                    <Icon name="bookmark" />
                    <span>{saved ? 'Saved' : 'Save'}</span>
                  </button>
                  <ShareExperience experience={item} />
                </div>
                <div className="reel-copy">
                  <Link to={`/hosts/${item.category}`} className="reel-host">
                    With {host.host}
                    <Icon name="chevron" size={14} />
                  </Link>
                  <h2>{item.title}</h2>
                  <p className="reel-location">
                    <Icon name="pin" size={14} />
                    {media.place} · {item.duration}
                  </p>
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={(event) => {
                      // Safari does not focus buttons on pointer activation.
                      // Give the native dialog an opener to restore focus to.
                      event.currentTarget.focus();
                      setPreview(true);
                    }}
                  >
                    Quick details
                    <Icon name="arrow-right" size={17} />
                  </button>
                  <Link
                    className="media-info-link"
                    to="/credits"
                    aria-label="About this media"
                  >
                    <Icon name="info" size={17} />
                  </Link>
                </div>
              </article>
            </section>
          );
        })}
        <section
          className="reel-slide reel-end"
          inert={index !== experiences.length}
          aria-hidden={index !== experiences.length}
        >
          <h2>You’re all caught up.</h2>
          <p>Keep your favourites. Find your next adventure.</p>
          <Link className="button button-primary" to="/saved">
            See your saved ideas
          </Link>
          <button className="text-link" type="button" onClick={() => go(0)}>
            Watch again
          </button>
        </section>
      </div>
      <div className="reel-navigation">
        <button
          type="button"
          disabled={index === 0}
          aria-label="Previous experience"
          onClick={() => go(index - 1)}
        >
          <Icon name="arrow-left" />
        </button>
        <button
          type="button"
          disabled={index === experiences.length}
          aria-label="Next experience"
          onClick={() => go(index + 1)}
        >
          <Icon name="arrow-right" />
        </button>
      </div>
      {storageNotice && (
        <p className="reel-notice" role="status">
          {storageNotice}
        </p>
      )}
      {preview && experience && (
        <QuickPreview
          experience={experience}
          onClose={() => setPreview(false)}
        />
      )}
    </div>
  );
}
