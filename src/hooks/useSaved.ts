import { useCallback, useEffect, useState } from 'react';
import { experiences } from '../data/experiences';
import { readSaved, SAVED_KEY, writeSaved } from '../lib/storage';

const validIds = experiences.map(({ id }) => id);

function initialSaved(key: string) {
  try {
    return readSaved(window.localStorage, validIds, key);
  } catch {
    return [];
  }
}

export function useStoredExperiences(key: string, label: string) {
  const [savedIds, setSavedIds] = useState(() => initialSaved(key));
  const [storageNotice, setStorageNotice] = useState('');

  useEffect(() => {
    try {
      if (writeSaved(window.localStorage, savedIds, key)) return;
    } catch {
      // Browsers may deny access to storage entirely.
    }
    setStorageNotice(
      `Your ${label} will stay for this visit. Browser storage is unavailable.`,
    );
  }, [savedIds, key, label]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === null)
        setSavedIds(initialSaved(key));
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [key]);

  const toggleSaved = useCallback((id: string) => {
    if (!validIds.includes(id)) return;
    setSavedIds((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id],
    );
  }, []);

  return { savedIds, toggleSaved, storageNotice };
}

export const useSaved = () => useStoredExperiences(SAVED_KEY, 'saves');
