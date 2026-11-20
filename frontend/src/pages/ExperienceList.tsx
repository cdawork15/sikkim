import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import type { AppContext } from '../components/AppShell';
import { CategoryNav } from '../components/CategoryNav';
import { ExperienceCard } from '../components/ExperienceCard';
import { Icon } from '../components/Icon';
import {
  filterExperiences,
  isCategory,
  type CategoryId,
} from '../data/experiences';

export function ExperienceList() {
  const { savedIds, toggleSaved } = useOutletContext<AppContext>();
  const [params, setParams] = useSearchParams();
  const selected = params.get('category');
  const category = isCategory(selected) ? selected : 'all';
  const query = params.get('q') ?? '';
  const sort = params.get('sort') ?? 'recommended';
  const filtered = filterExperiences(category, query).sort((a, b) =>
    sort === 'price-low'
      ? a.price - b.price
      : sort === 'price-high'
        ? b.price - a.price
        : 0,
  );
  const limit = params.get('more') === 'true' ? filtered.length : 4;
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (key !== 'more') next.delete('more');
    if (!value || (key === 'category' && value === 'all')) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: key === 'q', preventScrollReset: true });
  };
  return (
    <div className="page interior-page browse-page">
      <header className="page-heading">
        <h1>Find your next experience</h1>
        <p>Trails, local flavours and slower mornings in Sikkim.</p>
        <Link className="text-link host-profile-link" to="/hosts">
          Meet the hosts
        </Link>
      </header>
      <form
        className="search-form"
        role="search"
        onSubmit={(event) => event.preventDefault()}
      >
        <Icon name="search" />
        <label htmlFor="experience-search" className="sr-only">
          Search experiences
        </label>
        <input
          id="experience-search"
          type="search"
          placeholder="Search places, food or experiences"
          value={query}
          onChange={(event) => update('q', event.target.value)}
          maxLength={100}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            onClick={() => update('q', '')}
          >
            <Icon name="close" size={18} />
          </button>
        )}
      </form>
      <CategoryNav
        active={category}
        onChange={(id: CategoryId) => update('category', id)}
      />
      <h2 className="sr-only">Experience results</h2>
      <div className="results-heading">
        <p aria-live="polite">
          {filtered.length}{' '}
          {filtered.length === 1 ? 'experience' : 'experiences'}
        </p>
        <label className="sort-control">
          <span className="sr-only">Sort</span>
          <select
            aria-label="Sort experiences"
            value={sort}
            onChange={(event) => update('sort', event.target.value)}
          >
            <option value="recommended">Recommended</option>
            <option value="price-low">Price: low to high</option>
            <option value="price-high">Price: high to low</option>
          </select>
        </label>
      </div>
      {filtered.length ? (
        <div className="experience-grid explore-grid">
          {filtered.slice(0, limit).map((experience) => (
            <ExperienceCard
              key={experience.id}
              experience={experience}
              saved={savedIds.includes(experience.id)}
              onToggle={toggleSaved}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <span className="empty-icon">
            <Icon name="search" size={30} />
          </span>
          <h2>A different trail, perhaps?</h2>
          <p>
            No experiences match your search. Try another word or start fresh.
          </p>
          <button
            type="button"
            className="button button-primary"
            onClick={() => setParams({ view: 'list' })}
          >
            Clear all filters
            <Icon name="arrow-right" size={17} />
          </button>
        </div>
      )}
      {filtered.length > limit && (
        <button
          type="button"
          className="button button-secondary reset-button"
          onClick={() => update('more', 'true')}
        >
          Load more experiences
        </button>
      )}
    </div>
  );
}
