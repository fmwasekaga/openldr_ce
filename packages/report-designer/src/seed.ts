import type { ReportDesign } from './schema';
import type { ReportDesignStore } from './store';

/**
 * Default report designs. These replace the studio's former `MOCK_TEMPLATES` as the durable
 * defaults; their `id`s are stable (used for idempotency and the studio deep-link route).
 *
 * Empty as of Slice S5 (docs/superpowers/plans/2026-07-09-reports-template-linking.md) — the 3
 * demo designs below (`RETIRED_DEMO_DESIGN_IDS`) are no longer seeded on a fresh install now that
 * the built-in reports are data-driven (query + template) with their own seeded designs (see
 * `@openldr/reporting`'s `report-seeds.ts`). Kept as an extension point for future non-demo
 * default designs.
 */
export const SEED_DESIGNS: ReportDesign[] = [];

/**
 * The 3 former demo designs (`rt-amr-summary`, `rt-monthly-caseload`, `rt-lab-tat`), retired from
 * `SEED_DESIGNS` in Slice S5. Kept here only as the target list for `removeRetiredDemoDesigns`'s
 * one-shot cleanup on existing installs that already seeded them.
 */
export const RETIRED_DEMO_DESIGN_IDS = ['rt-amr-summary', 'rt-monthly-caseload', 'rt-lab-tat'] as const;

/** Idempotently insert the default designs. Returns how many were newly created. */
export async function seedReportDesigns(store: Pick<ReportDesignStore, 'get' | 'create'>): Promise<number> {
  let n = 0;
  for (const d of SEED_DESIGNS) {
    if (!(await store.get(d.id))) {
      await store.create(d);
      n += 1;
    }
  }
  return n;
}

/**
 * One-shot idempotent cleanup for existing installs that seeded the 3 retired demo designs before
 * Slice S5 removed them from `SEED_DESIGNS`. Deletes each `RETIRED_DEMO_DESIGN_IDS` entry ONLY IF
 * no `reports` record's `designId` still references it (a user may have linked one of the demo
 * designs to a report before the cutover — never delete a design that's in use). No-ops entirely
 * on a fresh install (the designs were never created). Logs what it removes/skips. Returns the
 * count actually removed.
 */
export async function removeRetiredDemoDesigns(
  store: Pick<ReportDesignStore, 'get' | 'remove'>,
  reportDefs: { list(): Promise<{ designId: string }[]> },
): Promise<number> {
  const referencedDesignIds = new Set((await reportDefs.list()).map((r) => r.designId));
  let removed = 0;
  for (const id of RETIRED_DEMO_DESIGN_IDS) {
    if (referencedDesignIds.has(id)) {
      console.log(`[seed] retired demo design "${id}" is referenced by a report record — keeping it`);
      continue;
    }
    const existing = await store.get(id);
    if (!existing) continue; // already removed, or never seeded on this install
    await store.remove(id);
    removed += 1;
    console.log(`[seed] removed retired demo design "${id}"`);
  }
  return removed;
}
