import { useState } from 'react';
import { Link, useOutletContext, useParams } from 'react-router-dom';
import type { AppContext } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { ExperienceImage, SaveButton } from '../components/ExperienceCard';
import { Icon } from '../components/Icon';
import { experiences, formatPrice, type Experience } from '../data/experiences';
import {
  demoCancellation,
  getExperienceDetails,
} from '../data/experienceDetails';

export function ExperiencePreview() {
  const { id } = useParams();
  const experience = experiences.find((item) => item.id === id);
  return experience ? (
    <Details key={experience.id} experience={experience} />
  ) : (
    <div className="page interior-page">
      <EmptyState title="This trail leads somewhere else.">
        That experience isn’t available. Let’s find you another idea.
      </EmptyState>
    </div>
  );
}

function Details({ experience }: { experience: Experience }) {
  const { savedIds, toggleSaved } = useOutletContext<AppContext>();
  const details = getExperienceDetails(experience);
  const [photo, setPhoto] = useState(0);
  const saved = savedIds.includes(experience.id);
  return (
    <div className="page booking-page experience-details-page">
      <Link
        to={`/explore?category=${experience.category}`}
        className="text-link back-link"
      >
        <Icon name="arrow-left" size={17} />
        Back to experiences
      </Link>
      <article className="detail-layout">
        <div className="detail-gallery">
          <div className="detail-cover">
            <SaveButton
              experience={experience}
              saved={saved}
              onToggle={toggleSaved}
            />
            <ExperienceImage
              key={photo}
              experience={{
                ...experience,
                image: details.gallery[photo]!,
                imageAlt: `Concept image ${photo + 1} for ${experience.title}`,
              }}
              eager
            />
            <span className="concept-label">
              {photo + 1}/{details.gallery.length}
            </span>
          </div>
          <div
            className="gallery-choices"
            role="group"
            aria-label="Experience photos"
          >
            {details.gallery.map((src, index) => (
              <button
                key={src}
                type="button"
                aria-label={`Show photo ${index + 1}`}
                aria-pressed={photo === index}
                onClick={() => setPhoto(index)}
              >
                <img src={src} alt="" width="120" height="80" />
                <span>Photo {index + 1}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="detail-content preview-copy">
          <p className="eyebrow accent">{experience.tag}</p>
          <h1>{experience.title}</h1>
          <div className="detail-meta">
            <span>
              <Icon name="pin" size={16} />
              {experience.area}
            </span>
            <span>
              <Icon name="clock" size={16} />
              {experience.duration}
            </span>
            <span>
              <Icon name="users" size={16} />
              Up to 8 people
            </span>
          </div>
          <span className="detail-chip">{details.level}</span>
          <p className="detail-story">{experience.description}</p>
          {experience.curation && (
            <section
              className="curation-note"
              aria-label="District curation status"
            >
              <h2>Proposed experience · Not yet verified</h2>
              <p>{experience.curation.verify}</p>
              <small>
                District curation: {experience.curation.district}, item{' '}
                {experience.curation.row}. Prices, duration and images are
                illustrative. No provider is confirmed or bookable.
              </small>
            </section>
          )}
          <section className="host-panel" aria-label="Host details">
            <span className="host-avatar" aria-hidden="true">
              {details.host.charAt(0)}
            </span>
            <div>
              <h2>Hosted by {details.host}</h2>
              <p>{details.hostStory}</p>
              <small>
                {experience.curation
                  ? 'Provider not confirmed'
                  : 'Host not confirmed'}
              </small>
              {!experience.curation && (
                <Link
                  className="text-link host-profile-link"
                  to={`/hosts/${experience.category}`}
                >
                  Meet {details.host}
                </Link>
              )}
            </div>
          </section>
          <div className="detail-inclusions">
            <section>
              <h2>What’s included</h2>
              <ul>
                {details.included.map((item) => (
                  <li key={item}>
                    <Icon name="check" size={16} />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <h2>Not included</h2>
              <ul>
                {details.excluded.map((item) => (
                  <li key={item}>
                    <Icon name="close" size={16} />
                    {item}
                  </li>
                ))}
              </ul>
            </section>
          </div>
          <details className="detail-disclosure">
            <summary>Before you go</summary>
            <p>{details.preparation}</p>
            <p>
              Meeting area: {experience.area}. Exact directions and access must
              be confirmed with a real host before travelling.
            </p>
          </details>
          <details className="detail-disclosure">
            <summary>Cancellation rules</summary>
            <p>{demoCancellation}</p>
          </details>
          <div className="prototype-note" role="note">
            <Icon name="compass" size={20} />
            <p>
              <strong>Before you book.</strong> This experience is an example.
              Hosts, dates and prices aren’t confirmed, and no payment is taken.
            </p>
          </div>
          <div className="detail-booking-bar">
            <div>
              <strong>{formatPrice(experience.price)}</strong>
              <span> / person</span>
            </div>
            <Link
              to={`/experiences/${experience.id}/book`}
              className="button button-primary"
            >
              Choose a date
              <Icon name="arrow-right" size={17} />
            </Link>
          </div>
          <button
            type="button"
            className="button button-secondary detail-save"
            aria-pressed={saved}
            onClick={() => toggleSaved(experience.id)}
          >
            <Icon name={saved ? 'check' : 'bookmark'} size={18} />
            {saved ? 'Saved to your ideas' : 'Save this experience'}
          </button>
        </div>
      </article>
    </div>
  );
}
