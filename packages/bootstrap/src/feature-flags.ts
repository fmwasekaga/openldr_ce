import { FEATURE_FLAGS, getFlagDefinition, parseFlagValue } from '@openldr/config';
import type { AppSettingStore } from '@openldr/db';

export interface ResolvedFlag {
  id: string;
  labelKey: string;
  descriptionKey: string;
  value: boolean;
}

export interface FeatureFlags {
  /** Boolean value of a flag: stored override, else registry default. Cached (5s TTL). */
  get(id: string): Promise<boolean>;
  /** All registry flags merged with stored overrides (for the admin UI). */
  all(): Promise<ResolvedFlag[]>;
  /** Persist a flag value (audited by the caller) and invalidate the cache. */
  set(id: string, value: boolean, actor: string | null): Promise<void>;
  /** Force the next read to hit the store. */
  invalidate(): void;
}

const TTL_MS = 5000;

export function createFeatureFlags(store: AppSettingStore): FeatureFlags {
  let cache: Map<string, string> | null = null;
  let loadedAt = 0;

  function invalidate(): void {
    cache = null;
    loadedAt = 0;
  }

  async function load(now: number): Promise<Map<string, string>> {
    if (cache && now - loadedAt < TTL_MS) return cache;
    const rows = await store.getAll();
    cache = new Map(rows.map((r) => [r.key, r.value]));
    loadedAt = now;
    return cache;
  }

  return {
    async get(id) {
      const def = getFlagDefinition(id);
      const map = await load(Date.now());
      return parseFlagValue(map.get(id), def?.default ?? false);
    },
    async all() {
      const map = await load(Date.now());
      return FEATURE_FLAGS.map((f) => ({
        id: f.id,
        labelKey: f.labelKey,
        descriptionKey: f.descriptionKey,
        value: parseFlagValue(map.get(f.id), f.default),
      }));
    },
    async set(id, value, actor) {
      await store.set(id, value ? 'true' : 'false', actor);
      invalidate();
    },
    invalidate,
  };
}
