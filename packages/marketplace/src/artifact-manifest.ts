import { z } from 'zod';
import { capabilitySchema } from './capabilities';

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** A plugin's UI contribution. Two tiers:
 *  - Webview: `entry`+`sha256` integrity-bind the single self-contained ui.html (body content +
 *    inline CSS/JS; the host wraps it in the document shell). Both fields must be provided together.
 *  - Declarative: only `declarative` (a JSON-Schema) is provided; the host renders a form. No iframe.
 *  Because this object lives inside the signed manifest, the Ed25519 signature already covers the
 *  ui.html hash — no signing-function change. `nav` drives the sidebar entry routed to /x/:id.
 *  `uiSdkVersion` selects the SDK runtime the host injects. */
export const uiContributionSchema = z.object({
  entry: z.string().min(1).optional(),
  sha256: z.string().regex(HEX64).optional(),
  nav: z.object({
    label: z.string().min(1),
    icon: z.string().min(1).default('puzzle'),
    section: z.string().min(1).default('apps'), // SP-A1b will narrow to an enum once the host sidebar section set is fixed
  }),
  uiSdkVersion: z.literal('1').default('1'), // add literals here when a new SDK ships; old signed bundles stay valid at their declared version
  declarative: z.unknown().optional(), // JSON-Schema for the declarative tier; narrowed once the renderer consumes it
}).refine((u) => (u.entry === undefined) === (u.sha256 === undefined), {
  message: 'ui.entry and ui.sha256 must be provided together (webview tier) or both omitted (declarative tier)',
});

export type UiContribution = z.infer<typeof uiContributionSchema>;

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
  ui: uiContributionSchema.optional(),
});
const formPayload = z.object({ kind: z.literal('form-template'), questionnaireSha256: z.string().regex(HEX64) });
const reportPayload = z.object({ kind: z.literal('report-template'), templateSha256: z.string().regex(HEX64) });

export const artifactManifestSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.enum(['plugin', 'form-template', 'report-template']),
  id: z.string().min(1),
  version: z.string().regex(SEMVER, 'version must be semver'),
  description: z.string().default(''),
  // Markdown docs shipped with the artifact. Cap bounds a render-DoS while leaving room
  // for a handful of inlined data: URI screenshots (each ~40-60KB base64).
  readme: z.string().max(1_000_000).default(''),
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
  ui?: unknown;
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
      ...(m.ui !== undefined ? { ui: m.ui } : {}),
    },
  });
}
