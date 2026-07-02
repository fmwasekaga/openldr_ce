# Error-code / Debuggability System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every failure traceable — API errors carry a real message + stable code + short correlation id (in the UI and the server log), and process-crash capture is hardened against restart-loop flooding.

**Architecture:** Two channels sharing one code catalog. Channel 1 (request/API): a shared `AppError` + catalog in `@openldr/core`, a central Fastify `setErrorHandler` emitting a flat `{ error, code, correlationId }` body, and studio formatting `message · code · id`. Channel 2 (process): the existing `crash-log` → `system.crash` audit path gains a per-crash fingerprint (coalesced on drain with occurrence counts) and a boot-time restart circuit-breaker.

**Tech Stack:** TypeScript, Fastify, Zod, vitest, commander (CLI), pnpm workspaces + turbo.

**Conventions (from repo memory):**
- Do **not** run `pnpm build` for the server (esbuild bundle fails on native deps). Verify with **typecheck + vitest**.
- Cross-package changes to `@openldr/core` shared types → run `pnpm typecheck --force` covering core, bootstrap, server, cli.
- Studio has ONE pre-existing failing test (`api.test.ts` "includes server error messages…"); expect **605/606**. Run studio tests isolated: `pnpm -C apps/studio test`.
- Per-package vitest: `pnpm -C packages/core test`, `pnpm -C packages/bootstrap test`, `pnpm -C apps/server test`, `pnpm -C packages/cli test`.
- Work on local `main`; frequent commits. Leave the pre-existing uncommitted `.gitignore` + four untracked `scripts/*.ts` alone.

---

## File Structure

**Channel 1 — codes & primitive**
- Create `packages/core/src/error-catalog.ts` — `AppError`, `CatalogEntry`, `CATALOG`, `appError`, `catalogFor`, `domainForPrefix`, `codeForUnknown`.
- Create `packages/core/src/error-catalog.test.ts` — catalog invariants + construction + classification.
- Modify `packages/core/src/index.ts` — add `export * from './error-catalog';`.

**Channel 1 — server**
- Create `apps/server/src/error-handler.ts` — `toErrorResponse(err)` (classify → `{ status, code, message }`) + `registerErrorHandler(app)`.
- Create `apps/server/src/error-handler.test.ts`.
- Modify `apps/server/src/app.ts` — `genReqId` + `registerErrorHandler(app)`.
- Modify `apps/server/src/reports-routes.ts` — delete `mapError`; throw `appError(...)`.

**Channel 1 — studio**
- Modify `apps/studio/src/api.ts` — `errorDetail` returns `{ message, code?, correlationId? }`; `okJson` formats; migrate bare-status dashboard throws.

**Channel 2 — crashes**
- Modify `packages/core/src/crash-log.ts` — add `fingerprint` to `CrashMarker`, compute in `buildCrashMarker`; add `readCrashMarkers` (non-destructive) + `detectCrashLoop`.
- Create `packages/core/src/crash-log.test.ts` — fingerprint stability + loop detection.
- Modify `packages/bootstrap/src/crash-audit.ts` — coalesce markers by fingerprint with counts; map `crash.loop` kind → `system.crash_loop`.
- Modify `packages/bootstrap/src/crash-audit.test.ts` — coalescing test.
- Modify `packages/config/src/schema.ts` — crash-loop config keys.
- Modify `apps/server/src/index.ts` — boot-time crash-loop check (sleep-then-exit backoff).

**CLI parity**
- Create `packages/cli/src/errors.ts` — `runErrorsList(opts)`.
- Modify `packages/cli/src/index.ts` — wire `errors list`.

---

## Task 1: The `AppError` primitive + catalog (`@openldr/core`)

**Files:**
- Create: `packages/core/src/error-catalog.ts`
- Test: `packages/core/src/error-catalog.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/error-catalog.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { AppError, CATALOG, appError, catalogFor, domainForPrefix, codeForUnknown } from './error-catalog';
import { ZodError } from 'zod';

describe('error catalog', () => {
  it('every code is well-formed and unique', () => {
    const codes = Object.keys(CATALOG);
    expect(codes.length).toBeGreaterThan(0);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z]{2,4}\d{4}$/);
      expect(CATALOG[code].code).toBe(code); // entry self-consistent
      expect(CATALOG[code].httpStatus).toBeGreaterThanOrEqual(400);
    }
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('appError builds an AppError from the catalog', () => {
    const err = appError('RP0001');
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe('RP0001');
    expect(err.httpStatus).toBe(400);
    expect(err.message).toBe(CATALOG.RP0001.message);
  });

  it('appError message override keeps the code', () => {
    const err = appError('FM0003', { message: 'field "patientId" is required' });
    expect(err.code).toBe('FM0003');
    expect(err.message).toBe('field "patientId" is required');
  });

  it('appError throws for an unknown code (programmer error)', () => {
    expect(() => appError('ZZ9999')).toThrow(/unknown error code/i);
  });

  it('catalogFor lists a domain by prefix', () => {
    const reports = catalogFor('RP');
    expect(reports.every((e) => e.code.startsWith('RP'))).toBe(true);
    expect(reports.length).toBeGreaterThanOrEqual(4);
  });

  it('domainForPrefix maps known prefixes', () => {
    expect(domainForPrefix('RP')).toBe('reports');
    expect(domainForPrefix('ZZ')).toBeUndefined();
  });

  it('codeForUnknown classifies raw errors to SY codes', () => {
    expect(codeForUnknown(new ZodError([]))).toBe('SY0400');
    expect(codeForUnknown(new Error('connect ECONNREFUSED 127.0.0.1:5432'))).toBe('SY0503');
    expect(codeForUnknown(new Error('boom'))).toBe('SY0500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test error-catalog`
Expected: FAIL — module `./error-catalog` not found.

- [ ] **Step 3: Write the implementation**

Create `packages/core/src/error-catalog.ts`:

```ts
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
  Object.fromEntries(ENTRIES.map((e) => [e.code, e])),
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
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connection|connect\b/i.test(msg)) return 'SY0503';
  return 'SY0500';
}
```

- [ ] **Step 4: Export from the core barrel**

In `packages/core/src/index.ts`, add after the existing `export * from './errors';` line:

```ts
export * from './error-catalog';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/core test error-catalog`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/error-catalog.ts packages/core/src/error-catalog.test.ts packages/core/src/index.ts
git commit -m "feat(core): AppError primitive + coded error catalog"
```

---

## Task 2: Central server error handler (`apps/server`)

**Files:**
- Create: `apps/server/src/error-handler.ts`
- Test: `apps/server/src/error-handler.test.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/error-handler.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { toErrorResponse } from './error-handler';
import { appError } from '@openldr/core';
import { ZodError } from 'zod';

describe('toErrorResponse', () => {
  it('maps an AppError to its code + status + message', () => {
    const r = toErrorResponse(appError('RP0001'));
    expect(r).toEqual({ status: 400, code: 'RP0001', message: 'date range not selected' });
  });

  it('maps an AppError message override through', () => {
    const r = toErrorResponse(appError('FM0003', { message: 'field "x" required' }));
    expect(r).toEqual({ status: 400, code: 'FM0003', message: 'field "x" required' });
  });

  it('classifies a ZodError to SY0400', () => {
    const r = toErrorResponse(new ZodError([]));
    expect(r.code).toBe('SY0400');
    expect(r.status).toBe(400);
  });

  it('classifies a connection error to SY0503', () => {
    const r = toErrorResponse(new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    expect(r.code).toBe('SY0503');
    expect(r.status).toBe(503);
  });

  it('classifies an unknown error to SY0500 and keeps its real message', () => {
    const r = toErrorResponse(new Error('kaboom'));
    expect(r.code).toBe('SY0500');
    expect(r.status).toBe(500);
    expect(r.message).toBe('kaboom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/server test error-handler`
Expected: FAIL — `./error-handler` not found.

- [ ] **Step 3: Write the implementation**

Create `apps/server/src/error-handler.ts`:

```ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { AppError, CATALOG, codeForUnknown, errorMessage } from '@openldr/core';

export interface ErrorResponse {
  status: number;
  code: string;
  message: string;
}

/**
 * Classify any thrown value into { status, code, message }. AppErrors carry their own code +
 * status; everything else is mapped to a SY#### fallback (ZodError→400, conn-refused→503,
 * else 500) while preserving the REAL error message so "500" is never opaque.
 */
export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    return { status: err.httpStatus, code: err.code, message: err.message };
  }
  const code = codeForUnknown(err);
  const entry = CATALOG[code];
  // Prefer the real error message; fall back to the catalog default only when empty.
  const message = errorMessage(err) || entry.message;
  return { status: entry.httpStatus, code, message };
}

/**
 * Install the single central error handler. Emits a FLAT, back-compatible body:
 *   { error: <message>, code: <RP0001>, correlationId: <8-char req.id> }
 * `error` stays the message string (studio's errorDetail already reads body.error). Logs exactly
 * one line per failure — error level for 5xx, warn for 4xx — so the correlationId in the UI greps
 * straight to the server log.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const { status, code, message } = toErrorResponse(err);
    const correlationId = String(req.id);
    const line = { code, correlationId, err };
    if (status >= 500) req.log.error(line, message);
    else req.log.warn(line, message);
    void reply.code(status).send({ error: message, code, correlationId });
  });
}
```

- [ ] **Step 4: Wire it into the app + add a short correlation id**

In `apps/server/src/app.ts`:

1. Add imports at the top (after the existing `import Fastify from 'fastify';`):

```ts
import { randomUUID } from 'node:crypto';
import { registerErrorHandler } from './error-handler';
```

2. Change the Fastify constructor in `buildApp` (line ~48) from:

```ts
  const app = Fastify({ loggerInstance: ctx.logger });
```

to:

```ts
  const app = Fastify({
    loggerInstance: ctx.logger,
    // Short 8-char correlation id per request; surfaces in every error body + one log line.
    genReqId: () => randomUUID().replace(/-/g, '').slice(0, 8),
  });
  registerErrorHandler(app);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -C apps/server test error-handler`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/error-handler.ts apps/server/src/error-handler.test.ts apps/server/src/app.ts
git commit -m "feat(server): central error handler with codes + correlation id"
```

---

## Task 3: Migrate reports routes to `appError` (`apps/server`)

**Files:**
- Modify: `apps/server/src/reports-routes.ts`

Context: `mapError` (lines ~199-212) currently classifies `ReportNotFoundError`→404, `ZodError`→400 `'invalid parameters'`, conn→503, else 500, and returns a flat `{ error }`. The central handler (Task 2) now does the ZodError/conn/unknown classification, so `mapError` collapses into throwing `appError` for the reports-specific cases and re-throwing the rest.

- [ ] **Step 1: Replace `mapError` with a reports-specific classifier that throws**

In `apps/server/src/reports-routes.ts`, replace the whole `mapError` function (lines ~199-212) with:

```ts
// Reports-specific error mapping: turn the known reports failures into catalog codes and throw
// so the central error handler renders them uniformly ({ error, code, correlationId }). Anything
// else re-throws unchanged and is classified as a SY#### fallback by the central handler.
function mapError(err: unknown, reply: FastifyReply): never {
  void reply; // status now comes from the AppError via the central handler
  if (err instanceof ReportNotFoundError) throw appError('RP0002', { message: err.message, cause: err });
  if (err instanceof ZodError) throw appError('RP0004', { cause: err });
  throw err;
}
```

Note: `mapError` callers use `return mapError(err, reply);` — a `never` return keeps those call sites valid (the function throws).

- [ ] **Step 2: Add the import**

At the top of `apps/server/src/reports-routes.ts`, add `appError` to the `@openldr/core` import (create the import if the file does not already import from core):

```ts
import { appError } from '@openldr/core';
```

- [ ] **Step 3: Convert the direct not-found returns**

Find the two direct not-found returns and convert them to throw the code. Replace:

```ts
    if (!def) {
      reply.code(404);
```

...the `{ error: ... }` return that follows with `throw appError('RP0002', { message: \`report not found: ${id}\` });`. Likewise replace:

```ts
    if (!ctx.reporting.list().find((r) => r.id === id)) { reply.code(404); return { error: `report not found: ${id}` }; }
```

with:

```ts
    if (!ctx.reporting.list().find((r) => r.id === id)) throw appError('RP0002', { message: `report not found: ${id}` });
```

and the schedule not-found:

```ts
    if (!existing) { reply.code(404); return { error: `schedule not found: ${sid}` }; }
```

with:

```ts
    if (!existing) throw appError('RP0002', { message: `schedule not found: ${sid}` });
```

- [ ] **Step 4: Run reports route tests**

Run: `pnpm -C apps/server test reports`
Expected: PASS. If a test asserts the old `'invalid parameters'` string, update it to expect `code: 'RP0004'` / the catalog message `'invalid report parameters'`.

- [ ] **Step 5: Typecheck the server package**

Run: `pnpm -C apps/server exec tsc --noEmit`
Expected: no errors (confirms `never` return + removed `FastifyReply` usage compile).

- [ ] **Step 6: Commit**

```bash
git add apps/server/src/reports-routes.ts
git commit -m "refactor(server): reports routes throw catalog codes via appError"
```

---

## Task 4: Studio surfaces code + correlation id (`apps/studio`)

**Files:**
- Modify: `apps/studio/src/api.ts`

Context: `errorDetail` (line ~541) returns a `string`; `okJson` (line ~551) throws `\`${what} failed: ${detail}\``. We extend `errorDetail` to also read `code` + `correlationId` and format them into the thrown message, so every existing toast/error display shows the code with no per-call-site edits. Then migrate the bare `throw new Error(\`... ${res.status}\`)` dashboard sites (the "list failed: 401" example) to route through `okJson`.

- [ ] **Step 1: Write the failing test**

Add to `apps/studio/src/api.test.ts` (new `describe` block; keep existing tests):

```ts
import { describe, it, expect } from 'vitest';
import { formatApiError } from './api';

describe('formatApiError', () => {
  it('appends code and correlation id when present', () => {
    expect(formatApiError('list dashboards', { message: 'your session has expired', code: 'AU0001', correlationId: 'a1b2c3d4' }))
      .toBe('list dashboards failed: your session has expired · AU0001 · a1b2c3d4');
  });
  it('omits code/id when absent', () => {
    expect(formatApiError('list dashboards', { message: 'boom' })).toBe('list dashboards failed: boom');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C apps/studio test api.test`
Expected: FAIL — `formatApiError` is not exported.

- [ ] **Step 3: Refactor `errorDetail` + `okJson` and add `formatApiError`**

In `apps/studio/src/api.ts`, replace the `errorDetail` + `okJson` block (lines ~541-554) with:

```ts
interface ApiErrorDetail { message: string; code?: string; correlationId?: string }

async function errorDetail(res: Response): Promise<ApiErrorDetail> {
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const body = await res.json().catch(() => null) as { error?: unknown; message?: unknown; code?: unknown; correlationId?: unknown } | null;
    const detail = body?.error ?? body?.message;
    const message = typeof detail === 'string' && detail.trim() ? detail.trim() : String(res.status);
    return {
      message,
      code: typeof body?.code === 'string' ? body.code : undefined,
      correlationId: typeof body?.correlationId === 'string' ? body.correlationId : undefined,
    };
  }
  const text = await res.text().catch(() => '');
  return { message: text.trim() || String(res.status) };
}

/** Format a failed API call into a single user-facing string: "<what> failed: <message> · <code> · <id>". */
export function formatApiError(what: string, detail: ApiErrorDetail): string {
  const parts = [detail.message];
  if (detail.code) parts.push(detail.code);
  if (detail.correlationId) parts.push(detail.correlationId);
  return `${what} failed: ${parts.join(' · ')}`;
}

async function okJson<T>(res: Response, what: string): Promise<T> {
  if (!res.ok) throw new Error(formatApiError(what, await errorDetail(res)));
  return res.json() as Promise<T>;
}
```

- [ ] **Step 4: Migrate the bare-status dashboard throws**

In `apps/studio/src/api.ts`, the dashboard block (lines ~279-299) uses `throw new Error(\`... failed: ${res.status}\`)`. Convert each to `okJson` (which now yields message · code · id). Replace those lines with:

```ts
  authFetch('/api/dashboards/models').then((r) => okJson<DashboardModel[]>(r, 'load models'));
```

...(models); the query one:

```ts
  authFetch('/api/dashboards/query', json(q)).then((r) => okJson<QueryResult>(r, 'run query'));
```

...(list/get/create/save):

```ts
  authFetch('/api/dashboards').then((r) => okJson<DashboardSummary[]>(r, 'list dashboards'));
  authFetch(`/api/dashboards/${id}`).then((r) => okJson<Dashboard>(r, 'get dashboard'));
  authFetch('/api/dashboards', json(d)).then((r) => okJson<Dashboard>(r, 'create dashboard'));
  authFetch(`/api/dashboards/${d.id}`, { ...json(d), method: 'PUT' }).then((r) => okJson<Dashboard>(r, 'save dashboard'));
```

Keep the exact generic types + local variable names already present at those call sites (read the surrounding lines and preserve the existing `DashboardModel`/`QueryResult`/`Dashboard`/`DashboardSummary` type names — do not invent new ones). The `delete` one (returns no body) stays as `apiDelete(...)` or its existing bare form.

- [ ] **Step 5: Run studio tests (isolated)**

Run: `pnpm -C apps/studio test`
Expected: **605 pass / 1 pre-existing fail** (`api.test.ts` "includes server error messages…"). Confirm the new `formatApiError` cases pass. If the pre-existing failing test now passes because of the refactor, that is fine — note it.

- [ ] **Step 6: Commit**

```bash
git add apps/studio/src/api.ts apps/studio/src/api.test.ts
git commit -m "feat(studio): surface error code + correlation id in API failures"
```

---

## Task 5: Crash fingerprint + non-destructive read + loop detection (`@openldr/core`)

**Files:**
- Modify: `packages/core/src/crash-log.ts`
- Test: `packages/core/src/crash-log.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/crash-log.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCrashMarker, appendCrashMarker, readCrashMarkers, detectCrashLoop } from './crash-log';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'crashlog-')); });

describe('crash fingerprint', () => {
  it('is stable across identical crashes and varies with the message', () => {
    const a = buildCrashMarker('uncaughtException', new Error('DB pool exhausted'));
    const b = buildCrashMarker('uncaughtException', new Error('DB pool exhausted'));
    const c = buildCrashMarker('uncaughtException', new Error('totally different'));
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
  });
  it('ignores volatile numbers/uuids in the message', () => {
    const a = buildCrashMarker('uncaughtException', new Error('connect ECONNREFUSED 127.0.0.1:5432'));
    const b = buildCrashMarker('uncaughtException', new Error('connect ECONNREFUSED 10.9.8.7:6543'));
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe('readCrashMarkers (non-destructive)', () => {
  it('reads without clearing the file', () => {
    appendCrashMarker(dir, buildCrashMarker('uncaughtException', new Error('x')));
    expect(readCrashMarkers(dir)).toHaveLength(1);
    expect(readCrashMarkers(dir)).toHaveLength(1); // still there
  });
  it('returns [] when no file exists', () => {
    rmSync(dir, { recursive: true, force: true });
    expect(readCrashMarkers(dir)).toEqual([]);
  });
});

describe('detectCrashLoop', () => {
  const mk = (atMs: number) => ({ ...buildCrashMarker('uncaughtException', new Error('x')), at: new Date(atMs).toISOString() });
  it('trips when >= threshold crashes fall within the window', () => {
    const now = 100_000;
    const markers = [mk(now - 5_000), mk(now - 10_000), mk(now - 15_000), mk(now - 20_000), mk(now - 25_000)];
    const r = detectCrashLoop(markers, { nowMs: now, windowSec: 60, threshold: 5 });
    expect(r.tripped).toBe(true);
    expect(r.count).toBe(5);
  });
  it('does not trip when crashes are outside the window', () => {
    const now = 1_000_000;
    const markers = [mk(now - 5_000), mk(now - 120_000), mk(now - 130_000)];
    const r = detectCrashLoop(markers, { nowMs: now, windowSec: 60, threshold: 3 });
    expect(r.tripped).toBe(false);
    expect(r.count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/core test crash-log`
Expected: FAIL — `readCrashMarkers`/`detectCrashLoop` not exported; `fingerprint` undefined.

- [ ] **Step 3: Add `fingerprint` to the marker type + `buildCrashMarker`**

In `packages/core/src/crash-log.ts`:

1. Add to the top imports:

```ts
import { createHash } from 'node:crypto';
```

2. Add a `fingerprint` field to the `CrashMarker` interface (after `stack?: string;`):

```ts
  /** Stable hash of (kind + normalized message + top stack frame) — groups repeat crashes on drain. */
  fingerprint: string;
```

3. Add a fingerprint helper above `buildCrashMarker`:

```ts
/** Normalize a crash into a stable fingerprint so a restart loop of the SAME crash coalesces.
 *  Volatile tokens (numbers, uuids, hex, ports, paths) are stripped so incidental differences
 *  (a changing IP or pid) don't fragment the group. */
export function crashFingerprint(kind: string, message: string, stack?: string): string {
  const topFrame = (stack ?? '').split('\n').find((l) => l.trim().startsWith('at ')) ?? '';
  const normalized = `${kind}|${message}|${topFrame}`
    .replace(/0x[0-9a-fA-F]+/g, '0x#')
    .replace(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '#uuid')
    .replace(/\d+/g, '#')
    .toLowerCase();
  return createHash('sha1').update(normalized).digest('hex').slice(0, 12);
}
```

4. In `buildCrashMarker`, add the fingerprint to the returned object (compute from the message + stack it already builds):

```ts
export function buildCrashMarker(kind: CrashMarker['kind'], err: unknown): CrashMarker {
  const e = err instanceof Error ? err : undefined;
  const error = e ? e.message : String(err);
  const stack = e?.stack;
  return {
    at: new Date().toISOString(),
    kind,
    error,
    ...(stack ? { stack } : {}),
    fingerprint: crashFingerprint(kind, error, stack),
    inFlight: currentInFlight(),
  };
}
```

- [ ] **Step 4: Add `readCrashMarkers` (non-destructive) + `detectCrashLoop`**

Append to `packages/core/src/crash-log.ts` (after `drainCrashMarkers`):

```ts
/** Read crash markers WITHOUT clearing them (used by the boot-time crash-loop check, which must
 *  run before the audit store exists and must not consume markers the later drain will audit). */
export function readCrashMarkers(dir: string): CrashMarker[] {
  const file = join(dir, CRASH_FILE);
  if (!existsSync(file)) return [];
  let content = '';
  try { content = readFileSync(file, 'utf8'); } catch { return []; }
  const markers: CrashMarker[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try { markers.push(JSON.parse(trimmed) as CrashMarker); } catch { /* skip torn line */ }
  }
  return markers;
}

export interface CrashLoopVerdict {
  tripped: boolean;
  /** How many crashes fell within the window. */
  count: number;
  firstAt?: string;
  lastAt?: string;
}

/** Decide whether the recent crash history constitutes a restart loop: >= `threshold` crashes
 *  within the last `windowSec` seconds. Pure + injectable clock for tests. Ignores `crash.loop`
 *  markers themselves so the breaker doesn't feed on its own output. */
export function detectCrashLoop(
  markers: CrashMarker[],
  opts: { nowMs: number; windowSec: number; threshold: number },
): CrashLoopVerdict {
  const cutoff = opts.nowMs - opts.windowSec * 1000;
  const recent = markers
    .filter((m) => m.kind !== 'crash.loop')
    .filter((m) => { const t = Date.parse(m.at); return Number.isFinite(t) && t >= cutoff; })
    .sort((a, b) => a.at.localeCompare(b.at));
  return {
    tripped: recent.length >= opts.threshold,
    count: recent.length,
    ...(recent.length ? { firstAt: recent[0].at, lastAt: recent[recent.length - 1].at } : {}),
  };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm -C packages/core test crash-log`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/crash-log.ts packages/core/src/crash-log.test.ts
git commit -m "feat(core): crash fingerprint + non-destructive read + loop detection"
```

---

## Task 6: Coalesce crash markers on drain (`@openldr/bootstrap`)

**Files:**
- Modify: `packages/bootstrap/src/crash-audit.ts`
- Modify: `packages/bootstrap/src/crash-audit.test.ts`

Context: today `drainCrashMarkersToAudit` writes one audit row per marker. Change it to group by `fingerprint` and write one row per group with `occurrenceCount` + `firstSeen` + `lastSeen`. Map the `crash.loop` kind (from Task 7) to action `system.crash_loop`.

- [ ] **Step 1: Write the failing test**

In `packages/bootstrap/src/crash-audit.test.ts`, add a case that seeds several identical-fingerprint markers and asserts ONE coalesced row. Use the existing test's harness style (a fake `AuditStore` capturing `record` calls). Add:

```ts
import { buildCrashMarker, appendCrashMarker } from '@openldr/core';

it('coalesces identical-fingerprint markers into one row with a count', async () => {
  // three identical crashes + one distinct
  appendCrashMarker(dir, buildCrashMarker('uncaughtException', new Error('DB pool exhausted')));
  appendCrashMarker(dir, buildCrashMarker('uncaughtException', new Error('DB pool exhausted')));
  appendCrashMarker(dir, buildCrashMarker('uncaughtException', new Error('DB pool exhausted')));
  appendCrashMarker(dir, buildCrashMarker('unhandledRejection', new Error('other')));
  const recorded: any[] = [];
  const audit = { record: async (r: any) => { recorded.push(r); }, list: async () => [] } as any;
  const n = await drainCrashMarkersToAudit({ dir, audit, logger });
  expect(n).toBe(4);                    // 4 markers drained
  expect(recorded).toHaveLength(2);     // coalesced into 2 rows
  const pool = recorded.find((r) => r.metadata.error === 'DB pool exhausted');
  expect(pool.metadata.occurrenceCount).toBe(3);
  expect(pool.metadata.firstSeen).toBeDefined();
  expect(pool.metadata.lastSeen).toBeDefined();
});
```

Match `dir`/`logger` setup to whatever the existing test file already defines (reuse its `beforeEach` temp dir + logger). If the file lacks them, add: `let dir: string; beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'crashaudit-')); });` and a no-op `logger`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/bootstrap test crash-audit`
Expected: FAIL — currently records 4 rows / no `occurrenceCount`.

- [ ] **Step 3: Rewrite the drain body to coalesce**

In `packages/bootstrap/src/crash-audit.ts`, replace the `for (const m of markers) { ... }` loop (lines ~20-37) with:

```ts
  // Group by fingerprint so a restart loop of the SAME crash collapses into one row that carries
  // an occurrence count + first/last-seen span, instead of thousands of near-identical rows.
  const groups = new Map<string, typeof markers>();
  for (const m of markers) {
    const key = m.fingerprint ?? `${m.kind}:${m.error}`;
    const g = groups.get(key);
    if (g) g.push(m); else groups.set(key, [m]);
  }
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) => a.at.localeCompare(b.at));
    const rep = sorted[sorted.length - 1]; // most recent as representative
    const culprit = rep.inFlight[0];
    const isLoop = rep.kind === 'crash.loop';
    await safeRecord(opts.audit, opts.logger, {
      actorType: 'system',
      actorName: 'system',
      action: isLoop ? 'system.crash_loop' : culprit ? 'plugin.crash' : 'system.crash',
      entityType: culprit ? 'plugin' : 'system',
      entityId: culprit?.pluginId ?? 'process',
      metadata: {
        kind: rep.kind,
        error: rep.error,
        fingerprint: rep.fingerprint,
        occurrenceCount: sorted.length,
        firstSeen: sorted[0].at,
        lastSeen: rep.at,
        inFlight: rep.inFlight,
        ...(rep.stack ? { stack: rep.stack } : {}),
      },
    });
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm -C packages/bootstrap test crash-audit`
Expected: PASS (both the new coalescing case and any existing crash-audit cases; existing single-marker cases now carry `occurrenceCount: 1`, `firstSeen == lastSeen` — update those assertions if they check exact metadata shape).

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/crash-audit.ts packages/bootstrap/src/crash-audit.test.ts
git commit -m "feat(bootstrap): coalesce crash markers by fingerprint with occurrence counts"
```

---

## Task 7: Restart circuit-breaker (config + boot wiring)

**Files:**
- Modify: `packages/config/src/schema.ts`
- Create: `packages/bootstrap/src/crash-loop.ts`
- Test: `packages/bootstrap/src/crash-loop.test.ts`
- Modify: `apps/server/src/index.ts`

- [ ] **Step 1: Add config keys**

In `packages/config/src/schema.ts`, after the `PLUGIN_CRASH_LOG_DIR` line (~123), add:

```ts
    // Restart circuit-breaker: if >= CRASH_LOOP_THRESHOLD process crashes occur within
    // CRASH_LOOP_WINDOW_SEC, the next boot writes one system.crash_loop marker and backs off
    // (escalating sleep-then-exit) so the orchestrator's restart policy slows a hot loop instead
    // of the app hot-spinning and flooding the crash log / audit trail.
    CRASH_LOOP_THRESHOLD: z.coerce.number().int().positive().default(5),
    CRASH_LOOP_WINDOW_SEC: z.coerce.number().int().positive().default(60),
    CRASH_LOOP_BACKOFF_MS: z.coerce.number().int().positive().default(2_000),
    CRASH_LOOP_BACKOFF_CAP_MS: z.coerce.number().int().positive().default(60_000),
```

- [ ] **Step 2: Write the failing test**

Create `packages/bootstrap/src/crash-loop.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCrashMarker, appendCrashMarker, readCrashMarkers } from '@openldr/core';
import { guardAgainstCrashLoop } from './crash-loop';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'crashloop-')); });

const cfg = { dir, threshold: 3, windowSec: 60, backoffMs: 1000, backoffCapMs: 8000 };

describe('guardAgainstCrashLoop', () => {
  it('is a no-op when below threshold', async () => {
    appendCrashMarker(dir, buildCrashMarker('uncaughtException', new Error('x')));
    const exit = vi.fn(); const sleep = vi.fn(async () => {});
    const tripped = await guardAgainstCrashLoop({ ...cfg, nowMs: 100_000, exit, sleep, log: () => {} });
    expect(tripped).toBe(false);
    expect(exit).not.toHaveBeenCalled();
  });

  it('trips at threshold: writes a crash.loop marker, sleeps with escalating backoff, then exits', async () => {
    const now = 100_000;
    for (let i = 0; i < 3; i++) appendCrashMarker(dir, { ...buildCrashMarker('uncaughtException', new Error('x')), at: new Date(now - i * 5000).toISOString() });
    const exit = vi.fn(); const sleep = vi.fn(async () => {});
    const tripped = await guardAgainstCrashLoop({ ...cfg, nowMs: now, exit, sleep, log: () => {} });
    expect(tripped).toBe(true);
    expect(sleep).toHaveBeenCalledOnce();
    const slept = sleep.mock.calls[0][0] as number;
    expect(slept).toBeGreaterThanOrEqual(cfg.backoffMs);
    expect(slept).toBeLessThanOrEqual(cfg.backoffCapMs);
    expect(exit).toHaveBeenCalledWith(1);
    // wrote exactly one crash.loop marker (not one per crash)
    const loopMarkers = readCrashMarkers(dir).filter((m) => m.kind === 'crash.loop');
    expect(loopMarkers).toHaveLength(1);
  });

  it('does not append a second crash.loop marker if the latest marker is already crash.loop', async () => {
    const now = 100_000;
    for (let i = 0; i < 3; i++) appendCrashMarker(dir, { ...buildCrashMarker('uncaughtException', new Error('x')), at: new Date(now - i * 5000).toISOString() });
    appendCrashMarker(dir, { ...buildCrashMarker('crash.loop', new Error('loop')), at: new Date(now - 1000).toISOString() });
    const exit = vi.fn(); const sleep = vi.fn(async () => {});
    await guardAgainstCrashLoop({ ...cfg, nowMs: now, exit, sleep, log: () => {} });
    const loopMarkers = readCrashMarkers(dir).filter((m) => m.kind === 'crash.loop');
    expect(loopMarkers).toHaveLength(1); // unchanged
    expect(exit).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm -C packages/bootstrap test crash-loop`
Expected: FAIL — `./crash-loop` not found.

- [ ] **Step 4: Implement the breaker**

Create `packages/bootstrap/src/crash-loop.ts`:

```ts
import { readCrashMarkers, detectCrashLoop, appendCrashMarker, buildCrashMarker, type CrashMarker } from '@openldr/core';

export interface CrashLoopGuardOpts {
  dir: string;
  threshold: number;
  windowSec: number;
  backoffMs: number;
  backoffCapMs: number;
  /** Injected for tests; default now. */
  nowMs?: number;
  /** Injected for tests; default process.exit. */
  exit?: (code: number) => void;
  /** Injected for tests; default real sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional structured log hook. */
  log?: (v: { count: number; firstAt?: string; lastAt?: string; backoffMs: number }) => void;
}

/**
 * Boot-time restart circuit-breaker. Reads the crash markers (non-destructively — the later audit
 * drain still consumes them), and if they show a restart loop, records ONE `crash.loop` marker,
 * backs off (escalating sleep scaled by how far over threshold we are, capped), then exits so the
 * orchestrator's restart policy slows the loop. Returns true when it tripped (caller should stop).
 */
export async function guardAgainstCrashLoop(opts: CrashLoopGuardOpts): Promise<boolean> {
  const nowMs = opts.nowMs ?? Date.now();
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const markers = readCrashMarkers(opts.dir);
  const verdict = detectCrashLoop(markers, { nowMs, windowSec: opts.windowSec, threshold: opts.threshold });
  if (!verdict.tripped) return false;

  // Escalating backoff: base * 2^(overThreshold), capped. More crashes → longer cool-off.
  const over = Math.max(0, verdict.count - opts.threshold);
  const backoff = Math.min(opts.backoffMs * 2 ** over, opts.backoffCapMs);

  // Record ONE loop marker (deduped: skip if the most recent marker is already a loop marker) so
  // the next healthy boot's drain surfaces a single system.crash_loop row rather than a pile.
  const latest = markers[markers.length - 1] as CrashMarker | undefined;
  if (!latest || latest.kind !== 'crash.loop') {
    const marker = buildCrashMarker('crash.loop', new Error(`restart loop: ${verdict.count} crashes in ${opts.windowSec}s`));
    try { appendCrashMarker(opts.dir, marker); } catch { /* best-effort */ }
  }
  opts.log?.({ count: verdict.count, firstAt: verdict.firstAt, lastAt: verdict.lastAt, backoffMs: backoff });
  await sleep(backoff);
  exit(1);
  return true;
}
```

- [ ] **Step 5: Export from the bootstrap barrel**

In `packages/bootstrap/src/index.ts`, add (next to the existing crash-audit export):

```ts
export * from './crash-loop';
```

- [ ] **Step 6: Wire into server startup**

In `apps/server/src/index.ts`:

1. Add `guardAgainstCrashLoop` to the `@openldr/bootstrap` import (line 2):

```ts
import { createAppContext, createIngestContext, createDbContext, seedDatabase, drainCrashMarkersToAudit, guardAgainstCrashLoop } from '@openldr/bootstrap';
```

2. Immediately AFTER the two `process.on(...)` crash-handler installs (after line ~22) and BEFORE the `MIGRATE_ON_START` block, add:

```ts
  // Restart circuit-breaker: before doing any expensive startup, bail out with a backoff if we're
  // in a crash loop, so a repeatedly-crashing boot slows down instead of hot-spinning + flooding.
  const tripped = await guardAgainstCrashLoop({
    dir: cfg.PLUGIN_CRASH_LOG_DIR,
    threshold: cfg.CRASH_LOOP_THRESHOLD,
    windowSec: cfg.CRASH_LOOP_WINDOW_SEC,
    backoffMs: cfg.CRASH_LOOP_BACKOFF_MS,
    backoffCapMs: cfg.CRASH_LOOP_BACKOFF_CAP_MS,
    log: (v) => logger.fatal(v, 'restart loop detected — backing off before exit'),
  });
  if (tripped) return; // guard already called process.exit; return keeps types happy under test
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm -C packages/bootstrap test crash-loop`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/config/src/schema.ts packages/bootstrap/src/crash-loop.ts packages/bootstrap/src/crash-loop.test.ts packages/bootstrap/src/index.ts apps/server/src/index.ts
git commit -m "feat: restart circuit-breaker to bound crash-loop flooding"
```

---

## Task 8: CLI `errors list` parity (`@openldr/cli`)

**Files:**
- Create: `packages/cli/src/errors.ts`
- Test: `packages/cli/src/errors.test.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/errors.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderErrorCatalog } from './errors';

describe('renderErrorCatalog', () => {
  it('lists codes grouped by domain (text)', () => {
    const out = renderErrorCatalog({ json: false });
    expect(out).toContain('RP0001');
    expect(out).toContain('date range not selected');
    expect(out).toContain('reports');
  });
  it('emits JSON when asked', () => {
    const out = renderErrorCatalog({ json: true });
    const parsed = JSON.parse(out);
    expect(parsed.find((e: any) => e.code === 'SY0500')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm -C packages/cli test errors`
Expected: FAIL — `./errors` not found.

- [ ] **Step 3: Implement**

Create `packages/cli/src/errors.ts`:

```ts
import { CATALOG, DOMAINS } from '@openldr/core';

/** Render the error catalog for `openldr errors list`. Pure (no ctx) — the catalog is static. */
export function renderErrorCatalog(opts: { json: boolean }): string {
  const entries = Object.values(CATALOG).sort((a, b) => a.code.localeCompare(b.code));
  if (opts.json) return JSON.stringify(entries, null, 2);
  const lines: string[] = [];
  for (const prefix of Object.keys(DOMAINS)) {
    const group = entries.filter((e) => e.code.startsWith(prefix));
    if (!group.length) continue;
    lines.push(`# ${DOMAINS[prefix]} (${prefix})`);
    for (const e of group) lines.push(`  ${e.code}  ${String(e.httpStatus).padEnd(3)}  ${e.message}`);
  }
  return lines.join('\n');
}

export function runErrorsList(opts: { json: boolean }): number {
  process.stdout.write(renderErrorCatalog(opts) + '\n');
  return 0;
}
```

- [ ] **Step 4: Wire the command**

In `packages/cli/src/index.ts`:

1. Add the import (near the other `run*` imports, ~line 19):

```ts
import { runErrorsList } from './errors';
```

2. Register the command (after the `health` command block, before the `fhir` group, ~line 51):

```ts
const errors = program.command('errors').description('Error-code catalog');
errors
  .command('list')
  .description('List the OpenLDR CE error codes (code, http status, message)')
  .option('--json', 'emit machine-readable JSON', false)
  .action((opts: { json: boolean }) => { process.exitCode = runErrorsList(opts); });
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm -C packages/cli test errors`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/errors.ts packages/cli/src/errors.test.ts packages/cli/src/index.ts
git commit -m "feat(cli): errors list command (catalog parity)"
```

---

## Task 9: Full cross-package gate

- [ ] **Step 1: Cross-package typecheck (forced)**

Run: `pnpm typecheck --force`
Expected: clean across core, config, bootstrap, server, cli, studio. (The `CrashMarker` new field + `error-catalog` export are cross-package — this is the gate the repo memory calls out.)

- [ ] **Step 2: Per-package vitest**

Run each; expected all green:
```
pnpm -C packages/core test
pnpm -C packages/config test
pnpm -C packages/bootstrap test
pnpm -C apps/server test
pnpm -C packages/cli test
```

- [ ] **Step 3: Studio tests (isolated)**

Run: `pnpm -C apps/studio test`
Expected: 605 pass / 1 pre-existing fail (or 606/606 if the refactor fixed the flaky message test — note which).

- [ ] **Step 4: Lint (if the repo gate includes it)**

Run: `pnpm lint` (or the repo's usual gate command). Fix any issues from the new files.

- [ ] **Step 5: Final commit (if anything changed during the gate)**

```bash
git add -A
git commit -m "chore: error-code / debuggability gate green"
```

---

## Self-Review notes (author)

- **Spec coverage:** B (primitive) → Task 1; C (catalog) → Task 1; D (server handler + genReqId + reports migration) → Tasks 2-3; E (studio surfacing) → Task 4; F (fingerprint + coalesce + circuit-breaker + config) → Tasks 5-7; G (CLI + tests) → Task 8 + Task 9. All spec sections covered.
- **Deferred/non-goals honored:** no localization, no client-side code→text remap (studio only formats what the server sent).
- **Type consistency:** `AppError`/`CatalogEntry`/`appError`/`codeForUnknown` defined Task 1 and used verbatim in Tasks 2-3, 8; `crashFingerprint`/`readCrashMarkers`/`detectCrashLoop`/`CrashMarker.fingerprint` defined Task 5 and used in Tasks 6-7; `guardAgainstCrashLoop` defined Task 7 and wired in the same task.
- **Open verification during impl:** confirm exact studio dashboard call-site type names (Task 4 Step 4) and the existing `crash-audit.test.ts` harness variables (Task 6 Step 1) by reading the surrounding lines before editing.
```
