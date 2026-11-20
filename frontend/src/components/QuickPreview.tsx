import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import type { Experience } from '../data/experiences';
import { formatPrice } from '../data/experiences';
import { getExperienceDetails } from '../data/experienceDetails';
import { reelMedia } from '../data/reels';
import { Icon } from './Icon';

export function QuickPreview({
  experience,
  onClose,
}: {
  experience: Experience;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const host = getExperienceDetails(experience);
  const media = reelMedia(experience);
  useEffect(() => {
    const modal = dialog.current!;
    modal.showModal();
    return () => modal.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="quick-preview"
      aria-labelledby="preview-title"
      onClose={() => {
        if (!dialog.current?.open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="quick-preview-content">
        <button
          className="quick-close icon-button"
          type="button"
          aria-label="Close preview"
          onClick={onClose}
          autoFocus
        >
          <Icon name="close" />
        </button>
        <img
          src={media.poster}
          alt={`Video still from ${media.place}`}
          width="768"
          height="512"
        />
        <div className="quick-preview-copy">
          <p className="eyebrow accent">QUICK LOOK</p>
          <h2 id="preview-title">{experience.title}</h2>
          <p>{experience.description}</p>
          <dl>
            <div>
              <dt>Price</dt>
              <dd>{formatPrice(experience.price)} / person</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>{experience.duration}</dd>
            </div>
            <div>
              <dt>Meeting area</dt>
              <dd>{experience.area} · Exact point not confirmed</dd>
            </div>
            <div>
              <dt>Reviews</dt>
              <dd>No verified reviews yet</dd>
            </div>
          </dl>
          <Link className="text-link" to={`/hosts/${experience.category}`}>
            Meet {host.host}
            <Icon name="chevron" size={16} />
          </Link>
          <Link
            className="button button-primary"
            to={`/experiences/${experience.id}`}
          >
            View full details
            <Icon name="arrow-right" size={18} />
          </Link>
          <Link className="text-link" to={`/experiences/${experience.id}/book`}>
            Try the booking flow
          </Link>
        </div>
      </div>
    </dialog>
  );
}
