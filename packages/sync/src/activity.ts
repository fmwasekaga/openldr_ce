import type { SyncActivityEventKind } from '@openldr/db';

/** One high-signal sync outcome, direction-bound by the recorder that emits it. */
export interface SyncActivityEntry {
  event: SyncActivityEventKind;
  records?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

/** A per-direction sink the runners write to. Implementations MUST be fire-and-forget and MUST NOT throw
 *  back into the cycle — sync correctness never depends on the activity write succeeding. */
export interface SyncActivityRecorder {
  /** Called once at the start of every cycle (including idle ones) — updates in-memory liveness only. */
  attempt(): void;
  /** Called only when something happened. Persists a row + updates in-memory success/error markers. */
  record(entry: SyncActivityEntry): void;
}

/** Scrub secrets from an error before it is stored/shown: redact `Bearer <token>` and JWT-shaped
 *  substrings, and cap length. Transport/token errors are the only ones that could carry a credential. */
export function sanitizeSyncError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  let s = raw
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/eyJ[A-Za-z0-9._-]{10,}/g, '[redacted-jwt]');
  if (s.length > 500) s = `${s.slice(0, 500)}…`;
  return s;
}
