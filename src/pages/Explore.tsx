import { Link, useSearchParams } from 'react-router-dom';
import { ExperienceList } from './ExperienceList';
import { ReelFeed } from '../components/ReelFeed';

export function Explore() {
  const [params] = useSearchParams();
  const listing =
    params.get('view') === 'list' ||
    ['category', 'q', 'sort', 'more'].some((key) => params.has(key));
  return (
    <>
      <nav className="explore-views page" aria-label="Explore views">
        <Link to="/explore" aria-current={!listing ? 'page' : undefined}>
          For you
        </Link>
        <Link
          to="/explore?view=list"
          aria-current={listing ? 'page' : undefined}
        >
          Browse all
        </Link>
      </nav>
      {listing ? <ExperienceList /> : <ReelFeed />}
    </>
  );
}
