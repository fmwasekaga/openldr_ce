# Distributed Sync S7-B — gzip Transport Compression (design)

**Date:** 2026-07-15
**Status:** Approved (brainstorm) → ready for implementation plan
**Workstream:** distributed-sync. S1–S5 + the S6 co-edit set (S6a/S6c/S6b) + **S7-A poison-bulk quarantine** all DONE + PUSHED (`origin/main` `75dacfdf`). This is the **second S7 hardening sub-slice**.
**Motivation:** the workstream exists for bandwidth-constrained, intermittent, often **asymmetric** national links (Mozambique-style). The sync transport currently sends and receives **uncompressed JSON** — the single biggest cheap win available. North-star §4 already calls for "batched, **gzip-compressed**, resumable".

---

## 1. Summary

Today nothing on the wire is compressed: `buildApp` (`apps/server/src/app.ts:55`) registers no compression plugin, and the sync client posts raw `JSON.stringify` bodies with `Content-Type: application/json` (`postJson` at `packages/bootstrap/src/index.ts:769`, `postPush` at `:796`).

S7-B compresses **both directions**:
- **central → lab (responses):** a global `@fastify/compress` registration. Node's `fetch` (undici) already sends `Accept-Encoding: gzip` and auto-decompresses, so this needs **zero client change** and immediately shrinks the biggest payloads — terminology bulk pages (LOINC ≈ 109k concepts), pull config, `pull-amendments`.
- **lab → central (requests):** the **push batch only**, gzipped client-side and inflated server-side, gated by an **auto-negotiation** so it can never break a lab talking to a not-yet-upgraded central.

`node:zlib` is already used by this codebase (S5 bundles: `packages/sync/src/bundle.ts` `gzipSync`/`gunzipSync`), so client-side gzip needs no new dependency. S5 bundles are CLI-written files, not HTTP-served — no double-compression interaction.

## 2. Decisions (from brainstorm)

1. **Both directions.** Responses are nearly free; requests are the real work. On asymmetric links the lab's *upload* is usually the scarcer resource, so compressing only downloads would skip the direction that hurts most.
2. **`@fastify/compress`, registered globally** in `buildApp` — one well-tested dep, standard negotiation, sane thresholds, and `compressible`/mime-db means already-compressed payloads (PDF/xlsx exports) are skipped automatically. Global also compresses the **studio API**, which lab users hit over the *same* constrained links — a genuine bonus, not scope creep. Content negotiation is transparent, so nothing existing breaks.
3. **Auto-negotiated request compression (RFC 7694).** Central advertises `Accept-Encoding: gzip` on its sync responses; the lab caches that and gzips subsequent push bodies. **Safe by construction:** an old central sends no advert → the lab never gzips → nothing breaks. No operator action, no new endpoint, no wire-type change.

### 2.1 Key simplification: request compression is PUSH-only

Of the client's HTTP calls, only the push carries a large request body. `postJson`'s bodies are tiny cursors/keys (`{fromSeq}`, `{systemUrl, afterCode}`) — gzipping those costs CPU and would *add* bytes. So **only `postPush` gzips its request**; every other call benefits via response compression.

## 3. Server (`apps/server`)

Register `@fastify/compress` globally in `buildApp` (`apps/server/src/app.ts:55`, alongside `registerErrorHandler`/`registerAuth`), configured for both halves:

- **Response compression:** `threshold` ≈ 1024 (a tiny pull response shouldn't pay for a gzip header/CPU). Default `compressible` behaviour skips non-compressible mime types (PDF/xlsx report exports).
- **Request decompression:** enable inflating an incoming `Content-Encoding: gzip` body **before** the JSON body parser runs, so `POST /api/sync/push` transparently receives the parsed `PushBatch`.
  - **Plan-time verification:** confirm `@fastify/compress`'s request-decompression option names/semantics (`requestEncodings` / `forceRequestEncoding` / `onUnsupportedRequestEncoding`) against the installed version, and that an unsupported `Content-Encoding` yields a clean **415** rather than an opaque 500.
- **Advertise (RFC 7694):** an `onSend` hook adds `Accept-Encoding: gzip` to sync responses, signalling "I accept gzipped request bodies". RFC 7694 defines `Accept-Encoding` as a *response* header for exactly this purpose. Old centrals send no such header — that absence is the negotiation.

## 4. Client (`packages/bootstrap`)

`postPush` (`packages/bootstrap/src/index.ts:796`) gains auto-negotiated request gzip:

- **Cache:** a `centralAcceptsGzip = false` flag scoped to the sync wiring (in-memory; re-learned within one request after a restart — durability is unnecessary).
- **Send:** if `centralAcceptsGzip` **and** the serialized batch exceeds a threshold (~1 KB), send `gzipSync(body)` with `Content-Encoding: gzip`; otherwise send plain.
- **Learn:** after each push, read `res.headers.get('accept-encoding')` from the response and update the cache. The **first push is always plain** (safe by construction); subsequent pushes compress once central has advertised.
- `postJson` is unchanged (tiny bodies; see §2.1). Its *responses* are compressed automatically by the server + undici.
- Uses `node:zlib` `gzipSync` — no new dependency.

## 5. Compatibility matrix

| | old central | new central |
|---|---|---|
| **old lab** | unchanged | responses gzipped (undici already sends `Accept-Encoding` and auto-decompresses — works today with no lab change); pushes plain |
| **new lab** | no advert → **never gzips requests** → unchanged, safe | 1st push plain, then gzipped both ways |

No upgrade-order requirement, no operator action, no failure mode. This is the property that justifies the auto-negotiation over a config flag.

## 6. Testing

- **Unit (server):** a gzipped push body round-trips (inflated → parsed → applied identically to a plain body); a plain body still works (no regression); an unsupported `Content-Encoding` → clean 415; sync responses carry `Accept-Encoding: gzip`; a response above threshold is gzipped and one below is not.
- **Unit (client):** with no advert → body is plain and carries **no** `Content-Encoding` header (the old-central safety case — the single most important test in this slice); after a response advertises → the next push is gzipped and round-trips to the identical `PushBatch`; a sub-threshold batch stays plain even when advertised.
- **Live acceptance:** extend the existing two-PG push harness (`scripts/sync-live-acceptance.ts` / `pnpm sync:accept`) or add `pnpm sync:gzip:accept` — push a realistically-sized batch and assert (a) it applies identically when gzipped, and (b) **the compressed body is materially smaller than the plain one**. (b) is the slice's entire justification: a gzip that doesn't shrink is a bug, so measure it rather than assume.
- **Regression:** all 6 sync acceptance harnesses (`sync:accept`, `:pull`, `:terminology`, `:amend`, `:order-status`, `:patient-merge`, `:quarantine`) + the full per-package gate. `sync:terminology:accept` matters most — it exercises the biggest compressed responses.

## 7. Components

| Piece | Package / file |
|---|---|
| `@fastify/compress` registration (responses + request inflate) + RFC 7694 `Accept-Encoding` advert hook | `apps/server` (`app.ts`, `package.json`) |
| `postPush` auto-negotiated request gzip (cache + threshold + learn-from-response) | `@openldr/bootstrap` (`index.ts`) |
| Gzip round-trip + old-central-safety + threshold tests | `apps/server`, `@openldr/bootstrap` |
| Acceptance: gzipped push applies identically **and measurably shrinks** | `scripts/` + `package.json` |
| Docs (transport compression + the negotiation) | `docs/` (operator/architecture) |

## 8. Build / process conventions

- Branch `feat/sync-s7-gzip`; subagent-driven per task with two-stage review; merge `--no-ff` to local `main`.
- Gate per-package on Windows (`pnpm --filter <pkg> exec vitest run` / `tsc --noEmit`); never pipe turbo/tsc through `tail` (it masks exit codes).
- Ask before pushing to origin. **No `Co-Authored-By` trailer.**
- Shared working directory: a concurrent user session may hold the checkout — do not switch branches/stash.

## 9. Non-goals / deferred

- **brotli** — better ratio, more CPU, weaker universality; gzip is the safe default. Revisit if measurement justifies it.
- Compressing `postJson`'s tiny request bodies (§2.1 — would add bytes).
- A config knob for compression level/threshold (defaults first; add only if measurement demands).
- The rest of the S7 backlog — LISTEN/NOTIFY wakeup, large-batch resumability/backpressure, log retention/compaction, S5 bundle encryption + central key rotation, sync observability metrics, same-version divergence detection — each its own sub-slice.
