import { z } from 'zod';
import { uiContributionSchema, workflowNodeDeclSchema } from '@openldr/marketplace';

export const pluginManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  // Plugin flavor. 'source' = the classic convert(bytes)->NDJSON ingest plugin (the
  // default, so every existing manifest stays a source unchanged). 'sink' = exports
  // the named `entrypoints` below (JSON bytes -> JSON bytes), invoked via the sink runtime.
  kind: z.enum(['source', 'sink']).default('source'),
  entrypoint: z.string().min(1).default('convert'),
  // Named entrypoints a sink exports (e.g. health_check, pull_metadata, push_aggregate,
  // push_tracker). Empty for sources. The sink runtime refuses to invoke a name not listed.
  entrypoints: z.array(z.string().min(1)).default([]),
  wasmSha256: z.string().regex(/^[0-9a-f]{64}$/, 'wasmSha256 must be a 64-char hex digest'),
  description: z.string().default(''),
  readme: z.string().default(''),
  license: z.string().default('UNLICENSED'),
  wasi: z.boolean().default(false),
  limits: z
    .object({ memoryMb: z.number().int().positive().default(256), timeoutMs: z.number().int().positive().default(30_000) })
    .default({ memoryMb: 256, timeoutMs: 30_000 }),
  ui: uiContributionSchema.optional(),
  // Workflow-builder nodes this plugin contributes (SP-1). Absent ⇒ no nodes; existing
  // manifests stay byte-identical. Each entry is validated by the shared marketplace schema.
  workflowNodes: z.array(workflowNodeDeclSchema).optional(),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export function parseManifest(raw: unknown): PluginManifest {
  return pluginManifestSchema.parse(raw);
}
