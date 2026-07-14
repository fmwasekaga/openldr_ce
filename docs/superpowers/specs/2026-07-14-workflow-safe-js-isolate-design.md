# Workflow Safe JS Isolate (QuickJS-WASM) — Design

**Date:** 2026-07-14
**Slice:** SEC-01 — replace Node `vm` with a real isolate for workflow condition expressions AND Code nodes
**Branch:** `feat/workflow-js-isolate` (to cut)
**Origin:** the SP-A2 marketplace security audit follow-up (`docs/audit/2026-06-25-phase4-security-audit.md`, SEC-01) + the 2026-07-14 marketplace state audit, which found Node `vm` is the only mechanism behind `if`/`filter`/`switch` (always-on, ungated) and the Code node (gated OFF by `WORKFLOW_CODE_ENABLED`).

## Context & the hole this closes

Workflow condition nodes evaluate user-authored JavaScript through Node's `vm`:
- `if`/`filter`/`switch` handlers call `vm.runInNewContext(resolved, sandbox, { timeout: 1000 })` (`packages/workflows/src/engine/node-handlers/{if,filter,switch}.ts`). These are **always-on core branching** — not gated.
- The Code node runs arbitrary JS via `vm.runInNewContext` inside a `worker_thread` (`packages/workflows/src/engine/sandbox.ts`), gated OFF by default behind `WORKFLOW_CODE_ENABLED`.

Node's `vm` is **not a security boundary**: `this.constructor.constructor('return process')()` reaches the real `process`, and a `worker_thread` shares the host filesystem/network/env. So a condition expression like `this.constructor.constructor('return process')().mainModule.require('fs')…` — evaluated on **every workflow run with a condition node** — is a live host-escape/RCE vector today. The Code node has the same escape but is at least gated off.

**Decision (brainstormed):** build ONE real JavaScript isolate and route BOTH condition expressions and Code nodes through it. Chosen because "make full JS safe" for conditions is only truly achievable with a real isolate, and a single sandboxing mechanism is cleaner than two. **Technology: QuickJS compiled to WASM via `quickjs-emscripten`** — real isolation (WASM linear memory; zero host fs/net/env unless explicitly bound), hard memory + CPU-time limits, and **pure-WASM (no native addon)**, which fits the repo's existing WASM sandboxing posture (`@extism/extism` runs plugins) and avoids the native-build friction this repo already hits on Windows (the CLI's native esbuild dep fails there).

**Substrate facts (verify during implementation):**
- `packages/workflows/src/engine/node-handlers/if.ts` — `resolveTemplate(condition, ctx, input)` → `vm.runInNewContext(resolved, { $input, $json, $items, input }, { timeout: 1000 })` → boolean → `ctx.branches[node.id]`. `filter.ts` (per-item boolean over the same sandbox) and `switch.ts` (per-rule condition) mirror it.
- `packages/workflows/src/engine/sandbox.ts` — `runInSandbox({ input, nodeOutputs, limits: {timeoutMs, memoryMb}, onLog })` builds a vm sandbox in a worker_thread and evaluates the wrapped Code-node script; `node-handlers/code.ts` enforces `ctx.codeLimits.enabled` (`WORKFLOW_CODE_ENABLED`) BEFORE calling it and logs the host-level-privileges warning. `sandbox.test.ts` has an "escape documentation" test that asserts the escape WORKS on purpose.
- Real condition expressions in the suite: `$json.status === 200`, `$json.status >= 400`, `$json.triggered === false`, `true`/`false` (member access + comparison + equality). `switch.test.ts` expects a malformed condition (`this is not js (`) to error gracefully.
- `codeLimits` on the engine ctx = `{ timeoutMs, memoryMb, enabled }` (from `cfg.WORKFLOW_CODE_{TIMEOUT_MS,MEMORY_MB,ENABLED}`).

## Scope (decided)

**In:** one QuickJS-WASM isolate module serving (a) `if`/`filter`/`switch` expression evaluation and (b) Code-node script execution; replacement of all `vm.runInNewContext` usage in the workflow engine; JSON data boundary; memory + wall-time limits; inverted escape tests proving the boundary holds.

**Out (separate / later):** SEC-06 webhook-secret encryption (its own sub-project); warm-context POOLING (perf optimization — fresh context per eval in v1); giving Code nodes any host I/O back (they become pure compute — see §5); migrating the marketplace WASM-plugin runtime (Extism, unrelated); async/host-callback APIs inside the isolate beyond `log()`.

## Design

### 1. The isolate module (`packages/workflows/src/engine/js-isolate.ts`)
Wraps `quickjs-emscripten`. The WASM module is loaded ONCE via a lazy singleton (`getQuickJS()` — tens of ms, amortized). Each evaluation creates a FRESH `QuickJSRuntime` + `QuickJSContext`, evaluates, and disposes both in a `finally` (QuickJS handles must be explicitly disposed — use the arena/`Scope` helper `quickjs-emscripten` provides to avoid leaks). Fresh-context-per-eval guarantees no state bleeds between evaluations. Exports:
```ts
export interface JsLimits { timeoutMs: number; memoryMb: number }
// Evaluate a boolean/value expression with `scope` vars injected. Used by if/filter/switch.
export async function evalExpression(source: string, scope: Record<string, unknown>, limits: JsLimits): Promise<unknown>;
// Run a Code-node script over items; the ONLY host binding is `log`. Returns the produced items.
export async function runScript(source: string, opts: {
  input: WorkflowItem[]; nodeOutputs: Record<string, WorkflowItem[]>; limits: JsLimits;
  onLog: (level: LogLevel, message: string) => void;
}): Promise<WorkflowItem[]>;
```
The context is created with **no host bindings** (no `require`, no `process`, no `globalThis.process`, no fs/net) except: `runScript` binds a single `log(level, message)` host function that calls `onLog`. `evalExpression` binds nothing.

### 2. Data marshaling — JSON boundary
Only DATA crosses the boundary, via JSON, never functions or references:
- **In:** on the host, `JSON.stringify` each scope var; inside the context, define it by `JSON.parse`-ing the string into a QuickJS value (or build the value with the context's `newString`/`newNumber`/object builders — but the JSON-parse-inside approach is simplest and avoids manual handle trees). For `evalExpression`: inject `$input`, `$json`, `$items`, `input`. For `runScript`: inject `input`, `nodeOutputs`.
- **Out:** the expression/script result is `JSON.stringify`-ed inside the context and returned as a host string, then `JSON.parse`-ed on the host. `evalExpression` returns the parsed value (callers coerce to boolean). `runScript` expects an items array (validate the shape; a non-array/invalid result → a clear error). Values that don't survive JSON (functions, undefined, circular) are dropped/error exactly as they would be over any serialization boundary — documented.

### 3. Resource limits
- Memory: `runtime.setMemoryLimit(limits.memoryMb * 1024 * 1024)`.
- CPU/wall time: `runtime.setInterruptHandler(() => Date.now() - start > limits.timeoutMs)` so a runaway loop (`while(true){}`) is interrupted (throws), not hung — set `start` immediately before eval. (Also set a stack-size limit via `runtime.setMaxStackSize` if `quickjs-emscripten` exposes it.)
- Conditions call with a small fixed budget (`{ timeoutMs: 1000, memoryMb: <small default, e.g. 16> }`, matching today's 1000 ms); Code nodes pass `ctx.codeLimits.{timeoutMs, memoryMb}`.
- A memory-limit or interrupt or eval error surfaces as a thrown `Error` with a clear message (`Condition failed: …` / `Code node failed: …`), mapping to the same error behavior the handlers have today.

### 4. Wiring — remove `vm`
- `if.ts`/`filter.ts`/`switch.ts`: replace `vm.runInNewContext(resolved, sandbox, { timeout: 1000 })` with `await evalExpression(resolved, sandbox, { timeoutMs: 1000, memoryMb: 16 })` (coerce result to boolean). `resolveTemplate` pre-pass unchanged. Remove the `import vm from 'node:vm'`. These handlers become async-awaiting the isolate (they are already async).
- `sandbox.ts` / `code.ts`: replace the `worker_thread` + `vm` machinery with `runScript`. `code.ts` KEEPS the `WORKFLOW_CODE_ENABLED` gate as defense-in-depth, but the warning text changes from "HOST-LEVEL privileges … vm is not a security sandbox" to "runs in a sandboxed QuickJS isolate (no host filesystem/network/env access)". The `sandbox.ts` module either becomes a thin adapter over `js-isolate.ts` or is deleted in favor of it (decide during implementation; prefer deleting the worker_thread path entirely).

### 5. Deliberate consequence — Code nodes become pure compute
The current Code node can perform arbitrary host I/O (the vulnerability). Inside QuickJS it can only compute over its injected inputs — **no fs, network, env, or `require`**. Any existing Code node that performed I/O will break; the migration is to use dedicated nodes (HTTP source, Database, read/write-file, Send Email) for I/O and reserve the Code node for pure transforms. This is the intended security outcome, documented in the node's help + the `code.ts` warning. (Code nodes are OFF by default and "trusted single-tenant only," so live blast radius is minimal.)

### 6. Testing
- **Invert the escape test** (`sandbox.test.ts` + a new `js-isolate.test.ts`): assert the boundary HOLDS for both entry points — `this.constructor.constructor('return process')()` throws or yields no usable `process`; `require`, `process`, `globalThis.process`, `globalThis.constructor.constructor` give no host reach; no fs/net module is obtainable. (Delete/replace the old "escape works" assertion.)
- **Behavior preserved:** existing conditions evaluate identically (`$json.status === 200` etc.); nested member access, logical/comparison/arithmetic/ternary, template literals, array/string methods (`.includes`, `.length`) all work; a malformed expression errors gracefully.
- **Limits:** an infinite-loop condition interrupts within the budget (test asserts it throws, does not hang the suite); a large-allocation script hits the memory limit.
- **Marshaling round-trip:** numbers, strings, nested objects, arrays, null, booleans survive in and out; the Code-node items-array contract is validated.
- **Engine regression:** `run-workflow.test.ts` + the node-handler tests stay green (update the `throw new Error(...)` condition test if it relied on `vm`-specific throw semantics — a thrown error in a condition still surfaces as a failed condition).

## Deliberate shortcuts / deferrals

- Fresh QuickJS context per eval (no pooling) — correctness/simplicity first; pool warm contexts later if condition-heavy workflows show latency (S7-style perf follow-up).
- JSON-only data boundary — values that don't survive JSON serialization are not supported inside the isolate (documented); this matches how any process/isolate boundary behaves.
- Code nodes lose host I/O (pure compute) — intended; migration is dedicated I/O nodes.
- `log()` is the only host binding; no async host callbacks (fetch/db) inside the isolate this slice.
- SEC-06 (webhook-secret encryption) and the Code-node-async story are out of scope.

## Testing / build order (plan will detail)

1. Add `quickjs-emscripten`; build `js-isolate.ts` (`evalExpression`/`runScript`) + its unit tests (escape-blocked, limits, marshaling).
2. Cut `if`/`filter`/`switch` over to `evalExpression`; remove their `vm` import; keep their tests green (+ add escape-blocked condition tests).
3. Cut the Code node (`sandbox.ts`/`code.ts`) over to `runScript`; remove the worker_thread+vm path; invert the escape test; update the warning; note the pure-compute change in the node help.
4. Gate (workflows typecheck+test + any consumer) + a live workflow smoke exercising a condition + a Code node + an escape attempt + whole-slice review + merge (+ push on user go).

## Relates to

[[workflow-builder-workstream]] / [[workflow-node-palette]] (the engine + condition/code nodes), [[dhis2-sink-plugin-workstream]] / the Extism WASM runtime (the existing WASM-sandbox posture this aligns with), the SP-A2 security audit (SEC-01 origin), [[marketplace-extensibility-vnext]] (the audit's home). SEC-06 (webhook-secret encryption) and the two other hardening items are separate sub-projects.
