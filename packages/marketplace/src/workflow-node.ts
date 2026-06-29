import { z } from 'zod';

/** Node archetype. Drives palette grouping + validation (a `source` must have no inputs). */
export const WORKFLOW_NODE_KINDS = ['source', 'transform', 'sink'] as const;
export const workflowNodeKindSchema = z.enum(WORKFLOW_NODE_KINDS);
export type WorkflowNodeKind = (typeof WORKFLOW_NODE_KINDS)[number];

/** Declarative config-field types the builder renders (v1). `select`/`multiselect` use either
 *  static `options` or a host-resolved `optionsSource`; `file` is the binary lane (SP-4). */
export const WORKFLOW_CONFIG_FIELD_TYPES = ['text', 'number', 'boolean', 'select', 'multiselect', 'file', 'json'] as const;
export const workflowConfigFieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(WORKFLOW_CONFIG_FIELD_TYPES),
  required: z.boolean().default(false),
  default: z.unknown().optional(),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
  /** Host-owned dynamic option source (e.g. 'connectors', 'dhis2-mappings', 'reports'). Resolved in SP-3. */
  optionsSource: z.string().min(1).optional(),
  /** For a select: a resolver name whose detail object is merged into the node config when a value
   *  is picked (build-time denormalization). See GET /api/workflows/node-detail/:source. */
  detailSource: z.string().min(1).optional(),
});
export type WorkflowConfigField = z.infer<typeof workflowConfigFieldSchema>;

export const workflowPortSchema = z.object({ name: z.string().min(1), binary: z.boolean().default(false) });
export type WorkflowPort = z.infer<typeof workflowPortSchema>;

/** A single workflow-node contribution declared in a plugin manifest (`workflowNodes[]`).
 *  `capabilities` are capability *kind* strings (e.g. 'net-egress', 'host:connectors') that MUST be
 *  a subset of the plugin's grant; the registry enforces the subset at discovery (SP-1) and the
 *  engine re-enforces at run (SP-2). `entrypoint` is a wasm export invoked per run (SP-2). */
export const workflowNodeDeclSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: workflowNodeKindSchema,
  description: z.string().default(''),
  entrypoint: z.string().min(1),
  ports: z
    .object({ inputs: z.array(workflowPortSchema).default([]), outputs: z.array(workflowPortSchema).default([]) })
    .default({ inputs: [], outputs: [] }),
  capabilities: z.array(z.string().min(1)).default([]),
  config: z.array(workflowConfigFieldSchema).default([]),
  /** Wire ABI: 'items' = JSON {items,config} (default, SP-2); 'bytes' = the host passes the input
   *  item's binary file as RAW bytes to the wasm entrypoint, which returns {items} (converter). */
  abi: z.enum(['items', 'bytes']).default('items'),
  /** For abi:'bytes' — the binary field on the input item to read (default 'file'). */
  binaryField: z.string().min(1).optional(),
});
export type WorkflowNodeDecl = z.infer<typeof workflowNodeDeclSchema>;

export function parseWorkflowNodeDecls(raw: unknown): WorkflowNodeDecl[] {
  return z.array(workflowNodeDeclSchema).parse(raw);
}
