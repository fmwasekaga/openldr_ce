import type { RunEvent } from '../types';
import type { WorkflowServices } from './services';
import type { WorkflowItem, BinaryRef } from './items';

export const DEFAULT_LOOP_MAX_ITEMS = 100_000;

/** Code node sandbox limits plus the SEC-01 master enable flag (default off). */
export interface CodeLimits {
  timeoutMs: number;
  memoryMb: number;
  /** When false, Code nodes refuse to run (host-level privilege risk — see SEC-01). */
  enabled: boolean;
}

export interface ExecutionContext {
  /** Initial input — e.g. a manual trigger payload. */
  input: unknown;
  /** Output items of every node that has run, keyed by node id. */
  nodeOutputs: Record<string, WorkflowItem[]>;
  /** Optional structured result metadata per node (e.g. a sink's import summary), keyed by node id. */
  nodeMeta: Record<string, unknown>;
  /** Branch decision (chosen sourceHandle, e.g. 'true'/'false') set by If/Filter; read by the runner for edge-pruning. */
  branches: Record<string, string>;
  /** Captured log lines per node. */
  logs: Record<string, import('../types').LogEntry[]>;
  /** Stream an event out to listeners (SSE + buffer). */
  emit: (evt: RunEvent) => void;
  /** All edges — used by the merge handler. */
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null }>;
  /**
   * Limits for the Code node sandbox + the master enable flag.
   * `enabled` gates SEC-01: Code nodes run user JS via `vm`, which is NOT a security
   * boundary (host fs/net/env reachable). Default false; only true in trusted deployments.
   */
  codeLimits: CodeLimits;
  /** Optional logger so an enabled Code node can warn about host-level execution. */
  logger?: { warn: (msg: string) => void };
  /** Server-provided data capabilities for source nodes (undefined in pure-engine tests). */
  services?: WorkflowServices;
  /** ID of the persisted workflow record — threaded through so sink nodes can stamp datasets. */
  workflowId?: string;
  /** Per-run file attachments (BinaryRefs), seeded onto the trigger's item. */
  files?: Record<string, BinaryRef>;
  /** Workflow-id recursion chain for the execute-workflow node (empty at the top level). */
  callStack: string[];
  /** Loop iteration stack (innermost loop on top) for $index/$item templating. */
  loopVars: Array<{ index: number; item?: Record<string, unknown> }>;
  /** Hard cap on a loop node's accumulated output items. */
  loopMaxItems: number;
}

export function createContext(
  input: unknown,
  emit: (evt: RunEvent) => void,
  edges: ExecutionContext['edges'] = [],
  codeLimits: CodeLimits = { timeoutMs: 5000, memoryMb: 128, enabled: false },
  services?: WorkflowServices,
  workflowId?: string,
  logger?: ExecutionContext['logger'],
  files?: Record<string, BinaryRef>,
  callStack: string[] = [],
): ExecutionContext {
  return { input, nodeOutputs: {}, nodeMeta: {}, branches: {}, logs: {}, emit, edges, codeLimits, services, workflowId, logger, files, callStack, loopVars: [], loopMaxItems: DEFAULT_LOOP_MAX_ITEMS };
}
