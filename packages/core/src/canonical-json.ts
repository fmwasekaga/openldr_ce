import { createHash } from 'node:crypto';

/** JSON with object keys recursively sorted (arrays keep order), so equality is key-order-insensitive.
 *  Postgres re-sorts jsonb keys on read, so a plain JSON.stringify would report spurious diffs. */
export function canonicalJson(v: unknown): string {
  return JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val as Record<string, unknown>).sort().reduce<Record<string, unknown>>(
          (o, k) => { o[k] = (val as Record<string, unknown>)[k]; return o; }, {})
      : val);
}

/** SHA-256 hex digest of the canonical JSON form. Stable across key reordering. */
export function canonicalHash(v: unknown): string {
  return createHash('sha256').update(canonicalJson(v)).digest('hex');
}
