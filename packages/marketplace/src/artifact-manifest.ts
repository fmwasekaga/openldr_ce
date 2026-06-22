import { z } from 'zod';
import { capabilitySchema } from './capabilities';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEX64 = /^[0-9a-f]{64}$/;

const pluginPayload = z.object({
  kind: z.literal('plugin'),
  wasmSha256: z.string().regex(HEX64),
  entrypoint: z.string().min(1).default('convert'),
  wasi: z.boolean().default(false),
  limits: z.object({ memoryMb: z.number().int().positive().default(256), timeoutMs: z.number().int().positive().default(30_000) })
    .default({ memoryMb: 256, timeoutMs: 30_000 }),
});
const formPayload = z.object({ kind: z.literal('form-template'), questionnaireSha256: z.string().regex(HEX64) });
const reportPayload = z.object({ kind: z.literal('report-template'), templateSha256: z.string().regex(HEX64) });

export const artifactManifestSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(['plugin', 'form-template', 'report-template']),
  id: z.string().min(1),
  version: z.string().regex(SEMVER, 'version must be semver'),
  description: z.string().default(''),
  license: z.string().default('UNLICENSED'),
  // Publisher is optional: legacy plugin manifests carry none and install hash-only.
  publisher: z.object({ id: z.string().min(1), name: z.string().default(''), keyFingerprint: z.string().regex(HEX64) }).optional(),
  compatibility: z.object({ ceVersion: z.string().min(1) }),
  dependencies: z.array(z.object({ id: z.string().min(1), versionRange: z.string().min(1) })).default([]),
  capabilities: z.array(capabilitySchema).default([]),
  source: z.enum(['local-file', 'registry']).default('local-file'), // 'federated' reserved
  payload: z.discriminatedUnion('kind', [pluginPayload, formPayload, reportPayload]),
  signature: z.string().regex(/^[0-9a-f]+$/).optional(),
});

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>;

export function parseArtifactManifest(raw: unknown): ArtifactManifest {
  return artifactManifestSchema.parse(raw);
}

/** Legacy plugin manifest shape (packages/plugins manifest.ts). */
export interface LegacyPluginManifest {
  id: string; version: string; entrypoint?: string; wasmSha256: string;
  description?: string; license?: string; wasi?: boolean;
  limits?: { memoryMb: number; timeoutMs: number };
}

/** Adapt a legacy plugin manifest to an (unsigned, publisher-less) artifact manifest. */
export function pluginManifestToArtifact(m: LegacyPluginManifest): ArtifactManifest {
  return parseArtifactManifest({
    schemaVersion: 1,
    type: 'plugin',
    id: m.id,
    version: m.version,
    description: m.description ?? '',
    license: m.license ?? 'UNLICENSED',
    compatibility: { ceVersion: '*' },
    payload: { kind: 'plugin', wasmSha256: m.wasmSha256, entrypoint: m.entrypoint ?? 'convert', wasi: m.wasi ?? false, limits: m.limits ?? { memoryMb: 256, timeoutMs: 30_000 } },
  });
}
