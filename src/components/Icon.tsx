import {
  Car,
  FileCheck,
  Phone,
  Ticket,
  Info,
  ExternalLink,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Share2,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronRight,
  Clock3,
  Compass,
  Heart,
  Home,
  Landmark,
  Leaf,
  Map,
  MapPin,
  Mountain,
  Search,
  Sun,
  Users,
  Utensils,
  X,
} from 'lucide-react';

const icons = {
  car: Car,
  document: FileCheck,
  phone: Phone,
  ticket: Ticket,
  info: Info,
  external: ExternalLink,
  play: Play,
  pause: Pause,
  volume: Volume2,
  'volume-off': VolumeX,
  share: Share2,
  'arrow-down': ArrowDown,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  bookmark: Bookmark,
  check: Check,
  chevron: ChevronRight,
  clock: Clock3,
  compass: Compass,
  heart: Heart,
  home: Home,
  landmark: Landmark,
  leaf: Leaf,
  map: Map,
  pin: MapPin,
  mountain: Mountain,
  search: Search,
  sun: Sun,
  users: Users,
  utensils: Utensils,
  close: X,
};
export type IconName = keyof typeof icons;

export function Icon({
  name,
  size = 20,
  className = '',
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  const Component = icons[name];
  return (
    <Component
      size={size}
      strokeWidth={1.65}
      aria-hidden="true"
      className={className}
    />
  );
}
