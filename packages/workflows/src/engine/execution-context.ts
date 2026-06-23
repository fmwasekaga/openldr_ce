import type { RunEvent } from '../types';

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
}

export function createContext(
  input: unknown,
  emit: (evt: RunEvent) => void,
  edges: ExecutionContext['edges'] = [],
): ExecutionContext {
  return { input, nodeOutputs: {}, logs: {}, emit, edges };
}
