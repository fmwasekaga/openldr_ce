import type { SyncQuarantineStore } from '@openldr/db';
import type { TerminologyBulkSync } from '@openldr/sync';

// Sync S7-A: operator-triggered re-sync of a quarantined bulk terminology entity, independent of the
// (already-advanced) 'sync-pull' cursor. Extracted from createAppContext so its failure/ordering
// contract is directly testable — the guarantees below are subtle and each one closes a real defect.
export interface RetryQuarantineDeps {
  quarantine: SyncQuarantineStore;
  termBulk: TerminologyBulkSync;
  /** Consecutive-failure count at which a re-recorded failure flips the row to 'quarantined'. */
  threshold: number;
}

export type RetryQuarantine = (
  entityType: string,
  entityId: string,
) => Promise<{ ok: boolean; error?: string }>;

/** Retry a quarantined bulk entity. Contract:
 *   - REFUSES an entity with no quarantine row. Retry is only meaningful for a tracked entity; without a
 *     row there is no descriptor to replay, and reconciling with an empty one would stamp
 *     version:null / resource_id:'' / generation:0 over a HEALTHY system (terminology-sync has no early
 *     return). Callers only validate that the strings are non-empty, so this guard is the real gate.
 *   - REPLAYS the stored body — central's real descriptor for the entity — so the reconcile's
 *     terminology_systems stamp stays faithful.
 *   - Re-syncs FIRST and clears ONLY on success: clearing up front would lose all operator visibility if
 *     the process died mid-retry.
 *   - On failure leaves the row intact and re-records from its real history (last_seq / stored body), so
 *     attempts keeps climbing rather than resetting to attempts:1 / seq:0 and discarding
 *     first_failed_at / quarantined_at. */
export function createRetryQuarantine(deps: RetryQuarantineDeps): RetryQuarantine {
  const { quarantine, termBulk, threshold } = deps;
  return async (entityType, entityId) => {
    const row = await quarantine.get(entityType, entityId);
    // BEFORE the re-sync so a refusal writes nothing at all.
    if (!row) return { ok: false, error: `not quarantined: ${entityType} ${entityId}` };
    try {
      if (entityType === 'terminology_system') await termBulk.syncSystem(entityId, row.lastBody);
      else if (entityType === 'concept_map') await termBulk.syncConceptMap(entityId, row.lastBody);
      else return { ok: false, error: `not a retriable bulk entity type: ${entityType}` };
      await quarantine.clear(entityType, entityId); // healed → the row goes away
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      await quarantine.recordFailure(entityType, entityId, {
        seq: row.lastSeq ?? 0,
        error: msg,
        body: row.lastBody,
        threshold,
      });
      return { ok: false, error: msg };
    }
  };
}
