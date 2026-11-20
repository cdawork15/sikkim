import { Link } from 'react-router-dom';
import { Icon, type IconName } from './Icon';

export function EmptyState({
  icon = 'compass',
  title,
  children,
  action = 'Explore experiences',
  to = '/explore',
}: {
  icon?: IconName;
  title: string;
  children: React.ReactNode;
  action?: string;
  to?: string;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={32} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      <Link to={to} className="button button-primary">
        {action}
        <Icon name="arrow-right" size={17} />
      </Link>
    </div>
  );
}
