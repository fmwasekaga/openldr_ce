/** n8n-style wire item. The binary lane is declared now but unused until SP-4. */
export interface BinaryRef {
  objectKey: string;
  contentType: string;
  fileName?: string;
  byteSize: number;
}
export interface WorkflowItem {
  json: Record<string, unknown>;
  binary?: Record<string, BinaryRef>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Every element is an object carrying a `json` object → already WorkflowItem[]. ([] qualifies.) */
function isItemArray(v: unknown): v is WorkflowItem[] {
  return Array.isArray(v) && v.every((e) => isRecord(e) && isRecord((e as { json?: unknown }).json));
}

/**
 * Normalize an upstream node output into WorkflowItem[]. SP-2 minimal boundary (the canonical
 * shim is SP-3): WorkflowItem[] passes through; `{columns,rows}`/`{rows}` → one item per row;
 * a plain object-array → one item per object; undefined/null → []; any other value → a single
 * wrapped item `{ json: { value } }`.
 */
export function toItems(upstream: unknown): WorkflowItem[] {
  if (upstream === undefined || upstream === null) return [];
  if (isItemArray(upstream)) return upstream;
  // A plugin-node returns the `{ items: WorkflowItem[], meta? }` envelope; unwrap it so a
  // downstream node sees the items, not the wrapper. (The node's full output, incl. meta, is
  // still recorded in run history.) Only a genuine WorkflowItem[] under `items` unwraps.
  if (isRecord(upstream) && isItemArray((upstream as { items?: unknown }).items)) {
    return (upstream as { items: WorkflowItem[] }).items;
  }
  if (isRecord(upstream) && Array.isArray((upstream as { rows?: unknown }).rows)) {
    return (upstream as { rows: unknown[] }).rows.map((r) => ({ json: isRecord(r) ? r : { value: r } }));
  }
  if (Array.isArray(upstream)) {
    return upstream.map((r) => ({ json: isRecord(r) ? r : { value: r } }));
  }
  if (isRecord(upstream)) return [{ json: upstream }];
  return [{ json: { value: upstream } }];
}

/** rows → items (source-handler convenience). */
export const rowsToItems = (rows: Record<string, unknown>[]): WorkflowItem[] => rows.map((json) => ({ json }));

/** Inverse for host-node interop: items → { columns, rows }; columns = union of row keys in order. */
export function fromItems(items: WorkflowItem[]): { columns: { key: string; label: string }[]; rows: Record<string, unknown>[] } {
  const rows = items.map((i) => i.json);
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  return { columns: keys.map((k) => ({ key: k, label: k })), rows };
}
