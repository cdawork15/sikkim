import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatPrice, type Experience } from '../data/experiences';
import { Icon } from './Icon';

export function ExperienceImage({
  experience,
  eager = false,
}: {
  experience: Experience;
  eager?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  return failed || !experience.image ? (
    <div className="image-fallback" role="img" aria-label={experience.imageAlt}>
      <Icon name="mountain" size={46} />
      <span>A little wonder awaits</span>
    </div>
  ) : (
    <img
      src={experience.image}
      alt={experience.imageAlt}
      width="768"
      height="512"
      style={{ objectPosition: experience.imagePosition }}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

export function SaveButton({
  experience,
  saved,
  onToggle,
}: {
  experience: Experience;
  saved: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`save-button ${saved ? 'is-saved' : ''}`}
      aria-label={`${saved ? 'Unsave' : 'Save'} ${experience.title}`}
      aria-pressed={saved}
      onClick={() => onToggle(experience.id)}
    >
      <Icon name="bookmark" size={19} />
    </button>
  );
}

export function ExperienceCard({
  booking = false,
  canSave = true,
  experience,
  saved,
  onToggle,
}: {
  experience: Experience;
  saved: boolean;
  onToggle: (id: string) => void;
  booking?: boolean;
  canSave?: boolean;
}) {
  return (
    <article className="experience-card">
      <div className="card-image">
        <Link
          to={`/experiences/${experience.id}`}
          tabIndex={-1}
          aria-hidden="true"
        >
          <ExperienceImage experience={experience} />
        </Link>
        <span className="card-tag">{experience.tag}</span>
        {canSave && (
          <SaveButton
            experience={experience}
            saved={saved}
            onToggle={onToggle}
          />
        )}
      </div>
      <div className="card-body">
        <div className="card-location">
          <Icon name="pin" size={14} /> {experience.area}
          <span>·</span>
          <span>{experience.duration}</span>
        </div>
        <h3>
          <Link to={`/experiences/${experience.id}`}>{experience.title}</Link>
        </h3>
        <div className="card-bottom">
          <span>
            <strong>{formatPrice(experience.price)}</strong>
            <span className="muted"> / person</span>
          </span>
          <Link
            to={`/experiences/${experience.id}${booking ? '/book' : ''}`}
            className={booking ? 'card-booking' : 'card-arrow'}
            aria-label={`${booking ? 'Try booking for' : 'Preview'} ${experience.title}`}
          >
            {booking ? 'Try booking' : <Icon name="arrow-right" size={19} />}
          </Link>
        </div>
      </div>
    </article>
  );
}
