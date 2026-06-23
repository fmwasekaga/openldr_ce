import type { RunEvent } from '../types';
import type { WorkflowServices } from './services';

export interface ExecutionContext {
  /** Initial input — e.g. a manual trigger payload. */
  input: unknown;
  /** Output of every node that has run, keyed by node id. */
  nodeOutputs: Record<string, unknown>;
  /** Captured log lines per node. */
  logs: Record<string, import('../types').LogEntry[]>;
  /** Stream an event out to listeners (SSE + buffer). */
  emit: (evt: RunEvent) => void;
  /** All edges — used by the merge handler. */
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null }>;
  /** Limits for the Code node sandbox. */
  codeLimits: { timeoutMs: number; memoryMb: number };
  /** Server-provided data capabilities for source nodes (undefined in pure-engine tests). */
  services?: WorkflowServices;
}

export function createContext(
  input: unknown,
  emit: (evt: RunEvent) => void,
  edges: ExecutionContext['edges'] = [],
  codeLimits: ExecutionContext['codeLimits'] = { timeoutMs: 5000, memoryMb: 128 },
  services?: WorkflowServices,
): ExecutionContext {
  return { input, nodeOutputs: {}, logs: {}, emit, edges, codeLimits, services };
}
