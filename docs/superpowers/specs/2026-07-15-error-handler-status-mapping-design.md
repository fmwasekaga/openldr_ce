# Central error handler: honour HTTP status, map to a catalog code

**Date:** 2026-07-15
**Status:** approved

## Problem

`apps/server/src/error-handler.ts`'s `toErrorResponse` only special-cases `AppError`. Every other
thrown value falls through to `codeForUnknown`, which sees no `statusCode` and answers **500 /
SY0500**. Fastify's default error handler honours `error.statusCode`; our custom handler swallows it.

So on every route today, a client's own bad request is reported as a server error:

| Trigger                        | Fastify error                  | Real status | Today |
| ------------------------------ | ------------------------------ | ----------- | ----- |
| malformed JSON body            | `FST_ERR_CTP_INVALID_JSON_BODY` | 400         | 500   |
| schema validation failure      | `FST_ERR_VALIDATION`            | 400         | 500   |
| unsupported content-type       | `FST_ERR_CTP_INVALID_MEDIA_TYPE`| 415         | 500   |

`apps/server/src/workflows-routes.ts:99` throws
`Object.assign(new Error('file too large'), { statusCode: 413 })` — flattened to 500 the same way.

This is wrong for clients and it buries real 500s in noise.

## Why the obvious fix is wrong

Honouring any plain `Error`'s `statusCode` **and** `code` leaks non-catalog codes to clients.
`packages/core/src/error-catalog.ts` states codes are stable support identifiers, one vocabulary
quoted everywhere; `error-catalog.test.ts` enforces the shape `^[A-Z]{2,4}\d{4}$`; the CLI
`openldr errors list` groups by domain prefix. Returning `FST_ERR_VALIDATION` in the `code` field
would violate that contract and be ungreppable.

The unmerged `feat/sync-s7-gzip` (S7-B) branch took exactly this shortcut — it honours
`statusCode` + `code` verbatim and feeds it `code: 'UNSUPPORTED_MEDIA_TYPE'`, pinned by a test.
That approach is superseded here; see Migration.

## Design

**Status comes from the error. Code comes from the catalog. Never from the library.**

### Catalog (`packages/core/src/error-catalog.ts`)

Two new `SY` entries:

```ts
{ code: 'SY0413', domain: 'system', httpStatus: 413, message: 'request payload too large' },
{ code: 'SY0415', domain: 'system', httpStatus: 415, message: 'unsupported media type' },
```

One new exported function:

```ts
export function codeForStatus(status: number): string {
  const exact = `SY0${status}`;            // SY0400 / SY0413 / SY0415 / SY0503 …
  if (CATALOG[exact]) return exact;
  return status >= 500 ? 'SY0500' : 'SY0400';
}
```

The catalog is its own lookup table. The existing `SY0400`/`SY0500`/`SY0503` names already encode
their status, so adding an entry is all it takes to light up a new status — no second map to drift.

The invariant that makes this sound is pinned by a test: any code matching `SY0[45]\d\d` must have
`httpStatus` equal to its own number. Codes below `SY0400` remain free for non-HTTP system errors.

### Handler (`apps/server/src/error-handler.ts`)

One new branch in `toErrorResponse`, between the `AppError` check and the `codeForUnknown` fallback:

```ts
if (err instanceof Error) {
  const { statusCode } = err as Error & { statusCode?: unknown };
  if (typeof statusCode === 'number' && statusCode >= 400 && statusCode <= 599) {
    const code = codeForStatus(statusCode);
    return { status: statusCode, code, message: err.message || CATALOG[code].message };
  }
}
```

- The `400..599` range guard means a library error carrying `statusCode: 0` or `200` cannot become
  the response status; it falls through to `codeForUnknown`.
- `err.code` is read nowhere.
- Message handling matches the existing fallback branch: prefer the real message, fall back to the
  catalog default when empty.

### Logging

The library's own code is valuable for support, just not to the client. `registerErrorHandler` adds
it to the existing log line as `libCode`, so a correlationId from the UI still greps to a log line
naming `FST_ERR_CTP_INVALID_JSON_BODY`.

The response body stays exactly `{ error, code, correlationId }`. The 4xx→warn / 5xx→error split is
untouched.

### Call site

`apps/server/src/workflows-routes.ts:99` converts to `throw appError('SY0413')`. Both forms produce
413/SY0413 under the new handler, but quoting the catalog at the throw site matches the rest of the
codebase and makes intent legible. The plain-`statusCode` mapping then exists purely as the safety
net for third-party library errors, which is its honest job.

## Testing

These paths are currently unpinned — that is how the gap survived. Pre-existing handler tests pass
because no fixture carries a `statusCode`.

**Unit — `apps/server/src/error-handler.test.ts`** (five existing cases stay green, untouched):
- 413 plain `Error` → 413 / `SY0413`
- out-of-range `statusCode` (e.g. `200`) → falls through to 500 / `SY0500`
- **regression pin:** an error carrying *both* `statusCode: 415` and `code: 'UNSUPPORTED_MEDIA_TYPE'`
  returns `SY0415` — the library code never leaks

**Integration — real Fastify app via `inject()`**, so the contract is pinned end-to-end rather than
at the pure-function level:
- malformed JSON → 400 / `SY0400`
- schema validation failure → 400 / `SY0400`
- unsupported content-type → 415 / `SY0415`
- unknown throw → 500 / `SY0500`
- `AppError` throw → its own code, round-tripped unchanged

**Core — `packages/core/src/error-catalog.test.ts`:**
- `codeForStatus` exact hits, 4xx fallback, 5xx fallback
- the `SY0[45]\d\d` httpStatus invariant

## Migration: S7-B (`feat/sync-s7-gzip`)

That branch is unmerged and conflicts directly. When it rebases onto this work it must drop:

1. the `statusCode` + `code` passthrough hunk in `error-handler.ts` (superseded by this mapper);
2. its test `honours a self-declared statusCode + code on a plain Error` (it asserts the leak);
3. its hand-rolled 415 in `app.ts`, which becomes
   `appError('SY0415', { message: \`unsupported content-encoding: ${encoding}\` })` — an `AppError`
   satisfies `onUnsupportedRequestEncoding`'s "must return an Error" signature and flows through the
   handler's first branch.

`SY0415` ships here rather than with S7-B because 415 is reachable on main today: Fastify raises
`FST_ERR_CTP_INVALID_MEDIA_TYPE` on any route given a bad content-type, with or without gzip.

## Out of scope

- Changing whether internal 5xx messages reach clients (pre-existing behaviour, unchanged).
- Surfacing Fastify's `.validation` issue array in `details`.
