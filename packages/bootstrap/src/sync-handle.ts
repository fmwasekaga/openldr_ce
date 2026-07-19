import type { Kysely } from 'kysely';
import type {
  InternalSchema, SyncQuarantineRow, SyncQuarantineStore,
  SyncDivergenceRow, SyncDivergenceSummary, SyncDivergenceStore,
} from '@openldr/db';
import type { SyncRuntime } from './sync-runtime';
import type { DirectionLiveness, SyncActivityTracker } from './sync-activity-tracker';

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
  /** When this direction last attempted a cycle (ISO, in-memory), or null if it never has. */
  lastAttemptAt: string | null;
  /** When this direction last succeeded (ISO, in-memory), or null if it never has. */
  lastSuccessAt: string | null;
  /** When this direction last failed (ISO, in-memory), or null if it never has. */
  lastErrorAt: string | null;
  /** The most recent failure message (in-memory), or null if none. */
  lastError: string | null;
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
  /** PHI-FREE summaries. The dropped body requires getDivergence(). */
  listDivergences(): Promise<SyncDivergenceSummary[]>;
  /** Includes incomingBody (PHI) — callers must gate + audit. */
  getDivergence(resourceType: string, resourceId: string, version: number): Promise<SyncDivergenceRow | undefined>;
  clearDivergence(resourceType: string, resourceId: string, version: number): Promise<void>;
}

interface WorkerRef {
  isRunning(): boolean;
  trigger(): void;
}

/** A read-only live view over the sync runtime — SyncRuntime satisfies this structurally. Reading
 *  through these getters on every call (rather than capturing fixed values at construction) is what
 *  lets a Settings toggle take effect on the SAME handle instance without a restart. */
export type SyncRuntimeView = Pick<SyncRuntime,
  'isEnabled' | 'mode' | 'centralUrl' | 'siteId' | 'pushWorker' | 'pullWorker' | 'retryQuarantine'>;

export function createSyncHandle(opts: {
  db: Kysely<InternalSchema>;
  runtime: SyncRuntimeView;
  quarantine?: SyncQuarantineStore;
  /** Built UNCONDITIONALLY by the host (outside both sync gates): divergence rows are durable and must
   *  be listable on a push-only or sync-disabled node. */
  divergences?: SyncDivergenceStore;
  /** Track A: per-direction liveness summary source (in-memory). Absent = liveness fields are null. */
  activity?: Pick<SyncActivityTracker, 'summary'>;
}): SyncHandle {
  const cursorRow = (consumer: string) =>
    opts.db
      .selectFrom('fhir.change_cursors')
      .select(['last_seq', 'updated_at'])
      .where('consumer', '=', consumer)
      .executeTakeFirst();

  const toDir = (
    row: { last_seq: unknown; updated_at: unknown } | undefined,
    w: WorkerRef | undefined,
    live: DirectionLiveness,
  ): SyncDirectionStatus | null =>
    w
      ? {
          running: w.isRunning(),
          lastSeq: Number(row?.last_seq ?? 0), // bigint reads back as string on real PG
          lastSyncedAt: row?.updated_at ? new Date(row.updated_at as string | number | Date).toISOString() : null,
          ...live,
        }
      : null;

  return {
    async status(): Promise<SyncStatus> {
      const push = opts.runtime.pushWorker();
      const pull = opts.runtime.pullWorker();
      const [pushRow, pullRow] = await Promise.all([cursorRow('sync-push'), cursorRow('sync-pull')]);
      let pendingPush = 0;
      // Only a push-capable node has a backlog to report; a pull-only or disabled lab reports 0
      // without touching change_log.
      if (push) {
        const head = await opts.db
          .selectFrom('fhir.change_log')
          .select((eb) => eb.fn.max('seq').as('m'))
          .executeTakeFirst();
        pendingPush = Math.max(0, Number(head?.m ?? 0) - Number(pushRow?.last_seq ?? 0));
      }
      const emptyLive: DirectionLiveness = { lastAttemptAt: null, lastSuccessAt: null, lastErrorAt: null, lastError: null };
      const pushLive = opts.activity?.summary('push') ?? emptyLive;
      const pullLive = opts.activity?.summary('pull') ?? emptyLive;
      return {
        enabled: opts.runtime.isEnabled(),
        mode: opts.runtime.mode(),
        centralUrl: opts.runtime.centralUrl(),
        siteId: opts.runtime.siteId(),
        push: toDir(pushRow, push, pushLive),
        pull: toDir(pullRow, pull, pullLive),
        pendingPush,
      };
    },
    triggerNow(): void {
      opts.runtime.pushWorker()?.trigger();
      opts.runtime.pullWorker()?.trigger();
    },
    async listQuarantine(): Promise<SyncQuarantineRow[]> {
      return opts.quarantine ? opts.quarantine.list() : [];
    },
    async retryQuarantine(entityType: string, entityId: string): Promise<{ ok: boolean; error?: string }> {
      const fn = opts.runtime.retryQuarantine();
      if (!fn) return { ok: false, error: 'sync pull is not enabled on this node' };
      return fn(entityType, entityId);
    },
    async listDivergences(): Promise<SyncDivergenceSummary[]> {
      return opts.divergences ? opts.divergences.list() : [];
    },
    async getDivergence(resourceType, resourceId, version): Promise<SyncDivergenceRow | undefined> {
      return opts.divergences ? opts.divergences.get(resourceType, resourceId, version) : undefined;
    },
    async clearDivergence(resourceType, resourceId, version): Promise<void> {
      if (opts.divergences) await opts.divergences.clear(resourceType, resourceId, version);
    },
  };
}
