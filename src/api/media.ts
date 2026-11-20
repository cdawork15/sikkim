export function mediaUrl(value?: string | null) {
  if (!value || !value.startsWith('/v1/media/')) return undefined;
  const base = (import.meta.env.VITE_API_BASE_URL || '/v1').replace(/\/$/, '');
  return base + value.slice(3);
}
