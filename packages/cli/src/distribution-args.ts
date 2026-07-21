export const DISTRIBUTION_SYSTEMS = new Set(['loinc', 'snomed', 'rxnorm']);

// Pure argument validation for `terminology distribution import`, split out so the branch logic is
// unit-testable without a database/blob store. Returns an error message, or null when valid.
export function validateDistributionImportArgs(system: string, opts: { file?: string; acceptLicense?: boolean }): string | null {
  if (!DISTRIBUTION_SYSTEMS.has(system)) return `unsupported system '${system}' (loinc|snomed|rxnorm)`;
  if (!opts.file) return 'missing --file <dist.zip>';
  if (!opts.acceptLicense) return 'the distribution license must be accepted (pass --accept-license)';
  return null;
}
