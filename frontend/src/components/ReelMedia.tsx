import { useEffect, useRef, useState } from 'react';
import type { Experience } from '../data/experiences';
import { reelMedia } from '../data/reels';
import { usePlaybackPreferences } from '../hooks/usePlaybackPreferences';
import { ExperienceImage } from './ExperienceCard';
import { Icon } from './Icon';

export function ReelMedia({
  experience,
  active,
  muted,
  onMute,
}: {
  experience: Experience;
  active: boolean;
  muted: boolean;
  onMute: () => void;
}) {
  const preferences = usePlaybackPreferences();
  const video = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  const [optIn, setOptIn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [captionError, setCaptionError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const media = reelMedia(experience);
  const limited = preferences.reducedMotion || preferences.lowData;
  const enabled = !preferences.offline && (!limited || optIn) && !failed;
  const shouldPlay =
    enabled && active && inView && !preferences.hidden && !paused;

  useEffect(() => {
    if (!container.current || !window.IntersectionObserver) return;
    const observer = new IntersectionObserver(
      ([entry]) => setInView(Boolean(entry?.isIntersecting)),
      { threshold: 0.3 },
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const player = video.current;
    if (!player) return;
    let disposed = false;
    if (shouldPlay) {
      setLoading(true);
      player.play().catch(() => {
        if (!disposed) {
          setPaused(true);
          setLoading(false);
        }
      });
    } else {
      player.pause();
      setLoading(false);
    }
    return () => {
      disposed = true;
      player.pause();
    };
  }, [shouldPlay, attempt]);
  useEffect(() => {
    if (!loading) return;
    const timer = window.setTimeout(() => {
      setFailed(true);
      setLoading(false);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [loading]);
  useEffect(() => {
    const tracks = video.current?.textTracks;
    if (tracks?.[0]) tracks[0].mode = captions ? 'showing' : 'hidden';
  }, [captions, enabled, attempt]);
  const play = () => {
    setOptIn(true);
    setFailed(false);
    setPaused(false);
    setAttempt((value) => value + 1);
  };
  const posterReason = preferences.offline
    ? 'Offline · Photo preview'
    : failed
      ? 'Video unavailable · Photo preview'
      : !enabled
        ? 'Photo preview · Motion or data saving is on'
        : '';

  return (
    <div className="reel-media" ref={container}>
      <ExperienceImage
        experience={{
          ...experience,
          image: media.poster,
          imageAlt: `Video still from ${media.place}`,
          imagePosition: 'center',
        }}
        eager
      />
      {enabled && (
        <video
          key={attempt}
          ref={video}
          src={media.video}
          poster={media.poster}
          muted={muted}
          loop
          playsInline
          preload="metadata"
          aria-label={`Real footage from ${media.place}`}
          onPlaying={() => {
            setPlaying(true);
            setLoading(false);
          }}
          onPause={() => setPlaying(false)}
          onWaiting={() => setLoading(true)}
          onError={() => {
            setFailed(true);
            setLoading(false);
          }}
        >
          <track
            kind="captions"
            src={media.captions}
            srcLang="en"
            label="English"
            default
            onError={() => setCaptionError(true)}
          />
        </video>
      )}
      <div className="reel-playback" aria-label="Video controls">
        <button
          type="button"
          aria-label={
            playing ? 'Pause video' : failed ? 'Retry video' : 'Play video'
          }
          disabled={preferences.offline}
          onClick={() => (playing ? setPaused(true) : play())}
        >
          <Icon name={playing ? 'pause' : 'play'} />
        </button>
        <button
          type="button"
          aria-label={muted ? 'Turn sound on' : 'Mute video'}
          aria-pressed={!muted}
          onClick={onMute}
        >
          <Icon name={muted ? 'volume-off' : 'volume'} />
        </button>
        <button
          type="button"
          aria-label="Captions"
          aria-pressed={captions}
          onClick={() => setCaptions((value) => !value)}
        >
          <span aria-hidden="true">CC</span>
        </button>
      </div>
      <p className="reel-media-status" role="status">
        {loading ? 'Loading preview…' : posterReason}
      </p>
      {captionError && captions && (
        <p className="reel-caption-fallback">
          Original location audio. Real Sikkim footage shown as inspiration for
          a sample experience.
        </p>
      )}
    </div>
  );
}
