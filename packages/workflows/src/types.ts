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
  | { type: 'node:success'; nodeId: string; nodeType: string; input: unknown; output: unknown; durationMs: number; meta?: unknown }
  | { type: 'node:error'; nodeId: string; nodeType: string; error: string; durationMs: number }
  | { type: 'workflow:done'; status: 'completed' | 'failed' };

/**
 * An opaque reference to a secret held in the server-side secret store (SEC-06).
 * A secret field accepts a plaintext `string` (a new/edited value) OR this ref
 * (an unchanged, already-extracted secret).
 *
 * NOTE: `node.data` below is `z.record(z.unknown())` (fully permissive), so the
 * `secret`/`headers` union is already accepted at the schema level without a
 * field-specific change. This schema is exported for the extraction/migration/
 * resolution tasks (and the studio write-only fields) to validate refs.
 */
export const secretRefSchema = z.object({ secretRef: z.string() }).strict();
export type SecretRef = z.infer<typeof secretRefSchema>;

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

export const TRIGGER_SOURCES = ['manual', 'schedule', 'webhook', 'ingest', 'event', 'postgres', 'email'] as const;
export type TriggerSource = (typeof TRIGGER_SOURCES)[number];

export const WorkflowRunSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  triggerSource: z.enum(TRIGGER_SOURCES),
  status: z.enum(['completed', 'failed']),
  startedAt: z.string(),
  finishedAt: z.string(),
  result: z.unknown(),          // the full WorkflowRunResult
  error: z.string().nullable().default(null),
  correlationId: z.string().nullable().optional(),
});
export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;

export const WorkflowScheduleSchema = z.object({
  workflowId: z.string(),
  nodeId: z.string(),
  cron: z.string(),
  tz: z.string().nullable().default(null),
  enabled: z.boolean().default(true),
  nextDueAt: z.string().nullable().default(null),
});
export type WorkflowSchedule = z.infer<typeof WorkflowScheduleSchema>;

export const WorkflowDatasetSchema = z.object({
  id: z.string(),
  name: z.string(),
  columns: z.array(z.object({ key: z.string(), label: z.string() })).default([]),
  rows: z.array(z.record(z.unknown())).default([]),
  rowCount: z.number().default(0),
  workflowId: z.string().nullable().default(null),
  publishedTable: z.string().nullable().default(null),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});
export type WorkflowDataset = z.infer<typeof WorkflowDatasetSchema>;
