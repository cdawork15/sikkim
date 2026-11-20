import type { ReactNode } from 'react';
import { Icon, type IconName } from '../components/Icon';

export function OfficialLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      className="essentials-source"
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <Icon name="external" size={16} />
      <span className="sr-only"> (opens a new tab)</span>
    </a>
  );
}

export const essentialsSections: {
  id: string;
  label: string;
  detail: string;
  icon: IconName;
}[] = [
  {
    id: 'permits',
    label: 'Permits',
    detail: 'Know what to arrange',
    icon: 'document',
  },
  {
    id: 'transport',
    label: 'Taxis & transport',
    detail: 'Find your way around',
    icon: 'car',
  },
  {
    id: 'bookings',
    label: 'My bookings',
    detail: 'Reservations & tickets',
    icon: 'ticket',
  },
  {
    id: 'help',
    label: 'Help & contacts',
    detail: 'A useful number away',
    icon: 'phone',
  },
  {
    id: 'updates',
    label: 'Travel updates',
    detail: 'Check before you set off',
    icon: 'info',
  },
  {
    id: 'before-you-go',
    label: 'Before you travel',
    detail: 'A few things to remember',
    icon: 'check',
  },
];
