import type { FormField } from './schema/form-schema';

/** How a page's Save handler reads form fields. */
export type PageMatch = 'apiProperty' | 'fieldId';

export interface PageTarget {
  /** Stable page id stored in a template's `targetPages`. */
  id: string;
  /** Human label shown in the builder picker + chooser. */
  label: string;
  /** Dimension the page's Save handler keys fields by. */
  match: PageMatch;
  /** Keys (by `match`) the page needs to persist a non-broken record. */
  requiredKeys: string[];
  /**
   * Whether the destination page actually exists yet. Only `available` targets are
   * offered in the builder picker; the rest are kept here to preserve their persist
   * contract for when those pages ship.
   */
  available: boolean;
}

/**
 * The pages a template can target. Order here is the order shown in the builder
 * picker. `requiredKeys` are derived from each page's persist layer:
 * - forms:      no required keys (form templates are self-contained)
 * - users:      UserDialog CORE identity fields (firstName/lastName/email). OpenLDR role
 *               assignment is a dedicated control outside the template (getUserRoles/
 *               setUserRoles), not an apiProperty a template needs to define.
 * - facilities: facilities table — only `name` is NOT NULL
 * - patients:   Patient record — firstName/lastName/dateOfBirth/sex are required
 * - orders:     Lab order — patient reference + tests reference are required
 */
export const PAGE_TARGETS: readonly PageTarget[] = [
  { id: 'forms', label: 'Forms', match: 'fieldId', requiredKeys: [], available: true },
  { id: 'users', label: 'Users', match: 'apiProperty', requiredKeys: ['firstName', 'lastName', 'email'], available: true },
  // Not available yet — these pages don't exist. Kept for their persist contract; flip
  // `available` to true when the page ships.
  { id: 'facilities', label: 'Facilities', match: 'apiProperty', requiredKeys: ['name'], available: false },
  { id: 'patients', label: 'Patients', match: 'apiProperty', requiredKeys: ['firstName', 'lastName', 'dateOfBirth', 'sex'], available: false },
  { id: 'orders', label: 'Orders', match: 'fieldId', requiredKeys: ['patient', 'tests'], available: false },
];

/** Targets whose destination page exists today — the only ones offered for new selection. */
export const AVAILABLE_PAGE_TARGETS: readonly PageTarget[] = PAGE_TARGETS.filter((p) => p.available);

export function getPageTarget(id: string): PageTarget | undefined {
  return PAGE_TARGETS.find((p) => p.id === id);
}

export interface TargetContractViolation {
  pageId: string;
  pageLabel: string;
  missing: string[];
}

function fieldKey(field: FormField, match: PageMatch): string | undefined {
  if (match === 'apiProperty') return field.apiProperty ?? undefined;
  return field.id;
}

/**
 * For each target page, the requiredKeys not covered by any ENABLED field
 * (matched by that page's `match` dimension). Pages with no missing keys are
 * omitted. Unknown page ids are ignored.
 */
export function validateTemplateTargets(
  targetPages: string[],
  fields: FormField[],
): TargetContractViolation[] {
  const out: TargetContractViolation[] = [];
  for (const pageId of targetPages) {
    const page = getPageTarget(pageId);
    if (!page) continue;
    const present = new Set(
      fields
        .filter((f) => f.enabled)
        .map((f) => fieldKey(f, page.match))
        .filter((k): k is string => !!k),
    );
    const missing = page.requiredKeys.filter((k) => !present.has(k));
    if (missing.length > 0) out.push({ pageId: page.id, pageLabel: page.label, missing });
  }
  return out;
}
