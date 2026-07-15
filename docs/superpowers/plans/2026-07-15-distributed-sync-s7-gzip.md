# Distributed Sync S7-B — gzip Transport Compression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compress the sync transport in both directions — gzip all API responses (server plugin, zero client change) and gzip the push request body via a safe auto-negotiation that can never break a lab talking to a not-yet-upgraded central.

**Architecture:** Register `@fastify/compress` globally in `buildApp` — it compresses responses (`threshold: 1024`, `encodings: ['gzip']`) *and* inflates incoming gzipped request bodies (`globalDecompression: true`, `requestEncodings: ['gzip']`). A global `onSend` hook adds `Accept-Encoding: gzip` (RFC 7694) advertising that the server accepts gzipped request bodies. The lab's `postPush` reads that advert off each response, caches it, and gzips subsequent push bodies above a 1 KB threshold. The encode/learn logic lives in a small **testable module** (`sync-gzip.ts`) rather than inline.

**Tech Stack:** TypeScript, Fastify 5 (`@fastify/compress` v8), Node `fetch`/undici, `node:zlib`, Vitest, pnpm/turbo. Spec: `docs/superpowers/specs/2026-07-15-distributed-sync-s7-gzip-design.md`.

---

## Verified facts (resolved during planning — do not re-litigate)

- `apps/server` uses **Fastify `^5.2.0`** → needs **`@fastify/compress` v8+**.
- `@fastify/compress` genuinely does BOTH halves. Verified option names:
  - Response: `globalCompression`, `threshold`, `encodings`, `onUnsupportedEncoding` (→406).
  - Request: `globalDecompression: true`, `requestEncodings: ['gzip']` ("the body will be automatically decompressed if the `Content-Encoding` header matches"), `forceRequestEncoding`, and **`onUnsupportedRequestEncoding: (request, encoding) => ({ statusCode: 415, ... })`**.
  - Per-route escape hatches exist: `{ compress: false, decompress: false }`.
- Existing register idiom in `apps/server/src/app.ts:133`: `void app.register(fastifyStatic, { ... })` (fire-and-forget; Fastify defers to `ready()`).
- `node:zlib` is already used in-repo (`packages/sync/src/bundle.ts`) — no new client dep.
- Client call sites: `postJson` at `packages/bootstrap/src/index.ts:769`, `postPush` at `:796`.

**Request compression is PUSH-only** — `postJson`'s bodies are tiny cursors (`{fromSeq}`, `{systemUrl, afterCode}`); gzipping them would add bytes. Do not touch `postJson`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `apps/server/package.json` | add `@fastify/compress` | Modify |
| `apps/server/src/app.ts` | register compress (both halves) + RFC 7694 advert hook | Modify |
| `apps/server/src/compress.test.ts` | server-side round-trip / 415 / threshold / advert tests | Create |
| `packages/bootstrap/src/sync-gzip.ts` | `encodePushBody` + `advertisesGzip` (testable, pure) | Create |
| `packages/bootstrap/src/sync-gzip.test.ts` | unit tests incl. the old-central safety case | Create |
| `packages/bootstrap/src/index.ts` | wire `postPush` to the module + cache the advert | Modify |
| `scripts/sync-gzip-live-acceptance.ts` | applies-identically **and measurably shrinks** | Create |
| `package.json` (root) | `sync:gzip:accept` | Modify |
| `docs/OPERATOR-GUIDE.md` (+ architecture doc if one covers transport) | document compression + negotiation | Modify |

**Key contracts:**
- `GZIP_MIN_BYTES = 1024`
- `encodePushBody(json: string, acceptsGzip: boolean): { body: string | Buffer; headers: Record<string, string> }`
- `advertisesGzip(acceptEncodingHeader: string | null): boolean`

---

## Task 1: Server — register `@fastify/compress` + RFC 7694 advert

**Files:**
- Modify: `apps/server/package.json`, `apps/server/src/app.ts`
- Test: `apps/server/src/compress.test.ts`

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @openldr/server add @fastify/compress`
Verify the installed version is **v8+** (Fastify 5 compatible) — check `apps/server/package.json`. If pnpm resolves an older major, pin explicitly: `pnpm --filter @openldr/server add @fastify/compress@^8`.

- [ ] **Step 2: Write the failing tests** — `apps/server/src/compress.test.ts`. Build a minimal Fastify app the same way the other route tests do (grep a sibling like `apps/server/src/activity-routes.test.ts` for the `Fastify()` + `app.inject` idiom), registering the compress plugin the same way `buildApp` will, plus a tiny echo route:

```typescript
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import compress from '@fastify/compress';
import { gzipSync, gunzipSync } from 'node:zlib';

async function appWithCompress() {
  const app = Fastify();
  await app.register(compress, {
    globalCompression: true,
    globalDecompression: true,
    threshold: 1024,
    encodings: ['gzip'],
    requestEncodings: ['gzip'],
    onUnsupportedRequestEncoding: (_request, encoding) => ({
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      error: 'Unsupported Media Type',
      message: `unsupported content-encoding: ${encoding}`,
    }),
  });
  // RFC 7694 advert (mirrors the hook buildApp adds)
  app.addHook('onSend', async (_req, reply) => {
    if (!reply.getHeader('accept-encoding')) reply.header('Accept-Encoding', 'gzip');
  });
  app.post('/echo', async (req) => ({ got: req.body }));
  app.get('/big', async () => ({ blob: 'x'.repeat(5000) }));
  app.get('/small', async () => ({ ok: true }));
  await app.ready();
  return app;
}

describe('@fastify/compress wiring', () => {
  it('inflates a gzipped request body', async () => {
    const app = await appWithCompress();
    const payload = { hello: 'world', n: 1 };
    const res = await app.inject({
      method: 'POST', url: '/echo',
      headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      payload: gzipSync(JSON.stringify(payload)),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().got).toEqual(payload);
  });

  it('still accepts a plain request body (no regression)', async () => {
    const app = await appWithCompress();
    const res = await app.inject({ method: 'POST', url: '/echo', payload: { a: 2 } });
    expect(res.statusCode).toBe(200);
    expect(res.json().got).toEqual({ a: 2 });
  });

  it('rejects an unsupported request encoding with 415', async () => {
    const app = await appWithCompress();
    const res = await app.inject({
      method: 'POST', url: '/echo',
      headers: { 'content-type': 'application/json', 'content-encoding': 'br' },
      payload: Buffer.from('irrelevant'),
    });
    expect(res.statusCode).toBe(415);
  });

  it('gzips a response above the threshold and leaves a small one alone', async () => {
    const app = await appWithCompress();
    const big = await app.inject({ method: 'GET', url: '/big', headers: { 'accept-encoding': 'gzip' } });
    expect(big.headers['content-encoding']).toBe('gzip');
    expect(JSON.parse(gunzipSync(big.rawPayload).toString()).blob.length).toBe(5000);

    const small = await app.inject({ method: 'GET', url: '/small', headers: { 'accept-encoding': 'gzip' } });
    expect(small.headers['content-encoding']).toBeUndefined();
  });

  it('advertises Accept-Encoding: gzip on responses (RFC 7694)', async () => {
    const app = await appWithCompress();
    const res = await app.inject({ method: 'GET', url: '/small' });
    expect(String(res.headers['accept-encoding'])).toMatch(/gzip/);
  });
});
```

Run: `pnpm --filter @openldr/server exec vitest run src/compress.test.ts`
Expected: FAIL until the dep is installed (module not found) — then PASS once installed, since this test registers the plugin itself. That's fine: its job is to pin the exact config `buildApp` uses.

- [ ] **Step 3: Register in `buildApp`**

In `apps/server/src/app.ts`, add the import next to the `fastifyStatic` one:
```typescript
import compress from '@fastify/compress';
```
Then inside `buildApp`, immediately after `registerErrorHandler(app);` (BEFORE any routes, so the hooks apply to everything), add:
```typescript
  // Sync S7-B: compress the wire in both directions. Labs reconcile over bandwidth-constrained,
  // often asymmetric links, so this is the cheapest available win — it shrinks the big terminology
  // bulk pages / pull responses AND (via globalDecompression) accepts gzipped push bodies.
  // Content negotiation is transparent: a client that doesn't ask simply doesn't get compressed bytes,
  // so nothing existing breaks. `compressible`/mime-db skips already-compressed types (PDF/xlsx exports).
  void app.register(compress, {
    globalCompression: true,
    globalDecompression: true,
    threshold: 1024,
    encodings: ['gzip'],
    requestEncodings: ['gzip'],
    onUnsupportedRequestEncoding: (_request, encoding) => ({
      statusCode: 415,
      code: 'UNSUPPORTED_MEDIA_TYPE',
      error: 'Unsupported Media Type',
      message: `unsupported content-encoding: ${encoding}`,
    }),
  });

  // RFC 7694: advertise to clients that this server ACCEPTS gzipped request bodies. The sync push
  // client reads this off the response and only then starts gzipping its batches — an older central
  // never sends it, so an upgraded lab safely keeps pushing plain JSON. Truthful globally, since
  // globalDecompression accepts gzip on every route.
  app.addHook('onSend', async (_req, reply) => {
    if (!reply.getHeader('accept-encoding')) reply.header('Accept-Encoding', 'gzip');
  });
```

Note the `void app.register(...)` fire-and-forget matches the existing `fastifyStatic` idiom at `app.ts:133` (`buildApp` is sync; Fastify defers registration to `ready()`).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @openldr/server exec vitest run src/compress.test.ts` → PASS (5).
Run: `pnpm --filter @openldr/server exec vitest run` → PASS (no regression; the whole existing suite now runs through the compress hooks — this is the important signal).
Run: `pnpm --filter @openldr/server exec tsc --noEmit` → clean. (Do NOT pipe through `tail` — it masks the exit code.)

- [ ] **Step 5: Commit** (no `Co-Authored-By` trailer)

```bash
git add apps/server/package.json apps/server/src/app.ts apps/server/src/compress.test.ts pnpm-lock.yaml
git commit -m "feat(server): gzip responses + accept gzipped request bodies (sync S7-B)"
```

---

## Task 2: Client — testable gzip module + `postPush` auto-negotiation

**Files:**
- Create: `packages/bootstrap/src/sync-gzip.ts`, `packages/bootstrap/src/sync-gzip.test.ts`
- Modify: `packages/bootstrap/src/index.ts`

Deliberately a separate module, not inline in `postPush`: S7-A's review found the inline retry closure had zero coverage. A pure module makes the old-central safety case directly testable.

- [ ] **Step 1: Write the failing tests** — `packages/bootstrap/src/sync-gzip.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { encodePushBody, advertisesGzip, GZIP_MIN_BYTES } from './sync-gzip';

describe('advertisesGzip', () => {
  it('detects gzip in an Accept-Encoding advert', () => {
    expect(advertisesGzip('gzip')).toBe(true);
    expect(advertisesGzip('gzip, deflate')).toBe(true);
    expect(advertisesGzip('deflate, gzip;q=1.0')).toBe(true);
  });
  it('is false for absent/other adverts (the old-central case)', () => {
    expect(advertisesGzip(null)).toBe(false);
    expect(advertisesGzip('')).toBe(false);
    expect(advertisesGzip('identity')).toBe(false);
    expect(advertisesGzip('deflate')).toBe(false);
  });
});

describe('encodePushBody', () => {
  const big = JSON.stringify({ pad: 'x'.repeat(GZIP_MIN_BYTES + 100) });

  it('sends PLAIN with no Content-Encoding when central has not advertised (old-central safety)', () => {
    const { body, headers } = encodePushBody(big, false);
    expect(body).toBe(big);
    expect(headers['Content-Encoding']).toBeUndefined();
  });

  it('gzips when advertised and above the threshold, and it round-trips', () => {
    const { body, headers } = encodePushBody(big, true);
    expect(headers['Content-Encoding']).toBe('gzip');
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(gunzipSync(body as Buffer).toString()).toBe(big);
  });

  it('stays plain below the threshold even when advertised', () => {
    const small = JSON.stringify({ a: 1 });
    const { body, headers } = encodePushBody(small, true);
    expect(body).toBe(small);
    expect(headers['Content-Encoding']).toBeUndefined();
  });

  it('actually shrinks a realistic repetitive batch', () => {
    const { body } = encodePushBody(big, true);
    expect((body as Buffer).byteLength).toBeLessThan(Buffer.byteLength(big));
  });
});
```

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/sync-gzip.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement the module** — `packages/bootstrap/src/sync-gzip.ts`:

```typescript
import { gzipSync } from 'node:zlib';

// Sync S7-B: gzip for the push request body. Kept as a pure module (not inline in postPush) so the
// safety-critical "old central → never gzip" branch is directly testable.

/** Below this, a gzip header costs more than it saves — send plain. */
export const GZIP_MIN_BYTES = 1024;

/** True when central's RFC 7694 `Accept-Encoding` RESPONSE header says it accepts gzipped REQUEST
 *  bodies. An older central sends no such header → false → we never gzip → it keeps working. */
export function advertisesGzip(acceptEncoding: string | null): boolean {
  return !!acceptEncoding && /(^|[,\s])gzip($|[,;\s])/i.test(acceptEncoding);
}

/** Encode a push body: gzipped (+ Content-Encoding) only when central advertised gzip AND the body is
 *  worth compressing; otherwise the original string, unchanged. */
export function encodePushBody(
  json: string,
  acceptsGzip: boolean,
): { body: string | Buffer; headers: Record<string, string> } {
  if (acceptsGzip && Buffer.byteLength(json) >= GZIP_MIN_BYTES) {
    return { body: gzipSync(json), headers: { 'Content-Encoding': 'gzip' } };
  }
  return { body: json, headers: {} };
}
```

- [ ] **Step 3: Wire `postPush`** — in `packages/bootstrap/src/index.ts`:

(a) Add the import near the other local imports:
```typescript
import { encodePushBody, advertisesGzip } from './sync-gzip';
```
(b) In the sync wiring scope (the same block where `postJson`/`tokenProvider` are defined, around `:769`), add the cache:
```typescript
    // Sync S7-B: learned from central's RFC 7694 Accept-Encoding advert on each push response. Starts
    // false so the FIRST push is always plain — an old central never advertises and we never gzip it.
    // In-memory by design: it re-learns on the next response after a restart.
    let centralAcceptsGzip = false;
```
(c) Replace the `postPush` body (currently at `:796`) with:
```typescript
        postPush: async (batch: PushBatch, token: string): Promise<PushResponse> => {
          const json = JSON.stringify(batch);
          const { body, headers: encHeaders } = encodePushBody(json, centralAcceptsGzip);
          const res = await fetch(`${syncCfg.centralUrl}/api/sync/push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...encHeaders },
            body,
          });
          // Learn central's capability from THIS response so subsequent pushes can compress.
          if (advertisesGzip(res.headers.get('accept-encoding'))) centralAcceptsGzip = true;
          // Throw (never leaking the token) so the runner leaves the cursor put and retries next cycle.
          if (!res.ok) throw new Error(`sync push POST /api/sync/push failed: central responded ${res.status}`);
          return (await res.json()) as PushResponse;
        },
```
Leave `postJson` untouched (tiny bodies — see the plan header).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @openldr/bootstrap exec vitest run src/sync-gzip.test.ts` → PASS (7).
Run: `pnpm --filter @openldr/bootstrap exec vitest run` → PASS (no regression).
Run: `pnpm --filter @openldr/bootstrap exec tsc --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add packages/bootstrap/src/sync-gzip.ts packages/bootstrap/src/sync-gzip.test.ts packages/bootstrap/src/index.ts
git commit -m "feat(bootstrap): auto-negotiated gzip for the sync push body (sync S7-B)"
```

---

## Task 3: Live acceptance — applies identically AND measurably shrinks

**Files:**
- Create: `scripts/sync-gzip-live-acceptance.ts`
- Modify: `package.json` (root)

Model the provision/migrate/teardown + `assert(cond,msg)` idiom on `scripts/sync-amend-live-acceptance.ts`. This harness needs a REAL Fastify server (unlike the in-process sibling harnesses) because the whole point is the HTTP wire.

- [ ] **Step 1: Write the harness** proving:
  1. Provision + migrate one internal PG DB (lab side is irrelevant here — this tests the wire).
  2. Stand up a real Fastify app registered exactly like `buildApp` does (compress plugin + advert hook) with a stub `POST /api/sync/push` route that echoes back the parsed batch (or a minimal `PushResponse`), and `listen({ port: 0 })` on an ephemeral port.
  3. **Advert:** a plain push response carries `Accept-Encoding: gzip`.
  4. **Round-trip:** build a realistically-sized `PushBatch` (e.g. 200 synthetic Observation-shaped records, comfortably > 1 KB); POST it gzipped via real `fetch` with `Content-Encoding: gzip`; assert the server parsed an **identical** batch (deep-equal) and returned 200.
  5. **Old-central safety:** POST the same batch plain (no `Content-Encoding`) → still 200 and identical.
  6. **The measurement (the slice's justification):** assert `gzipSync(json).byteLength` is materially smaller than `Buffer.byteLength(json)` — require at least a **50% reduction** on this repetitive JSON (real batches compress far better; a gzip that doesn't shrink is a bug). Print both sizes and the ratio.
  7. **Response compression:** GET/POST a large response through the app with `Accept-Encoding: gzip` and assert `content-encoding: gzip` came back and decodes correctly.
  8. Teardown: close the server + drop the DB in `finally`. Final line: `sync:gzip:accept PASSED`; any throw → `exit(1)`.

If standing up the real server proves awkward, do NOT fake it — report what blocked you. (The server is already trivially constructible in tests via `Fastify()` + `app.inject`, but `inject` bypasses real HTTP; prefer `listen({port:0})` + real `fetch` so the negotiation is genuinely exercised end-to-end.)

- [ ] **Step 2: Add the pnpm script** in root `package.json`, next to the other `sync:*:accept` entries:
```json
"sync:gzip:accept": "tsx scripts/sync-gzip-live-acceptance.ts",
```

- [ ] **Step 3: Run it** — `docker compose up -d postgres` if needed, then `pnpm sync:gzip:accept` → `sync:gzip:accept PASSED`. Report the printed compression ratio. Do NOT fake a pass.

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-gzip-live-acceptance.ts package.json
git commit -m "test(sync): S7-B gzip wire acceptance — round-trip + measured shrink"
```

---

## Task 4: Docs, gate, and regression

**Files:** `docs/OPERATOR-GUIDE.md` (+ an architecture/transport doc if one exists — grep `docs/` for `sync` transport coverage)

- [ ] **Step 1: Document it** — concise, matching each doc's structure:
  - Sync traffic is gzip-compressed in both directions. Responses (incl. the large terminology bulk pages) compress automatically.
  - Push bodies compress only after central advertises support (`Accept-Encoding: gzip`, RFC 7694), so **a lab running a newer build against an older central keeps working** — no upgrade-order requirement.
  - No configuration required.

- [ ] **Step 2: Per-package gate** (run each directly; never pipe through `tail`; report counts):
```
pnpm --filter @openldr/server exec vitest run
pnpm --filter @openldr/bootstrap exec vitest run
pnpm --filter @openldr/db exec vitest run
pnpm --filter @openldr/sync exec vitest run
pnpm --filter @openldr/cli exec vitest run
pnpm --filter @openldr/server exec tsc --noEmit
pnpm --filter @openldr/bootstrap exec tsc --noEmit
```
KNOWN: full db/bootstrap/server runs can show Windows parallel-pg-mem TIMEOUT flakes ("Test timed out in 5000ms") — NOT real failures. If seen, re-run the S7-B files in isolation (`apps/server: src/compress.test.ts`, `@openldr/bootstrap: src/sync-gzip.test.ts`) and report both, separating real failures from flakes.

- [ ] **Step 3: Regression** — all sync harnesses (dev Postgres up). Report each final line:
```
pnpm sync:gzip:accept
pnpm sync:accept
pnpm sync:pull:accept
pnpm sync:terminology:accept
pnpm sync:quarantine:accept
pnpm sync:amend:accept
pnpm sync:order-status:accept
pnpm sync:patient-merge:accept
```
`sync:terminology:accept` matters most — it moves the biggest payloads. Note: these harnesses are in-process (they don't go over HTTP), so they won't exercise compression directly — their job here is proving **no regression**.

- [ ] **Step 4: Commit docs**
```bash
git add docs
git commit -m "docs(sync): document gzip transport compression + negotiation"
```

---

## Self-Review (completed during planning)

**Spec coverage:** §3 server (plugin both halves + advert) → Task 1; §4 client (push-only, cache, threshold, learn) → Task 2; §5 compat matrix → pinned by Task 2's old-central tests + Task 3's plain-push case; §6 testing → Tasks 1-3; §2.1 push-only → enforced (postJson untouched); §9 non-goals (brotli, postJson gzip, config knob) → not implemented, correct.

**Resolved the spec's one open question:** `@fastify/compress`'s request-decompression options are confirmed (`globalDecompression`, `requestEncodings`, `onUnsupportedRequestEncoding` → 415) — Task 1 uses them verbatim, so there's no plan-time guessing left.

**Type consistency:** `encodePushBody`/`advertisesGzip`/`GZIP_MIN_BYTES` (Task 2) are used verbatim in `index.ts`'s `postPush` and in the Task 2 tests. The plugin options in Task 1's test are byte-identical to those in `buildApp`, so the test genuinely pins the shipped config.

**Placeholder scan:** no TBDs. Task 3 delegates only the provision/teardown *idiom* to the sibling harness (a pattern to copy, not undefined logic); every assertion is specified, including the ≥50% shrink threshold. Task 1 Step 1 specifies the version check rather than assuming.

**Applied lesson from S7-A:** the client logic is a testable module from the start, not an inline closure — S7-A's final review found the inline retry closure had zero coverage, which is exactly how a real defect slipped through.
