import { randomUUID } from 'node:crypto';
import type { EventingPort } from '@openldr/ports';
import type { WorkflowStore } from './store';
import type { WorkflowRunStore } from './run-store';
import type { WorkflowScheduleStore } from './schedule-store';
import type { WebhookRegistry } from './webhook-registry';
import type { runWorkflow as RunWorkflowFn } from './engine/run-workflow';
import { WorkflowDefinitionSchema, type TriggerSource, type WorkflowRun } from './types';
import { nextCronDate } from './cron';

interface RunnerDeps {
  store: Pick<WorkflowStore, 'get'>;
  runs: WorkflowRunStore;
  schedules: Pick<WorkflowScheduleStore, 'get' | 'list' | 'setNextDue'>;
  webhooks: Pick<WebhookRegistry, 'resolve'>;
  runWorkflow: typeof RunWorkflowFn;
  logger: { error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
}

const SCHEDULE_DUE = 'workflow.schedule.due';
const INGEST_DONE = 'ingest.batch.done';

export interface WorkflowTriggerRunner {
  registerRunner(eventing: EventingPort): Promise<void>;
  reconcile(eventing: EventingPort): Promise<void>;
  setIngestWorkflowIds(ids: string[]): void;
  runAndRecord(workflowId: string, source: TriggerSource, input: unknown): Promise<void>;
}

export function createWorkflowTriggerRunner(deps: RunnerDeps): WorkflowTriggerRunner {
  let ingestIds = new Set<string>();

  async function runAndRecord(workflowId: string, source: TriggerSource, input: unknown): Promise<void> {
    const wf = await deps.store.get(workflowId);
    if (!wf || !wf.enabled) return;
    const def = WorkflowDefinitionSchema.parse(wf.definition);
    let result: Awaited<ReturnType<typeof deps.runWorkflow>>;
    let error: string | null = null;
    try {
      result = await deps.runWorkflow(def.nodes, def.edges, { input });
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      result = {
        status: 'failed' as const,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        results: [],
      };
    }
    const run: WorkflowRun = {
      id: randomUUID(),
      workflowId,
      triggerSource: source,
      status: result.status,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      result,
      error,
    };
    await deps.runs.record(run);
  }

  async function arm(
    eventing: EventingPort,
    workflowId: string,
    nodeId: string,
    cron: string,
    tz: string | null,
  ): Promise<void> {
    const due = nextCronDate(cron, tz, new Date());
    await deps.schedules.setNextDue(workflowId, nodeId, due.toISOString());
    await eventing.publish({ type: SCHEDULE_DUE, payload: { workflowId, nodeId } }, { availableAt: due });
  }

  return {
    setIngestWorkflowIds(ids) {
      ingestIds = new Set(ids);
    },

    runAndRecord,

    async registerRunner(eventing) {
      await eventing.subscribe(SCHEDULE_DUE, async (event) => {
        const { workflowId, nodeId } = event.payload as { workflowId: string; nodeId: string };
        const s = await deps.schedules.get(workflowId, nodeId);
        if (!s || !s.enabled) return;
        await runAndRecord(workflowId, 'schedule', { scheduledAt: new Date().toISOString() });
        // Re-fetch after the run so a mid-run disable/edit is honored when re-arming.
        const after = await deps.schedules.get(workflowId, nodeId);
        if (!after || !after.enabled) return;
        try {
          await arm(eventing, workflowId, nodeId, after.cron, after.tz);
        } catch (err) {
          deps.logger.error({ err, workflowId, nodeId }, 'workflow schedule re-arm failed');
        }
      });

      await eventing.subscribe(INGEST_DONE, async (event) => {
        for (const workflowId of ingestIds) {
          await runAndRecord(workflowId, 'ingest', event.payload).catch((err) =>
            deps.logger.error({ err, workflowId }, 'ingest-triggered workflow run failed'),
          );
        }
      });
    },

    async reconcile(eventing) {
      const now = Date.now();
      for (const s of await deps.schedules.list({ enabledOnly: true })) {
        // Skip schedules already armed for a future time — avoids duplicate runs on restart.
        if (s.nextDueAt && new Date(s.nextDueAt).getTime() > now) continue;
        try {
          await arm(eventing, s.workflowId, s.nodeId, s.cron, s.tz);
        } catch (err) {
          deps.logger.error(
            { err, workflowId: s.workflowId, nodeId: s.nodeId },
            'workflow schedule arm failed',
          );
        }
      }
    },
  };
}
