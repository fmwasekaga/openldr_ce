/**
 * Declarative registry of admin-tunable NUMBER settings (operational limits). Parallels the
 * boolean FEATURE_FLAGS registry: adding an entry wires it into the DB-backed settings store
 * and the Settings → General "Limits & tuning" UI. Values live in `app_settings` keyed by id.
 *
 * Only operational, non-security tunables belong here — anything that changes the trust boundary
 * (who can do what) stays an operator-controlled env var. See the migration notes in schema.ts.
 */
export interface NumberSettingDefinition {
  /** Stable key stored in app_settings.key. */
  id: string;
  /** i18n key for the human label (resolved in apps/studio). */
  labelKey: string;
  /** i18n key for the description. */
  descriptionKey: string;
  /** Default when no stored override exists. */
  default: number;
  /** Inclusive bounds; stored values are clamped into range on read. */
  min: number;
  max: number;
}

export const NUMBER_SETTINGS: readonly NumberSettingDefinition[] = [
  {
    id: 'dashboard.sql_timeout_ms',
    labelKey: 'settings.general.numbers.dashboardSqlTimeoutMs.label',
    descriptionKey: 'settings.general.numbers.dashboardSqlTimeoutMs.description',
    default: 5000,
    min: 100,
    max: 600_000,
  },
  {
    id: 'dashboard.sql_row_cap',
    labelKey: 'settings.general.numbers.dashboardSqlRowCap.label',
    descriptionKey: 'settings.general.numbers.dashboardSqlRowCap.description',
    default: 10_000,
    min: 1,
    max: 1_000_000,
  },
  {
    id: 'marketplace.max_payload_bytes',
    labelKey: 'settings.general.numbers.marketplaceMaxPayloadBytes.label',
    descriptionKey: 'settings.general.numbers.marketplaceMaxPayloadBytes.description',
    default: 67_108_864,
    min: 1_024,
    max: 536_870_912,
  },
];

export type NumberSettingId = (typeof NUMBER_SETTINGS)[number]['id'];

export function getNumberSettingDefinition(id: string): NumberSettingDefinition | undefined {
  return NUMBER_SETTINGS.find((s) => s.id === id);
}

/** Coerce a stored string to an integer within [min,max]; unknown/invalid falls back to `def`. */
export function parseNumberSetting(
  value: string | undefined | null,
  def: NumberSettingDefinition,
): number {
  if (value == null || value === '') return def.default;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return def.default;
  return Math.min(def.max, Math.max(def.min, n));
}
