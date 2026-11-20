import { useEffect, useState } from 'react';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { CategoryNav } from '../components/CategoryNav';
import { ExperienceCard } from '../components/ExperienceCard';
import { Icon } from '../components/Icon';
import type { AppContext } from '../components/AppShell';
import {
  experiences,
  filterExperiences,
  isCategory,
  type CategoryId,
} from '../data/experiences';

const features = [
  {
    id: 'first-light',
    title: 'Sunrise in the Himalayas',
    description: 'Head into the foothills. Find a new perspective.',
    image: '/images/himalayan-dawn.webp',
    category: 'hiking',
  },
  {
    id: 'monastery-mornings',
    title: 'Monastery Heritage Trail',
    description: 'Quiet courtyards, mountain views and living traditions.',
    image: '/images/monastery.webp',
    category: 'culture',
  },
  {
    id: 'momo-table',
    title: 'Taste a little of Sikkim',
    description: 'Local kitchens. Shared stories. Freshly folded momos.',
    image: '/images/momos.webp',
    category: 'food',
  },
] as const;

export function Home() {
  const { savedIds, toggleSaved } = useOutletContext<AppContext>();
  const [params, setParams] = useSearchParams();
  const selected = params.get('category');
  const category = isCategory(selected) ? selected : 'all';
  const visibleFeatures =
    category === 'all'
      ? features
      : filterExperiences(category).map((item) => ({
          id: item.id,
          title: item.title,
          description: item.description,
          image: item.image,
          category: item.category,
        }));
  const [featureIndex, setFeatureIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const updateMotion = () => setReducedMotion(preference?.matches ?? false);
    const updateVisibility = () => setHidden(document.hidden);
    updateMotion();
    preference?.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    return () => {
      preference?.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
    };
  }, []);
  const rotating = !focused && !hidden && !reducedMotion;
  useEffect(() => {
    if (!rotating || visibleFeatures.length < 2) return;
    const timer = window.setTimeout(
      () => setFeatureIndex((index) => (index + 1) % visibleFeatures.length),
      3000,
    );
    return () => window.clearTimeout(timer);
  }, [rotating, featureIndex, visibleFeatures.length]);
  const feature =
    visibleFeatures[featureIndex] ?? visibleFeatures[0] ?? features[0];
  const featuredExperience = experiences.find(
    (item) => item.id === feature.id,
  )!;
  const changeCategory = (id: CategoryId) => {
    setFeatureIndex(0);
    setParams(id === 'all' ? {} : { category: id }, {
      preventScrollReset: true,
    });
  };
  const rows =
    category === 'all'
      ? [
          {
            title: 'Trending experiences',
            items: experiences.slice(0, 8),
            link: '/explore',
          },
          {
            title: 'Pakyong discoveries',
            items: experiences.filter(
              (item) => item.curation?.district === 'Pakyong',
            ),
            link: '/explore?q=Pakyong',
          },
          {
            title: 'Nature & outdoor escapes',
            items: experiences.filter((item) =>
              ['hiking', 'nature', 'wellness'].includes(item.category),
            ),
            link: '/explore?category=nature',
          },
          {
            title: 'Culture & local flavours',
            items: experiences.filter((item) =>
              ['culture', 'food'].includes(item.category),
            ),
            link: '/explore?category=culture',
          },
        ]
      : [
          {
            title: 'Experiences for you',
            items: filterExperiences(category),
            link: `/explore?category=${category}`,
          },
        ];
  return (
    <div className="page home-page">
      <CategoryNav active={category} onChange={changeCategory} />
      <section
        className="discovery-hero"
        aria-label="Featured experiences"
        aria-roledescription="carousel"
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget))
            setFocused(false);
        }}
      >
        <img
          src={feature.image}
          alt={`Illustrative concept image: ${feature.title}`}
          width="1536"
          height="1024"
          fetchPriority="high"
        />
        <div
          className="discovery-hero-content"
          aria-live={rotating ? 'off' : 'polite'}
        >
          <span className="featured-label">
            {featuredExperience.area} · {featuredExperience.duration}
          </span>
          <h1>{feature.title}</h1>
          <p>{feature.description}</p>
          <div className="hero-actions">
            <Link
              to={`/experiences/${feature.id}`}
              className="button button-white"
            >
              Explore
            </Link>
            <Link
              to={`/experiences/${feature.id}/book`}
              className="button button-primary"
            >
              Book now
            </Link>
            <button
              type="button"
              className={`save-button ${savedIds.includes(feature.id) ? 'is-saved' : ''}`}
              aria-label="Save featured experience"
              aria-pressed={savedIds.includes(feature.id)}
              onClick={() => toggleSaved(feature.id)}
            >
              <Icon name="bookmark" size={19} />
            </button>
          </div>
        </div>
        <div
          className="feature-controls"
          role="group"
          aria-label="Choose featured experience"
        >
          {visibleFeatures.map((item, index) => (
            <button
              type="button"
              key={item.id}
              aria-label={`Show ${item.title}`}
              aria-pressed={index === featureIndex}
              onClick={() => setFeatureIndex(index)}
            >
              <span />
            </button>
          ))}
        </div>
      </section>
      {rows.map((row) => (
        <section
          key={row.title}
          className="discovery-section"
          aria-label={row.title}
        >
          <div className="section-heading">
            <h2>{row.title}</h2>
            <Link className="text-link" to={row.link}>
              See all
              <Icon name="chevron" size={16} />
            </Link>
          </div>
          <div className="experience-rail">
            {row.items.map((experience) => (
              <ExperienceCard
                key={experience.id}
                experience={experience}
                saved={savedIds.includes(experience.id)}
                onToggle={toggleSaved}
              />
            ))}
          </div>
        </section>
      ))}
      {category !== 'all' && (
        <button
          className="button button-secondary reset-button"
          type="button"
          onClick={() => changeCategory('all')}
        >
          Show all experiences
        </button>
      )}
    </div>
  );
}
