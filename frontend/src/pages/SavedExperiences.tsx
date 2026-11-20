import { Link, useOutletContext } from 'react-router-dom';
import type { AppContext } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { ExperienceCard } from '../components/ExperienceCard';
import { Icon } from '../components/Icon';
import { experiences } from '../data/experiences';

export function SavedExperiences() {
  const { savedIds, toggleSaved } = useOutletContext<AppContext>();
  const saved = experiences.filter((item) => savedIds.includes(item.id));
  return (
    <div className="page interior-page">
      <header className="page-heading">
        <h1>Your saved experiences</h1>
        <p>Keep a little inspiration for your visit.</p>
      </header>
      <div className="saved-summary">
        <span>
          <Icon name="bookmark" size={18} />
          Saved experiences <strong>{saved.length}</strong>
        </span>
        <span>Stored on this browser</span>
      </div>
      {saved.length ? (
        <>
          <h2 className="sr-only">Saved experience ideas</h2>
          <div className="experience-grid explore-grid">
            {saved.map((experience) => (
              <ExperienceCard
                key={experience.id}
                experience={experience}
                saved
                booking
                onToggle={toggleSaved}
              />
            ))}
          </div>
          <Link to="/explore" className="button button-secondary reset-button">
            Find a little more inspiration
            <Icon name="arrow-right" size={17} />
          </Link>
        </>
      ) : (
        <EmptyState icon="bookmark" title="Make room for a little wonder.">
          Tap the bookmark on an experience you love. Your next adventure can
          start with a single idea.
        </EmptyState>
      )}
      <p className="page-footnote">
        Keep your favourite places together. Saving an idea doesn’t reserve a
        place.
      </p>
    </div>
  );
}
