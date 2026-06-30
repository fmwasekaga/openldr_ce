import { randomUUID } from 'node:crypto';
import type { EventingPort } from '@openldr/ports';
import type { WorkflowStore } from './store';
import type { WorkflowRunStore } from './run-store';
import type { WorkflowScheduleStore } from './schedule-store';
import type { WebhookRegistry } from './webhook-registry';
import type { runWorkflow as RunWorkflowFn } from './engine/run-workflow';
import type { WorkflowServices } from './engine/services';
import type { CodeLimits } from './engine/execution-context';
import type { BinaryRef } from './engine/items';
import { WorkflowDefinitionSchema, type TriggerSource, type WorkflowRun } from './types';
import { nextCronDate } from './cron';

interface RunnerDeps {
  store: Pick<WorkflowStore, 'get'>;
  runs: WorkflowRunStore;
  schedules: Pick<WorkflowScheduleStore, 'get' | 'list' | 'setNextDue'>;
  webhooks: Pick<WebhookRegistry, 'resolve'>;
  runWorkflow: typeof RunWorkflowFn;
  logger: { error(o: unknown, m?: string): void; warn(o: unknown, m?: string): void };
  codeLimits?: CodeLimits;
  services?: WorkflowServices;
}

const SCHEDULE_DUE = 'workflow.schedule.due';
const INGEST_DONE = 'ingest.batch.done';
const DATA_PERSISTED = 'data.persisted';

export interface WorkflowTriggerRunner {
  registerRunner(eventing: EventingPort): Promise<void>;
  reconcile(eventing: EventingPort): Promise<void>;
  setIngestWorkflowIds(ids: string[]): void;
  setEventWorkflowIds(ids: string[]): void;
  runAndRecord(workflowId: string, source: TriggerSource, input: unknown, files?: Record<string, BinaryRef>): Promise<void>;
}

export function createWorkflowTriggerRunner(deps: RunnerDeps): WorkflowTriggerRunner {
  let ingestIds = new Set<string>();
  let eventIds = new Set<string>();

  async function runAndRecord(workflowId: string, source: TriggerSource, input: unknown, files?: Record<string, BinaryRef>): Promise<void> {
    const wf = await deps.store.get(workflowId);
    if (!wf || !wf.enabled) return;
    const def = WorkflowDefinitionSchema.parse(wf.definition);
    let result: Awaited<ReturnType<typeof deps.runWorkflow>>;
    let error: string | null = null;
    try {
      result = await deps.runWorkflow(def.nodes, def.edges, {
        input,
        files,
        codeLimits: deps.codeLimits,
        services: deps.services,
        workflowId,
        logger: { warn: (msg: string) => deps.logger.warn(msg) },
      });
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

  /**
   * Does this workflow's ingest trigger accept a batch from `source`? An empty
   * (or absent) `data.config.sourceFilter` matches every batch; a set filter
   * matches case-insensitively against the event's `source`.
   */
  async function ingestNodeMatches(workflowId: string, source: string): Promise<boolean> {
    const wf = await deps.store.get(workflowId);
    if (!wf || !wf.enabled) return false;
    const def = WorkflowDefinitionSchema.parse(wf.definition);
    const ingestNode = (def.nodes as Array<{ type?: string; data?: Record<string, unknown> }>).find(
      (n) => n.type === 'trigger' && n.data?.triggerType === 'ingest',
    );
    const filter = String((ingestNode?.data?.config as { sourceFilter?: unknown } | undefined)?.sourceFilter ?? '')
      .trim()
      .toLowerCase();
    return filter === '' || filter === source;
  }

  /**
   * Does this workflow's event trigger accept this data.persisted event? Empty
   * source/resourceType filters match everything; a set source matches the event
   * source case-insensitively; a set resourceType must be among the event's
   * resourceTypes.
   */
  async function eventNodeMatches(
    workflowId: string,
    payload: { source?: unknown; resourceTypes?: unknown },
  ): Promise<boolean> {
    const wf = await deps.store.get(workflowId);
    if (!wf || !wf.enabled) return false;
    const def = WorkflowDefinitionSchema.parse(wf.definition);
    const node = (def.nodes as Array<{ type?: string; data?: Record<string, unknown> }>).find(
      (n) => n.type === 'trigger' && n.data?.triggerType === 'event',
    );
    const cfg = (node?.data?.config ?? {}) as { source?: unknown; resourceType?: unknown };
    const wantSource = String(cfg.source ?? '').trim().toLowerCase();
    const wantType = String(cfg.resourceType ?? '').trim();
    const evSource = String(payload.source ?? '').trim().toLowerCase();
    const evTypes = Array.isArray(payload.resourceTypes) ? payload.resourceTypes.map((t) => String(t)) : [];
    if (wantSource !== '' && wantSource !== evSource) return false;
    if (wantType !== '' && !evTypes.includes(wantType)) return false;
    return true;
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

    setEventWorkflowIds(ids) {
      eventIds = new Set(ids);
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
        const payload = (event.payload ?? {}) as { source?: unknown; blobKey?: unknown; byteSize?: unknown };
        const source = String(payload.source ?? '').trim().toLowerCase();
        const files = (typeof payload.blobKey === 'string' && typeof payload.byteSize === 'number')
          ? { file: { objectKey: payload.blobKey, contentType: 'application/octet-stream', fileName: payload.blobKey.split('/').pop() ?? 'payload', byteSize: payload.byteSize } as BinaryRef }
          : undefined;
        for (const workflowId of ingestIds) {
          try {
            if (!(await ingestNodeMatches(workflowId, source))) continue;
            await runAndRecord(workflowId, 'ingest', event.payload, files);
          } catch (err) {
            deps.logger.error({ err, workflowId }, 'ingest-triggered workflow run failed');
          }
        }
      });

      await eventing.subscribe(DATA_PERSISTED, async (event) => {
        const payload = (event.payload ?? {}) as { source?: unknown; resourceTypes?: unknown };
        for (const workflowId of eventIds) {
          try {
            if (!(await eventNodeMatches(workflowId, payload))) continue;
            await runAndRecord(workflowId, 'event', event.payload);
          } catch (err) {
            deps.logger.error({ err, workflowId }, 'event-triggered workflow run failed');
          }
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
