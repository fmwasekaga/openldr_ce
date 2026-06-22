/** Deterministic JSON: recursively sorted keys, no insignificant whitespace, undefined props skipped. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJSON(v)).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

/**
 * Bytes an artifact signature is computed over: canonical manifest (minus `signature`)
 * joined to the payload's sha256. Binds the signature to both manifest and payload.
 */
export function canonicalSigningBytes(manifest: Record<string, unknown>, payloadSha256: string): Uint8Array {
  const { signature: _omit, ...rest } = manifest;
  return new TextEncoder().encode(canonicalJSON(rest) + ':' + payloadSha256);
}
