const PINNED_KEY = 'reports.pinned';
const LAST_PARAMS_KEY = 'reports.lastParams';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function loadPinned(): string[] {
  const v = readJson<string[]>(PINNED_KEY, []);
  return Array.isArray(v) ? v : [];
}

export function savePinned(ids: string[]): void {
  localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
}

export function togglePinned(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export type LastParams = Record<string, Record<string, string>>;

export function loadLastParams(): LastParams {
  const v = readJson<LastParams>(LAST_PARAMS_KEY, {});
  return v && typeof v === 'object' ? v : {};
}

export function saveLastParams(map: LastParams): void {
  localStorage.setItem(LAST_PARAMS_KEY, JSON.stringify(map));
}
