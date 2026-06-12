import type { HealthResult } from '@openldr/ports';
import { errorMessage } from './errors';
import { redact } from './redact';

/** Time a liveness probe; convert success/throw into a HealthResult. */
export async function probe(fn: () => Promise<string | void>): Promise<HealthResult> {
  const start = performance.now();
  try {
    const detail = await fn();
    return {
      status: 'up',
      latencyMs: Math.round(performance.now() - start),
      detail: detail || undefined,
    };
  } catch (err) {
    return {
      status: 'down',
      latencyMs: Math.round(performance.now() - start),
      detail: redact(errorMessage(err)),
    };
  }
}
