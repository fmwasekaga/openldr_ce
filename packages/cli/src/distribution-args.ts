export const DISTRIBUTION_SYSTEMS = new Set(['loinc', 'snomed', 'rxnorm']);

// Pure argument validation for `terminology distribution import`, split out so the branch logic is
// unit-testable without a database/blob store. Returns an error message, or null when valid.
export function validateDistributionImportArgs(system: string, opts: { file?: string; acceptLicense?: boolean }): string | null {
  if (!DISTRIBUTION_SYSTEMS.has(system)) return `unsupported system '${system}' (loinc|snomed|rxnorm)`;
  if (!opts.file) return 'missing --file <dist.zip>';
  if (!opts.acceptLicense) return 'the distribution license must be accepted (pass --accept-license)';
  return null;
}

// True when an insertRunning failure is a legitimate "an import is already running" signal rather
// than a real error. Two such signals exist: the store's own hasActive guard (throws an Error whose
// message contains "already active") and the active_key unique-index race in Postgres (SQLSTATE
// 23505, unique_violation). Anything else — a dropped connection, a bad config — must be surfaced
// truthfully, not mislabeled as a conflict. Pure, so it is unit-testable without a database.
export function isActiveJobConflict(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  if (code === '23505') return true; // Postgres unique_violation on active_key
  const msg = err instanceof Error ? err.message : String(err);
  return /already active/i.test(msg);
}
