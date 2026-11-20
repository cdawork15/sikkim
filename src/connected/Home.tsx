import { useExperienceActions } from './ExperienceActions';
import { mediaUrl } from '../api/media';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CategoryNav } from '../components/CategoryNav';
import { ExperienceCard } from '../components/ExperienceCard';
import { Icon } from '../components/Icon';
import { useResource } from '../api/react';
import type { HomeData } from '../api/types';
import {
  duration,
  ErrorNotice,
  Loading,
  previewImage,
  experienceSummary,
} from './shared';
import { isCategory, type CategoryId } from '../data/experiences';

export function Home() {
  const result = useResource<HomeData>('/home');
  const rowsFromServer = result.data?.rows ?? [];
  const all = [
    ...new Map(
      rowsFromServer
        .flatMap((row) => row.experiences)
        .map((item) => [item.id, item]),
    ).values(),
  ];
  const actions = useExperienceActions(all.map((item) => item.id));
  const stateFor = (slug: string) =>
    actions.states.find(
      (state) => state.id === all.find((item) => item.slug === slug)?.id,
    );
  const toggleSaved = (slug: string) => {
    const id = all.find((item) => item.slug === slug)?.id;
    if (id) actions.toggle(id, 'saved');
  };
  const experiences = all.map((item) => ({
    id: item.slug,
    categories: item.categories,
    areaCode: item.areaCode,
    title: item.title,
    category: (item.categories.find((code) =>
      ['hiking', 'nature', 'culture', 'food', 'wellness'].includes(code),
    ) ?? 'culture') as Exclude<CategoryId, 'all'>,
    area: item.area,
    duration: duration(item.durationMinutes),
    price: item.pricePaise / 100,
    image:
      mediaUrl(
        item.media.find((media) => media.placement === 'cover')?.urls.image ??
          item.media[0]?.urls.image ??
          item.media[0]?.urls.poster,
      ) ??
      previewImage(item) ??
      '',
    imageAlt:
      item.media[0]?.altText ??
      (previewImage(item)
        ? `Illustrative concept image: ${item.title}`
        : `Photo coming soon: ${item.title}`),
    tag: item.hostName,
    description: experienceSummary(item),
    curation: undefined,
  }));
  const featuredIds = new Set(
    rowsFromServer
      .find((row) => row.id === 'featured')
      ?.experiences.map((item) => item.slug),
  );
  const features = experiences.filter((item) => featuredIds.has(item.id));
  const filterExperiences = (category: CategoryId) =>
    experiences.filter(
      (item) =>
        category === 'all' ||
        item.categories.includes(category) ||
        (category === 'culture' &&
          item.categories.some((code) => ['art', 'music'].includes(code))),
    );
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
    visibleFeatures[featureIndex] ??
    visibleFeatures[0] ??
    (category === 'all' ? experiences[0] : undefined);
  const featuredExperience = experiences.find(
    (item) => item.id === feature?.id,
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
            title: 'Explore Sikkim',
            items: experiences.slice(0, 8),
            link: '/explore?view=list',
          },
          {
            title: 'Pakyong discoveries',
            items: experiences.filter((item) => item.areaCode === 'pakyong'),
            link: '/explore?area=pakyong',
          },
          {
            title: 'Nature & outdoor escapes',
            items: experiences.filter((item) =>
              item.categories.some((code) =>
                ['hiking', 'nature', 'wellness'].includes(code),
              ),
            ),
            link: '/explore?category=nature',
          },
          {
            title: 'Culture & local flavours',
            items: experiences.filter((item) =>
              item.categories.some((code) =>
                ['culture', 'food', 'art', 'music'].includes(code),
              ),
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
  if (!feature || !featuredExperience)
    return (
      <div className="page interior-page">
        {result.loading ? (
          <Loading />
        ) : result.error ? (
          <ErrorNotice error={result.error} retry={result.reload} />
        ) : (
          <>
            <h1>
              {category === 'all'
                ? 'Discover Sikkim'
                : 'More experiences are on their way.'}
            </h1>
            <p>
              {category === 'all'
                ? 'Experiences will appear here once published.'
                : 'There are no experiences in this category on Home yet.'}
            </p>
            {category !== 'all' && (
              <div className="api-actions">
                <Link
                  className="button button-primary"
                  to={`/explore?category=${category}`}
                >
                  Browse this category
                </Link>
                <button
                  className="button button-secondary"
                  onClick={() => changeCategory('all')}
                >
                  Show all experiences
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
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
        {feature.image && (
          <img
            src={feature.image}
            alt={`Illustrative concept image: ${feature.title}`}
            width="1536"
            height="1024"
            fetchPriority="high"
          />
        )}
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
              to={`/experiences/${feature.id}`}
              className="button button-primary"
            >
              View details
            </Link>
            <button
              type="button"
              className="save-button"
              disabled={actions.busy}
              aria-label={
                stateFor(feature.id)?.saved
                  ? 'Unsave experience'
                  : 'Save experience'
              }
              aria-pressed={stateFor(feature.id)?.saved ?? false}
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
      {rows
        .filter((row) => row.items.length > 0)
        .map((row) => (
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
                  saved={stateFor(experience.id)?.saved ?? false}
                  onToggle={toggleSaved}
                  canSave={!actions.busy}
                />
              ))}
            </div>
          </section>
        ))}
      <ErrorNotice error={actions.error} retry={actions.retry} />
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
