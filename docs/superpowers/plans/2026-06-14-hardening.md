# Hardening & load (P2-HARD) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden OpenLDR CE's secrets handling, plugin sandbox, ingest reliability, and warehouse write throughput — the final Phase-2 step — without changing feature behaviour.

**Architecture:** Four independent slices on one branch `feat/p2-hardening`. (A) pattern + value redaction applied at every log/CLI boundary; (B) Rust property/fuzz tests + a security-posture doc; (C) a reaper integration test + a swallowed-error sweep; (D) a batched flat-writer + a parameterised sample generator + a load-measurement script with PG/MSSQL numbers.

**Tech Stack:** TypeScript (pnpm monorepo, vitest, kysely, pino, commander), Rust (`wasm/` Cargo workspace, `cargo test`), Postgres + SQL Server (Docker).

**Spec:** `docs/superpowers/specs/2026-06-14-hardening-design.md`

**Conventions (honor exactly):**
- GateGuard hook gates the first Bash and every Edit/Write — present the four facts (importers; no duplicate via Glob; data field/format; the user's verbatim instruction) then retry the same call. Destructive-command gate (git checkout/branch -d/rm) wants files-affected + rollback + instruction.
- Conventional commits, suffix `(P2-HARD)` or `(P2-HARD-N)`. **No `Co-Authored-By` trailers.**
- TS gates after substantive tasks: `pnpm -s typecheck && pnpm -s test && pnpm -s depcruise && pnpm -s build:check` (fall back to `pnpm --filter <pkg> exec vitest run` etc. if the `core-js` ignored-builds gate aborts a runner). Rust: `cargo test` in `wasm/` (USTC crates.io mirror per memory; building wasm artifacts needs `pnpm build:plugins`, but **fuzz tests run native via `cargo test`** — no wasm build needed).
- DP-1: only `@openldr/bootstrap` imports a concrete `adapter-*`. New core helpers live in `@openldr/core`; the batch writer in `@openldr/db`.

---

## File Structure

**Slice A — Secrets:**
- Modify: `packages/core/src/redact.ts` (extend patterns + add `makeRedactor`)
- Modify: `packages/core/src/redact.test.ts` (new cases)
- Modify: `packages/core/src/logger.ts` (pino `redact` config)
- Create: `packages/core/src/logger.test.ts` (assert redaction)
- Create: `packages/cli/src/redact-error.ts` (`redactError` helper)
- Create: `packages/cli/src/redact-error.test.ts`
- Modify: `packages/cli/src/index.ts` (every error boundary) + `packages/cli/src/target-store.ts:29-30`

**Slice B — Sandbox:**
- Create: `docs/security/plugin-sandbox.md`
- Create: `wasm/hl7v2/src/fuzz.rs` (+ `mod fuzz;` in `lib.rs`) — property tests
- Create: `wasm/tabular/src/fuzz.rs` (+ `mod fuzz;` in `lib.rs`) — property tests

**Slice C — Reliability:**
- Create: `packages/adapter-event-bus/src/lease-live.test.ts` (opt-in live-PG reaper test)
- Modify: any genuine swallowed-error site the sweep finds (+ its regression test)
- Create: `docs/superpowers/notes/2026-06-14-error-sweep.md` (sweep findings record)

**Slice D — Load:**
- Modify: `packages/db/src/flat-writer.ts` (add `writeMany`)
- Modify: `packages/db/src/flat-writer.test.ts` (batch cases)
- Modify: `packages/db/src/persist.ts` (add `persistResources` batched path)
- Modify: `packages/db/src/persist.test.ts`
- Modify: `packages/db/src/index.ts` (export new symbols if needed)
- Modify: `packages/ingest/src/handle.ts` (use batched persist) + `packages/ingest/src/handle.test.ts`
- Modify: `packages/bootstrap/src/ingest-context.ts` (wire batched persist)
- Modify: `scripts/make-whonet-sample.mjs` (`--rows N`)
- Create: `scripts/load-measure.mjs` + root `package.json` script `load:measure`

---

## SLICE A — Secrets & credentials (P2-HARD-3)

### Task A1: Extend `redact()` with Authorization + connection-string-param patterns

**Files:**
- Modify: `packages/core/src/redact.ts`
- Modify: `packages/core/src/redact.test.ts`

- [ ] **Step 1: Add the failing tests** — append to `redact.test.ts` inside `describe('redact', …)`:

```typescript
  it('masks a Basic Authorization header value', () => {
    expect(redact('Authorization: Basic dXNlcjpwYXNz')).toBe('Authorization: Basic ***');
  });
  it('masks a Bearer Authorization header value', () => {
    expect(redact('failed with Authorization: Bearer eyJabc.def.ghi here')).toBe('failed with Authorization: Bearer *** here');
  });
  it('masks password= in a connection string', () => {
    expect(redact('Server=db;Database=x;User Id=sa;Password=S3cret!;Encrypt=false')).toBe('Server=db;Database=x;User Id=sa;Password=***;Encrypt=false');
  });
  it('masks pwd= case-insensitively', () => {
    expect(redact('host=db pwd=hunter2 sslmode=require')).toBe('host=db pwd=*** sslmode=require');
  });
  it('masks multiple URLs in one string', () => {
    expect(redact('a postgres://u1:p1@h1/x and mssql://u2:p2@h2/y')).toBe('a postgres://u1:***@h1/x and mssql://u2:***@h2/y');
  });
```

- [ ] **Step 2: Run to verify failure** — Run: `pnpm --filter @openldr/core exec vitest run src/redact.test.ts`. Expected: FAIL on the new cases.

- [ ] **Step 3: Implement** — replace `packages/core/src/redact.ts` body:

```typescript
// Mask secrets so they never reach logs / health detail / CLI error output (P1-NFR-2, P2-HARD-3).
// Pattern-based: needs no knowledge of the actual secret values. For value-based masking
// of known loaded secrets, compose with makeRedactor().
export function redact(text: string): string {
  return text
    // URL userinfo: scheme://user:password@host  ->  scheme://user:***@host (all occurrences, the /g flag)
    .replace(/(\/\/[^\s:@/]+:)[^\s@]+(@)/g, '$1***$2')
    // Authorization: Basic <b64> | Bearer <token>  ->  Authorization: <scheme> ***
    .replace(/(Authorization:\s*(?:Basic|Bearer)\s+)[^\s'"]+/gi, '$1***')
    // connection-string credential params: password=... / pwd=...  (terminated by ; & whitespace quote or end)
    .replace(/((?:password|pwd)\s*=\s*)[^\s;&'"]+/gi, '$1***');
}

/**
 * Build a value-based redactor over the actual loaded secret values. Masks any literal
 * occurrence of a non-empty secret anywhere in a string. Longest-first so a secret that is a
 * substring of another doesn't leave a partial leak; empty/whitespace secrets are ignored.
 */
export function makeRedactor(secrets: string[]): (text: string) => string {
  const real = Array.from(new Set(secrets.filter((s) => typeof s === 'string' && s.trim().length > 0)))
    .sort((a, b) => b.length - a.length);
  if (real.length === 0) return (text) => text;
  const escaped = real.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(escaped.join('|'), 'g');
  return (text: string) => text.replace(re, '***');
}
```

- [ ] **Step 4: Add the `makeRedactor` tests** — append to `redact.test.ts`:

```typescript
import { makeRedactor } from './redact';

describe('makeRedactor', () => {
  it('masks a literal secret value anywhere in a string', () => {
    const r = makeRedactor(['hunter2']);
    expect(r('tedious: login failed for password hunter2 at host')).toBe('tedious: login failed for password *** at host');
  });
  it('is a no-op when given only empty secrets', () => {
    const r = makeRedactor(['', '   ']);
    expect(r('nothing to mask')).toBe('nothing to mask');
  });
  it('escapes regex metacharacters in secrets', () => {
    const r = makeRedactor(['a.b*c']);
    expect(r('x a.b*c y axbxc')).toBe('x *** y axbxc');
  });
  it('masks the longer secret first when one contains another', () => {
    const r = makeRedactor(['pass', 'password123']);
    expect(r('password123')).toBe('***');
  });
});
```

- [ ] **Step 5: Run to verify pass** — Run: `pnpm --filter @openldr/core exec vitest run src/redact.test.ts`. Expected: PASS (all cases incl. the original 4).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/redact.ts packages/core/src/redact.test.ts
git commit -m "feat(core): extend redact() (auth headers + conn-string creds) + value-based makeRedactor (P2-HARD-3)"
```

### Task A2: pino `redact` config in `createLogger`

**Files:**
- Modify: `packages/core/src/logger.ts`
- Create: `packages/core/src/logger.test.ts`

- [ ] **Step 1: Write the failing test** — create `packages/core/src/logger.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Writable } from 'node:stream';
import { pino } from 'pino';
import { redactPaths } from './logger';

// Drive a pino logger with our redact paths into an in-memory stream and assert masking.
function capture(): { logger: ReturnType<typeof pino>; lines: () => unknown[] } {
  const chunks: string[] = [];
  const stream = new Writable({ write(c, _e, cb) { chunks.push(c.toString()); cb(); } });
  const logger = pino({ redact: { paths: redactPaths, censor: '[redacted]' } }, stream);
  return { logger, lines: () => chunks.filter(Boolean).map((l) => JSON.parse(l)) };
}

describe('logger redaction', () => {
  it('redacts a password key', () => {
    const { logger, lines } = capture();
    logger.error({ config: { password: 'hunter2' } }, 'boom');
    expect(JSON.stringify(lines())).not.toContain('hunter2');
    expect(JSON.stringify(lines())).toContain('[redacted]');
  });
  it('redacts a connectionString key', () => {
    const { logger, lines } = capture();
    logger.error({ connectionString: 'postgres://u:p@h/db' }, 'boom');
    expect(JSON.stringify(lines())).not.toContain('postgres://u:p@h/db');
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `pnpm --filter @openldr/core exec vitest run src/logger.test.ts`. Expected: FAIL — `redactPaths` not exported.

- [ ] **Step 3: Implement** — replace `packages/core/src/logger.ts`:

```typescript
import { pino, type Logger } from 'pino';

export type { Logger };

// Keys whose values may carry secrets (DSNs, passwords, tokens, S3 keys). pino redacts any
// log object property matching these paths. `*` covers a key at any one nesting level; the
// bracket forms also catch top-level keys.
export const redactPaths = [
  'password', '*.password',
  'pwd', '*.pwd',
  'connectionString', '*.connectionString',
  'secretAccessKey', '*.secretAccessKey',
  'accessKeyId', '*.accessKeyId',
  'authorization', '*.authorization', 'Authorization', '*.Authorization',
];

export function createLogger(opts?: { level?: string; name?: string }): Logger {
  return pino({
    name: opts?.name ?? 'openldr',
    level: opts?.level ?? process.env.LOG_LEVEL ?? 'info',
    redact: { paths: redactPaths, censor: '[redacted]' },
  });
}
```

- [ ] **Step 4: Run to verify pass** — Run: `pnpm --filter @openldr/core exec vitest run src/logger.test.ts`. Expected: PASS.

- [ ] **Step 5: Run the whole core package** — Run: `pnpm --filter @openldr/core exec vitest run`. Expected: PASS (no existing log-shape test breaks; existing call sites log scalars like `{ batchId, error }`).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/logger.ts packages/core/src/logger.test.ts
git commit -m "feat(core): pino redact config so structured logs never emit secret keys (P2-HARD-3)"
```

### Task A3: CLI `redactError` helper + apply at every CLI error boundary

**Files:**
- Create: `packages/cli/src/redact-error.ts`
- Create: `packages/cli/src/redact-error.test.ts`
- Modify: `packages/cli/src/index.ts` (all error boundaries) + `packages/cli/src/target-store.ts:29-30`

- [ ] **Step 1: Write the failing test** — create `packages/cli/src/redact-error.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { redactError } from './redact-error';

describe('redactError', () => {
  it('redacts a DSN password from an error message', () => {
    const err = new Error('connect ECONNREFUSED postgres://sa:S3cret@db:5432/openldr');
    expect(redactError(err)).toBe('connect ECONNREFUSED postgres://sa:***@db:5432/openldr');
  });
  it('redacts a Password= connection-string param from a driver error', () => {
    const err = new Error("Login failed (Server=db;User Id=sa;Password=S3cret!;)");
    expect(redactError(err)).not.toContain('S3cret!');
  });
  it('passes plain messages through unchanged', () => {
    expect(redactError(new Error('unknown report: x'))).toBe('unknown report: x');
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `pnpm --filter @openldr/cli exec vitest run src/redact-error.test.ts`. Expected: FAIL — module missing.

- [ ] **Step 3: Implement** — create `packages/cli/src/redact-error.ts`:

```typescript
import { errorMessage, redact } from '@openldr/core';

/**
 * Single CLI error-formatting boundary: stringify an unknown error, then redact secrets.
 * Pattern-based redaction (DSN userinfo, Authorization headers, password=/pwd=) covers
 * driver errors that echo a connection string. Use everywhere the CLI prints an error.
 */
export function redactError(err: unknown): string {
  return redact(errorMessage(err));
}
```

- [ ] **Step 4: Run to verify pass** — Run: `pnpm --filter @openldr/cli exec vitest run src/redact-error.test.ts`. Expected: PASS.

- [ ] **Step 5: Apply at every CLI error boundary** — in `packages/cli/src/index.ts`:
  - add to the imports: `import { redactError } from './redact-error';`
  - replace **every** `errorMessage(err)` occurrence in an error path with `redactError(err)`. There are ~15+ catch sites: `health` (lines ~40, 42), `fhir validate` (~66, 68), `db migrate` (~82), `db reset` (~94), `db seed` (~105), `forms extract` (~149), `ingest` (~167), `pipeline status/retry/logs` (~174/177/180), `queue status` (~185), `provenance audit` (~190), `plugin install/list/test/run/remove` (~200/206/213/222/229), `report list` (~234), `report run` (~244), `audit list` (~262), `user list/show/create/set-role/activate/deactivate` (~267/270/280/283/286/289), `export` (~301).
  - Then remove the now-unused `errorMessage` import **only if** no non-error use remains (it is imported on line 4; grep first — if every use became `redactError`, drop it from the import).

  Example transformation (the `health` catch):

```typescript
    } catch (err) {
      if (opts.json) {
        process.stdout.write(JSON.stringify({ status: 'down', error: redactError(err) }) + '\n');
      } else {
        process.stderr.write(`health failed: ${redactError(err)}\n`);
      }
      process.exitCode = 1;
    } finally {
```

- [ ] **Step 6: Apply in `target-store.ts`** — in `packages/cli/src/target-store.ts`, replace the import `import { errorMessage } from '@openldr/core';` with `import { redactError } from './redact-error';` and change lines 29-30:

```typescript
    if (opts.json) process.stdout.write(JSON.stringify({ status: 'down', error: redactError(err) }) + '\n');
    else process.stderr.write(`target-store test failed: ${redactError(err)}\n`);
```

- [ ] **Step 7: Verify build & typecheck** — Run: `pnpm --filter @openldr/cli exec tsc --noEmit` then `pnpm --filter @openldr/cli exec vitest run`. Expected: PASS, no unused-import error.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/redact-error.ts packages/cli/src/redact-error.test.ts packages/cli/src/index.ts packages/cli/src/target-store.ts
git commit -m "feat(cli): redact secrets at every CLI error boundary via redactError helper (P2-HARD-3)"
```

### Task A4: Slice-A gate

- [ ] **Step 1: Full gates** — Run: `pnpm -s typecheck && pnpm -s test && pnpm -s depcruise && pnpm -s build:check`. Expected: all green. (If the `core-js` ignored-builds gate aborts, run each gate per-package.)

- [ ] **Step 2: Manual leak check** — Run a CLI command that fails with a DSN-bearing error and confirm no plaintext password. Example: `INTERNAL_DATABASE_URL=postgres://sa:LEAKME@nohost:5432/x pnpm openldr health 2>&1 | grep -c LEAKME` → expect `0`. (Adjust env/cmd to a path that surfaces the DSN; if no path surfaces it, note that and rely on the unit tests.)

---

## SLICE B — Plugin sandbox (P2-HARD-1)

### Task B1: Security-posture review doc

**Files:**
- Create: `docs/security/plugin-sandbox.md`

- [ ] **Step 1: Read the ground truth** — Read `packages/plugins/src/extism-runner.ts` and `packages/plugins/src/manifest.ts` so the doc is accurate.

- [ ] **Step 2: Write the doc** — create `docs/security/plugin-sandbox.md` covering, factually:
  - **Isolation model:** Extism (`@extism/extism@1.0.3`), `runInWorker:false` (1.0.3 worker bug — ERR_INVALID_URL on `worker.js.map`), in-process.
  - **Default-deny:** `allowedHosts`/`allowedPaths` left unset ⇒ no network, no host filesystem. WASI is **opt-in per plugin** (`useWasi: opts.wasi`); pure-Rust plugins still need `wasi:true` because std imports `wasi_snapshot_preview1` even for in-memory work.
  - **Host surface:** only `log` and `progress` host functions are exposed (`extism:host/user`); no syscalls, no eval.
  - **Integrity:** plugins are sha256-verified on install **and** re-verified on load (runtime).
  - **Input contract:** plugins receive only the payload bytes + an operator-supplied config map; output is NDJSON FHIR, each resource re-validated strictly.
  - **KNOWN GAP (call it out plainly):** the 1.0.3 JS SDK exposes **no memory-page or hard-timeout option**. `limits.memoryMb` (256) is recorded in the manifest but **not enforced**; the timeout (`limits.timeoutMs`, 30000) is a **cooperative watchdog** (`setTimeout`→reject racing `plugin.call`) that bounds async overruns but **cannot interrupt a synchronous runaway** (in-process, no worker). Operator guidance: only install trusted/audited plugins; a malicious or buggy plugin can spin CPU/allocate memory until the host process is killed. Upgrade path: a newer Extism SDK with worker + memory/timeout limits would let us enforce these hard.

- [ ] **Step 3: Commit**

```bash
git add docs/security/plugin-sandbox.md
git commit -m "docs(security): plugin sandbox posture incl. unenforced memory/hard-timeout gap (P2-HARD-1)"
```

### Task B2: HL7 v2 parser property/fuzz tests

**Files:**
- Create: `wasm/hl7v2/src/fuzz.rs`
- Modify: `wasm/hl7v2/src/lib.rs` (add `#[cfg(test)] mod fuzz;`)

Targets (already native-testable): `parser::parse_messages(raw: &str) -> Vec<Vec<Segment>>`, `parser::unescape`, `mapping::map_message(segs, &Config::default(), seq) -> Vec<Value>`. Property: **never panic, never hang** on arbitrary/malformed input. We use a hand-rolled deterministic xorshift PRNG (no new crate — avoids the proptest dependency/mirror risk noted in memory; a panic fails `cargo test`, and a bounded iteration count guarantees termination).

- [ ] **Step 1: Write the failing test** — create `wasm/hl7v2/src/fuzz.rs`:

```rust
//! Property/fuzz tests: the parser and mapper must degrade gracefully (return empty/partial,
//! never panic, never hang) on random and structurally-malformed input. Native `cargo test`.
use crate::mapping::{map_message, Config};
use crate::parser::{parse_messages, unescape, Encoding};

// Deterministic xorshift64* PRNG — reproducible, no external crate.
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12; x ^= x << 25; x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545F4914F6CDD1D)
    }
    fn byte(&mut self) -> u8 { (self.next() & 0xff) as u8 }
}

// Bytes biased toward HL7-significant chars so we exercise the structural paths, not just noise.
fn fuzzy_bytes(rng: &mut Rng, len: usize) -> Vec<u8> {
    const SIG: &[u8] = b"|^~\\&\r\nMSHPIDOBXR01ORU0123";
    (0..len).map(|_| if rng.byte() & 1 == 0 { SIG[(rng.byte() as usize) % SIG.len()] } else { rng.byte() }).collect()
}

#[test]
fn parse_messages_never_panics_on_random_input() {
    let mut rng = Rng(0x1234_5678_9abc_def0);
    for _ in 0..2000 {
        let len = (rng.next() % 256) as usize;
        let bytes = fuzzy_bytes(&mut rng, len);
        let s = String::from_utf8_lossy(&bytes);
        let _ = parse_messages(&s); // must return without panicking/hanging
    }
}

#[test]
fn map_message_never_panics_on_fuzzed_messages() {
    let mut rng = Rng(0xdead_beef_cafe_babe);
    let cfg = Config::default();
    for i in 0..2000 {
        let len = (rng.next() % 512) as usize;
        let s = String::from_utf8_lossy(&fuzzy_bytes(&mut rng, len)).into_owned();
        for segs in parse_messages(&s) {
            let _ = map_message(&segs, &cfg, i);
        }
    }
}

#[test]
fn unescape_never_panics_on_truncated_sequences() {
    let enc = Encoding::default();
    let cases = ["\\", "\\F", "\\\\", "\\X41", "a\\F\\", "\\R\\\\T\\", "", "\\&\\S"];
    for c in cases { let _ = unescape(c, &enc); }
}

#[test]
fn handles_degenerate_inputs() {
    for s in ["", "MSH", "MSH|", "M", "\r\r\r", "MSH|^~\\&|", "PID|||"] {
        let _ = parse_messages(s);
    }
}
```

- [ ] **Step 2: Register the module** — in `wasm/hl7v2/src/lib.rs`, add near the other `mod` declarations:

```rust
#[cfg(test)]
mod fuzz;
```

- [ ] **Step 3: Run** — Run: `cargo test -p openldr-hl7v2` (from `wasm/`). Expected: PASS (the existing parser already returns `Vec`/`Option` so it should be panic-free; if any case panics, that is a real bug — fix the parser, do not weaken the test). Note: confirm the crate name with `cargo metadata`/`Cargo.toml` if `-p openldr-hl7v2` is not found.

- [ ] **Step 4: Commit**

```bash
git add wasm/hl7v2/src/fuzz.rs wasm/hl7v2/src/lib.rs
git commit -m "test(hl7v2): property/fuzz tests prove parser+mapper never panic on malformed input (P2-HARD-1)"
```

### Task B3: Tabular reader property/fuzz tests

**Files:**
- Create: `wasm/tabular/src/fuzz.rs`
- Modify: `wasm/tabular/src/lib.rs` (add `#[cfg(test)] mod fuzz;`)

Targets: `reader::read_rows(bytes: &[u8], sheet: Option<&str>) -> Result<Vec<Row>, String>` and `mapping::map_rows(&[Row], &Mapping) -> Vec<Value>`. Property: graceful `Err` or empty `Ok`, never panic, on malformed CSV / bad config / non-zip-claiming-xlsx.

- [ ] **Step 1: Write the failing test** — create `wasm/tabular/src/fuzz.rs`:

```rust
//! Property/fuzz tests: the reader must return Err or empty Ok (never panic/hang) on malformed
//! bytes, and the mapper must not panic on arbitrary rows. Native `cargo test`.
use crate::mapping::{map_rows, Mapping};
use crate::reader::{read_rows, Row};
use std::collections::HashMap;

struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 { let mut x=self.0; x^=x>>12; x^=x<<25; x^=x>>27; self.0=x; x.wrapping_mul(0x2545F4914F6CDD1D) }
    fn byte(&mut self) -> u8 { (self.next() & 0xff) as u8 }
}

fn csvish(rng: &mut Rng, len: usize) -> Vec<u8> {
    const SIG: &[u8] = b",\t\r\n\"abc123";
    (0..len).map(|_| if rng.byte() & 1 == 0 { SIG[(rng.byte() as usize) % SIG.len()] } else { rng.byte() }).collect()
}

#[test]
fn read_rows_never_panics_on_csvish_bytes() {
    let mut rng = Rng(0x0bad_f00d_1234_5678);
    for _ in 0..2000 {
        let len = (rng.next() % 256) as usize;
        let _ = read_rows(&csvish(&mut rng, len), None); // Ok or Err, never panic
    }
}

#[test]
fn read_rows_handles_zip_magic_that_is_not_xlsx() {
    // Looks like xlsx (PK\x03\x04) but is garbage -> must be Err, not a panic.
    let mut bytes = vec![0x50, 0x4B, 0x03, 0x04];
    bytes.extend_from_slice(&[0u8; 64]);
    assert!(read_rows(&bytes, None).is_err());
}

#[test]
fn read_rows_handles_degenerate_csv() {
    for raw in ["", "\n", "a,b\n1", "a,b,c\n1,2", "\"unterminated", "h\r\n\r\n\r\n"] {
        let _ = read_rows(raw.as_bytes(), None);
    }
}

#[test]
fn map_rows_never_panics_on_arbitrary_rows() {
    let mut rng = Rng(0xfeed_face_0102_0304);
    let m = Mapping {
        sheet: None, patient_id: "pid".into(), gender: Some("sex".into()), gender_map: None,
        birth_date: None, specimen_id: "sid".into(), specimen_type: None, collected_date: None,
        origin: None, origin_map: None, organism: Some("org".into()), organism_code: None, antibiotics: None,
    };
    for _ in 0..1000 {
        let mut row: Row = HashMap::new();
        let n = (rng.byte() % 6) as usize;
        for _ in 0..n {
            let k = format!("k{}", rng.byte());
            let v = String::from_utf8_lossy(&csvish(&mut rng, (rng.byte() % 16) as usize)).into_owned();
            row.insert(k, v);
        }
        let _ = map_rows(&[row], &m);
    }
}
```

- [ ] **Step 2: Register the module** — in `wasm/tabular/src/lib.rs`, add:

```rust
#[cfg(test)]
mod fuzz;
```

- [ ] **Step 3: Run** — Run: `cargo test -p openldr-tabular` (from `wasm/`). Expected: PASS. (If the `Mapping` literal won't compile because the field set differs, read `mapping.rs` and match the actual struct fields exactly — the fields above are from the current struct.)

- [ ] **Step 4: Commit**

```bash
git add wasm/tabular/src/fuzz.rs wasm/tabular/src/lib.rs
git commit -m "test(tabular): property/fuzz tests prove reader+mapper never panic on malformed input (P2-HARD-1)"
```

### Task B4: Slice-B gate

- [ ] **Step 1: Full Rust test run** — Run: `cargo test` (from `wasm/`). Expected: all crates green incl. new fuzz modules.
- [ ] **Step 2: Confirm the doc names the gap** — re-read `docs/security/plugin-sandbox.md`; verify the memory/hard-timeout-not-enforced section is explicit.

---

## SLICE C — Reliability (verify + error sweep)

> **Note:** The reaper is **already unit-tested** in `packages/adapter-event-bus/src/lease.test.ts` (3 fake-pool tests asserting the claim SQL matches stale `processing` rows, reclaim bumps attempts, and terminal-fail past max_attempts). This slice (1) adds a **live-Postgres** test that proves the real `updated_at < now() - interval` arithmetic actually reclaims a row (the fake-pool test cannot), and (2) sweeps for genuinely swallowed errors.

### Task C1: Live-Postgres reaper integration test

**Files:**
- Create: `packages/adapter-event-bus/src/lease-live.test.ts`

- [ ] **Step 1: Decide the live-DB guard** — the test runs against a real Postgres only when `INTERNAL_DATABASE_URL` (or a dedicated test URL) is set; otherwise it skips, so the default `pnpm test` stays hermetic. First confirm the env var name the repo uses for live DB tests (grep `packages/**/*.test.ts` for `skipIf`/`process.env.*DATABASE`); use that convention. Below assumes `process.env.INTERNAL_DATABASE_URL`.

- [ ] **Step 2: Write the test** — create `packages/adapter-event-bus/src/lease-live.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createEventBus, type EventBus } from './index';

const url = process.env.INTERNAL_DATABASE_URL;
const live = describe.skipIf(!url);

live('event-bus lease reaper (live Postgres)', () => {
  let pool: pg.Pool;
  let bus: EventBus;
  beforeAll(() => { pool = new pg.Pool({ connectionString: url }); });
  afterAll(async () => { await bus?.close?.(); await pool.end(); });

  it('reclaims a row stuck in processing past the lease window', async () => {
    // leaseMs = 50ms so a row updated >50ms ago is stale.
    bus = createEventBus({ url: url!, leaseMs: 50 }, { pool });
    const id = randomUUID();
    // Insert a row already in 'processing' with an updated_at far in the past.
    await pool.query(
      `insert into outbox_events (id, type, payload, status, attempts, max_attempts, available_at, updated_at)
       values ($1, 'reaper.test', $2, 'processing', 0, 5, now() - interval '1 hour', now() - interval '1 hour')`,
      [id, JSON.stringify({ marker: id })],
    );
    let handled = false;
    await bus.subscribe('reaper.test', async () => { handled = true; });
    const res = await bus.drain();
    expect(handled).toBe(true);
    expect(res.processed).toBeGreaterThanOrEqual(1);
    const after = await pool.query(`select status, attempts from outbox_events where id=$1`, [id]);
    expect(after.rows[0].status).toBe('done');
    expect(after.rows[0].attempts).toBe(1); // crash counted as one attempt
    await pool.query(`delete from outbox_events where id=$1`, [id]);
  });
});
```

- [ ] **Step 3: Run with a live DB** — start the stack (`docker compose up -d`), migrate (`pnpm openldr db migrate`), then Run: `INTERNAL_DATABASE_URL=postgres://openldr:openldr@localhost:5433/openldr pnpm --filter @openldr/adapter-event-bus exec vitest run src/lease-live.test.ts` (use the repo's actual dev DSN — port 5433 per the override). Expected: PASS. Without the env var, Run the same without it → the suite **skips** (0 failures).

- [ ] **Step 4: Commit**

```bash
git add packages/adapter-event-bus/src/lease-live.test.ts
git commit -m "test(event-bus): live-PG reaper test proves real lease-interval reclaim (P2-HARD)"
```

### Task C2: Swallowed-error sweep

**Files:**
- Create: `docs/superpowers/notes/2026-06-14-error-sweep.md`
- Modify: any genuine swallowed-error site found (+ regression test)

- [ ] **Step 1: Sweep** — search `packages/**` for swallowed errors. Patterns to grep: `catch {}`, `catch (e) {}`, `.catch(() => undefined)`, `.catch(() => {})`, `catch { return`, `} catch { /` (empty), and ignored floating promises (`void ` before an async call). Read each hit and classify:
  - **Intentional best-effort** (leave, but list): `safeRecord` audit swallow; `startWorker` `tick`'s `void drain().catch(()=>undefined)` (a failed drain is retried next tick); the `ready` acquisition `.catch(()=>undefined)`; the DHIS2 adapter's `try { JSON.parse } catch { undefined }` (it falls through to a thrown error when no summary). These are correct degradation.
  - **Genuine bug** (fix): any `catch {}` that hides a fault the caller needs, any place a rejected promise is dropped where the failure should surface or be logged, any fallback that masks a real error as success.
  - The `ecc:silent-failure-hunter` agent is well-suited to drive this sweep; it returns a classified list.

- [ ] **Step 2: Record findings** — create `docs/superpowers/notes/2026-06-14-error-sweep.md`: a table of every swallow site (file:line, classification, action). This is the audit trail the spec requires.

- [ ] **Step 3: Fix real ones (TDD)** — for each genuine bug: write a failing test that proves the swallowed fault now surfaces (or is logged), then fix the catch to log via `logger.error({ err: redact(errorMessage(e)) }, '…')` or rethrow as appropriate. Keep DP-7 best-effort semantics where they are intentional. If the sweep finds **no** genuine bug, record that conclusion explicitly (a clean sweep is a valid outcome — the prior sub-projects already hardened the worker paths) and skip to Step 5.

- [ ] **Step 4: Run** — Run: `pnpm -s test`. Expected: PASS incl. any new regression test.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/notes/2026-06-14-error-sweep.md
git commit -m "docs: swallowed-error sweep record (P2-HARD)"
# plus, if fixes were made, a separate fix commit per genuine bug with its regression test
```

### Task C3: Slice-C gate

- [ ] **Step 1: Full gates** — Run: `pnpm -s typecheck && pnpm -s test && pnpm -s depcruise && pnpm -s build:check`. Expected: green (live reaper test skips without a DB URL).

---

## SLICE D — Warehouse load / perf (P2-HARD-2, P2-NFR-3)

### Task D1: `writeMany` on FlatWriter — Postgres multi-row upsert

**Files:**
- Modify: `packages/db/src/flat-writer.ts`
- Modify: `packages/db/src/flat-writer.test.ts`

- [ ] **Step 1: Write the failing test** — append to `packages/db/src/flat-writer.test.ts`. First extend `fakeDb()` so the batch path works (record `values` arg; `values` returns the `onConflict` shape):

```typescript
function fakeDb() {
  const exec = { execute: vi.fn(async () => undefined) };
  const onConflict = (cb: (oc: { column: () => { doUpdateSet: () => typeof exec } }) => unknown) => { cb({ column: () => ({ doUpdateSet: () => exec }) }); return exec; };
  const insertInto = vi.fn(() => ({ values: vi.fn(() => ({ onConflict })) }));
  const mergeInto = vi.fn(() => ({
    using: () => ({ whenMatched: () => ({ thenUpdateSet: () => ({ whenNotMatched: () => ({ thenInsertValues: () => exec }) }) }) }),
  }));
  return { db: { insertInto, mergeInto } as never, insertInto, mergeInto };
}
```

  Then add:

```typescript
describe('createFlatWriter writeMany', () => {
  const a = { resourceType: 'Patient', id: 'p1', gender: 'male' };
  const b = { resourceType: 'Patient', id: 'p2', gender: 'female' };

  it('postgres batches same-table rows into one multi-row insert per table', async () => {
    const { db, insertInto, mergeInto } = fakeDb();
    const w = createFlatWriter(db, 'postgres');
    const res = await w.writeMany([{ resource: a }, { resource: b }]);
    expect(res).toEqual(['written', 'written']);
    expect(insertInto).toHaveBeenCalledTimes(1);
    expect(insertInto).toHaveBeenCalledWith('patients');
    expect(mergeInto).not.toHaveBeenCalled();
  });

  it('skips non-domain resources and reports skipped in order', async () => {
    const { db } = fakeDb();
    const w = createFlatWriter(db, 'postgres');
    const res = await w.writeMany([{ resource: a }, { resource: { resourceType: 'Bundle', id: 'x' } }]);
    expect(res).toEqual(['written', 'skipped']);
  });

  it('mssql batches via mergeInto', async () => {
    const { db, mergeInto, insertInto } = fakeDb();
    const w = createFlatWriter(db, 'mssql');
    const res = await w.writeMany([{ resource: a }, { resource: b }]);
    expect(res).toEqual(['written', 'written']);
    expect(mergeInto).toHaveBeenCalled();
    expect(insertInto).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `pnpm --filter @openldr/db exec vitest run src/flat-writer.test.ts`. Expected: FAIL — `writeMany` undefined.

- [ ] **Step 3: Implement `writeMany`** — extend `packages/db/src/flat-writer.ts`. Add to the interface and module:

```typescript
export interface FlatWriteItem { resource: unknown; provenance?: Provenance; }

export interface FlatWriter {
  write(resource: unknown, provenance?: Provenance): Promise<WriteResult>;
  writeMany(items: FlatWriteItem[]): Promise<WriteResult[]>;
}

// Postgres column-param ceiling is 65535; MSSQL is ~2100 params / 1000 rows. Chunk rows per
// table so a large batch never exceeds the driver limit. cols-per-row is small (<= ~20), so
// these row caps stay well under both ceilings.
const PG_MAX_ROWS = 1000;
const MSSQL_MAX_ROWS = 500;

async function insertBatchPg(db: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
  for (let i = 0; i < rows.length; i += PG_MAX_ROWS) {
    const chunk = rows.slice(i, i + PG_MAX_ROWS);
    const updateCols = Object.keys(chunk[0]).filter((c) => c !== 'id' && c !== 'created_at');
    await db.insertInto(table).values(chunk).onConflict((oc: any) =>
      oc.column('id').doUpdateSet(Object.fromEntries(updateCols.map((c) => [c, (eb: any) => eb.ref(`excluded.${c}`)])))
    ).execute();
  }
}

async function mergeBatchMssql(db: Kysely<any>, table: string, rows: Record<string, unknown>[]): Promise<void> {
  // MERGE source is a multi-row VALUES list; one MERGE per chunk, idempotent on id.
  for (let i = 0; i < rows.length; i += MSSQL_MAX_ROWS) {
    const chunk = rows.slice(i, i + MSSQL_MAX_ROWS);
    const cols = Object.keys(chunk[0]);
    const sourceCols = sql.raw(cols.join(', '));
    const valuesRows = sql.join(chunk.map((r) => sql`(${sql.join(cols.map((c) => sql`${r[c]}`))})`));
    const updateCols = cols.filter((c) => c !== 'id' && c !== 'created_at');
    const set = Object.fromEntries(updateCols.map((c) => [c, sql.ref(`src.${c}`)]));
    const insertValues = Object.fromEntries(cols.map((c) => [c, sql.ref(`src.${c}`)]));
    await db
      .mergeInto(`${table} as tgt`)
      .using(sql`(values ${valuesRows})`.as(sql`src(${sourceCols})`), (j: any) => j.onRef('tgt.id', '=', 'src.id'))
      .whenMatched().thenUpdateSet(set)
      .whenNotMatched().thenInsertValues(insertValues)
      .execute();
  }
}
```

  Then in `createFlatWriter`'s returned object, add `writeMany` (leave `write` unchanged):

```typescript
    async writeMany(items) {
      const results: WriteResult[] = new Array(items.length).fill('skipped');
      // Group flattened rows by target table, remembering each item's original index.
      const byTable = new Map<string, Record<string, unknown>[]>();
      items.forEach((it, idx) => {
        const flat = flattenResource(it.resource, it.provenance ?? {});
        if (!flat) return; // stays 'skipped'
        results[idx] = 'written';
        const list = byTable.get(flat.table) ?? [];
        list.push(flat.row);
        byTable.set(flat.table, list);
      });
      for (const [table, rows] of byTable) {
        if (engine === 'mssql') await mergeBatchMssql(anyDb, table, rows);
        else await insertBatchPg(anyDb, table, rows);
      }
      return results;
    },
```

  Note: the WHONET/HL7/tabular converters emit **distinct ids per resource**, so a single batch never contains two rows with the same id (a multi-row upsert with duplicate ids can error on some engines). If a future converter could emit dup ids in one batch, de-dup by id (keep last) before insert — add only when an actual converter does this.

- [ ] **Step 4: Run to verify pass** — Run: `pnpm --filter @openldr/db exec vitest run src/flat-writer.test.ts`. Expected: PASS (all old + new cases).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/flat-writer.ts packages/db/src/flat-writer.test.ts
git commit -m "feat(db): batched FlatWriter.writeMany (PG multi-row upsert + MSSQL multi-row MERGE, chunked) (P2-HARD-2)"
```

### Task D2: Batched persist path

**Files:**
- Modify: `packages/db/src/persist.ts`
- Modify: `packages/db/src/persist.test.ts`
- Modify: `packages/db/src/index.ts` (export `persistResources`/`FlatWriteItem` if not already via `export *`)

- [ ] **Step 1: Write the failing test** — append to `packages/db/src/persist.test.ts` (mirror the existing fakes for `fhirStore`/`flatWriter`/`logger`):

```typescript
import { persistResources } from './persist';

describe('persistResources (batched)', () => {
  it('saves each canonically then flat-writes the batch in one writeMany', async () => {
    const saved: unknown[] = [];
    const fhirStore = { save: vi.fn(async (r: any) => { saved.push(r); return { id: r.id ?? 'gen' }; }) } as never;
    const writeMany = vi.fn(async (items: unknown[]) => items.map(() => 'written'));
    const flatWriter = { write: vi.fn(), writeMany } as never;
    const logger = { error: vi.fn(), info: vi.fn() } as never;
    const a = { resourceType: 'Patient', id: 'p1', gender: 'male' };
    const b = { resourceType: 'Patient', id: 'p2', gender: 'female' };
    const res = await persistResources({ fhirStore, flatWriter, logger }, [a, b], {});
    expect(fhirStore.save).toHaveBeenCalledTimes(2);
    expect(writeMany).toHaveBeenCalledTimes(1);
    expect(res.every((r) => r.saved && r.flattened === 'written')).toBe(true);
  });

  it('degrades (no throw) when the batch flat-write fails, and redacts the error', async () => {
    const fhirStore = { save: vi.fn(async (r: any) => ({ id: r.id })) } as never;
    const flatWriter = { write: vi.fn(), writeMany: vi.fn(async () => { throw new Error('boom postgres://u:p@h/db'); }) } as never;
    const logger = { error: vi.fn(), info: vi.fn() } as never;
    const a = { resourceType: 'Patient', id: 'p1', gender: 'male' };
    const res = await persistResources({ fhirStore, flatWriter, logger }, [a], {});
    expect(res[0].saved).toBe(true);
    expect(res[0].flattened).toBe('degraded');
    expect(res[0].externalError).not.toContain('p@h'); // redacted
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `pnpm --filter @openldr/db exec vitest run src/persist.test.ts`. Expected: FAIL — `persistResources` undefined.

- [ ] **Step 3: Implement** — append to `packages/db/src/persist.ts`:

```typescript
import type { FlatWriteItem } from './flat-writer';

/**
 * Batched persist: save each resource canonically (must-succeed, DP-7), then flat-write the
 * whole batch with a single writeMany (the throughput win). A batch-level external failure
 * degrades every resource's flat result without throwing — the canonical saves still stand.
 */
export async function persistResources(
  deps: PersistDeps,
  resources: unknown[],
  provenance: Provenance = {},
): Promise<PersistResult[]> {
  const withIds: unknown[] = [];
  for (const resource of resources) {
    const validation = validateResource(resource);
    if (!validation.ok) throw new OpenLdrError('cannot persist invalid FHIR resource');
    const valid = validation.resource;
    const ref = await deps.fhirStore.save(valid, provenance);
    withIds.push({ ...valid, id: ref.id });
  }
  const items: FlatWriteItem[] = withIds.map((withId) => ({ resource: withId, provenance }));
  try {
    const flat = await deps.flatWriter.writeMany(items);
    return withIds.map((_, i) => ({ saved: true, flattened: flat[i] }));
  } catch (err) {
    const externalError = redact(errorMessage(err));
    deps.logger.error({ externalError, count: items.length }, 'batched flatten write degraded');
    return withIds.map(() => ({ saved: true, flattened: 'degraded', externalError }));
  }
}
```

- [ ] **Step 4: Run to verify pass** — Run: `pnpm --filter @openldr/db exec vitest run src/persist.test.ts`. Expected: PASS. Then confirm `persistResources` + `FlatWriteItem` are reachable from `@openldr/db` (check `packages/db/src/index.ts`; if persist/flat-writer aren't re-exported, add the exports).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/persist.ts packages/db/src/persist.test.ts packages/db/src/index.ts
git commit -m "feat(db): persistResources batched path (canonical per-resource + one writeMany, DP-7 degrade) (P2-HARD-2)"
```

### Task D3: Use the batched persist in the ingest path

**Files:**
- Modify: `packages/ingest/src/handle.ts`
- Modify: `packages/ingest/src/handle.test.ts`
- Modify: `packages/bootstrap/src/ingest-context.ts`

- [ ] **Step 1: Write the failing test** — `handle.test.ts` already fakes `persist`. Change the fake to a batched `vi.fn` that receives an array and assert a single call with all resources. Add a case:

```typescript
  it('persists all converted resources in a single batched call', async () => {
    // arrange blob+resolver+batches as the existing test does; converter returns [r1, r2]
    const persist = vi.fn(async (rs: unknown[]) => rs.map(() => ({ saved: true, flattened: 'written' })));
    await handleIngestEvent({ blob, persist, resolver, batches, logger }, event);
    expect(persist).toHaveBeenCalledTimes(1);
    expect((persist.mock.calls[0][0] as unknown[]).length).toBe(2);
  });
```

  (Also update any existing handle test whose `persist` fake had the per-resource signature so it matches the new array shape.)

- [ ] **Step 2: Run to verify failure** — Run: `pnpm --filter @openldr/ingest exec vitest run src/handle.test.ts`. Expected: FAIL (current code calls `persist` per-resource in a loop).

- [ ] **Step 3: Implement** — in `packages/ingest/src/handle.ts`, change the `persist` dep signature and the loop:

```typescript
export interface HandleDeps {
  blob: BlobStoragePort;
  persist: (resources: unknown[], provenance: Provenance) => Promise<PersistResult[]>;
  resolver: ConverterResolver;
  batches: BatchStore;
  logger: Logger;
  audit?: AuditHook;
  onBatchDone?: (info: { batchId: string; source: string; converter: string; count: number }) => Promise<void>;
}
```

  and replace the per-resource loop (lines ~43-46) with a single batched call:

```typescript
    const provenance: Provenance = { sourceSystem: source, pluginId: c.id, pluginVersion: c.version, batchId };
    await deps.persist(resources, provenance);
```

- [ ] **Step 4: Wire bootstrap** — in `packages/bootstrap/src/ingest-context.ts`, change the import block from `@openldr/db` to bring in `persistResources` (alongside or replacing `persistResource`), and change the `persist` binding (line ~68):

```typescript
  const persist = (resources: unknown[], provenance: Provenance) => persistResources({ fhirStore, flatWriter, logger }, resources, provenance);
```

- [ ] **Step 5: Run** — Run: `pnpm --filter @openldr/ingest exec vitest run && pnpm --filter @openldr/bootstrap exec tsc --noEmit`. Expected: PASS / no type errors. Grep `persistResource(` for any other caller of the old single-resource `persist` shape (e.g. createAppContext) — if `persistResource` is now unused anywhere, leave it exported (it is still a valid single-resource API) but ensure no caller passes the wrong shape.

- [ ] **Step 6: Commit**

```bash
git add packages/ingest/src/handle.ts packages/ingest/src/handle.test.ts packages/bootstrap/src/ingest-context.ts
git commit -m "feat(ingest): ingest persists the batch via persistResources (one flat round-trip set) (P2-HARD-2)"
```

### Task D4: Parameterise `make-whonet-sample.mjs` with `--rows N`

**Files:**
- Modify: `scripts/make-whonet-sample.mjs`

- [ ] **Step 1: Implement** — rewrite `scripts/make-whonet-sample.mjs` to accept `--rows N` (default 2 keeps current behaviour):

```javascript
// Generates a synthetic WHONET SQLite sample using Node's built-in node:sqlite.
// Usage: node scripts/make-whonet-sample.mjs [--rows N]   (default N=2). Node >= 22.5.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const rowsArg = process.argv.indexOf('--rows');
const ROWS = rowsArg >= 0 ? Math.max(1, parseInt(process.argv[rowsArg + 1], 10) || 2) : 2;

const dir = join(process.cwd(), 'samples');
mkdirSync(dir, { recursive: true });
const path = join(dir, 'whonet-sample.sqlite');

const db = new DatabaseSync(path);
db.exec(`
  DROP TABLE IF EXISTS isolates;
  CREATE TABLE isolates (
    patient_id TEXT, sex TEXT, birth_date TEXT,
    spec_num TEXT, spec_type TEXT, spec_date TEXT,
    organism TEXT, organism_code TEXT, location_type TEXT,
    ab_AMP TEXT, ab_CIP TEXT, ab_GEN TEXT
  );
`);
const insert = db.prepare('INSERT INTO isolates VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');

// Deterministic generator (no Math.random) so runs are reproducible.
const SEX = ['F', 'M'];
const SPEC = ['BLOOD', 'URINE', 'WOUND', 'CSF'];
const ORG = [['Escherichia coli', 'eco'], ['Klebsiella pneumoniae', 'kpn'], ['Staphylococcus aureus', 'sau'], ['Pseudomonas aeruginosa', 'pae']];
const LOC = ['i', 'o'];
const SIR = ['R', 'I', 'S'];
const pad = (n) => String(n).padStart(4, '0');
const day = (n) => String((n % 27) + 1).padStart(2, '0');
const mon = (n) => String((n % 12) + 1).padStart(2, '0');
for (let i = 0; i < ROWS; i++) {
  const [org, code] = ORG[i % ORG.length];
  insert.run(
    `P${pad(i + 1)}`, SEX[i % 2], `19${70 + (i % 30)}-${mon(i)}-${day(i)}`,
    `S${pad(i + 1)}`, SPEC[i % SPEC.length], `2026-01-${day(i)}`,
    org, code, LOC[i % 2],
    SIR[i % 3], SIR[(i + 1) % 3], SIR[(i + 2) % 3],
  );
}
db.close();
process.stdout.write(`wrote ${path} (${ROWS} rows)\n`);
```

- [ ] **Step 2: Verify** — Run: `node scripts/make-whonet-sample.mjs` → "wrote … (2 rows)". Run: `node scripts/make-whonet-sample.mjs --rows 500` → "wrote … (500 rows)". (No unit test — dev script; the load script exercises it.)

- [ ] **Step 3: Commit**

```bash
git add scripts/make-whonet-sample.mjs
git commit -m "feat(scripts): make-whonet-sample --rows N for volume datasets (P2-HARD-2)"
```

### Task D5: Load-measurement script

**Files:**
- Create: `scripts/load-measure.mjs`
- Modify: root `package.json` (add `load:measure` script)

- [ ] **Step 1: Implement** — create `scripts/load-measure.mjs` (generates an N-row sample then times an ingest via the built CLI, reporting rows/s; shells to the CLI so it measures the real persist path end-to-end):

```javascript
// Measure ingest throughput: generate an N-row WHONET sample, ingest it through the built CLI,
// report wall-clock + rows/s. Honest caveat: synthetic local volume, not a production load test.
// Usage: node scripts/load-measure.mjs [--rows N]
// Requires: built plugin (pnpm build:plugins), a migrated DB, plugin installed, and env set
// (TARGET_STORE_ADAPTER + creds) exactly as a normal ingest. Engine is whatever the env selects.
import { execFileSync } from 'node:child_process';

const rowsArg = process.argv.indexOf('--rows');
const ROWS = rowsArg >= 0 ? parseInt(process.argv[rowsArg + 1], 10) || 100 : 100;

execFileSync(process.execPath, ['scripts/make-whonet-sample.mjs', '--rows', String(ROWS)], { stdio: 'inherit' });

const t0 = process.hrtime.bigint();
execFileSync(process.execPath, ['packages/cli/dist/index.js', 'ingest', 'samples/whonet-sample.sqlite', '--plugin', 'whonet-sqlite'], { stdio: 'inherit' });
const t1 = process.hrtime.bigint();

const ms = Number(t1 - t0) / 1e6;
// WHONET emits ~6 FHIR resources per isolate (patient, specimen, organism obs, 3 AST obs).
const approxResources = ROWS * 6;
process.stdout.write(`\nINGEST ${ROWS} isolates (~${approxResources} resources) in ${ms.toFixed(0)}ms = ${(approxResources / (ms / 1000)).toFixed(1)} resources/s\n`);
```

  Add to root `package.json` scripts: `"load:measure": "node scripts/load-measure.mjs"`.

- [ ] **Step 2: Smoke** — with a live stack (built CLI via `pnpm --filter @openldr/cli build`, DB migrated, plugin installed), Run: `pnpm load:measure -- --rows 50`. Expected: prints a resources/s line. (Controller does the real PG+MSSQL baseline-vs-batched runs below.)

- [ ] **Step 3: Commit**

```bash
git add scripts/load-measure.mjs package.json
git commit -m "feat(scripts): load:measure ingest-throughput harness (P2-HARD-2, P2-NFR-3)"
```

### Task D6: Slice-D gate + live multi-driver acceptance (controller)

> Controller (not a subagent) runs this — it needs the Docker stack and is the P2-NFR-3 evidence.

- [ ] **Step 1: TS gates** — Run: `pnpm -s typecheck && pnpm -s test && pnpm -s depcruise && pnpm -s build:check`. Expected: green.

- [ ] **Step 2: Postgres acceptance** — `docker compose up -d`; `pnpm openldr db migrate`; `pnpm build:plugins`; install the WHONET plugin; ingest a 500-row sample; verify flat-table row counts are correct and a **re-ingest is idempotent** (counts don't double). Record batched rows/s from `pnpm load:measure -- --rows 500`. Capture a baseline number by measuring the per-resource path (stash the D3 change or temporarily restore the loop) on the same data.

- [ ] **Step 3: SQL Server acceptance (P2-NFR-3)** — `docker compose --profile mssql up -d` (openldr mssql on 11433; sibling `sqlserver` holds 1433); create the `openldr` DB via sqlcmd (`/opt/mssql-tools18/bin/sqlcmd -C`, pw `Openldr_Local_2026!`); set `TARGET_STORE_ADAPTER=mssql` + `MSSQL_*` (`MSSQL_PORT=11433`); migrate; ingest the 500-row sample; verify identical flat-table contents to Postgres and idempotent re-ingest; record batched rows/s.

- [ ] **Step 4: Record the numbers** — create `docs/superpowers/notes/2026-06-14-load-results.md` with a results table (baseline vs batched, PG + MSSQL, rows/s) and the honest caveat (synthetic local volume, not production-scale).

---

## Finish (controller)

- [ ] **Step 1: Final full gates on the branch** — `pnpm -s typecheck && pnpm -s test && pnpm -s depcruise && pnpm -s build:check` + `cargo test` in `wasm/`. All green.
- [ ] **Step 2:** Use `superpowers:finishing-a-development-branch` — verify tests, strip any harness-injected `Co-Authored-By` (`FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f --msg-filter "sed '/^Co-Authored-By:/Id'" main..HEAD`), merge `--no-ff` to `main` (`merge: hardening — secrets/sandbox/reliability/load (Phase-2 §7 step 7, P2-HARD)`), re-run full gates on `main`, delete the branch.
- [ ] **Step 3:** Add a "Phase-2 sub-project — Hardening (P2-HARD)" entry to `openldr-ce-build-plan.md` (carry-forwards: WASM memory/hard-timeout still unenforced; MSSQL true bulk-copy still deferred; load numbers are synthetic-local) and update the `MEMORY.md` index line to record Phase-2 §7 hardening complete.

---

## Self-Review (spec coverage)

- **P2-HARD-3 secrets:** A1 (redact patterns + makeRedactor), A2 (pino redact), A3 (CLI boundaries) — ✓ all three spec deliverables.
- **P2-HARD-1 sandbox:** B1 (posture doc incl. the gap), B2+B3 (HL7 + tabular fuzz) — ✓.
- **Reliability:** C1 (live reaper test; unit tests already exist — noted), C2 (sweep + record) — ✓.
- **P2-HARD-2 / P2-NFR-3 load:** D1+D2+D3 (batched writer + persist + ingest wiring), D4 (`--rows N`), D5 (load:measure), D6 (PG+MSSQL numbers) — ✓.
- **Conventions:** GateGuard facts, no Co-Authored-By, suffix `(P2-HARD[-N])`, gates, DP-1, finishing-a-development-branch, memory update — ✓.
- **Type consistency:** `writeMany`/`FlatWriteItem`/`persistResources`/`redactError`/`makeRedactor`/`redactPaths` names are used identically across all tasks that reference them.
