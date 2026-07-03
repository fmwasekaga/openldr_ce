import { NUMBER_SETTINGS, getNumberSettingDefinition, parseNumberSetting } from '@openldr/config';
import type { AppSettingStore } from '@openldr/db';

export interface ResolvedNumberSetting {
  id: string;
  labelKey: string;
  descriptionKey: string;
  value: number;
  min: number;
  max: number;
}

export interface NumberSettings {
  /** Current value of a setting: stored override (clamped), else registry default. Cached (5s TTL). */
  get(id: string): Promise<number>;
  /** All registry settings merged with stored overrides (for the admin UI). */
  all(): Promise<ResolvedNumberSetting[]>;
  /** Persist a setting value (clamped into range, audited by the caller) and invalidate the cache. */
  set(id: string, value: number, actor: string | null): Promise<number>;
  invalidate(): void;
}

const TTL_MS = 5000;

/**
 * DB-backed resolver for admin-tunable number settings, mirroring createFeatureFlags. Shares the
 * app_settings store. Unknown ids throw on set (only registered settings are tunable).
 */
export function createNumberSettings(store: AppSettingStore): NumberSettings {
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
      const def = getNumberSettingDefinition(id);
      if (!def) throw new Error(`unknown number setting "${id}"`);
      const map = await load(Date.now());
      return parseNumberSetting(map.get(id), def);
    },
    async all() {
      const map = await load(Date.now());
      return NUMBER_SETTINGS.map((s) => ({
        id: s.id,
        labelKey: s.labelKey,
        descriptionKey: s.descriptionKey,
        value: parseNumberSetting(map.get(s.id), s),
        min: s.min,
        max: s.max,
      }));
    },
    async set(id, value, actor) {
      const def = getNumberSettingDefinition(id);
      if (!def) throw new Error(`unknown number setting "${id}"`);
      const clamped = Math.min(def.max, Math.max(def.min, Math.trunc(value)));
      await store.set(id, String(clamped), actor);
      invalidate();
      return clamped;
    },
    invalidate,
  };
}
