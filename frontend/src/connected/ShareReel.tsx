import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAction, useApi, useResource } from '../api/react';
import type { Experience } from '../api/types';
import { Icon } from '../components/Icon';
import { ErrorNotice, RequireAccount } from './shared';
import {
  reelContentType,
  reelLimits,
  ReelSourcePicker,
  takeReelClip,
  type ReelClip,
} from './ReelCapture';

type MyReel = {
  id: string;
  caption: string;
  place: string;
  createdAt: string;
  status: 'in_review' | 'live' | 'not_published';
  reviewReason: string | null;
};
type UploadIntent = { id: string; uploadUrl: string | null; state: string };

const statusText: Record<MyReel['status'], string> = {
  in_review: 'Waiting for review',
  live: 'Live in Explore',
  not_published: 'Not published',
};

/**
 * Reads a video's length in the browser, for the caption timing. Some phone
 * formats (HEVC .mov on desktop browsers) can't be read here; the server then
 * measures the video and trims the caption to fit.
 */
function videoDuration(file: File) {
  return new Promise<number | null>((resolve) => {
    const video = document.createElement('video');
    const url = URL.createObjectURL(file);
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = 'metadata';
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    setTimeout(() => done(null), 5000);
    video.src = url;
  });
}

const stamp = (seconds: number) => {
  const whole = Math.max(0.5, Math.min(seconds, 60));
  const s = Math.floor(whole);
  const ms = Math.round((whole - s) * 1000);
  return `00:00:${String(s).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function ShareReel() {
  return (
    <div className="page interior-page share-reel-page">
      <RequireAccount>
        <ShareReelForm />
      </RequireAccount>
    </div>
  );
}

function ShareReelForm() {
  const api = useApi();
  const action = useAction();
  const mine = useResource<MyReel[]>('/me/reels', true);
  const experiences = useResource<Experience[]>('/experiences?limit=50');
  const [progress, setProgress] = useState('');
  // A clip picked on Explore arrives here; otherwise pick one on this page.
  const [clip, setClip] = useState<ReelClip | null>(() => takeReelClip());
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (!clip) return setPreview(undefined);
    const url = URL.createObjectURL(clip.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [clip]);
  return (
    <>
      <Link className="ops-back" to="/explore">
        <Icon name="arrow-left" size={16} /> Explore
      </Link>
      <h1>Share a reel</h1>
      <p className="ops-muted">
        Record with your camera or pick a video from your photos: up to 60
        seconds and 50 MB. Our team checks every reel before it appears in
        Explore.
      </p>
      <form
        className="ops-panel ops-form share-reel-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void action.run(async () => {
            if (!clip) throw new Error('Record or choose a video first.');
            const file = clip.file;
            const contentType = reelContentType(file);
            if (!contentType) throw new Error('Use an MP4, MOV or WebM video.');
            if (file.size > reelLimits.bytes)
              throw new Error('Videos must be 50 MB or smaller.');
            const caption = String(data.get('caption') ?? '').trim();
            const place = String(data.get('place') ?? '').trim();
            setProgress('Reading video…');
            const duration = clip.duration ?? (await videoDuration(file));
            if (duration !== null && duration > reelLimits.seconds + 0.5)
              throw new Error('Keep reels to 60 seconds or less.');
            setProgress('Uploading…');
            const intent = await api.request<UploadIntent>('/me/media', {
              method: 'POST',
              private: true,
              body: {
                purpose: 'public_content',
                contentType,
                bytes: file.size,
                author: String(data.get('author') ?? '').trim(),
                permissionNote: 'Shared by the person who filmed it.',
                place: place || 'Sikkim',
                altText: caption || 'Reel from Sikkim',
                captions: `WEBVTT\n\n00:00:00.000 --> ${stamp((duration ?? reelLimits.seconds) - 0.05)}\n${caption || place || 'Sikkim'}\n`,
              },
            });
            const path = intent.data.uploadUrl?.replace(/^\/v1/, '');
            if (!path) throw new Error('Upload could not start. Try again.');
            await api.request(path, {
              method: 'PUT',
              private: true,
              body: file,
            });
            setProgress('Processing video…');
            let state = 'processing';
            for (
              let i = 0;
              i < 120 && !['ready', 'failed'].includes(state);
              i += 1
            ) {
              await wait(1000);
              state = (
                await api.request<UploadIntent>(`/me/media/${intent.data.id}`, {
                  private: true,
                })
              ).data.state;
            }
            if (state !== 'ready')
              throw new Error(
                'The video could not be processed. Try another file.',
              );
            const experienceId = String(data.get('experienceId') ?? '');
            await api.request('/me/reels', {
              method: 'POST',
              private: true,
              body: {
                assetId: intent.data.id,
                caption,
                place,
                experienceId: experienceId || null,
              },
            });
            form.reset();
            setClip(null);
            setProgress('');
            mine.reload();
          }, 'Thanks! Your reel is waiting for review.');
        }}
      >
        <fieldset className="ops-wide reel-video-field">
          <legend>Video</legend>
          {clip && preview ? (
            <div className="reel-picked">
              <video
                src={preview}
                controls
                playsInline
                muted
                aria-label="Selected video"
              />
              <div>
                <strong>{clip.file.name}</strong>
                <span>
                  {(clip.file.size / 1024 / 1024).toFixed(1)} MB
                  {clip.duration ? ` · ${Math.round(clip.duration)} s` : ''}
                </span>
                <p>Change video:</p>
                <ReelSourcePicker onPick={setClip} compact />
              </div>
            </div>
          ) : (
            <ReelSourcePicker onPick={setClip} />
          )}
        </fieldset>
        <label className="ops-wide">
          Caption
          <input
            name="caption"
            maxLength={300}
            placeholder="First snow at Tsomgo Lake"
          />
        </label>
        <label>
          Place
          <input name="place" maxLength={120} placeholder="Tsomgo Lake" />
        </label>
        <label>
          Filmed by
          <input
            name="author"
            required
            maxLength={160}
            placeholder="Your name"
          />
        </label>
        <label className="ops-wide">
          Tag an experience (optional)
          <select name="experienceId" defaultValue="">
            <option value="">No experience</option>
            {experiences.data?.map((experience) => (
              <option key={experience.id} value={experience.id}>
                {experience.title}
              </option>
            ))}
          </select>
        </label>
        <label className="ops-check ops-wide">
          <input type="checkbox" required /> I filmed this video, and anyone
          recognisable in it agreed to be shared.
        </label>
        <ErrorNotice error={action.error} />
        {(progress && action.busy) || action.message ? (
          <p role="status" className="ops-muted">
            {action.busy ? progress : action.message}
          </p>
        ) : null}
        <button
          className="button button-primary ops-submit"
          disabled={action.busy}
        >
          {action.busy ? 'Sharing…' : 'Share reel'}
        </button>
      </form>
      <section className="ops-panel">
        <h2>Your reels</h2>
        <ErrorNotice error={mine.error} retry={mine.reload} />
        {mine.data?.length === 0 && <p className="ops-muted">No reels yet.</p>}
        {mine.data?.map((reel) => (
          <div className="ops-line" key={reel.id}>
            <span>{reel.caption || reel.place || 'Untitled reel'}</span>
            <span>
              {statusText[reel.status]}
              {reel.reviewReason ? ` · ${reel.reviewReason}` : ''}
            </span>
          </div>
        ))}
      </section>
    </>
  );
}
