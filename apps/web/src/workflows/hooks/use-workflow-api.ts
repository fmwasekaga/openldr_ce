import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import {
  createWorkflow,
  updateWorkflow,
  executeWorkflowStream,
  fetchWorkflowNodes,
  uploadWorkflowFile,
  type ExecuteResponse,
  type RunEvent,
  type WorkflowBinaryRef,
} from '@/api';
import type { WorkflowNode, WorkflowEdge } from '../lib/types';
import { serializeWorkflow } from '../lib/serializer';
import { useWorkflowStore } from './use-workflow-store';

/** Build the persisted workflow body from the current store graph. */
function buildBody(opts: { id: string; name: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] }) {
  // An empty name field shows a placeholder in the UI; persist a sensible default so the
  // list never shows a blank row.
  const name = opts.name.trim() || 'Untitled Workflow';
  // `serializeWorkflow` strips ReactFlow runtime metadata (selected/dragging).
  const def = serializeWorkflow(name, opts.nodes, opts.edges, opts.id);
  return {
    id: opts.id,
    name,
    description: null,
    definition: { nodes: def.nodes, edges: def.edges },
    enabled: true,
    createdBy: null,
  };
}

function newWorkflowId(): string {
  return `wf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Returns true when the current canvas has at least one plugin-node whose
 * server-side descriptor carries abi:'bytes' (a binary converter node).
 * Fetches the node catalog and matches against canvas nodes in one pass.
 */
async function needsFileUpload(nodes: WorkflowNode[]): Promise<boolean> {
  const pluginNodes = nodes.filter((n) => n.type === 'plugin-node');
  if (pluginNodes.length === 0) return false;
  let descriptors;
  try { descriptors = await fetchWorkflowNodes(); } catch { return false; }
  const bytesIds = new Set(descriptors.filter((d) => d.abi === 'bytes').map((d) => d.id));
  return pluginNodes.some((n) => {
    const d = n.data as unknown as { pluginId?: string; nodeId?: string; nodeType?: string };
    const nodeId = d.pluginId ? `${d.pluginId}:${d.nodeId ?? ''}` : (d.nodeType ?? '');
    return bytesIds.has(nodeId);
  });
}

/**
 * Open a native file picker imperatively and resolve with the chosen File,
 * or null if the user cancels. A hidden <input> element is attached to body
 * for the duration of the pick then removed.
 */
function pickFile(accept?: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files?.[0] ?? null;
      document.body.removeChild(input);
      resolve(file);
    };
    // Resolve null on cancel (focus returns to window without a change event).
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files?.length) {
          document.body.removeChild(input);
          resolve(null);
        }
        window.removeEventListener('focus', onFocus);
      }, 300);
    };
    window.addEventListener('focus', onFocus);
    input.click();
  });
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
   *
   * When the canvas contains a plugin-node with abi:'bytes', a native file
   * picker is shown before the run; the chosen file is uploaded to the server
   * and the resulting BinaryRef is seeded onto the trigger item via `files`.
   */
  const runStream = useCallback(async () => {
    setExecuting(true);
    setLastExecution(null);

    try {
      // Determine whether any canvas node needs a binary file before saving,
      // so we can gate the run without starting the SSE stream prematurely.
      const currentNodes = store.nodes;
      const requiresFile = await needsFileUpload(currentNodes);

      let files: Record<string, WorkflowBinaryRef> | undefined;
      if (requiresFile) {
        const file = await pickFile();
        if (!file) {
          // User cancelled the picker — abort the run cleanly.
          setExecuting(false);
          store.setArmed(false);
          return;
        }
        // Save first (upload needs a stable workflowId).
        const workflowId = await ensureSaved();
        toast.loading('Uploading file…', { id: 'wf-upload' });
        try {
          const ref = await uploadWorkflowFile(workflowId, file);
          files = { file: ref };
          toast.success(`Uploaded ${file.name}`, { id: 'wf-upload' });
        } catch (err) {
          toast.error(`Upload failed: ${err instanceof Error ? err.message : String(err)}`, { id: 'wf-upload' });
          throw err;
        }
        // workflowId is already saved; stream the run with the file ref.
        const handleEventBytes = (evt: RunEvent) => {
          switch (evt.type) {
            case 'node:start': store.setNodeStatus(evt.nodeId, 'running'); break;
            case 'node:log': store.appendNodeLog(evt.entry); break;
            case 'node:success': store.setNodeStatus(evt.nodeId, 'success'); store.setNodeRunData(evt.nodeId, evt.input, evt.output); break;
            case 'node:error': store.setNodeStatus(evt.nodeId, 'error', evt.error); break;
            case 'workflow:done': break;
          }
        };
        const result = await executeWorkflowStream(workflowId, handleEventBytes, { files });
        if (result) setLastExecution(result);
        return;
      }

      // Standard (no-file) path — unchanged behaviour.
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
