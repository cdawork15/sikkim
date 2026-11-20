import { useEffect, useRef, useState } from 'react';
import { usePlaybackPreferences } from '../hooks/usePlaybackPreferences';
import { mediaUrl } from '../api/media';
import type { MediaItem } from '../api/types';
import { Icon } from '../components/Icon';

export function MediaPlayer({
  media,
  active = false,
  retry,
}: {
  media: MediaItem;
  active?: boolean;
  retry?: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [captions, setCaptions] = useState(true);
  useEffect(() => {
    const track = video.current?.textTracks[0];
    if (track) track.mode = captions ? 'showing' : 'hidden';
  }, [captions]);
  const { hidden, reducedMotion, lowData, offline } = usePlaybackPreferences();
  useEffect(() => {
    setFailed(false);
  }, [media.urls.video, media.urls.image]);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (
      active &&
      !hidden &&
      !paused &&
      !reducedMotion &&
      !lowData &&
      !offline &&
      !failed
    ) {
      void element.play().catch(() => setPaused(true));
    } else element.pause();
  }, [active, hidden, paused, reducedMotion, lowData, offline, failed]);
  if (failed)
    return (
      <div className="media-error" role="status">
        <p>This media could not load. Check your connection and try again.</p>
        {retry && (
          <button className="button button-secondary" onClick={retry}>
            Reload media
          </button>
        )}
      </div>
    );
  return (
    <>
      {media.kind === 'image' ? (
        <img
          src={mediaUrl(media.urls.image)}
          alt={media.altText}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <>
          <video
            ref={video}
            src={mediaUrl(media.urls.video)}
            poster={mediaUrl(media.urls.poster)}
            muted={muted}
            playsInline
            crossOrigin="anonymous"
            loop
            preload={active && !reducedMotion && !lowData ? 'auto' : 'none'}
            controls={reducedMotion || lowData || !active}
            aria-label={media.altText}
            onError={() => setFailed(true)}
            onWaiting={() => setBuffering(true)}
            onPlaying={() => setBuffering(false)}
            onCanPlay={() => setBuffering(false)}
          >
            <track
              kind="captions"
              src={mediaUrl(media.urls.captions)}
              srcLang="en"
              label="English"
              default
              onLoad={() => {
                const track = video.current?.textTracks[0];
                if (track) track.mode = captions ? 'showing' : 'hidden';
              }}
            />
          </video>
          {active && buffering && (
            <p className="media-buffering" role="status">
              Loading video…
            </p>
          )}
          {active && !reducedMotion && !lowData && (
            <div className="media-controls">
              <button
                className="icon-button"
                aria-label={paused ? 'Play video' : 'Pause video'}
                onClick={() => setPaused((value) => !value)}
              >
                <Icon name={paused ? 'play' : 'pause'} />
              </button>
              <button
                className="icon-button caption-toggle"
                aria-label={captions ? 'Hide captions' : 'Show captions'}
                aria-pressed={captions}
                onClick={() => setCaptions((value) => !value)}
              >
                CC
              </button>
              <button
                className="icon-button"
                aria-label={muted ? 'Unmute video' : 'Mute video'}
                onClick={() => setMuted((value) => !value)}
              >
                <Icon name={muted ? 'volume-off' : 'volume'} />
              </button>
            </div>
          )}
        </>
      )}
    </>
  );
}
