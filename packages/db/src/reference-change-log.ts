import type { Kysely, Transaction } from 'kysely';
import type { InternalSchema } from './schema/internal';

// Distributed sync S2: reference-data change capture. Config stores call recordReferenceChange
// inside their own write transaction so the append to reference_change_log is atomic with the
// store write (Task 4 instruments the stores; this is the capture primitive).

export type ReferenceEntityType =
  | 'form'
  | 'dashboard'
  | 'report'
  | 'setting'
  | 'publisher'
  | 'coding_system'
  | 'term_mapping'
  | 'terminology_system'
  | 'concept_map';
export const ENTITY_TYPES: ReferenceEntityType[] = ['form', 'dashboard', 'report', 'setting'];
export type ReferenceOp = 'upsert' | 'delete';

/** Append a reference-data change to the log — but only if it differs from the entity's latest logged
 *  state (same content_hash on an upsert, or a delete after a delete → no-op; a delete of a never-logged
 *  entity → no-op). Runs inside the caller's transaction so capture is atomic with the store write. */
export async function recordReferenceChange(
  trx: Transaction<InternalSchema> | Kysely<InternalSchema>,
  entityType: ReferenceEntityType,
  entityId: string,
  op: ReferenceOp,
  contentHash: string | null,
): Promise<void> {
  const latest = await trx
    .selectFrom('reference_change_log')
    .select(['op', 'content_hash'])
    .where('entity_type', '=', entityType)
    .where('entity_id', '=', entityId)
    .orderBy('seq', 'desc')
    .limit(1)
    .executeTakeFirst();

  if (latest) {
    if (op === 'upsert' && latest.op === 'upsert' && latest.content_hash === contentHash) return; // unchanged
    if (op === 'delete' && latest.op === 'delete') return; // already tombstoned
  } else if (op === 'delete') {
    return; // nothing to tombstone
  }

  await trx
    .insertInto('reference_change_log')
    .values({ entity_type: entityType, entity_id: entityId, op, content_hash: contentHash })
    .execute();
}
