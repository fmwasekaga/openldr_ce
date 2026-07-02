# Error-code / Debuggability System — Design

- **Date:** 2026-07-02
- **Status:** Approved (brainstorm → spec)
- **Owner:** OpenLDR CE

## Problem

When something fails, the UI shows a bare `500` / `list failed: 401` with no way to
diagnose it, and the Audit trail records *actions*, not *errors*. There is no stable
identifier a user can quote to support, and no thread from a UI failure to the server
log line that explains it. Process-level crashes (uncaught exceptions, restart loops)
are captured to an audit trail today but are **unbounded** — a tight restart loop writes
crash rows forever.

## Goals

1. Every API error response carries the **real server message**, a **stable code**, and a
   short **correlation id** that also appears in the server log — so "500" becomes traceable.
2. A **coded catalog** (`RP0001`-style) covering the known user-facing failure classes across
   reports, connectors, forms/validation, auth, and dashboards, plus a `SY####` fallback so
   **no failure is ever codeless**.
3. The existing process-crash channel is **hardened against restart-loop flooding** via
   fingerprint coalescing + a restart circuit-breaker.

## Non-goals / deferred

- **Localization of error text.** Server sends a plain (English) message; studio displays it
  verbatim. Codes are stable identifiers for support tickets + log correlation, *not* a
  localization layer. Translating server error text is a later extension.
- **Client-side code→text mapping.** Studio never remaps a code to different copy; it shows
  what the server sent plus the code/id.
- A dedicated `@openldr/errors` package (using `core` instead — see Decisions).

## Decisions (locked during brainstorm)

| Question | Decision |
|---|---|
| Catalog scope in v1 | Framework **plus** populated codes for all 5 domains + system |
| Code format | Prefix + zero-padded number (`RP0001`); 2–4 letter domain prefix |
| Message source | **Server text only**; code for support/logs; studio shows verbatim |
| Correlation id | Short (~8-char) id; on every error response + one error log line |
| Process crashes | Real concern: restart loops must not flood storage |
| Loop protection | **Coalesce (fingerprint + count) + restart circuit-breaker** |
| Primitive home | `@openldr/core` (not a new package) |
| Response shape | **Flat** `{ error, code, correlationId }` (back-compat with studio) |

## Architecture — two channels, one vocabulary

- **Channel 1 — request/API errors:** typed, coded, correlation-id'd, surfaced in the UI.
- **Channel 2 — process/lifecycle crashes:** the existing `crash-log` → `system.crash`
  audit path, hardened against restart loops.

Both draw codes from **one catalog**, so `RP0003` means the same thing in a toast, a log
line, and an audit row.

## Component B — the shared primitive: `@openldr/core/src/errors.ts` (new)

Lives in `core` (already imported by `apps/server` and `@openldr/bootstrap`). Studio does
**not** import it — codes reach studio as plain strings over the wire.

```ts
export class AppError extends Error {
  readonly code: string;          // 'RP0001'
  readonly httpStatus: number;    // 400/404/409/503/500…
  correlationId?: string;         // stamped by the server error handler
  readonly details?: unknown;     // structured, non-PII (safe to log/return)
  readonly retryable: boolean;
  constructor(entry: CatalogEntry, opts?: { message?: string; details?: unknown; cause?: unknown });
}

export interface CatalogEntry {
  code: string;
  domain: string;                 // 'reports' | 'connectors' | …
  httpStatus: number;
  message: string;                // default English message
  retryable?: boolean;            // default false
}

export const CATALOG: Readonly<Record<string, CatalogEntry>>;   // assembled from per-domain tables
export function appError(code: string, opts?): AppError;         // construct from catalog by code
export function catalogFor(prefix: string): CatalogEntry[];      // list a domain
export function domainForPrefix(prefix: string): string | undefined;
```

- `appError('RP0001')` builds an `AppError` from the catalog entry; `opts.message` overrides
  the default (e.g. to add a specific field name), `opts.details` attaches structured context.
- The catalog is assembled from per-domain modules (one small table per domain) merged into
  `CATALOG`. A build-time invariant test asserts codes are unique and well-formed
  (`/^[A-Z]{2,4}\d{4}$/`).

## Component C — the catalog (populated in v1)

Code = `<PREFIX><NNNN>`. Prefixes: `RP` reports, `CN` connectors, `FM` forms/validation,
`AU` auth, `DB` dashboards, `SY` system. Starter entries (final wording locked in
implementation, but these are the intended set):

| Code | http | Meaning |
|---|---|---|
| `RP0001` | 400 | Date range not selected |
| `RP0002` | 404 | Report not found |
| `RP0003` | 500 | Report render/generation failed |
| `RP0004` | 400 | Invalid report parameters |
| `CN0001` | 404 | Connector not found |
| `CN0002` | 503 | Connector unreachable |
| `CN0003` | 502 | Connector auth failed |
| `CN0004` | 500 | Connector secret decrypt failed |
| `FM0001` | 400 | Form validation failed |
| `FM0002` | 404 | Form not found |
| `FM0003` | 400 | Required field missing |
| `AU0001` | 401 | Session expired |
| `AU0002` | 401 | Not authenticated |
| `AU0003` | 403 | Insufficient role |
| `DB0001` | 400 | Dashboard query failed |
| `DB0002` | 403 | SQL authoring disabled |
| `DB0003` | 404 | Dashboard model not found |
| `SY0400` | 400 | Bad request (uncoded validation) |
| `SY0500` | 500 | Unexpected server error |
| `SY0503` | 503 | Upstream/backing service unavailable |

**Unknown/uncaught errors always map to a `SY####` code** (default `SY0500`; conn-refused
patterns → `SY0503`; ZodError → `SY0400`). There is never a codeless failure.

## Component D — Channel 1 wiring (server)

1. **Correlation id.** Fastify `genReqId` returns a short 8-char id (first 8 hex of
   `randomUUID()`), set as `req.id`. (Deterministic-enough, collision-safe for correlation.)
2. **Central error handler.** One `app.setErrorHandler((err, req, reply) => …)`:
   - If `err instanceof AppError`: use its `code` + `httpStatus`.
   - Else classify: `ZodError` → `SY0400`; conn-refused/timeout regex → `SY0503`; otherwise
     `SY0500`.
   - Stamp `correlationId = req.id`.
   - Reply body (**flat, back-compatible**):
     ```json
     { "error": "date range not selected", "code": "RP0001", "correlationId": "a1b2c3d4" }
     ```
     `error` remains the human message string (studio's `errorDetail` already reads
     `body.error`), `code` + `correlationId` are added siblings.
   - Emit exactly **one** `logger.error({ code, correlationId, err }, message)` line.
3. **Reports refactor.** `reports-routes.ts` `mapError` is deleted; routes throw
   `appError('RP…')` (mapping today's `ReportNotFoundError`/`ZodError`/conn branches to codes)
   and let the central handler render. Existing `{ error: … }` returns for 404 not-found stay
   valid (same flat shape) but should migrate to `appError` where practical.
4. **Non-reports routes.** Routes keep throwing; the central handler catches everything, so
   even routes that never adopt `appError` still get a `SY####` code + correlation id for free.

## Component E — Channel 1 surfacing (studio)

- Extend `errorDetail` + `okJson` in [`apps/studio/src/api.ts`](apps/studio/src/api.ts:541) to
  also read `code` + `correlationId` from the JSON body and format the thrown `Error.message`
  as **`{message} · {code} · {correlationId}`** (id/code omitted when absent). Every existing
  error display/toast then shows the code with no per-call-site change.
- 401 keeps the existing redirect-to-login behavior (studio already handles this).
- Bare `throw new Error(\`… failed: ${res.status}\`)` sites are migrated to route through
  `okJson`/`errorDetail` so they pick up the message + code + id (removes the bare-status UX).

## Component F — Channel 2 hardening (`crash-log.ts` + `crash-audit.ts`)

1. **Fingerprint.** Add `fingerprint: string` to `CrashMarker`, computed in `buildCrashMarker`
   as a short hash of `kind` + normalized message (numbers/uuids/paths stripped) + top stack
   frame. Backwards-compatible: markers without a fingerprint fall back to a hash of `kind`.
2. **Coalesce on drain.** `drainCrashMarkersToAudit` groups drained markers by `fingerprint`
   and writes **one** audit row per fingerprint with `occurrenceCount`, `firstSeen`,
   `lastSeen`, representative `stack`/`inFlight`. A 5s loop of the same crash = 1 row that
   ticks up, not thousands.
3. **Restart circuit-breaker.** A small persisted crash-history (append recent crash
   timestamps to a bounded sidecar file, or reuse the crash log's timestamps read on boot).
   On boot, **before** full startup: if ≥ `CRASH_LOOP_THRESHOLD` (default 5) crashes occurred
   within `CRASH_LOOP_WINDOW_SEC` (default 60s), write one prominent `system.crash_loop` audit
   row and **back off** — escalating `sleep(min(base·2^n, cap))` then `process.exit(1)`, so the
   Docker/pm2 restart policy slows the loop instead of the app hot-spinning. Clock + exit +
   sleep injected for testability (matching the existing `makeCrashHandler` pattern).
4. **Config.** New keys in `packages/config/src/schema.ts`:
   `CRASH_LOOP_THRESHOLD` (default 5), `CRASH_LOOP_WINDOW_SEC` (default 60),
   `CRASH_LOOP_BACKOFF_MS` (base, default 2000), `CRASH_LOOP_BACKOFF_CAP_MS` (default 60000).

## Component G — CLI parity & testing

- **CLI.** Add `openldr errors list` (dump the catalog: code, domain, http, message) for
  support reference, in the shared `@openldr/bootstrap` command surface. Crash rows already
  surface in `audit list`.
- **Tests (vitest — do not run `pnpm build` for the server; typecheck + vitest):**
  - `errors.ts`: catalog uniqueness/format invariant; `appError` construction; unknown→`SY####`
    classification.
  - server error handler: AppError → correct status/code/body; unknown → `SY0500` + id present;
    exactly one log line.
  - `errorDetail`/`okJson`: message · code · id formatting; graceful when fields absent.
  - `crash-log`: fingerprint stability; coalescing groups identical fingerprints with counts.
  - circuit-breaker: fires at threshold within window; backoff escalates; injected clock/exit.

## Cross-package gate note

`errors.ts` in `core` is a shared-type/ambient surface change → run the cross-package
typecheck gate (`pnpm typecheck --force`) covering `core`, `bootstrap`, and `server`, not just
the owning package. `CrashMarker` gaining a field is likewise cross-package (core → bootstrap
→ server).

## Rollout / sequencing (for the plan)

1. `core/errors.ts` + catalog + invariant test.
2. Server: `genReqId` + central `setErrorHandler` + flat envelope + log line.
3. Reports: migrate `mapError`/throws to `appError`.
4. Studio: `errorDetail`/`okJson` code+id formatting; migrate bare-status throws.
5. Channel 2: fingerprint + coalesce + circuit-breaker + config.
6. CLI `errors list`.
7. Gate: `pnpm typecheck --force`, per-package vitest, studio isolated test (expect 605/606).
