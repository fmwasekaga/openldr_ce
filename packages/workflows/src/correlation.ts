/** Derive a payload correlation id (the Persist Store batchId) for a run.
 *  1. Reactive/ingest/event runs carry batchId in the trigger input payload.
 *  2. An originating run stamps it via a Persist Store node's meta.batchId. */
export function extractCorrelationId(
  input: unknown,
  result: { results?: Array<{ meta?: unknown }> },
): string | null {
  const fromInput = (input as { batchId?: unknown } | null)?.batchId;
  if (typeof fromInput === 'string' && fromInput) return fromInput;
  for (const r of result.results ?? []) {
    const b = (r.meta as { batchId?: unknown } | null | undefined)?.batchId;
    if (typeof b === 'string' && b) return b;
  }
  return null;
}
