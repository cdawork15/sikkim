import { Link } from 'react-router-dom';

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Sikkim Experiences home">
      <svg width="30" height="24" viewBox="0 0 30 24" aria-hidden="true">
        <path d="M1 23L10 6l5 8 4-6 10 15z" fill="currentColor" />
        <path d="M10 6l2.6 4.2L10 9 7.6 10.6z" fill="#fff" />
      </svg>
      <span>
        Sikkim<span className="brand-caption">Experiences</span>
      </span>
    </Link>
  );
}
