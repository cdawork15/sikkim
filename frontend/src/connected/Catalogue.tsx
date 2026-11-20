import { ExperienceActions } from './ExperienceActions';
import { ExperienceGallery } from './Media';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useAction, useApi, useResource, useSession } from '../api/react';
import { Icon } from '../components/Icon';
import { queryString } from '../api/client';
import type {
  CatalogueOptions,
  Experience,
  ExperienceDetail,
  Host,
  Searches,
  SearchFilters,
} from '../api/types';
import {
  Card,
  experienceSummary,
  isPreviewExperience,
  isPreviewHost,
  duration,
  ErrorNotice,
  Loading,
  money,
  PagedList,
  paise,
} from './shared';

export function Explore() {
  const [params, setParams] = useSearchParams();
  return (
    <Browse key={params.toString()} params={params} setParams={setParams} />
  );
}
function Browse({
  params,
  setParams,
}: {
  params: URLSearchParams;
  setParams: (value: URLSearchParams) => void;
}) {
  const api = useApi();
  const { user } = useSession();
  const action = useAction();
  const options = useResource<CatalogueOptions>('/catalogue/options');
  const searches = useResource<Searches>(user ? '/me/searches' : null, true);
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [suggestionQuery, setSuggestionQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSuggestionQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const suggestions = useResource<
    { id: string; slug: string; title: string }[]
  >(
    suggestionQuery
      ? '/search/suggestions?q=' + encodeURIComponent(suggestionQuery)
      : null,
  );
  const allowed = [
    'q',
    'area',
    'category',
    'minPricePaise',
    'maxPricePaise',
    'accessibility',
    'difficulty',
    'sort',
    ...(options.data?.dateFilteringAvailable ? ['date'] : []),
  ];
  const filtered = new URLSearchParams(
    [...params].filter(([key]) => allowed.includes(key)),
  );
  function apply(filters: SearchFilters) {
    const next = new URLSearchParams(queryString(filters));
    next.set('view', 'list');
    setParams(next);
  }
  const current = Object.fromEntries(filtered) as Record<
    string,
    string | number
  >;
  for (const key of ['minPricePaise', 'maxPricePaise'])
    if (key in current) current[key] = Number(current[key]);
  return (
    <div className="page interior-page browse-page connected-browse">
      <header className="page-heading">
        <div>
          <h1>Find your next experience</h1>
          <Link className="text-link" to="/explore">
            Watch reels
          </Link>
          <p>Trails, local flavours and slower mornings in Sikkim.</p>
        </div>
        <Link className="text-link" to="/hosts">
          Meet the hosts <Icon name="arrow-right" size={16} />
        </Link>
      </header>
      <form
        className="search-form"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          apply({ ...current, q: query.trim() });
        }}
      >
        <Icon name="search" />
        <label className="sr-only" htmlFor="connected-search">
          Search experiences
        </label>
        <input
          id="connected-search"
          type="search"
          value={query}
          maxLength={120}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search places, food or experiences"
        />
        <button
          className="icon-button"
          aria-label="Find experiences"
          disabled={action.busy}
        >
          <Icon name="arrow-right" />
        </button>
      </form>
      {query.trim() !== (params.get('q') ?? '') &&
        suggestions.data &&
        suggestions.data.length > 0 && (
          <ul className="api-suggestions browse-suggestions">
            {suggestions.data.map((item) => (
              <li key={item.id}>
                <Link to={'/experiences/' + item.slug}>{item.title}</Link>
              </li>
            ))}
          </ul>
        )}
      <div
        className="category-nav"
        role="group"
        aria-label="Experience categories"
      >
        <button
          className={`category-chip ${!params.get('category') ? 'active' : ''}`}
          aria-pressed={!params.get('category')}
          onClick={() => apply({ ...current, category: '' })}
        >
          <Icon name="compass" size={18} />
          All experiences
        </button>
        {options.data?.categories.map((category) => (
          <button
            key={category.code}
            className={`category-chip ${params.get('category') === category.code ? 'active' : ''}`}
            aria-pressed={params.get('category') === category.code}
            onClick={() => apply({ ...current, category: category.code })}
          >
            {category.name}
          </button>
        ))}
      </div>
      <div className="browse-toolbar">
        <details className="browse-filters">
          <summary>
            Filters
            {[
              'area',
              'minPricePaise',
              'maxPricePaise',
              'accessibility',
              'difficulty',
            ].filter((key) => params.has(key) && params.get(key)).length >
              0 && (
              <span className="browse-filter-count">
                {
                  [
                    'area',
                    'minPricePaise',
                    'maxPricePaise',
                    'accessibility',
                    'difficulty',
                  ].filter((key) => params.has(key) && params.get(key)).length
                }
              </span>
            )}
            <Icon name="chevron" size={16} />
          </summary>
          <form
            className="api-form browse-filter-panel"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void action.run(async () => {
                const values: SearchFilters = {
                  ...current,
                  area: String(form.get('area')),
                  accessibility: String(form.get('accessibility')),
                  difficulty: String(form.get('difficulty')),
                };
                const minimum = paise(String(form.get('min')));
                const maximum = paise(String(form.get('max')));
                if (minimum === null) delete values.minPricePaise;
                else values.minPricePaise = minimum;
                if (maximum === null) delete values.maxPricePaise;
                else values.maxPricePaise = maximum;
                if (minimum !== null && maximum !== null && minimum > maximum)
                  throw new Error('Minimum price cannot exceed maximum price.');
                apply(values);
              });
            }}
          >
            <label>
              Area
              <select name="area" defaultValue={params.get('area') ?? ''}>
                <option value="">All areas</option>
                {options.data?.areas.map((area) => (
                  <option key={area.code} value={area.code}>
                    {area.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Minimum price (₹)
              <input
                name="min"
                inputMode="decimal"
                defaultValue={
                  params.has('minPricePaise')
                    ? Number(params.get('minPricePaise')) / 100
                    : ''
                }
              />
            </label>
            <label>
              Maximum price (₹)
              <input
                name="max"
                inputMode="decimal"
                defaultValue={
                  params.has('maxPricePaise')
                    ? Number(params.get('maxPricePaise')) / 100
                    : ''
                }
              />
            </label>
            <label>
              Accessibility
              <select
                name="accessibility"
                defaultValue={params.get('accessibility') ?? ''}
              >
                <option value="">Any</option>
                <option value="accessible">Accessible</option>
                <option value="not_accessible">Not accessible</option>
                <option value="unknown">Not specified</option>
              </select>
            </label>
            <label>
              Difficulty
              <select
                name="difficulty"
                defaultValue={params.get('difficulty') ?? ''}
              >
                <option value="">Any</option>
                {['easy', 'moderate', 'challenging', 'unknown'].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>

            <div className="api-actions api-wide">
              <button
                className="button button-primary"
                disabled={action.busy || !options.data}
              >
                Apply filters
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() =>
                  apply({
                    q: params.get('q') ?? '',
                    category: params.get('category') ?? '',
                    sort: params.get('sort') ?? 'recommended',
                  })
                }
              >
                Clear filters
              </button>
            </div>
          </form>
        </details>
        <label className="sort-control">
          <span className="sr-only">Sort experiences</span>
          <select
            aria-label="Sort experiences"
            value={params.get('sort') ?? 'recommended'}
            onChange={(event) =>
              apply({ ...current, sort: event.target.value })
            }
          >
            {Object.entries({
              recommended: 'Recommended',
              price_asc: 'Price: low to high',
              price_desc: 'Price: high to low',
              duration: 'Shortest first',
              newest: 'Newest',
            }).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {params.has('date') &&
        options.data &&
        !options.data.dateFilteringAvailable && (
          <p role="status" className="api-notice">
            Date availability is not connected yet. These results are not
            filtered by date.
          </p>
        )}
      <ErrorNotice error={options.error} retry={options.reload} />
      <ErrorNotice error={action.error} />
      <ErrorNotice error={searches.error} retry={searches.reload} />
      {action.message && <p role="status">{action.message}</p>}
      {user && (
        <details className="browse-saved">
          <summary>Saved filters & recent searches</summary>
          <p>Searches are only remembered when you choose to save them.</p>
          <div className="api-actions">
            <button
              className="button button-secondary"
              disabled={action.busy || !params.get('q')?.trim()}
              onClick={() =>
                void action.run(async () => {
                  await api.request('/me/recent-searches', {
                    method: 'POST',
                    private: true,
                    body: { q: params.get('q')!.trim() },
                  });
                  searches.reload();
                }, 'Search saved.')
              }
            >
              Save this search
            </button>
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api.request('/me/search-filters', {
                    method: 'PUT',
                    private: true,
                    body: current,
                  });
                  searches.reload();
                }, 'Filters saved.')
              }
            >
              Save these filters
            </button>
            <button
              className="button button-secondary"
              disabled={!searches.data}
              onClick={() => searches.data && apply(searches.data.filters)}
            >
              Use saved filters
            </button>
            <button
              className="button button-secondary"
              disabled={action.busy}
              onClick={() =>
                void action.run(async () => {
                  await api.request('/me/search-filters', {
                    method: 'PUT',
                    private: true,
                    body: {},
                  });
                  searches.reload();
                }, 'Saved filters cleared.')
              }
            >
              Reset saved filters
            </button>
          </div>
          {!!searches.data?.recent.length && (
            <>
              <h2>Recent searches</h2>
              <div className="api-chips">
                {searches.data.recent.map((item) => (
                  <button
                    className="api-chip"
                    key={item.query}
                    onClick={() => apply({ q: item.query })}
                  >
                    {item.query}
                  </button>
                ))}
              </div>
              <button
                className="button button-secondary"
                disabled={action.busy}
                onClick={() =>
                  void action.run(async () => {
                    await api.request('/me/recent-searches', {
                      method: 'DELETE',
                      private: true,
                    });
                    searches.reload();
                  })
                }
              >
                Clear search history
              </button>
            </>
          )}
        </details>
      )}
      <PagedList<Experience>
        path={'/experiences?' + filtered.toString()}
        cursorName="cursor"
        render={(item) => <Card experience={item} />}
      />
    </div>
  );
}

export function Detail() {
  const { slug = '' } = useParams();
  const result = useResource<ExperienceDetail>(
    '/experiences/' + encodeURIComponent(slug),
  );
  const item = result.data;
  return (
    <div className="page interior-page">
      <Link to="/explore?view=list">← All experiences</Link>
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
      {item && (
        <>
          <div className="api-detail">
            <ExperienceGallery experience={item} reload={result.reload} />
            <section>
              <p className="eyebrow">{item.area}</p>
              <h1>{item.title}</h1>
              <ExperienceActions id={item.id} />
              <p>{experienceSummary(item)}</p>
              <div className="api-chips">
                <span className="api-chip">
                  {duration(item.durationMinutes)}
                </span>
                <span className="api-chip">
                  {item.difficulty === 'unknown'
                    ? 'Difficulty not specified'
                    : item.difficulty}
                </span>
                <span className="api-chip">
                  {item.minParticipants}–{item.maxParticipants} people
                </span>
              </div>
              <h2>
                {money(item.pricePaise)} <small>/ person</small>
              </h2>
              {item.availability.bookable ? (
                <Link
                  className="button button-primary"
                  to={'/experiences/' + encodeURIComponent(item.slug) + '/book'}
                >
                  Choose a date
                </Link>
              ) : (
                <button className="button button-primary" disabled>
                  {item.availability.status === 'payment_unavailable'
                    ? 'Paid booking is not available yet'
                    : 'Bookings aren’t open yet'}
                </button>
              )}
            </section>
          </div>
          {isPreviewExperience(item) ? (
            <section className="api-panel">
              <h2>Before you book</h2>
              <p>
                Host, meeting point and inclusions will be confirmed when
                bookings open.
              </p>
            </section>
          ) : (
            <>
              <div className="api-grid">
                <section className="api-panel">
                  <h2>Your host</h2>
                  <Link to={'/hosts/' + item.hostId}>{item.hostName}</Link>
                  <p>{item.hostStory}</p>
                </section>
                <section className="api-panel">
                  <h2>Where to meet</h2>
                  <p>{item.meetingPoint}</p>
                </section>
                <section className="api-panel">
                  <h2>Included</h2>
                  <ul>
                    {item.inclusions.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                  <h3>Not included</h3>
                  <ul>
                    {item.exclusions.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                </section>
                <section className="api-panel">
                  <h2>Before you go</h2>
                  <p>{item.preparation || 'No preparation notes provided.'}</p>
                  <h3>Accessibility</h3>
                  <p>
                    {item.accessibility.replaceAll('_', ' ')}.{' '}
                    {item.accessibilityNotes}
                  </p>
                </section>
              </div>
              <section className="api-panel">
                <h2>Things to know</h2>
                {(['cancellation', 'safety', 'participation'] as const).map(
                  (key) => (
                    <details key={key}>
                      <summary>
                        {key.charAt(0).toUpperCase() + key.slice(1)}
                      </summary>
                      <p>{item.policy[key]}</p>
                    </details>
                  ),
                )}
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
export function Hosts() {
  return (
    <div className="page interior-page">
      <p className="eyebrow">People of Sikkim</p>
      <h1>Meet your hosts.</h1>
      <PagedList<Host>
        path="/hosts"
        render={(host) => (
          <Link className="api-panel api-host" to={'/hosts/' + host.id}>
            <h2>{host.publicName}</h2>
            <p>
              {isPreviewHost(host.story)
                ? 'Experience ideas · Host to be confirmed'
                : host.story}
            </p>
            <span>{host.serviceAreas.join(' · ')}</span>
          </Link>
        )}
      />
    </div>
  );
}
export function HostDetail() {
  const { id = '' } = useParams();
  const result = useResource<Host>('/hosts/' + encodeURIComponent(id));
  return (
    <div className="page interior-page">
      <Link to="/hosts">← All hosts</Link>
      {result.loading && <Loading />}
      <ErrorNotice error={result.error} retry={result.reload} />
      {result.data && (
        <>
          <p className="eyebrow">
            {isPreviewHost(result.data.story)
              ? 'Experience collection'
              : 'Your local host'}
          </p>
          <h1>{result.data.publicName}</h1>
          <p>
            {isPreviewHost(result.data.story)
              ? 'Explore this collection of experiences. Host details will be available when bookings open.'
              : result.data.story}
          </p>
          <p>{result.data.serviceAreas.join(' · ')}</p>
          <h2>
            {isPreviewHost(result.data.story)
              ? 'Explore the collection'
              : 'Experiences with this host'}
          </h2>
          <PagedList<Experience>
            path={'/hosts/' + encodeURIComponent(id) + '/experiences'}
            cursorName="cursor"
            render={(item) => <Card experience={item} />}
          />
        </>
      )}
    </div>
  );
}
