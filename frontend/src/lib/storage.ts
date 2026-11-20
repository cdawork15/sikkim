export const SAVED_KEY = 'sikkim:saved:v1';

export function readSaved(
  storage: Pick<Storage, 'getItem'>,
  validIds: readonly string[],
  key = SAVED_KEY,
): string[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter(
          (id): id is string => typeof id === 'string' && validIds.includes(id),
        ),
      ),
    ];
  } catch {
    return [];
  }
}

export function writeSaved(
  storage: Pick<Storage, 'setItem'>,
  ids: readonly string[],
  key = SAVED_KEY,
) {
  try {
    storage.setItem(key, JSON.stringify(ids));
    return true;
  } catch {
    return false;
  }
}
