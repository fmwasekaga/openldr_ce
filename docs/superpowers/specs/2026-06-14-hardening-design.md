# Hardening & load (P2-HARD) — design spec

**Phase-2 §7 step 7 — the final Phase-2 sub-project for OpenLDR CE.**
Date: 2026-06-14. Branch: `feat/p2-hardening`.

## Context

Phase-2 sub-projects 1–7 are merged. This step hardens the security, sandbox,
reliability, and load characteristics of the system that those sub-projects
built. It is **not** a feature step — it adds tests, redaction, docs, and one
performance optimisation (batched flat writes). The design below was agreed in a
prior brainstorming session; this spec is the frozen source of truth for the plan.

Scope is deliberately bounded: synthetic local load (not production-scale), and
the WASM memory/hard-timeout sandbox gap stays a documented carry-forward (the
Extism 1.0.3 JS SDK cannot enforce it). We harden what is enforceable today and
honestly document what is not.

## Goals

- **P2-HARD-3 (Secrets):** No secret value — connection-string password, DHIS2
  Basic-auth credential, S3 key, OIDC secret — can reach stdout/stderr/logs via
  any error path. Today the 6 `redact()` callers are correct, but every CLI error
  boundary prints raw `errorMessage(err)`, and `redact()` only masks URL userinfo.
- **P2-HARD-1 (Sandbox):** Document the plugin security posture honestly, and add
  fuzz/property tests proving the HL7 v2 and tabular parsers degrade gracefully
  (return errors, never panic/hang) on malformed input.
- **Reliability:** Lock in the existing outbox lease-reaper behaviour with a test,
  and sweep for genuinely swallowed errors, fixing the real ones.
- **P2-HARD-2 / P2-NFR-3 (Load):** Batch the flat-writer (the confirmed
  bottleneck — one round-trip per resource), parameterise the sample generator
  for volume, and add a repeatable load-measurement path with baseline-vs-batched
  numbers on **both** Postgres and SQL Server.

## Non-goals

- Hard memory caps / interruptible timeouts on WASM plugins (Extism SDK limit —
  stays a carry-forward; the posture doc records it).
- `cargo-fuzz` / libFuzzer infrastructure (we use `cargo test`-runnable property /
  random-input tests — no new toolchain).
- `tedious bulkLoad`→staging→MERGE true bulk-copy for MSSQL (the deferred-from-P2-DB
  item). Multi-row batched MERGE is the win we take here; native bulk-copy stays a
  carry-forward.
- Production-scale / distributed load testing, k6/Gatling, CI perf gates.
- Changing the at-least-once + idempotency delivery guarantee.

---

## Slice A — Secrets & credentials (P2-HARD-3)

### Problem (grounded)

- `packages/core/src/redact.ts` masks **only** URL userinfo
  (`//user:pass@` → `//user:***@`) via one regex. 6 callers use it correctly:
  `probe.ts`, `health-registry.ts`, `adapter-event-bus/index.ts:151`,
  `ingest/handle.ts:59`, `db/persist.ts:39`.
- **Unprotected leak boundaries:** every CLI error path in
  `packages/cli/src/index.ts` (health/fhir/db migrate/db reset/db seed/forms/
  ingest/pipeline×3/queue/provenance/plugin×5/report list/audit/user×5/export)
  writes raw `errorMessage(err)` to stderr/stdout **without** `redact()`, and
  `packages/cli/src/target-store.ts:29-30` does the same.
- **Secret sources** that can surface in those errors: `adapter-db-store`
  (`pg.Pool({ connectionString })` — a pg error can carry the full DSN incl.
  password), `adapter-mssql-store` (tedious user/password), `adapter-dhis2`
  (Basic-auth header built from `user:password`).
- **Secret config fields** (`packages/config/src/schema.ts`):
  `INTERNAL_DATABASE_URL`, `TARGET_DATABASE_URL`, `MSSQL_PASSWORD`,
  `DHIS2_PASSWORD`, `S3_SECRET_ACCESS_KEY`, `S3_ACCESS_KEY_ID` (the DSN env vars
  embed passwords; `OIDC_ISSUER_URL` is a plain URL, not itself a secret).
- The logger is plain `pino({ name, level })` (`packages/core/src/logger.ts`) with
  **no `redact` config** — a structured `logger.error({ err })` that includes a
  config object or DSN would emit secrets verbatim.

### Deliverables

1. **Extend `redact(text)`** (pattern-based, no secret list needed) to also mask:
   - more URL userinfo forms (keep `scheme://user:pass@` and ensure it tolerates
     passwords with special chars and multiple URLs in one string);
   - `Authorization: Basic <b64>` / `Authorization: Bearer <token>` headers →
     `Authorization: ***`;
   - connection-string credential params: `password=...`, `pwd=...` (case-insensitive,
     `;`/`&`/whitespace/end terminated) → `password=***`.
   - Keep it a pure, composable string transform; the existing 6 callers must stay
     green (URL-userinfo behaviour unchanged for their inputs).

2. **Value-based redactor — `makeRedactor(secrets: string[]): (text: string) => string`**
   (new, in `@openldr/core`). Given the actual loaded secret values, returns a
   function that masks any literal occurrence of a non-empty secret anywhere in a
   string (longest-first to avoid partial-mask artefacts; ignores empty/whitespace
   secrets; escapes regex metacharacters). Catches secrets in forms the pattern
   redactor can't anticipate (e.g. a bare password echoed in a driver error).
   Composes with the pattern `redact()`.

3. **Apply redaction at every CLI error boundary.** A single CLI helper
   (e.g. `redactError(err)` = `redact(errorMessage(err))`, optionally also running a
   value-redactor built from the loaded config's secret fields when config is
   available) replaces the bare `errorMessage(err)` at each `process.stderr.write` /
   error-JSON site in `cli/src/index.ts` and `cli/src/target-store.ts`. JSON error
   outputs (`{ error: ... }`, `{ status:'down', error: ... }`) get the same treatment.

4. **pino `redact` config** in `createLogger` so structured logs never emit secret
   keys: redact paths covering the secret-bearing keys an error/info log might carry
   (e.g. `*.password`, `*.connectionString`, a DSN-bearing `*.url`, `Authorization`,
   `*.secretAccessKey`, `*.accessKeyId`, and the censor applied to nested `err`/
   `config` objects where feasible). Default censor `'[redacted]'`. Must not break
   existing call sites (they log scalars like `{ batchId, error }`).

### Acceptance

- Unit tests: `redact()` masks each new form; `makeRedactor` masks literal secret
  values (incl. embedded mid-string) and is a no-op for empty secrets; the CLI
  `redactError` helper composes both. pino redact config verified by a test asserting
  a logged object with a `password`/`connectionString` key emits `[redacted]`.
- A focused test shows a CLI command failing with a DSN-bearing driver error prints
  **no** plaintext password.
- All prior `redact()` call sites unchanged in behaviour; full gates green.

---

## Slice B — Plugin sandbox (P2-HARD-1)

### Problem (grounded)

`packages/plugins/src/extism-runner.ts` is already **default-deny**:
`allowedHosts`/`allowedPaths` unset (no net/fs), host functions minimal
(`log`/`progress`), `useWasi` per-plugin, `runInWorker:false` (1.0.3 worker bug).
`manifest.ts` records `limits{memoryMb:256,timeoutMs:30000}` but the **JS SDK 1.0.3
has no memory/timeout option** — the timeout is a cooperative `setTimeout`-reject
watchdog that cannot kill a synchronous runaway, and `memoryMb` is recorded but not
enforced. The wasm workspace (`wasm/Cargo.toml`: `openldr-plugin-sdk`,
`whonet-sqlite`, `hl7v2`, `tabular`) is native-`cargo test`-able (convert glue is
`cfg(target_arch="wasm32")`-gated). Parsers have `#[test]`s only; **no fuzz infra**.

### Deliverables

1. **Security-posture review doc** (markdown, e.g. `docs/security/plugin-sandbox.md`):
   documents default-deny fs/net, minimal host functions, WASI opt-in rationale, the
   deterministic-input contract, and — clearly — the **memory/hard-timeout-not-enforced
   gap** (Extism 1.0.3 limitation, the cooperative watchdog, what an operator should
   know, and the upgrade path). Honest, no overclaiming.

2. **Fuzz / property tests (Rust, `cargo test`)** for the two text parsers:
   - `wasm/hl7v2` (`parser.rs` segment/field/component/escape parsing + `mapping.rs`
     ORU/ORM mapping): feed random and structurally-malformed byte sequences
     (truncated segments, missing separators, bad encoding chars, huge repeats,
     non-UTF8-ish bytes, empty input) and assert the parser/mapper returns an error or
     empty result — **never panics, never hangs**.
   - `wasm/tabular` (`reader.rs` csv/xlsx + `mapping.rs` config-driven row mapping):
     feed malformed CSV (ragged rows, embedded quotes/newlines, BOM, empty), bad
     config, and non-zip bytes claiming to be xlsx; assert graceful error, no panic.
   - Use `proptest` (preferred — add as `[dev-dependencies]`, USTC mirror per memory)
     or a hand-rolled deterministic PRNG loop if proptest pulls too much. Tests must
     run under plain `cargo test` (the native, non-wasm path) — no new toolchain, no
     `cargo-fuzz`.

### Acceptance

- `cargo test` in `wasm/` passes incl. the new property/fuzz tests; no panic/hang on
  any generated input (bounded iteration count so the suite stays fast).
- The posture doc exists, is accurate against `extism-runner.ts`/`manifest.ts`, and
  names the unenforced-limits gap explicitly.

---

## Slice C — Reliability (verify + error sweep)

### Problem (grounded)

The outbox **lease-reaper already exists** in
`packages/adapter-event-bus/src/index.ts` (`claim()`, lines ~78-118): it reclaims
stale `processing` rows (`updated_at < now() - leaseMs`, default 300000ms via
`DEFAULT_LEASE_MS`), increments `attempts`, and fails past `max_attempts` with
`'lease expired: worker presumed crashed while processing'`. Schema:
`migrations/internal/002_outbox.ts`. The reaper is **passive** (fires only on
claim/drain; the worker drains every ~2s + on `pg_notify`).

### Deliverables

1. **Focused reaper test** proving: a row left in `status='processing'` with a stale
   `updated_at` (older than `leaseMs`) is reclaimed on the next `claim()`/`drain()`,
   its `attempts` increments, and once `attempts >= max_attempts` it transitions to
   `failed` with the lease-expired error — and that a *fresh* `processing` row within
   the lease window is **not** reaped. Use a low `leaseMs` (injected via
   `EventBusConfig.leaseMs`) against a real Postgres (the package's existing live/db
   test style) or a faithful harness.

2. **Swallowed-error sweep** across `packages/**`: find empty `catch {}`, ignored
   promise rejections (`void p.catch(()=>undefined)` that hides real faults),
   `catch { return undefined }` that masks a fault the caller should see, and missing
   graceful-degradation. Distinguish **intentional** best-effort swallows (already
   documented: `safeRecord` audit, `startWorker` tick `.catch`, the unknown-handler
   requeue) from genuine bugs. **Fix the real ones**; leave (and note) the intentional
   ones. Add a startup reconcile **only if a genuine gap surfaces** (the 2s poll
   already drives the reaper, so likely unnecessary).

### Acceptance

- The reaper test passes and would fail if the reap branch were removed.
- The sweep is documented (what was found, fixed, and intentionally left + why) in the
  slice's commit(s); any fix has a regression test.
- Full gates green.

---

## Slice D — Warehouse load / perf (P2-HARD-2, P2-NFR-3)

### Problem (grounded)

`packages/db/src/flat-writer.ts` writes **one** `INSERT ... ON CONFLICT` (PG) or
**one** `MERGE` (MSSQL `upsertMssql`) **per resource** — N resources = N round-trips,
and `db/persist.ts` adds the canonical FHIR save per resource on top. The persist
loop (`ingest/handle.ts:44-46`) is **sequential** (`for … await persist`). The
sample generators `scripts/make-whonet-sample.mjs` + `make-lab-sample.mjs` are
**2-row hardcoded** (not parameterised). There is **zero** existing perf measurement.
Engine is selected via `TARGET_STORE_ADAPTER` → `bootstrap/target-store.ts`
`selectTargetStore` (`pg`|`mssql`).

### Deliverables

1. **Batch the flat-writer** — add a batch write API to `FlatWriter`
   (e.g. `writeMany(items: {resource, provenance}[]): Promise<WriteResult[]>` or a
   grouped variant) that, per flat **table**, emits a **multi-row** `INSERT … ON
   CONFLICT DO UPDATE` for PG and a **batched MERGE** (multi-row `VALUES` source, or
   chunked) for MSSQL — idempotent on `id` (same trust-boundary note as the existing
   single-row MERGE: table/cols are closed-schema internal identifiers, values
   parameterised). Group a mixed-resource batch by target table (`flattenResource`
   routes each resource to one of 7 tables). Chunk to a safe param limit (PG ~65535
   params; MSSQL ~2100 params / 1000-row insert limit) so large batches don't exceed
   driver limits.
   - **Use it in the persist path:** add a batched persist (canonical saves may stay
     per-resource initially; the flat writes batch) wired through `handleIngestEvent`
     so an ingest of N resources does **far fewer** round-trips. Preserve DP-7
     semantics (internal save must-succeed; external batch failure → degraded, logged,
     no crash) and provenance.

2. **Parameterise `make-whonet-sample.mjs`** with `--rows N` (default keeps current
   behaviour) to generate volume datasets via `node:sqlite`, so load runs have a real
   N-isolate WHONET SQLite input the WHONET plugin ingests.

3. **Load-measurement path:** a small script (e.g. `scripts/load-measure.mjs` +
   `pnpm load:measure`) that ingests N resources (generate sample → `ingest --plugin
   whonet-sqlite`), times it, and reports **rows/s** (and total wall-clock). Capture
   **baseline (per-row) vs batched** numbers on **both Postgres and SQL Server**
   (P2-NFR-3) and record them in a short results table (spec/plan/commit). The batched
   path must be measurably faster than baseline on both engines.

### Acceptance

- `writeMany` unit-tested: correct multi-row SQL shape per engine (assert generated
  SQL / branch selection like the existing FlatWriter tests do), idempotency on `id`,
  table-grouping, chunking at the param limit, mixed-resource batches.
- Live multi-driver acceptance (PG + MSSQL, per memory: `docker compose --profile
  mssql up -d`, create db, `MSSQL_PORT=11433`): generate an N-row WHONET sample,
  ingest both ways, verify **identical** flat-table contents (batched == per-row,
  still idempotent on re-ingest) and report rows/s improvement on both engines.
- **Honest caveat recorded:** synthetic local volume + batching + measurement, not a
  production-scale load test.
- Full gates green on both engines; Postgres path un-regressed.

---

## Cross-cutting / conventions

- One feature branch `feat/p2-hardening`; slices A→B→C→D as task groups, merged
  `--no-ff` to `main` at the end (per-slice merges acceptable if cleaner).
- TDD per task (write the failing test first). Subagent-driven development: fresh
  implementer subagent per task + two-stage spec/quality review.
- Commits: conventional, suffix `(P2-HARD)` or `(P2-HARD-N)`. **No `Co-Authored-By`.**
- Gates after substantive tasks and before finishing:
  `pnpm -s typecheck && pnpm -s test && pnpm -s depcruise && pnpm -s build:check`
  (depcruise excludes `dist/`; fall back to `pnpm --filter <pkg> exec …` if the
  core-js ignored-builds gate aborts a runner). Rust via `cargo test` in `wasm/`
  (USTC mirror per memory).
- DP-1 holds: no new adapter imports outside `@openldr/bootstrap`. New core helpers
  (`makeRedactor`) live in `@openldr/core`; the batch writer in `@openldr/db`.
- Finish with `superpowers:finishing-a-development-branch`: verify tests, strip any
  injected `Co-Authored-By`, merge `--no-ff`, re-run full gates on `main`, delete the
  branch. Update the build-plan memory + `MEMORY.md` index.

## Risks

- **redact() over-masking** legitimate non-secret text (e.g. a URL with userinfo in a
  user-facing message). Mitigation: targeted patterns + tests on realistic strings.
- **Batched MERGE param limits** on MSSQL (2100 params / 1000 rows) — chunk; test the
  boundary. PG 65535-param limit similarly chunked.
- **proptest dependency weight / mirror** — fall back to a hand-rolled PRNG loop if it
  bloats the wasm build or won't fetch.
- **Live MSSQL acceptance** needs the Docker stack up (sibling `sqlserver` holds 1433;
  ours is 11433) — same procedure as P2-DB / P2-REP acceptance.
