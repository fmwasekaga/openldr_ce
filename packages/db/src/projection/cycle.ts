import type { Kysely } from 'kysely';
import type { InternalSchema } from '../schema/internal';
import type { FhirStore } from '../fhir-store';
import type { FlatWriter } from '../flat-writer';
import { planProjection, type ProjectionTask } from './plan';
import { readCursor, advanceCursor } from './cursor';
import type { SafeFetchResult } from './fetch';

export type FetchSafeRows = (db: Kysely<InternalSchema>, cursor: number, limit: number) => Promise<SafeFetchResult>;

export interface Logger { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void; debug(o: unknown, m?: string): void; }

export interface ProjectionDeps {
  internalDb: Kysely<InternalSchema>;
  fhirStore: FhirStore;
  flatWriter: FlatWriter;
  logger: Logger;
  fetch: FetchSafeRows;
  batchSize?: number;
}

async function applyProjection(task: ProjectionTask, deps: ProjectionDeps): Promise<void> {
  const canonical = await deps.fhirStore.get(task.resourceType, task.id);
  if (canonical) await deps.flatWriter.write(canonical);
  else await deps.flatWriter.deleteById(task.resourceType, task.id);
}

/** One projection cycle: fetch safe rows, plan, apply each (current-state, idempotent), advance cursor.
 *  Returns the number of resources projected. A failing apply is logged and skipped (reprojectAll heals). */
export async function runProjectionCycle(deps: ProjectionDeps): Promise<number> {
  const cursor = await readCursor(deps.internalDb, 'projection');
  const { rows, boundary } = await deps.fetch(deps.internalDb, cursor, deps.batchSize ?? 500);
  const { tasks, newCursor } = planProjection(rows, boundary, cursor);
  for (const task of tasks) {
    try {
      await applyProjection(task, deps);
    } catch (err) {
      deps.logger.error({ err, task }, 'projection apply failed; skipping (reprojectAll can heal)');
    }
  }
  if (newCursor > cursor) await advanceCursor(deps.internalDb, 'projection', newCursor);
  return tasks.length;
}

/** Rebuild the read-model from the canonical store, then set the cursor to the current max seq. */
export async function reprojectAll(deps: Pick<ProjectionDeps, 'internalDb' | 'flatWriter'>): Promise<number> {
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
    await deps.flatWriter.writeMany(rows.map((r) => ({ resource: r.resource })));
    projected += rows.length;
    offset += rows.length;
    if (rows.length < page) break;
  }
  await advanceCursor(deps.internalDb, 'projection', maxSeq);
  return projected;
}
