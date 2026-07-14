import type { Transaction, Kysely } from 'kysely';
import type { InternalSchema } from './schema/internal';
import type { ReferenceEntityType, ReferenceOp } from './reference-change-log';
import { recordReferenceChange } from './reference-change-log';

/** Injected into a config store so its writes are captured into reference_change_log, atomically. */
export interface ReferenceCapture {
  record(
    trx: Transaction<InternalSchema> | Kysely<InternalSchema>,
    entityType: ReferenceEntityType,
    entityId: string,
    op: ReferenceOp,
    contentHash: string | null,
  ): Promise<void>;
}

/** Default binding — stores depend on the interface, not the helper directly. */
export const referenceCapture: ReferenceCapture = { record: recordReferenceChange };

/**
 * Center-owned app_settings keys that propagate to labs. Everything else (esp. `sync.*`) is
 * lab-local and MUST NOT be captured/pulled. Keep explicit + small: only feature flags that a
 * central authoring node owns for the whole fleet belong here. `dashboard.raw_sql` is the SQL
 * authoring gate — its state is a center policy decision. (Mirrors @openldr/config FEATURE_FLAGS,
 * but hardcoded here so @openldr/db does not depend on @openldr/config.)
 */
export const CENTER_OWNED_SETTING_KEYS: ReadonlySet<string> = new Set<string>([
  'dashboard.raw_sql',
]);
