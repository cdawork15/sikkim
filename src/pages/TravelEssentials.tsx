import { Link } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { essentialsSections } from './essentials-shared';
import './travel-essentials.css';

export function TravelEssentials() {
  return (
    <div className="page essentials-page">
      <header className="essentials-hero">
        <img src="/videos/nathu.webp" alt="" />
        <div className="essentials-hero-copy">
          <p className="eyebrow">A LITTLE KNOW-HOW GOES A LONG WAY</p>
          <h1>Travel essentials.</h1>
          <p>
            Less to figure out.
            <br />
            More Sikkim to enjoy.
          </p>
          <span className="essentials-location">
            <Icon name="pin" size={15} /> Sikkim, India
          </span>
        </div>
      </header>

      <nav
        className="essentials-shortcuts"
        aria-label="Travel essentials sections"
      >
        {essentialsSections.slice(0, 4).map((section) => (
          <Link key={section.id} to={'/essentials/' + section.id}>
            <span className="essentials-icon">
              <Icon name={section.icon} size={24} />
            </span>
            <span>
              <strong>{section.label}</strong>
              <small>{section.detail}</small>
            </span>
            <Icon name="arrow-right" size={18} />
          </Link>
        ))}
      </nav>
      <nav className="essentials-secondary" aria-label="Before you go">
        {essentialsSections.slice(4).map((section) => (
          <Link key={section.id} to={'/essentials/' + section.id}>
            <Icon name={section.icon} size={20} />
            <span>
              <strong>{section.label}</strong>
              <small>{section.detail}</small>
            </span>
            <Icon name="arrow-right" size={18} />
          </Link>
        ))}
      </nav>
    </div>
  );
}
