import { z } from 'zod';
import { capabilitySchema } from './capabilities';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEX64 = /^[0-9a-f]{64}$/;

const pluginPayload = z.object({
  kind: z.literal('plugin'),
  // Source/sink flavor. Named `pluginKind` because this object's own discriminator is
  // already `kind: 'plugin'`. Maps to the flat manifest's `kind`. Default 'source' keeps
  // every existing (signed) plugin artifact byte-identical and verifying.
  pluginKind: z.enum(['source', 'sink']).default('source'),
  wasmSha256: z.string().regex(HEX64),
  entrypoint: z.string().min(1).default('convert'),
  // Named entrypoints a sink exports; empty for sources.
  entrypoints: z.array(z.string().min(1)).default([]),
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
  readme: z.string().default(''),
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

/** Legacy plugin manifest shape (packages/plugins manifest.ts). A flat legacy manifest may
 *  still declare `capabilities`; without it the derived grant is empty and emit-fhir is
 *  fail-closed (the plugin can emit nothing), so reference plugins must carry it. */
export interface LegacyPluginManifest {
  id: string; version: string; kind?: 'source' | 'sink'; entrypoint?: string; entrypoints?: string[];
  wasmSha256: string; description?: string; readme?: string; license?: string; wasi?: boolean;
  limits?: { memoryMb: number; timeoutMs: number };
  capabilities?: unknown;
}

/** Adapt a legacy plugin manifest to an (unsigned, publisher-less) artifact manifest.
 *  Carries `capabilities` through when present (validated by the schema) so a flat
 *  reference-plugin manifest can declare what it emits; absent ⇒ schema default []. */
export function pluginManifestToArtifact(m: LegacyPluginManifest): ArtifactManifest {
  return parseArtifactManifest({
    schemaVersion: 1,
    type: 'plugin',
    id: m.id,
    version: m.version,
    description: m.description ?? '',
    readme: m.readme ?? '',
    license: m.license ?? 'UNLICENSED',
    compatibility: { ceVersion: '*' },
    ...(m.capabilities !== undefined ? { capabilities: m.capabilities } : {}),
    payload: {
      kind: 'plugin',
      pluginKind: m.kind ?? 'source',
      wasmSha256: m.wasmSha256,
      entrypoint: m.entrypoint ?? 'convert',
      entrypoints: m.entrypoints ?? [],
      wasi: m.wasi ?? false,
      limits: m.limits ?? { memoryMb: 256, timeoutMs: 30_000 },
    },
  });
}
