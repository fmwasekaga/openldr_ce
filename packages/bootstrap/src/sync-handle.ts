import type { Kysely } from 'kysely';
import type { InternalSchema, SyncQuarantineRow, SyncQuarantineStore } from '@openldr/db';

// Sync S4 (Task 5): a read/trigger handle over the two sync directions, always present on AppContext
// (even when sync is disabled). status() reflects each worker's live isRunning() plus its cursor
// position (fhir.change_cursors), and — for the push direction only — how far the change_log head is
// ahead of the pushed cursor (pendingPush). triggerNow() nudges whichever workers exist. This lets a
// status endpoint / CLI (Task 6) render uniformly without knowing the mode gate's internals.

export type SyncMode = 'push' | 'pull' | 'bidirectional';

export interface SyncDirectionStatus {
  /** The worker's live loop state (start()ed and not stop()ped). */
  running: boolean;
  /** The direction's cursor position (last consumed change_log seq). */
  lastSeq: number;
  /** When the cursor last advanced (ISO), or null if it never has. */
  lastSyncedAt: string | null;
}

export interface SyncStatus {
  enabled: boolean;
  mode: SyncMode;
  centralUrl: string;
  siteId: string;
  /** Null when the push worker isn't running this boot (pull-only or disabled). */
  push: SyncDirectionStatus | null;
  /** Null when the pull worker isn't running this boot (push-only or disabled). */
  pull: SyncDirectionStatus | null;
  /** change_log head minus the push cursor. 0 when no push worker exists (never queried pointlessly). */
  pendingPush: number;
}

export interface SyncHandle {
  status(): Promise<SyncStatus>;
  triggerNow(): void;
  listQuarantine(): Promise<SyncQuarantineRow[]>;
  retryQuarantine(entityType: string, entityId: string): Promise<{ ok: boolean; error?: string }>;
}

interface WorkerRef {
  isRunning(): boolean;
  trigger(): void;
}

export function createSyncHandle(opts: {
  db: Kysely<InternalSchema>;
  enabled: boolean;
  mode: SyncMode;
  centralUrl: string;
  siteId: string;
  pushWorker?: WorkerRef;
  pullWorker?: WorkerRef;
  quarantine?: SyncQuarantineStore;
  retryQuarantine?: (entityType: string, entityId: string) => Promise<{ ok: boolean; error?: string }>;
}): SyncHandle {
  const cursorRow = (consumer: string) =>
    opts.db
      .selectFrom('fhir.change_cursors')
      .select(['last_seq', 'updated_at'])
      .where('consumer', '=', consumer)
      .executeTakeFirst();

  const toDir = (
    row: { last_seq: unknown; updated_at: unknown } | undefined,
    w?: WorkerRef,
  ): SyncDirectionStatus | null =>
    w
      ? {
          running: w.isRunning(),
          lastSeq: Number(row?.last_seq ?? 0), // bigint reads back as string on real PG
          lastSyncedAt: row?.updated_at ? new Date(row.updated_at as string | number | Date).toISOString() : null,
        }
      : null;

  return {
    async status(): Promise<SyncStatus> {
      const [pushRow, pullRow] = await Promise.all([cursorRow('sync-push'), cursorRow('sync-pull')]);
      let pendingPush = 0;
      // Only a push-capable node has a backlog to report; a pull-only or disabled lab reports 0
      // without touching change_log.
      if (opts.pushWorker) {
        const head = await opts.db
          .selectFrom('fhir.change_log')
          .select((eb) => eb.fn.max('seq').as('m'))
          .executeTakeFirst();
        pendingPush = Math.max(0, Number(head?.m ?? 0) - Number(pushRow?.last_seq ?? 0));
      }
      return {
        enabled: opts.enabled,
        mode: opts.mode,
        centralUrl: opts.centralUrl,
        siteId: opts.siteId,
        push: toDir(pushRow, opts.pushWorker),
        pull: toDir(pullRow, opts.pullWorker),
        pendingPush,
      };
    },
    triggerNow(): void {
      opts.pushWorker?.trigger();
      opts.pullWorker?.trigger();
    },
    async listQuarantine(): Promise<SyncQuarantineRow[]> {
      return opts.quarantine ? opts.quarantine.list() : [];
    },
    async retryQuarantine(entityType: string, entityId: string): Promise<{ ok: boolean; error?: string }> {
      if (!opts.retryQuarantine) return { ok: false, error: 'sync pull is not enabled on this node' };
      return opts.retryQuarantine(entityType, entityId);
    },
  };
}
