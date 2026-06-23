import { z } from 'zod';

/** Per-node lifecycle events streamed to the UI over SSE. Mirror of the standalone. */
export type LogLevel = 'log' | 'info' | 'warn' | 'error';

export interface LogEntry {
  nodeId: string;
  level: LogLevel;
  message: string;
  /** Unix ms */
  ts: number;
}

export type RunEvent =
  | { type: 'node:start'; nodeId: string; nodeType: string }
  | { type: 'node:log'; entry: LogEntry }
  | { type: 'node:success'; nodeId: string; nodeType: string; input: unknown; output: unknown; durationMs: number }
  | { type: 'node:error'; nodeId: string; nodeType: string; error: string; durationMs: number }
  | { type: 'workflow:done'; status: 'completed' | 'failed' };

/** A ReactFlow node, persisted as JSON. `data` is intentionally open (per-type shape lives in the web layer). */
export const WorkflowNodeSchema = z.object({
  id: z.string(),
  type: z.string(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
  data: z.record(z.unknown()).default({}),
});
export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;

export const WorkflowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().nullable().optional(),
  targetHandle: z.string().nullable().optional(),
});
export type WorkflowEdge = z.infer<typeof WorkflowEdgeSchema>;

export const WorkflowDefinitionSchema = z.object({
  nodes: z.array(WorkflowNodeSchema).default([]),
  edges: z.array(WorkflowEdgeSchema).default([]),
});
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable().default(null),
  definition: WorkflowDefinitionSchema.default({ nodes: [], edges: [] }),
  enabled: z.boolean().default(true),
  createdBy: z.string().nullable().default(null),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;
