import type { AppSettingStore } from '@openldr/db';
import type { StrictnessLevel } from '@openldr/fhir';

export const VALIDATION_STRICTNESS_KEY = 'validation.strictness';
const LEVELS: StrictnessLevel[] = ['low', 'medium', 'high'];
const DEFAULT: StrictnessLevel = 'high';

export interface ValidationStrictness {
  get(): Promise<StrictnessLevel>;
  set(level: StrictnessLevel, actor: string | null): Promise<void>;
}

export function createValidationStrictness(store: AppSettingStore): ValidationStrictness {
  return {
    async get() {
      const row = await store.get(VALIDATION_STRICTNESS_KEY);
      const v = row?.value as StrictnessLevel | undefined;
      return v && LEVELS.includes(v) ? v : DEFAULT;
    },
    async set(level, actor) {
      if (!LEVELS.includes(level)) throw new Error(`invalid strictness "${level}"`);
      await store.set(VALIDATION_STRICTNESS_KEY, level, actor);
    },
  };
}
