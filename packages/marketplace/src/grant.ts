import type { Capability } from './capabilities';
import { parseCapabilities } from './capabilities';

export type Grant = { legacy: true } | { legacy: false; capabilities: Capability[] };

/** A persisted manifest with a `capabilities` field is a marketplace artifact (enforced); otherwise legacy (unrestricted).
 *  A capabilities field that is present-but-not-a-valid-array is a corrupt/forged row — fail loudly,
 *  do NOT silently treat as legacy/unenforced. */
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
