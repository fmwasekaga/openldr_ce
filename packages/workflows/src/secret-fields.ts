/**
 * Shared secret-field locator (SEC-06).
 *
 * This module is the SINGLE source of truth for WHICH fields in a workflow
 * definition hold secrets. Save-time extraction, boot migration, runtime
 * resolution, and defense-in-depth redaction all funnel through here so the
 * field-knowledge can never drift between those call sites.
 *
 * Secret-bearing fields (mirrors the historical `redactWorkflowSecrets` logic):
 *  - `node.data.secret` on a webhook trigger
 *      (`node.type === 'webhook'` OR `node.type === 'trigger' && data.triggerType === 'webhook'`).
 *  - each `node.data.headers[k]` whose key matches {@link AUTH_HEADER_RE} (any node).
 *
 * A secret VALUE is either a plaintext `string` or an opaque `{ secretRef: string }`
 * that points at the server-side secret store.
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
  /** `${nodeId}.data.secret` or `${nodeId}.data.headers.${headerKey}`. */
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

    // Auth-bearing headers (any node with a `data.headers` object).
    const headers = data.headers;
    if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
      const h = headers as Record<string, unknown>;
      // Snapshot keys up front so `set(undefined)` during iteration is safe.
      for (const k of Object.keys(h)) {
        if (!AUTH_HEADER_RE.test(k)) continue;
        yield {
          value: h[k],
          path: `${nodeId}.data.headers.${k}`,
          set(v) {
            if (v === undefined) delete h[k];
            else h[k] = v;
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
