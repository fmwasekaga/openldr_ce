import type { Kysely } from 'kysely';
import type { InternalSchema } from '@openldr/db';
import { type WorkflowSchedule, WorkflowScheduleSchema } from './types';

function fromRow(r: Record<string, unknown>): WorkflowSchedule {
  return WorkflowScheduleSchema.parse({
    workflowId: r.workflow_id, nodeId: r.node_id, cron: r.cron,
    tz: r.tz ?? null, enabled: r.enabled == null ? true : Boolean(r.enabled),
    nextDueAt: r.next_due_at ? String(r.next_due_at) : null,
  });
}

export interface WorkflowScheduleStore {
  upsert(s: WorkflowSchedule): Promise<void>;
  removeForWorkflow(workflowId: string): Promise<void>;
  list(opts: { enabledOnly?: boolean }): Promise<WorkflowSchedule[]>;
  get(workflowId: string, nodeId: string): Promise<WorkflowSchedule | undefined>;
  setNextDue(workflowId: string, nodeId: string, nextDueAt: string): Promise<void>;
}

export function createWorkflowScheduleStore(db: Kysely<InternalSchema>): WorkflowScheduleStore {
  const T = 'workflow_schedules' as const;
  return {
    async upsert(s) {
      const v = WorkflowScheduleSchema.parse(s);
      await db.deleteFrom(T).where('workflow_id', '=', v.workflowId).where('node_id', '=', v.nodeId).execute();
      await db.insertInto(T).values({
        workflow_id: v.workflowId, node_id: v.nodeId, cron: v.cron, tz: v.tz ?? null,
        enabled: v.enabled, next_due_at: v.nextDueAt ?? null,
      } as never).execute();
    },
    async removeForWorkflow(workflowId) {
      await db.deleteFrom(T).where('workflow_id', '=', workflowId).execute();
    },
    async list(opts) {
      let q = db.selectFrom(T).selectAll();
      if (opts.enabledOnly) q = q.where('enabled', '=', true);
      const rows = await q.execute();
      return rows.map((r) => fromRow(r as Record<string, unknown>));
    },
    async get(workflowId, nodeId) {
      const r = await db.selectFrom(T).selectAll().where('workflow_id', '=', workflowId).where('node_id', '=', nodeId).executeTakeFirst();
      return r ? fromRow(r as Record<string, unknown>) : undefined;
    },
    async setNextDue(workflowId, nodeId, nextDueAt) {
      await db.updateTable(T).set({ next_due_at: nextDueAt } as never).where('workflow_id', '=', workflowId).where('node_id', '=', nodeId).execute();
    },
  };
}
