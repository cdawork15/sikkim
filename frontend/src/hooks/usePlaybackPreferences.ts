import { useEffect, useState } from 'react';

type Connection = EventTarget & { saveData?: boolean; effectiveType?: string };
function connection() {
  return (navigator as Navigator & { connection?: Connection }).connection;
}
function readPreferences() {
  const network = connection();
  return {
    reducedMotion:
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    lowData: Boolean(
      network?.saveData ||
      ['slow-2g', '2g'].includes(network?.effectiveType ?? ''),
    ),
    offline: !navigator.onLine,
    hidden: document.hidden,
  };
}

export function usePlaybackPreferences() {
  const [preferences, setPreferences] = useState(readPreferences);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const network = connection();
    const update = () => setPreferences(readPreferences());
    media?.addEventListener('change', update);
    network?.addEventListener('change', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      media?.removeEventListener('change', update);
      network?.removeEventListener('change', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return preferences;
}
