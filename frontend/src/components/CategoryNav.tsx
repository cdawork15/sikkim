import { categories, type CategoryId } from '../data/experiences';
import { Icon } from './Icon';

export function CategoryNav({
  active,
  onChange,
}: {
  active: CategoryId;
  onChange: (id: CategoryId) => void;
}) {
  return (
    <div
      className="category-nav"
      role="group"
      aria-label="Experience categories"
    >
      {categories.map((category) => (
        <button
          type="button"
          className={`category-chip ${active === category.id ? 'active' : ''}`}
          aria-pressed={active === category.id}
          key={category.id}
          onClick={() => onChange(category.id)}
        >
          <Icon name={category.icon} size={18} />
          {category.label}
        </button>
      ))}
    </div>
  );
}
