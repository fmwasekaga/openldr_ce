/**
 * The OpenLDR CE error-code catalog + the AppError primitive.
 *
 * One catalog, quoted everywhere: a code like `RP0003` means the same thing in a UI toast,
 * a server log line, and an audit row. Codes are STABLE support/log identifiers — the server
 * owns the (English) message and studio displays it verbatim; there is no client-side
 * code→text remapping (see the 2026-07-02 design spec).
 *
 * Code format: 2–4 letter domain prefix + 4-digit number, e.g. `RP0001`.
 */

/** A single catalog entry: the stable meaning + default HTTP mapping of one code. */
export interface CatalogEntry {
  code: string;
  domain: string;
  httpStatus: number;
  /** Default English message. Callers may override per-occurrence via appError(code, { message }). */
  message: string;
  /** Hint that the failure is transient and worth retrying. Default false. */
  retryable?: boolean;
}

/** Prefix → human domain name. Drives `domainForPrefix` and the CLI `errors list` grouping. */
export const DOMAINS: Readonly<Record<string, string>> = {
  RP: 'reports',
  CN: 'connectors',
  FM: 'forms',
  AU: 'auth',
  DB: 'dashboards',
  SY: 'system',
};

// Per-domain tables. Kept as flat literals so the whole vocabulary is greppable in one file.
const ENTRIES: readonly CatalogEntry[] = [
  // Reports (RP)
  { code: 'RP0001', domain: 'reports', httpStatus: 400, message: 'date range not selected' },
  { code: 'RP0002', domain: 'reports', httpStatus: 404, message: 'report not found' },
  { code: 'RP0003', domain: 'reports', httpStatus: 500, message: 'report generation failed' },
  { code: 'RP0004', domain: 'reports', httpStatus: 400, message: 'invalid report parameters' },
  { code: 'RP0005', domain: 'reports', httpStatus: 400, message: 'report is PDF-only and has no tabular data' },
  // Connectors (CN)
  { code: 'CN0001', domain: 'connectors', httpStatus: 404, message: 'connector not found' },
  { code: 'CN0002', domain: 'connectors', httpStatus: 503, message: 'connector unreachable', retryable: true },
  { code: 'CN0003', domain: 'connectors', httpStatus: 502, message: 'connector authentication failed' },
  { code: 'CN0004', domain: 'connectors', httpStatus: 500, message: 'connector secret could not be decrypted' },
  // Forms / validation (FM)
  { code: 'FM0001', domain: 'forms', httpStatus: 400, message: 'form validation failed' },
  { code: 'FM0002', domain: 'forms', httpStatus: 404, message: 'form not found' },
  { code: 'FM0003', domain: 'forms', httpStatus: 400, message: 'a required field is missing' },
  // Auth (AU)
  { code: 'AU0001', domain: 'auth', httpStatus: 401, message: 'your session has expired' },
  { code: 'AU0002', domain: 'auth', httpStatus: 401, message: 'authentication required' },
  { code: 'AU0003', domain: 'auth', httpStatus: 403, message: 'insufficient permissions' },
  // Dashboards (DB)
  { code: 'DB0001', domain: 'dashboards', httpStatus: 400, message: 'dashboard query failed' },
  { code: 'DB0002', domain: 'dashboards', httpStatus: 403, message: 'SQL authoring is disabled' },
  { code: 'DB0003', domain: 'dashboards', httpStatus: 404, message: 'dashboard model not found' },
  // System / fallback (SY)
  { code: 'SY0400', domain: 'system', httpStatus: 400, message: 'bad request' },
  { code: 'SY0500', domain: 'system', httpStatus: 500, message: 'unexpected server error' },
  { code: 'SY0503', domain: 'system', httpStatus: 503, message: 'a backing service is unavailable', retryable: true },
];

/** The assembled catalog, keyed by code. */
export const CATALOG: Readonly<Record<string, CatalogEntry>> = Object.freeze(
  Object.fromEntries(ENTRIES.map((e) => [e.code, Object.freeze(e)])),
);

/** A coded, HTTP-mapped application error. The central server error handler stamps correlationId. */
export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly retryable: boolean;
  readonly details?: unknown;
  correlationId?: string;
  constructor(entry: CatalogEntry, opts?: { message?: string; details?: unknown; cause?: unknown }) {
    super(opts?.message ?? entry.message, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = entry.code;
    this.httpStatus = entry.httpStatus;
    this.retryable = entry.retryable ?? false;
    this.details = opts?.details;
  }
}

/** Construct an AppError from a catalog code. Throws if the code is unknown (a programmer error). */
export function appError(code: string, opts?: { message?: string; details?: unknown; cause?: unknown }): AppError {
  const entry = CATALOG[code];
  if (!entry) throw new Error(`unknown error code: ${code}`);
  return new AppError(entry, opts);
}

/** All catalog entries for a domain prefix, sorted by code. */
export function catalogFor(prefix: string): CatalogEntry[] {
  return Object.values(CATALOG).filter((e) => e.code.startsWith(prefix)).sort((a, b) => a.code.localeCompare(b.code));
}

/** Human domain name for a 2-letter prefix, or undefined. */
export function domainForPrefix(prefix: string): string | undefined {
  return DOMAINS[prefix];
}

/**
 * Classify a NON-AppError thrown value into a fallback `SY####` code, so nothing is ever codeless.
 * Mirrors the pre-existing reports mapError heuristic: ZodError → 400, conn-refused/timeout → 503.
 */
export function codeForUnknown(err: unknown): 'SY0400' | 'SY0500' | 'SY0503' {
  // ZodError is identified structurally (avoid importing zod into core just for instanceof).
  if (err instanceof Error && (err.name === 'ZodError' || Array.isArray((err as { issues?: unknown }).issues))) {
    return 'SY0400';
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|\bconnect(ion)?\b/i.test(msg)) return 'SY0503';
  return 'SY0500';
}
