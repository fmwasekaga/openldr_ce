import { useState } from 'react';

/** A boolean toggle persisted to localStorage under `key`. Returns [value, toggle, set]. */
export function usePersistedToggle(key: string, initial = false): [boolean, () => void, (v: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    try { const s = localStorage.getItem(key); return s == null ? initial : s === 'true'; } catch { return initial; }
  });
  const write = (v: boolean) => { try { localStorage.setItem(key, String(v)); } catch { /* ignore */ } return v; };
  const toggle = () => setValue((c) => write(!c));
  const set = (v: boolean) => setValue(() => write(v));
  return [value, toggle, set];
}
