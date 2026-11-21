import { useEffect, useRef, useState, type ChangeEvent } from 'react';

/** A video chosen for a reel, with its length when the browser knows it. */
export type ReelClip = { file: File; duration: number | null };

export const reelLimits = { seconds: 60, bytes: 50 * 1024 * 1024 } as const;

const typesByExtension: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
};

/** The upload type for a picked file, or null when it is not a supported video. */
export function reelContentType(file: File) {
  const declared = file.type.split(';')[0]!.trim().toLowerCase();
  if (['video/mp4', 'video/webm', 'video/quicktime'].includes(declared))
    return declared;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return typesByExtension[extension] ?? null;
}

// Hands a clip picked on Explore to the share page without putting the file in
// history state (which has size limits in some browsers).
let pending: ReelClip | null = null;
export const holdReelClip = (clip: ReelClip) => {
  pending = clip;
};
export const takeReelClip = () => {
  const clip = pending;
  pending = null;
  return clip;
};

/** Phones and tablets open their own camera app; laptops record in the page. */
function recordsInPage() {
  return (
    typeof window !== 'undefined' &&
    !window.matchMedia?.('(pointer: coarse)').matches &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );
}

/** Camera and Photos buttons. Calls onPick with the chosen or recorded video. */
export function ReelSourcePicker({
  onPick,
  compact = false,
}: {
  onPick: (clip: ReelClip) => void;
  compact?: boolean;
}) {
  const camera = useRef<HTMLInputElement>(null);
  const photos = useRef<HTMLInputElement>(null);
  const [recording, setRecording] = useState(false);
  const picked = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) onPick({ file, duration: null });
  };
  return (
    <div className={`reel-source ${compact ? 'reel-source-compact' : ''}`}>
      <button
        type="button"
        onClick={() =>
          recordsInPage() ? setRecording(true) : camera.current?.click()
        }
      >
        <span className="reel-source-icon" aria-hidden="true">
          ●
        </span>
        <strong>Camera</strong>
        {!compact && <span>Record a new video</span>}
      </button>
      <button type="button" onClick={() => photos.current?.click()}>
        <span className="reel-source-icon" aria-hidden="true">
          ▦
        </span>
        <strong>Photos</strong>
        {!compact && <span>Choose a video from your gallery</span>}
      </button>
      <input
        ref={camera}
        type="file"
        accept="video/*"
        capture="environment"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={picked}
      />
      <input
        ref={photos}
        type="file"
        accept="video/*,.mov,.mp4,.m4v,.webm"
        hidden
        tabIndex={-1}
        aria-hidden="true"
        onChange={picked}
      />
      {recording && (
        <CameraRecorder
          onClose={() => setRecording(false)}
          onDone={(clip) => {
            setRecording(false);
            onPick(clip);
          }}
          onUnavailable={() => {
            setRecording(false);
            camera.current?.click();
          }}
        />
      )}
    </div>
  );
}

const recorderTypes = [
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

/** Records up to 60 seconds from the laptop camera. */
function CameraRecorder({
  onClose,
  onDone,
  onUnavailable,
}: {
  onClose: () => void;
  onDone: (clip: ReelClip) => void;
  onUnavailable: () => void;
}) {
  const live = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [state, setState] = useState<
    'starting' | 'ready' | 'recording' | 'review' | 'blocked'
  >('starting');
  const [elapsed, setElapsed] = useState(0);
  const [clip, setClip] = useState<ReelClip & { url: string }>();
  // Keep the camera open across re-renders: read the fallback through a ref.
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;

  useEffect(() => {
    let cancelled = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      .then((media) => {
        if (cancelled) return media.getTracks().forEach((t) => t.stop());
        stream.current = media;
        if (live.current) live.current.srcObject = media;
        setState('ready');
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // No camera at all: fall back to the device's own picker.
        if (error instanceof DOMException && error.name === 'NotFoundError')
          unavailable.current();
        else setState('blocked');
      });
    return () => {
      cancelled = true;
      if (recorder.current?.state === 'recording') recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  // The live preview is re-created after "Retake"; reconnect it to the camera.
  useEffect(() => {
    if (
      live.current &&
      stream.current &&
      live.current.srcObject !== stream.current
    )
      live.current.srcObject = stream.current;
  }, [state]);

  useEffect(() => {
    closeButton.current?.focus();
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [onClose]);

  useEffect(() => {
    if (state !== 'recording') return;
    const timer = setInterval(() => {
      const seconds = (Date.now() - started.current) / 1000;
      setElapsed(seconds);
      if (seconds >= reelLimits.seconds - 0.5) recorder.current?.stop();
    }, 250);
    return () => clearInterval(timer);
  }, [state]);

  useEffect(() => () => clip && URL.revokeObjectURL(clip.url), [clip]);

  function start() {
    if (!stream.current) return;
    const mimeType = recorderTypes.find((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    const media = new MediaRecorder(stream.current, {
      ...(mimeType ? { mimeType } : {}),
      videoBitsPerSecond: 2_500_000,
    });
    const chunks: Blob[] = [];
    media.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    media.onstop = () => {
      const duration = (Date.now() - started.current) / 1000;
      const type = (media.mimeType || mimeType || 'video/webm').split(';')[0]!;
      const file = new File(
        chunks,
        `reel-${Date.now()}.${type === 'video/mp4' ? 'mp4' : 'webm'}`,
        { type },
      );
      setClip({ file, duration, url: URL.createObjectURL(file) });
      setState('review');
    };
    recorder.current = media;
    started.current = Date.now();
    setElapsed(0);
    media.start(1000);
    setState('recording');
  }

  const clock = (seconds: number) =>
    `0:${String(Math.min(59, Math.floor(seconds))).padStart(2, '0')}`;

  return (
    <div className="camera-backdrop">
      <div
        className="camera-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="camera-title"
      >
        <header>
          <h2 id="camera-title">Record a reel</h2>
          <button
            ref={closeButton}
            type="button"
            className="camera-close"
            onClick={onClose}
            aria-label="Close camera"
          >
            ×
          </button>
        </header>
        {state === 'blocked' ? (
          <p className="camera-message" role="alert">
            Camera access is blocked. Allow the camera in your browser’s site
            settings, or choose a video from Photos.
          </p>
        ) : state === 'review' && clip ? (
          <video
            className="camera-view"
            src={clip.url}
            controls
            playsInline
            aria-label="Your recording"
          />
        ) : (
          <video
            ref={live}
            className="camera-view camera-live"
            autoPlay
            muted
            playsInline
            aria-label="Camera preview"
          />
        )}
        <div className="camera-controls">
          {state === 'starting' && <p role="status">Opening camera…</p>}
          {state === 'ready' && (
            <button
              type="button"
              className="camera-record"
              onClick={start}
              aria-label="Start recording"
            />
          )}
          {state === 'recording' && (
            <>
              <span className="camera-timer" role="timer">
                ● {clock(elapsed)} / 1:00
              </span>
              <button
                type="button"
                className="camera-record camera-stop"
                onClick={() => recorder.current?.stop()}
                aria-label="Stop recording"
              />
            </>
          )}
          {state === 'review' && clip && (
            <>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  setClip(undefined);
                  setState('ready');
                }}
              >
                Retake
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() =>
                  onDone({ file: clip.file, duration: clip.duration })
                }
              >
                Use this video
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
