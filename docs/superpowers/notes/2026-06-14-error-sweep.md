# Swallowed-error sweep — packages/*/src (P2-HARD, Task C2)

Date: 2026-06-14

A sweep across `packages/*/src` looked for `catch {}` / `catch (e) {}` blocks and
other places where errors are discarded. The codebase is mostly well-hardened: the
ingest, event-bus, audit, and CLI paths propagate or surface errors correctly. The
sweep found a number of **intentional** best-effort swallows (left as-is) and exactly
**2 genuine bugs** (both fixed below).

## Intentional swallows (correct — left unchanged)

| Location | Why it is correct |
| --- | --- |
| `packages/audit/src/*` — `safeRecord` | Audit writes are deliberately best-effort: a failed audit insert must never break the business operation it records. It already logs internally. |
| `packages/bootstrap/src/*` — worker tick `.catch` | The periodic worker tick must keep ticking; a single tick failure is caught so the loop survives. Surfaced via its own logging. |
| `packages/bootstrap/src/*` — LISTEN `ready` catch | The Postgres LISTEN `ready` notification is best-effort signalling; missing it must not abort startup. |
| `packages/adapter-dhis2/src/*` — DHIS2 `JSON.parse`-then-throw | Parse failure is caught only to rethrow a clearer typed error; nothing is masked. |
| `packages/bootstrap/src/*` — bootstrap `Promise.allSettled` teardowns | Teardown gathers all shutdown results so one failing close does not prevent the others; intentional. |
| `packages/cli/src/db.ts` — post-reset audit catch | After a destructive reset, the follow-up audit write is best-effort; failing it must not undo the completed reset. |

## Genuine bugs (fixed)

| Location | Consequence | Fix applied |
| --- | --- | --- |
| `packages/adapter-s3-bucket/src/index.ts:53` — `exists()` `catch { return false }` | ALL S3 errors (403/AccessDenied, bad credentials, ECONNREFUSED/network) were reported as "file does not exist". A caller gating on `exists()` could not distinguish "absent" from "S3 unreachable" — total, latent masking of operational failures. | Narrowed the catch with a duck-typed guard: return `false` only for genuine not-found (`name === 'NotFound'` / `'NoSuchKey'` or `$metadata.httpStatusCode === 404`); rethrow everything else so credential/permission/network errors propagate. |
| `packages/bootstrap/src/dhis2-context.ts:127` (scheduled) and `:138` (ingest-driven) — bare `catch {}` | `runMapping` only audits failures that reach its DHIS2-push branch. An EARLIER throw (DB down in `loadMapping`/`orgUnits.getMap()`, a build error) exits `runMapping` WITHOUT an audit, and the bare outer catch then produced ZERO log — a scheduled sync could silently fail while it re-schedules and looks healthy. | Added `logger.error({ err, scheduleId, mappingId, ... }, '...')` in each catch. Re-schedule/continue behaviour is unchanged (not rethrown — these are best-effort scheduled handlers — but they now always log). The logger has redact paths configured, so logging `err` is safe. |

## Verification

- `packages/adapter-s3-bucket` — TDD: a new `exists` test (403 AccessDenied) failed
  before the fix (`resolved "false" instead of rejecting`) and passes after. Full
  `vitest run` green.
- `packages/bootstrap` — `tsc --noEmit` clean. The dhis2 catch fix is covered by a
  focused unit test in `dhis2-sync.test.ts` that mirrors the production handler
  (the established pattern in that file, since `createDhis2Context` constructs its
  own DB/audit/target/stores with no DI seam) and asserts `logger.error` is called
  on a pre-push failure while the schedule still re-enqueues.

## Conclusion

The codebase was mostly well-hardened. Two genuine swallowed-error bugs were found and
fixed; all other swallows are intentional best-effort handlers and were left unchanged.
