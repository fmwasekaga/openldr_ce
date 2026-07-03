import { buildLifecycle, type Lifecycle, type LifecycleRun } from '@openldr/workflows';

/** Structural view of a workflow run; `result` is widened to `unknown` so the store's
 *  own WorkflowRun type (which has `result?: unknown`) is assignable here. `buildLifecycle`
 *  reads `result.results` defensively, so the loose shape is safe. */
export type ActivityRun = Omit<LifecycleRun, 'result'> & { result?: unknown };

export interface ActivityDeps {
  runs: {
    listByCorrelation(id: string): Promise<ActivityRun[]>;
    listCorrelations(opts?: { limit?: number; offset?: number }): Promise<Array<{ correlationId: string; latestAt: string; latestStatus: string; workflowId: string }>>;
  };
  batches: { get(batchId: string): Promise<{ created_at?: unknown; source?: unknown; status?: unknown } | null | undefined> };
  /** Reads the data.persisted event for a batch from outbox_events (null if not yet persisted). */
  persistedEvent(correlationId: string): Promise<{ at: string; count: number; resourceTypes: string[] } | null>;
}

export interface RecentPayload { correlationId: string; workflowId: string; source: string | null; startedAt: string; currentStage: string; status: string; }

export interface ActivityService {
  getLifecycle(correlationId: string): Promise<Lifecycle | null>;
  listRecent(opts?: { limit?: number; offset?: number }): Promise<RecentPayload[]>;
}

export function createActivityService(deps: ActivityDeps): ActivityService {
  async function assemble(correlationId: string): Promise<Lifecycle | null> {
    const runs = await deps.runs.listByCorrelation(correlationId);
    const batchRow = await deps.batches.get(correlationId);
    const persistedEvent = await deps.persistedEvent(correlationId);
    if (runs.length === 0 && !batchRow) return null;
    const ingestBatch = batchRow
      ? { receivedAt: String(batchRow.created_at ?? runs[0]?.startedAt ?? ''), source: (batchRow.source as string) ?? null, status: String(batchRow.status ?? '') }
      : null;
    return buildLifecycle({ correlationId, runs: runs as LifecycleRun[], persistedEvent, ingestBatch });
  }
  return {
    getLifecycle: assemble,
    async listRecent(opts) {
      const heads = await deps.runs.listCorrelations(opts);
      const out: RecentPayload[] = [];
      for (const h of heads) {
        const lc = await assemble(h.correlationId);
        const last = lc?.stages[lc.stages.length - 1];
        out.push({ correlationId: h.correlationId, workflowId: h.workflowId,
          source: last?.detail ?? null, startedAt: h.latestAt,
          currentStage: last?.stage ?? 'received', status: lc?.status ?? 'stuck' });
      }
      return out;
    },
  };
}
