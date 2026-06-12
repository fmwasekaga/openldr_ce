import { z } from 'zod';

export const pluginManifestSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  entrypoint: z.string().min(1).default('convert'),
  wasmSha256: z.string().regex(/^[0-9a-f]{64}$/, 'wasmSha256 must be a 64-char hex digest'),
  description: z.string().default(''),
  license: z.string().default('UNLICENSED'),
  wasi: z.boolean().default(false),
  limits: z
    .object({ memoryMb: z.number().int().positive().default(256), timeoutMs: z.number().int().positive().default(30_000) })
    .default({ memoryMb: 256, timeoutMs: 30_000 }),
});

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export function parseManifest(raw: unknown): PluginManifest {
  return pluginManifestSchema.parse(raw);
}
