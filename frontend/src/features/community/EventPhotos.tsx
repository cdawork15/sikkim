import { useEffect, useRef, useState } from 'react';
import { MAX_EVENT_PHOTOS, prepareEventPhoto } from './photos';

export function EventPhotoPicker({
  photos,
  onChange,
  onBusyChange,
}: {
  photos: string[];
  onChange: (photos: string[]) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function add(files: File[]) {
    setError('');
    if (!files.length) return;
    if (photos.length + files.length > MAX_EVENT_PHOTOS) {
      setError('You can add up to 4 photos. Remove one before adding another.');
      return;
    }
    setBusy(true);
    onBusyChange(true);
    try {
      // Process one at a time to avoid decoding four large phone photos at once.
      const added: string[] = [];
      for (const file of files) added.push(await prepareEventPhoto(file));
      if (mounted.current) onChange([...photos, ...added]);
    } catch (failure) {
      if (mounted.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not add these photos. Try again.',
        );
    } finally {
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  return (
    <fieldset className="event-photo-picker" disabled={busy}>
      <legend>Event photos</legend>
      <p>
        Add up to 4 photos. JPG, PNG or WebP, up to 10 MB each. The first photo
        is your cover.
      </p>
      <label>
        Add photos · {photos.length} / {MAX_EVENT_PHOTOS}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          disabled={busy || photos.length === MAX_EVENT_PHOTOS}
          onChange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';
            void add(files);
          }}
        />
      </label>
      {busy && <p role="status">Preparing photos…</p>}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="event-photo-grid">
        {photos.map((photo, index) => (
          <div className="event-photo-tile" key={index}>
            <img src={photo} alt={`Event photo ${index + 1}`} />
            <button
              type="button"
              aria-label={`Use photo ${index + 1} as cover`}
              aria-pressed={index === 0}
              onClick={() =>
                onChange([photo, ...photos.filter((_, i) => i !== index)])
              }
            >
              {index === 0 ? 'Cover photo' : 'Make cover'}
            </button>
            <button
              type="button"
              aria-label={`Remove photo ${index + 1}`}
              onClick={() => onChange(photos.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function EventPhotos({
  photos,
  title,
}: {
  photos: string[];
  title: string;
}) {
  const [selected, setSelected] = useState(0);
  const index = selected < photos.length ? selected : 0;
  return (
    <div className="community-photo-gallery">
      <img
        className="event-cover"
        src={photos[index]}
        alt={`${title} · photo ${index + 1}`}
      />
      {photos.length > 1 && (
        <div className="community-photo-thumbnails" aria-label="Event photos">
          {photos.map((photo, i) => (
            <button
              key={i}
              type="button"
              aria-label={`View event photo ${i + 1}`}
              aria-pressed={i === index}
              onClick={() => setSelected(i)}
            >
              <img src={photo} alt="" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
