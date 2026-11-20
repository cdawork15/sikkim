import { Link, useOutletContext, useParams } from 'react-router-dom';
import type { AppContext } from '../components/AppShell';
import { EmptyState } from '../components/EmptyState';
import { ExperienceCard } from '../components/ExperienceCard';
import { experiences } from '../data/experiences';
import { getHost, hosts } from '../data/hosts';

export function HostProfile() {
  const { category } = useParams();
  const { savedIds, toggleSaved } = useOutletContext<AppContext>();
  const host = getHost(category);
  if (!category)
    return (
      <div className="page interior-page">
        <Link className="text-link back-link" to="/explore?view=list">
          Back to experiences
        </Link>
        <header className="page-heading">
          <p className="eyebrow accent">PEOPLE BEHIND THE IDEAS</p>
          <h1>Meet the hosts</h1>
          <p>
            These example profiles show the kinds of local experiences we’re
            building. Hosts are not yet confirmed.
          </p>
        </header>
        <div className="host-directory">
          {Object.entries(hosts).map(([id, h]) => (
            <Link className="host-card" key={id} to={`/hosts/${id}`}>
              <img src={h.image} alt="" loading="lazy" />
              <div>
                <p className="eyebrow accent">LOCAL EXPERIENCES</p>
                <h2>{h.name}</h2>
                <p>{h.focus}</p>
                <small>{h.area}</small>
                <span className="host-profile-link">Meet {h.name} →</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    );
  if (!host)
    return (
      <div className="page interior-page">
        <EmptyState
          title="This host profile is unavailable."
          action="Browse hosts"
          to="/hosts"
        >
          Explore other profiles and experience ideas.
        </EmptyState>
      </div>
    );
  const hosted = experiences.filter(
    (item) => item.category === category && !item.curation,
  );
  return (
    <div className="page interior-page host-profile">
      <Link className="text-link back-link" to="/hosts">
        All hosts
      </Link>
      <header className="host-introduction">
        <img
          className="host-cover"
          src={host.image}
          alt={`Concept artwork for ${host.focus.toLowerCase()}, not a photo of the host`}
        />
        <div className="page-heading">
          <span className="host-avatar" aria-hidden="true">
            {host.name.charAt(0)}
          </span>
          <p className="eyebrow accent">LOCAL EXPERIENCES</p>
          <h1>Meet {host.name}</h1>
          <p>
            {host.area} · {host.focus}
          </p>
          <p>{host.story}</p>
          <p className="demo-caption">
            This is an example profile. Host contact and verified reviews aren’t
            available yet.
          </p>
        </div>
      </header>
      <h2>Experience ideas</h2>
      <div className="experience-grid explore-grid">
        {hosted.map((experience) => (
          <ExperienceCard
            key={experience.id}
            experience={experience}
            saved={savedIds.includes(experience.id)}
            onToggle={toggleSaved}
          />
        ))}
      </div>
    </div>
  );
}
