import type { Capability } from './capabilities';
import { parseCapabilities } from './capabilities';

export type Grant = { legacy: true } | { legacy: false; capabilities: Capability[] };

/** Read the capability grant from a *persisted* plugin/artifact row.
 *
 *  Posture: **declare-or-denied** (the security-preferred default). The install path
 *  (packages/plugins runtime.ts) force-normalizes EVERY manifest — legacy or artifact —
 *  into an ArtifactManifest, whose `capabilities` defaults to []. So a freshly installed
 *  row ALWAYS carries a `capabilities` array, and an empty array means "declared nothing
 *  ⇒ may emit nothing" (enforced/fail-closed), NOT unrestricted.
 *
 *  `capabilities === undefined` therefore only occurs for rows persisted BEFORE the
 *  capability system existed (genuinely pre-marketplace installs that never passed through
 *  normalization); those are grandfathered as legacy/unrestricted for back-compat.
 *  A capabilities field that is present-but-not-a-valid-array is a corrupt/forged row —
 *  fail loudly, do NOT silently treat as legacy/unenforced. */
export function readGrant(manifest: Record<string, unknown>): Grant {
  if (manifest.capabilities === undefined) return { legacy: true };
  // present-but-invalid → throws (corrupt or forged manifest row)
  return { legacy: false, capabilities: parseCapabilities(manifest.capabilities) };
}

export function allowedResourceTypes(capabilities: Capability[]): string[] {
  const cap = capabilities.find((c): c is Extract<Capability, { kind: 'emit-fhir' }> => c.kind === 'emit-fhir');
  return cap ? cap.resourceTypes : [];
}

export function allowedHosts(capabilities: Capability[]): string[] {
  const cap = capabilities.find((c): c is Extract<Capability, { kind: 'net-egress' }> => c.kind === 'net-egress');
  return cap ? cap.allowedHosts : [];
}
