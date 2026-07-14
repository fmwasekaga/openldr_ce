/**
 * Shared secret-field locator (SEC-06).
 *
 * This module is the SINGLE source of truth for WHICH fields in a workflow
 * definition hold secrets. Save-time extraction, boot migration, runtime
 * resolution, and defense-in-depth redaction all funnel through here so the
 * field-knowledge can never drift between those call sites.
 *
 * Secret-bearing fields:
 *  - `node.data.secret` on a webhook trigger
 *      (`node.type === 'webhook'` OR `node.type === 'trigger' && data.triggerType === 'webhook'`).
 *      Surfaced per-field (the value is the secret string / ref).
 *  - `node.data.config.headers` — the HTTP node's headers blob (this is the REAL
 *      location the HTTP handler reads; there is no per-key `node.data.headers`).
 *      Surfaced as ONE whole-blob field WHEN the blob contains any auth header
 *      (see {@link AUTH_HEADER_RE}). The blob may be a JSON string, an object, or
 *      an already-sealed `{ secretRef }`. A blob with no auth header is left alone.
 *
 * A secret VALUE is either a plaintext value (string, or the whole headers blob)
 * or an opaque `{ secretRef: string }` that points at the server-side secret store.
 */

/** Header keys treated as auth/secret-bearing (case-insensitive). */
export const AUTH_HEADER_RE = /^(authorization|proxy-authorization|cookie|x-api-key|x-.*-token)$/i;

/** A secret field value: plaintext (new/edited) or an opaque store reference (unchanged). */
export type SecretValue = string | { secretRef: string };

/** Type guard: is this value an opaque secret-store reference? */
export function isSecretRef(v: unknown): v is { secretRef: string } {
  return !!v && typeof v === 'object' && typeof (v as { secretRef?: unknown }).secretRef === 'string';
}

/** A located secret field: its current value, a dotted path, and a writer into the (cloned) definition. */
export interface SecretFieldRef {
  value: unknown;
  /** `${nodeId}.data.secret` (webhook secret) or `${nodeId}.data.config.headers` (whole HTTP headers blob). */
  path: string;
  /** Write the field in place. `set(undefined)` deletes the field. */
  set(v: SecretValue | undefined): void;
}

function isWebhookTrigger(node: { type?: unknown; data?: { triggerType?: unknown } }): boolean {
  return (
    node.type === 'webhook' ||
    (node.type === 'trigger' && node.data?.triggerType === 'webhook')
  );
}

/**
 * Does the HTTP node's `config.headers` blob hold an auth header (and therefore
 * count as one secret field)? Accepts an already-sealed ref, an object, or a
 * JSON string; a non-JSON/template string or an auth-free blob is NOT secret.
 */
function headersBlobIsSecret(headers: unknown): boolean {
  // Already sealed → it IS a secret field (so extraction keeps / migration skips it).
  if (isSecretRef(headers)) return true;
  let obj: unknown = headers;
  if (typeof headers === 'string') {
    try {
      obj = JSON.parse(headers);
    } catch {
      // A template/non-JSON string can't be introspected — treat as not secret.
      return false;
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return false;
  return Object.keys(obj as Record<string, unknown>).some((k) => AUTH_HEADER_RE.test(k));
}

/**
 * Walk `definition` in place, yielding a {@link SecretFieldRef} for every
 * secret-bearing field. The refs' `set` mutates whatever object is passed in —
 * callers that must not mutate the input clone first (see {@link mapSecretFields}).
 */
function* iterSecretFields(definition: unknown): Generator<SecretFieldRef> {
  if (!definition || typeof definition !== 'object') return;
  const nodes = (definition as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return;
  for (const raw of nodes) {
    if (!raw || typeof raw !== 'object') continue;
    const node = raw as { id?: unknown; type?: unknown; data?: Record<string, unknown> };
    const data = node.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) continue;
    const nodeId = typeof node.id === 'string' ? node.id : '';

    // Webhook trigger shared secret.
    if (isWebhookTrigger(node) && 'secret' in data) {
      yield {
        value: data.secret,
        path: `${nodeId}.data.secret`,
        set(v) {
          if (v === undefined) delete data.secret;
          else data.secret = v;
        },
      };
    }

    // HTTP node headers blob (`data.config.headers`) — surfaced whole when it
    // carries an auth header. The value is the ENTIRE blob (string/object/ref).
    const config = data.config;
    if (config && typeof config === 'object' && !Array.isArray(config)) {
      const cfg = config as Record<string, unknown>;
      if ('headers' in cfg && headersBlobIsSecret(cfg.headers)) {
        yield {
          value: cfg.headers,
          path: `${nodeId}.data.config.headers`,
          set(v) {
            if (v === undefined) delete cfg.headers;
            else cfg.headers = v;
          },
        };
      }
    }
  }
}

/**
 * Deep-clone `definition`, visit every secret-bearing field with `fn`, and
 * return the NEW definition. `fn`'s `set` writes into the clone; the caller's
 * input is never mutated.
 */
export function mapSecretFields(definition: unknown, fn: (f: SecretFieldRef) => void): unknown {
  const clone = structuredClone(definition);
  for (const ref of iterSecretFields(clone)) fn(ref);
  return clone;
}

/** Async variant of {@link mapSecretFields} — `fn` may await (e.g. the async store.put). */
export async function mapSecretFieldsAsync(
  definition: unknown,
  fn: (f: SecretFieldRef) => Promise<void>,
): Promise<unknown> {
  const clone = structuredClone(definition);
  for (const ref of iterSecretFields(clone)) await fn(ref);
  return clone;
}

/** Read-only scan (no clone) — visits every secret field without a writer. */
export function forEachSecretField(
  definition: unknown,
  fn: (f: { value: unknown; path: string }) => void,
): void {
  for (const ref of iterSecretFields(definition)) fn({ value: ref.value, path: ref.path });
}
