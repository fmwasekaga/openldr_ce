const BASE_MS = 1000;
const MAX_BACKOFF_MS = 300_000;

/** Exponential backoff in ms for a given (1-based) attempt count, capped. */
export function backoff(attempts: number): number {
  return Math.min(MAX_BACKOFF_MS, BASE_MS * 2 ** attempts);
}
