import type { AvailableArtifact, InstalledArtifact } from '@/api';

/** A minimal, source-agnostic shape for a card + detail header. */
export interface CardEntry {
  ref?: string;          // present only for Browse (registry) items
  id: string;
  version: string;
  type: string;
  publisher: { id: string; name: string } | null;
  capabilities: unknown[];
  valid?: boolean;       // Browse only (signature validity)
  installed?: boolean;   // is this id currently installed?
  active?: boolean;      // installed AND active version
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

export function availableToEntry(b: AvailableArtifact, installedIds: Set<string>): CardEntry {
  return {
    ref: b.ref, id: b.id, version: b.version, type: b.type,
    publisher: b.publisher, capabilities: b.capabilities, valid: b.valid,
    installed: installedIds.has(b.id),
  };
}

export function installedToEntry(a: InstalledArtifact): CardEntry {
  const pub = a.publisher && typeof a.publisher === 'object'
    ? (a.publisher as { id?: string; name?: string })
    : null;
  return {
    id: a.id, version: a.version, type: a.type,
    publisher: pub ? { id: pub.id ?? '', name: pub.name ?? '' } : null,
    capabilities: a.capabilities, installed: true, active: a.active,
  };
}
