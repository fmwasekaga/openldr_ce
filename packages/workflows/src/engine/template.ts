/**
 * Tiny `{{ expression }}` template resolver. Used by node handlers to let
 * users reference upstream node output from their config (e.g. a Log node
 * whose `message` field is `received {{ $input.body.name }}`).
 *
 * Supported syntax (intentionally minimal — no arithmetic, no fn calls):
 *   {{ $input.path.to.value }}        — output of the immediate upstream node
 *   {{ $json.path.to.value }}         — alias for $input (n8n compat)
 *   {{ $node('node-id').path }}       — output of any prior node by id
 *
 * Missing paths resolve to an empty string (consistent with most template
 * engines). The original non-expression text is returned verbatim.
 */

import type { ExecutionContext } from './execution-context';

const EXPR_RE = /\{\{\s*(.*?)\s*\}\}/g;
const NODE_CALL_RE = /^\$node\(\s*['"]([^'"]+)['"]\s*\)(.*)$/;

/**
 * Walk a dot-path (possibly starting with `.`) against an arbitrary JS value.
 * Returns `undefined` if any segment is missing.
 */
function readPath(value: unknown, path: string): unknown {
  if (!path) return value;
  const segments = path.replace(/^\./, '').split('.').filter(Boolean);
  let current: unknown = value;
  for (const seg of segments) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/**
 * Resolve a single `{{ ... }}` expression against the execution context.
 * `upstreamOutput` is the output of the node feeding into the current one
 * (used by $input / $json). Pass `undefined` for source nodes like triggers.
 */
export function resolveExpression(
  expression: string,
  ctx: ExecutionContext,
  upstreamOutput: unknown,
): unknown {
  const trimmed = expression.trim();

  // $node('some-id').a.b
  const nodeMatch = trimmed.match(NODE_CALL_RE);
  if (nodeMatch) {
    const [, nodeId, rest] = nodeMatch;
    const output = ctx.nodeOutputs[nodeId];
    return readPath(output, rest);
  }

  if (trimmed.startsWith('$input')) {
    return readPath(upstreamOutput, trimmed.slice('$input'.length));
  }
  if (trimmed.startsWith('$json')) {
    return readPath(upstreamOutput, trimmed.slice('$json'.length));
  }

  // Unknown expression — return the raw text so users see their typo.
  return `{{ ${trimmed} }}`;
}

/**
 * Replace every `{{ ... }}` in a string with its resolved value. Non-string
 * resolved values are stringified via JSON (so users can log whole objects).
 */
export function resolveTemplate(
  input: string,
  ctx: ExecutionContext,
  upstreamOutput: unknown,
): string {
  if (!input.includes('{{')) return input;
  return input.replace(EXPR_RE, (_match, expr: string) => {
    const value = resolveExpression(expr, ctx, upstreamOutput);
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  });
}

/**
 * Deep-walk a plain object and call `resolveTemplate` on every string value.
 * Used so handlers can accept a whole config object and get templated fields
 * resolved in one pass without handling each field by hand.
 */
export function resolveTemplatesDeep<T>(
  value: T,
  ctx: ExecutionContext,
  upstreamOutput: unknown,
): T {
  if (typeof value === 'string') {
    return resolveTemplate(value, ctx, upstreamOutput) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => resolveTemplatesDeep(v, ctx, upstreamOutput)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = resolveTemplatesDeep(v, ctx, upstreamOutput);
    }
    return out as unknown as T;
  }
  return value;
}
