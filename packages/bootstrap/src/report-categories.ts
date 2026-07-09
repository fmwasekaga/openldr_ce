import { ReportCategoryListSchema, type ReportCategoryList } from '@openldr/reporting';
import type { AppSettingStore } from '@openldr/db';

/** app_settings key backing the global, editable report-category list. */
export const REPORT_CATEGORIES_SETTING_KEY = 'report.categories';

export interface ReportCategoriesService {
  /** The current global category list (id/label/order), or [] if never set. */
  list(): Promise<ReportCategoryList>;
  /** Validate + persist the full list (replaces any prior value). */
  save(categories: ReportCategoryList, actor?: string | null): Promise<void>;
}

/**
 * DB-backed store for the global, editable report-category list, mirroring
 * createFeatureFlags/createNumberSettings — shares the app_settings store, JSON-encoded under a
 * single key. Unlike those two (registry-backed, single values), this setting IS the whole list,
 * so there's no per-id registry default: an unset setting simply means "no categories yet"
 * (the bootstrap seed writes the initial default list on first boot — see seed.ts).
 */
export function createReportCategoriesService(store: Pick<AppSettingStore, 'get' | 'set'>): ReportCategoriesService {
  return {
    async list() {
      const row = await store.get(REPORT_CATEGORIES_SETTING_KEY);
      if (!row) return [];
      let raw: unknown;
      try {
        raw = JSON.parse(row.value);
      } catch {
        return [];
      }
      const parsed = ReportCategoryListSchema.safeParse(raw);
      return parsed.success ? parsed.data : [];
    },
    async save(categories, actor = null) {
      const validated = ReportCategoryListSchema.parse(categories);
      await store.set(REPORT_CATEGORIES_SETTING_KEY, JSON.stringify(validated), actor);
    },
  };
}
