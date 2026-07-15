import { canonicalHash } from '@openldr/core';

// Distributed sync S7: THE comparison basis for same-version divergence detection.
//
// canonicalHash sorts keys, so this is immune to serialization key-order drift (a raw-string compare
// happens to work today only because both stored bodies flow through the same JSON.stringify — a
// future refactor would start manufacturing phantom divergences with no test to catch it).
//
// meta.versionId / meta.lastUpdated are STRIPPED because they are server-stamped and volatile:
// save() already hashes pre-stamp content for exactly this reason. Two sides holding identical
// content that differs only in those stamps did NOT lose anything, so it is not a divergence.
// False positives are fatal to this feature — an operator who sees noise stops looking.
//
// Returns null for "no content" (a tombstone, or an unparseable body). Callers compare with
// NULL-aware semantics: null vs null = agree; null vs hash = diverged.
const VOLATILE_META_KEYS = ['versionId', 'lastUpdated'] as const;

export function divergenceHash(body: unknown): string | null {
  if (body == null) return null;

  let value: unknown = body;
  if (typeof value === 'string') {
    // resource_history.resource is stored serialized; some drivers hand jsonb back as text.
    try {
      value = JSON.parse(value);
    } catch {
      // An unreadable stored body cannot be meaningfully compared. Treat as "no content" rather than
      // throwing — a hash failure must never fail the apply it is inspecting.
      return null;
    }
  }
  if (value == null || typeof value !== 'object') return null;

  const rest = { ...(value as Record<string, unknown>) };
  const meta = rest.meta;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const trimmed = { ...(meta as Record<string, unknown>) };
    for (const k of VOLATILE_META_KEYS) delete trimmed[k];
    // A meta that held ONLY volatile fields is dropped entirely, so a body carrying stamps hashes
    // identically to one that never had them.
    if (Object.keys(trimmed).length === 0) delete rest.meta;
    else rest.meta = trimmed;
  }
  return canonicalHash(rest);
}
