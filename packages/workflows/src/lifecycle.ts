export type Stage = 'received' | 'validated' | 'persisted' | 'pushed';
export type LifecycleStatus = 'complete' | 'stuck' | 'failed';

export interface LifecycleRun {
  id: string; workflowId: string; triggerSource: string; status: string;
  startedAt: string; finishedAt: string; error: string | null;
  result: { results?: Array<{ nodeId?: string; nodeType?: string; status?: string; meta?: unknown }> };
  correlationId?: string | null;
}
export interface LifecycleInputs {
  correlationId: string;
  runs: LifecycleRun[];
  persistedEvent: { at: string; count: number; resourceTypes: string[] } | null;
  ingestBatch: { receivedAt: string; source: string | null; status: string } | null;
}
export interface LifecycleStageEntry { stage: Stage; status: 'ok' | 'failed'; at: string; runId?: string; detail?: string; }
export interface Lifecycle { correlationId: string; status: LifecycleStatus; stages: LifecycleStageEntry[]; runIds: string[]; }

const has = (n: { nodeId?: string; nodeType?: string }, needle: string) =>
  (n.nodeType ?? '').toLowerCase().includes(needle) || (n.nodeId ?? '').toLowerCase().includes(needle);

export function buildLifecycle(input: LifecycleInputs): Lifecycle {
  const runs = [...input.runs].sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const stages: LifecycleStageEntry[] = [];
  const anyFailed = runs.some((r) => r.status === 'failed');

  const receivedAt = input.ingestBatch?.receivedAt ?? runs[0]?.startedAt;
  if (receivedAt) stages.push({ stage: 'received', status: 'ok', at: receivedAt, runId: runs[0]?.id,
    detail: input.ingestBatch?.source ?? runs[0]?.triggerSource });

  for (const r of runs) {
    const v = (r.result.results ?? []).find((n) => has(n, 'validate') && n.status === 'success');
    if (v) { stages.push({ stage: 'validated', status: 'ok', at: r.startedAt, runId: r.id }); break; }
  }

  if (input.persistedEvent) {
    stages.push({ stage: 'persisted', status: 'ok', at: input.persistedEvent.at,
      detail: `${input.persistedEvent.count} × ${input.persistedEvent.resourceTypes.join(', ') || 'resource'}` });
  }

  for (const r of runs) {
    for (const n of r.result.results ?? []) {
      if ((has(n, 'sink') || has(n, 'push')) && n.status === 'success') {
        stages.push({ stage: 'pushed', status: 'ok', at: r.finishedAt, runId: r.id, detail: n.nodeType });
      }
    }
  }

  const status: LifecycleStatus = anyFailed ? 'failed' : input.persistedEvent ? 'complete' : 'stuck';
  return { correlationId: input.correlationId, status, stages, runIds: runs.map((r) => r.id) };
}
