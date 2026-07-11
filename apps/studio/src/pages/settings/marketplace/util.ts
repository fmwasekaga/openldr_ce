import type { AvailableArtifact, ArtifactPayloadMeta, InstalledArtifact } from '@/api';

/** A minimal, source-agnostic shape for a card + detail header. */
export interface CardEntry {
  ref?: string;          // present only for Browse (registry) items
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  description?: string | null;   // from the bundle/manifest (used when no registry detail)
  license?: string | null;
  payload?: ArtifactPayloadMeta | null;
  capabilities: unknown[];
  valid?: boolean;       // Browse only (signature validity)
  invalidReason?: AvailableArtifact['invalidReason']; // Browse only: which check failed when valid === false
  installed?: boolean;   // is this id currently installed?
  active?: boolean;      // installed AND active version
  enabled?: boolean;     // installed AND user-enabled (on/off toggle)
  drifted?: boolean;     // installed form-template modified locally
  targetFormId?: string; // installed form-template's local form id
  versions?: { version: string; ref: string }[];
  registryName?: string; // Browse only: source registry label
}

/** Render one capability as a human-readable line for the Permissions list. */
export function capabilityLine(cap: unknown): string {
  if (typeof cap !== 'object' || cap === null) return String(cap);
  const c = cap as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof c.kind === 'string') parts.push(c.kind);
  if (Array.isArray(c.resourceTypes)) parts.push(`(${(c.resourceTypes as string[]).join(', ')})`);
  if (Array.isArray(c.allowedHosts)) parts.push(`(${(c.allowedHosts as string[]).join(', ') || 'none'})`);
  return parts.join(' ') || JSON.stringify(cap);
}

export function availableToEntry(b: AvailableArtifact, installed: Map<string, InstalledArtifact>): CardEntry {
  // Merge the installed state so a Browse entry that is already installed carries the
  // real enabled/active flags — otherwise the detail menu shows the wrong Enable/Disable
  // label (and rollback visibility) for installed plugins viewed from Browse.
  const inst = installed.get(b.id);
  return {
    ref: b.ref, id: b.id, version: b.version, type: b.type,
    publisher: b.publisher, description: b.description, license: b.license,
    capabilities: b.capabilities ?? [], valid: b.valid, invalidReason: b.invalidReason,
    installed: Boolean(inst), enabled: inst?.enabled, active: inst?.active,
    versions: b.versions ?? [], registryName: b.registryName,
  };
}

export function installedToEntry(a: InstalledArtifact): CardEntry {
  const pub = a.publisher && typeof a.publisher === 'object'
    ? (a.publisher as { id?: string; name?: string })
    : null;
  return {
    id: a.id, version: a.version, type: a.type,
    publisher: pub ? { id: pub.id ?? '', name: pub.name ?? '' } : null,
    description: a.description, license: a.license, payload: a.payload,
    capabilities: a.capabilities, installed: true, active: a.active,
    enabled: a.enabled, drifted: a.drifted, targetFormId: a.targetFormId,
  };
}
