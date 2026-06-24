import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  createWorkflow,
  updateWorkflow,
  executeWorkflowStream,
  type ExecuteResponse,
  type RunEvent,
} from '@/api';
import type { WorkflowNode, WorkflowEdge } from '../lib/types';
import { serializeWorkflow } from '../lib/serializer';
import { useWorkflowStore } from './use-workflow-store';

/** Build the persisted workflow body from the current store graph. */
function buildBody(opts: { id: string; name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] }) {
  // `serializeWorkflow` strips ReactFlow runtime metadata (selected/dragging).
  const def = serializeWorkflow(opts.name, opts.nodes, opts.edges, opts.id);
  return {
    id: opts.id,
    name: opts.name,
    description: null,
    definition: { nodes: def.nodes, edges: def.edges },
    enabled: true,
    createdBy: null,
  };
}

function newWorkflowId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useWorkflowApi() {
  const [saving, setSaving] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [lastExecution, setLastExecution] = useState<ExecuteResponse | null>(null);

  const store = useWorkflowStore();

  const save = useCallback(async () => {
    setSaving(true);
    try {
      if (store.workflowId) {
        await updateWorkflow(
          store.workflowId,
          buildBody({ id: store.workflowId, name: store.workflowName, nodes: store.nodes, edges: store.edges }),
        );
      } else {
        const id = newWorkflowId();
        const result = await createWorkflow(
          buildBody({ id, name: store.workflowName, nodes: store.nodes, edges: store.edges }),
        );
        store.setWorkflow(result.id, result.name, store.nodes, store.edges);
      }
      toast.success('Workflow saved');
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    } finally {
      setSaving(false);
    }
  }, [store]);

  /**
   * Save or create the workflow, returning a guaranteed-valid workflow ID.
   * Handles the case where the server lost the workflow (e.g. restart) by
   * falling back to creating a new one.
   */
  const ensureSaved = useCallback(async (): Promise<string> => {
    if (!store.workflowId) {
      const id = newWorkflowId();
      const result = await createWorkflow(
        buildBody({ id, name: store.workflowName, nodes: store.nodes, edges: store.edges }),
      );
      store.setWorkflow(result.id, result.name, store.nodes, store.edges);
      return result.id;
    }

    try {
      await updateWorkflow(
        store.workflowId,
        buildBody({ id: store.workflowId, name: store.workflowName, nodes: store.nodes, edges: store.edges }),
      );
      return store.workflowId;
    } catch {
      const id = newWorkflowId();
      const result = await createWorkflow(
        buildBody({ id, name: store.workflowName, nodes: store.nodes, edges: store.edges }),
      );
      store.setWorkflow(result.id, result.name, store.nodes, store.edges);
      return result.id;
    }
  }, [store]);

  /**
   * Stream a run from the server. Auto-saves the current graph first, then
   * dispatches each per-node RunEvent into the store so the canvas animations
   * + Logs tab update live.
   */
  const runStream = useCallback(async () => {
    setExecuting(true);
    setLastExecution(null);

    try {
      const workflowId = await ensureSaved();

      const handleEvent = (evt: RunEvent) => {
        switch (evt.type) {
          case 'node:start':
            store.setNodeStatus(evt.nodeId, 'running');
            break;
          case 'node:log':
            store.appendNodeLog(evt.entry);
            break;
          case 'node:success':
            store.setNodeStatus(evt.nodeId, 'success');
            store.setNodeRunData(evt.nodeId, evt.input, evt.output);
            break;
          case 'node:error':
            store.setNodeStatus(evt.nodeId, 'error', evt.error);
            break;
          case 'workflow:done':
            // Final ExecuteResponse arrives via the `done` SSE frame below.
            break;
        }
      };

      const result = await executeWorkflowStream(workflowId, handleEvent);
      if (result) setLastExecution(result);
    } catch (err) {
      setLastExecution({
        status: 'failed',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        results: [
          {
            nodeId: '__runner__',
            type: 'runner',
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
            durationMs: 0,
          },
        ],
      });
    } finally {
      setExecuting(false);
      store.setArmed(false);
    }
  }, [store, ensureSaved]);

  /**
   * Handle the Run button. If the workflow has manual triggers, "arm" the
   * workflow and wait for the user to click one (n8n's mental model).
   * Otherwise run immediately.
   */
  const execute = useCallback(async () => {
    store.resetRun();

    const manualTriggers = store.nodes.filter(
      (n) =>
        n.type === 'trigger' &&
        (n.data as { triggerType?: string }).triggerType === 'manual',
    );

    if (manualTriggers.length > 0) {
      for (const n of manualTriggers) {
        store.setNodeStatus(n.id, 'waiting');
      }
      store.setArmed(true);
      return;
    }

    await runStream();
  }, [store, runStream]);

  /**
   * Fire a specific manual trigger. Called from the canvas when the user clicks
   * a node that's in the `waiting` state. Unsets armed first so concurrent
   * clicks don't double-run.
   */
  const fireTrigger = useCallback(
    async (_triggerId: string) => {
      if (!store.armed) return;
      store.setArmed(false);
      await runStream();
    },
    [store, runStream],
  );

  return { save, execute, fireTrigger, saving, executing, lastExecution };
}
