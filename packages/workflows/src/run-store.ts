import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type WorkflowRun, WorkflowRunSchema } from './types';

function toRow(r: WorkflowRun) {
  return {
    id: r.id, workflow_id: r.workflowId, trigger_source: r.triggerSource, status: r.status,
    started_at: r.startedAt, finished_at: r.finishedAt,
    result: JSON.stringify(r.result ?? null), error: r.error ?? null,
  };
}
function fromRow(r: Record<string, unknown>): WorkflowRun {
  const parse = (v: unknown) => (typeof v === 'string' ? JSON.parse(v) : (v ?? null));
  return WorkflowRunSchema.parse({
    id: r.id, workflowId: r.workflow_id, triggerSource: r.trigger_source, status: r.status,
    startedAt: String(r.started_at), finishedAt: String(r.finished_at),
    result: parse(r.result), error: r.error ?? null,
  });
}

export interface WorkflowRunStore {
  record(run: WorkflowRun): Promise<void>;
  list(workflowId: string, opts?: { limit?: number; offset?: number }): Promise<WorkflowRun[]>;
  get(id: string): Promise<WorkflowRun | undefined>;
}

export function createWorkflowRunStore(db: Kysely<InternalSchema>): WorkflowRunStore {
  return {
    async record(run) {
      await db.insertInto('workflow_runs').values(toRow(WorkflowRunSchema.parse(run)) as never).execute();
    },
    async list(workflowId, opts = {}) {
      const rows = await db.selectFrom('workflow_runs').selectAll()
        .where('workflow_id', '=', workflowId)
        .orderBy('started_at', 'desc')
        .limit(opts.limit ?? 50).offset(opts.offset ?? 0).execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(id) {
      const r = await db.selectFrom('workflow_runs').selectAll().where('id', '=', id).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
  };
}
