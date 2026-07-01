/**
 * Declarative registry of admin-toggleable feature flags. Adding a flag here wires it into
 * both the DB seed (defaults) and the Settings → General Feature-Flags UI (label/description
 * are i18n keys resolved in apps/studio). Values live in the `app_settings` table keyed by id.
 */
export interface FeatureFlagDefinition {
  /** Stable key stored in app_settings.key. */
  id: string;
  /** i18n key for the human label (resolved in apps/studio). */
  labelKey: string;
  /** i18n key for the description of what enabling does. */
  descriptionKey: string;
  /** Default when no stored override exists. */
  default: boolean;
}

export const FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [
  {
    id: 'dashboard.raw_sql',
    labelKey: 'settings.general.flags.dashboardRawSql.label',
    descriptionKey: 'settings.general.flags.dashboardRawSql.description',
    default: false,
  },
];

export type FeatureFlagId = (typeof FEATURE_FLAGS)[number]['id'];

export function getFlagDefinition(id: string): FeatureFlagDefinition | undefined {
  return FEATURE_FLAGS.find((f) => f.id === id);
}

/** Coerce a stored string value to boolean; unknown/absent falls back to `def`. */
export function parseFlagValue(value: string | undefined | null, def: boolean): boolean {
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return def;
}
