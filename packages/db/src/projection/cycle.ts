import type { Kysely } from 'kysely';
import type { InternalSchema } from '../schema/internal';
import type { FhirStore } from '../fhir-store';
import type { RelationalWriter } from '../relational-writer';
import { planProjection, type ProjectionTask, type Gap } from './plan';
import { readCursor, advanceCursor } from './cursor';
import type { SafeFetchResult } from './fetch';

export type FetchSafeRows = (db: Kysely<InternalSchema>, cursor: number, limit: number) => Promise<SafeFetchResult>;

export interface Logger { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; debug(o: unknown, m?: string): void; }

export interface ProjectionDeps {
  internalDb: Kysely<InternalSchema>;
  fhirStore: FhirStore;
  relationalWriter: RelationalWriter;
  logger: Logger;
  fetch: FetchSafeRows;
  batchSize?: number;
}

export interface ProjectionRunner {
  runCycle(): Promise<number>;
}

async function applyProjection(task: ProjectionTask, deps: ProjectionDeps): Promise<void> {
  // getWithProvenance, not get: the projected row must carry the canonical row's
  // source_system/plugin_id/plugin_version/batch_id, or the read model cannot say
  // which producer or which run wrote it.
  const found = await deps.fhirStore.getWithProvenance(task.resourceType, task.id);
  if (found) {
    await deps.relationalWriter.write(found.resource, found.provenance);
  } else {
    await deps.relationalWriter.deleteById(task.resourceType, task.id);
  }
}

/** A stateful projection runner. `pendingGaps` (seq→x0) is carried across ticks in-memory so the
 *  safe-frontier can confirm rolled-back gaps once the xmin boundary advances. Each cycle: fetch safe
 *  rows + snapshot bounds, plan, apply each (current-state, idempotent), advance the cursor. A failing
 *  apply is logged and skipped (reprojectAll can heal). Returns the number of resources projected. */
export function createProjectionRunner(deps: ProjectionDeps): ProjectionRunner {
  let pendingGaps: Gap[] = [];
  return {
    async runCycle(): Promise<number> {
      const cursor = await readCursor(deps.internalDb, 'projection');
      const { rows, boundary, xmax } = await deps.fetch(deps.internalDb, cursor, deps.batchSize ?? 500);
      const plan = planProjection({ rows, boundary, xmax, cursor, pendingGaps });
      pendingGaps = plan.pendingGaps;
      for (const task of plan.tasks) {
        try {
          await applyProjection(task, deps);
        } catch (err) {
          deps.logger.error({ err, task }, 'projection apply failed; skipping (reprojectAll can heal)');
        }
      }
      if (plan.newCursor > cursor) await advanceCursor(deps.internalDb, 'projection', plan.newCursor);
      return plan.tasks.length;
    },
  };
}

/** Rebuild the read-model from the canonical store, then set the cursor to the current max seq. */
export async function reprojectAll(deps: Pick<ProjectionDeps, 'internalDb' | 'relationalWriter'>): Promise<number> {
  const maxRow = await deps.internalDb
    .selectFrom('fhir.change_log')
    .select((eb) => eb.fn.max('seq').as('m'))
    .executeTakeFirst();
  const maxSeq = maxRow?.m != null ? Number(maxRow.m) : 0;

  let projected = 0;
  const page = 1000;
  let offset = 0;
  for (;;) {
    const rows = await deps.internalDb
      .selectFrom('fhir.fhir_resources')
      .select('resource')
      .orderBy('resource_type')
      .orderBy('id')
      .limit(page)
      .offset(offset)
      .execute();
    if (rows.length === 0) break;
    // reprojectAll's SELECT only fetches `resource` (see above), not the provenance
    // columns, so there is nothing to carry here. `{}` is explicit rather than a
    // default — same as before this slice made provenance required — and is out of
    // scope to fix: that would mean re-fetching provenance for every row in a full
    // rebuild, a separate change from the deferred-projection bug this slice targets.
    await deps.relationalWriter.writeMany(rows.map((r) => ({ resource: r.resource, provenance: {} })));
    projected += rows.length;
    offset += rows.length;
    if (rows.length < page) break;
  }
  await advanceCursor(deps.internalDb, 'projection', maxSeq);
  return projected;
}
