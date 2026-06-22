import type { Capability } from './capabilities';

export type Grant = { legacy: true } | { legacy: false; capabilities: Capability[] };

/** A persisted manifest with a `capabilities` field is a marketplace artifact (enforced); otherwise legacy (unrestricted). */
export function readGrant(manifest: Record<string, unknown>): Grant {
  const caps = manifest.capabilities;
  if (!Array.isArray(caps)) return { legacy: true };
  return { legacy: false, capabilities: caps as Capability[] };
}

export function allowedResourceTypes(capabilities: Capability[]): string[] {
  const cap = capabilities.find((c): c is Extract<Capability, { kind: 'emit-fhir' }> => c.kind === 'emit-fhir');
  return cap ? cap.resourceTypes : [];
}

export function allowedHosts(capabilities: Capability[]): string[] {
  const cap = capabilities.find((c): c is Extract<Capability, { kind: 'net-egress' }> => c.kind === 'net-egress');
  return cap ? cap.allowedHosts : [];
}
