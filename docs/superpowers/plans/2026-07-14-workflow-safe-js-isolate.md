# Workflow Safe JS Isolate (QuickJS-WASM) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Node `vm` (not a security boundary) with a real QuickJS-WASM isolate for BOTH workflow condition expressions (`if`/`filter`/`switch`, always-on) and Code nodes — so user-authored JS can no longer reach the host (`this.constructor.constructor('return process')()` etc.), with hard memory + wall-time limits.

**Architecture:** One module `packages/workflows/src/engine/js-isolate.ts` wrapping `quickjs-emscripten` (pure-WASM, no native build). `evalExpression(source, scope, limits)` for conditions; `runScript(source, opts)` for Code nodes. Data crosses the boundary as JSON only; the sole host binding is a `log` function for Code nodes. The WASM module loads once (lazy singleton); each eval uses a fresh disposed-after context.

**Tech Stack:** TypeScript, `quickjs-emscripten`, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-14-workflow-safe-js-isolate-design.md`

**Key substrate to read first (all exist):**
- `packages/workflows/src/engine/node-handlers/if.ts` — `resolveTemplate(condition, ctx, input)` → `vm.runInNewContext(resolved, { $input, $json, $items, input }, { timeout: 1000 })` → boolean → `ctx.branches[node.id]`. `filter.ts` (per-item, sandbox `{ $input:[item], $json:item.json, $items:[item.json], input:[item] }`) + `switch.ts` (per-rule).
- `packages/workflows/src/engine/sandbox.ts` — `BOOTSTRAP_JS` (worker_thread + `vm.runInNewContext` on `(async()=>{<code>})()`, sandbox `{ $input, $json, $items, input, $node(id), console }`), `runInSandbox(code, { input, nodeOutputs, limits:{timeoutMs,memoryMb}, onLog })`. `node-handlers/code.ts` — gate `ctx.codeLimits.enabled`, the host-privileges warning, `runInSandbox` → `toItems(result)`.
- `packages/workflows/src/engine/items.ts` — `WorkflowItem` (`{ json: unknown, ... }`) + `toItems(result)` (normalizes a script return to `WorkflowItem[]`).
- `packages/workflows/src/types.ts` — `LogLevel`.
- `packages/workflows/src/engine/sandbox.test.ts` — the "escape documentation" test (asserts the escape WORKS — to be INVERTED).
- `run-workflow.test.ts` + `node-handlers/{if,filter,switch}.test.ts` — the regression suite.
- `quickjs-emscripten` docs — `getQuickJS()` (module singleton), `QuickJSContext` (`evalCode`, `newString`/`newNumber`/`newObject`/`newFunction`, `getString`/`dump`, `setProp`, `unwrapResult`, `resolvePromise`, `runtime.executePendingJobs`), `QuickJSRuntime` (`setMemoryLimit`, `setInterruptHandler`, `setMaxStackSize`), and the `Scope`/arena helpers for handle disposal. **Verify the exact API against the installed version — quickjs-emscripten's surface has shifted across majors; match what `node_modules/quickjs-emscripten` actually exports.**

**Global rules:** `pnpm --filter`/`pnpm exec`, never raw `node_modules/.bin`. NEVER a `Co-Authored-By` trailer. Windows: run per-package `tsc --noEmit`/`vitest run` directly (turbo `--force` flakes on the install-race; never pipe turbo through `tail`). `quickjs-emscripten` is pure-WASM — no native build, but confirm it bundles/loads under the repo's ESM + vitest setup.

---

## Task 0: Cut the branch
- [ ] `git checkout main && git checkout -b feat/workflow-js-isolate && git branch --show-current` → `feat/workflow-js-isolate`, clean tree.

---

## Task 1: Isolate module — `evalExpression` (+ dependency)

**Files:** Modify `packages/workflows/package.json` (add `quickjs-emscripten`); Create `packages/workflows/src/engine/js-isolate.ts` + `packages/workflows/src/engine/js-isolate.test.ts`.

- [ ] **Step 1: add the dependency.** `cd packages/workflows` then add `"quickjs-emscripten": "^0.31.0"` (or the current stable — check `npm view quickjs-emscripten version`; pin the resolved major) to `dependencies`, and `pnpm install` at the repo root. Confirm it imports under ESM: a throwaway `pnpm --filter @openldr/workflows exec tsx -e "import { getQuickJS } from 'quickjs-emscripten'; getQuickJS().then(q => console.log('ok', !!q))"` prints `ok true`. If it fails to load under the repo's setup, STOP and report (the WASM asset may need a vitest/tsx loader tweak).

- [ ] **Step 2: `js-isolate.ts` — module singleton + `evalExpression`.**
```ts
import { getQuickJS, Scope, type QuickJSWASMModule } from 'quickjs-emscripten';

export interface JsLimits { timeoutMs: number; memoryMb: number }

let modPromise: Promise<QuickJSWASMModule> | null = null;
function quickjs(): Promise<QuickJSWASMModule> { return (modPromise ??= getQuickJS()); }

/** Evaluate a JS expression `source` with `scope` variables injected as JSON data, under memory +
 *  wall-time limits, in a fresh disposed-after QuickJS context with NO host bindings. Returns the
 *  JSON-round-tripped result value. Throws on syntax/runtime error, timeout, or memory limit. */
export async function evalExpression(source: string, scope: Record<string, unknown>, limits: JsLimits): Promise<unknown> {
  const QuickJS = await quickjs();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(limits.memoryMb * 1024 * 1024);
  const start = Date.now();
  runtime.setInterruptHandler(() => Date.now() - start > limits.timeoutMs);
  try {
    return Scope.withScope((scopeArena) => {
      const ctx = scopeArena.manage(runtime.newContext());
      // Inject each scope var by parsing its JSON inside the context (data only — no functions cross).
      for (const [k, v] of Object.entries(scope)) {
        const json = JSON.stringify(v === undefined ? null : v);
        const handle = scopeArena.manage(ctx.evalCode(`(${json})`));  // parse literal → value handle
        // If evalCode returns a result wrapper, unwrap it; on error throw. (Match the installed API —
        // ctx.unwrapResult(handle) or handle.value; large JSON via a global var is fine too.)
        ctx.setProp(ctx.global, k, scopeArena.manage(ctx.unwrapResult(handle)));
      }
      // Evaluate the expression, JSON-stringify the result INSIDE the context, read it out as a string.
      const wrapped = `JSON.stringify((${source}))`;
      const res = ctx.evalCode(wrapped);
      const out = ctx.unwrapResult(res);            // throws a QuickJS error → catch/rethrow below
      const str = ctx.getString(scopeArena.manage(out));
      return str === undefined ? undefined : JSON.parse(str);
    });
  } catch (err) {
    throw normalizeIsolateError(err);
  } finally {
    runtime.dispose();
  }
}

function normalizeIsolateError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  return new Error(msg);
}
```
IMPORTANT: the exact handle/dispose/unwrap API (`Scope.withScope`, `evalCode` result shape, `unwrapResult`, `getString`, `setProp`) MUST match the INSTALLED `quickjs-emscripten` version — READ its types in `node_modules/quickjs-emscripten` first and adjust (e.g. some versions return `{ value }`/`{ error }` from `evalCode` requiring `ctx.unwrapResult`, and require `ctx.dump(handle)` to marshal a value out instead of `JSON.stringify`-inside — `ctx.dump` is an acceptable alternative to the JSON-string-out approach and may be simpler; pick whichever the version supports and use it consistently). The invariants that MUST hold regardless: (1) NO host functions bound; (2) memory + interrupt limits set on the runtime BEFORE eval; (3) every handle disposed (use the arena/Scope); (4) a QuickJS error/timeout/memory-limit becomes a thrown host `Error`.

- [ ] **Step 3: tests (`js-isolate.test.ts`)** — the SECURITY tests are the point:
  - **Escape blocked:** `evalExpression("this.constructor.constructor('return process')()", {}, L)` → the result is NOT a usable host `process` (assert it throws OR returns null/undefined/no `.env`); `evalExpression("typeof process", {}, L)` → `'undefined'`; `evalExpression("typeof require", {}, L)` → `'undefined'`; `evalExpression("typeof globalThis.process", {}, L)` → `'undefined'`. (There is no `require`/`process`/fs reachable.)
  - **Real conditions:** `evalExpression("$json.status === 200", { $json: { status: 200 } }, L)` → `true`; `=== 200` with `{status:500}` → `false`; `$json.status >= 400` etc.; nested `$json.a.b.c`; logical `$json.a && $json.b`; ternary; a string method `$json.s.includes('x')`; `$items.length > 0`.
  - **Limits:** `evalExpression("while(true){}", {}, { timeoutMs: 200, memoryMb: 32 })` → throws (does NOT hang — give the test its own generous vitest timeout and assert rejection within a couple seconds); a big-allocation expression → throws on the memory limit.
  - **Marshaling round-trip:** numbers, strings, nested objects, arrays, null, booleans inject + a computed object result reads back via the JSON/dump path.
  - **Malformed:** `evalExpression("this is not js (", {}, L)` → throws a clear Error.
  - `L = { timeoutMs: 1000, memoryMb: 16 }`.

- [ ] **Step 4:** `pnpm --filter @openldr/workflows exec tsc --noEmit && pnpm --filter @openldr/workflows exec vitest run src/engine/js-isolate.test.ts`. Commit `feat(workflows): QuickJS-WASM safe expression isolate (evalExpression) (SEC-01)`.

**Gotcha:** `quickjs-emscripten` loads a WASM asset — the first `getQuickJS()` is slow (tens of ms); the singleton amortizes it. If vitest can't resolve the WASM under the repo's config, you may need the `@jitl/quickjs-wasmfile-release-sync` variant or the async/sync module choice — READ the package README for the "which variant" guidance and pick the sync-friendly release build (evalExpression is synchronous inside; the outer fn is async only for the module load).

---

## Task 2: Cut `if`/`filter`/`switch` over to `evalExpression`

**Files:** Modify `packages/workflows/src/engine/node-handlers/if.ts`, `filter.ts`, `switch.ts`; extend their tests.

- [ ] **Step 1: `if.ts`** — replace the vm block:
```ts
// remove: import vm from 'node:vm';
import { evalExpression } from '../js-isolate';
const COND_LIMITS = { timeoutMs: 1000, memoryMb: 16 };
// …inside the handler, replacing the try/vm block:
      const scope = { $input: input, $json: input[0]?.json, $items: input.map((i) => i.json), input };
      branch = (await evalExpression(resolved, scope, COND_LIMITS)) ? 'true' : 'false';
```
Keep the `try/catch` → `throw new Error('Condition failed: …')`. The handler is already `async`.

- [ ] **Step 2: `filter.ts`** — the per-item `passes` becomes async; use a sequential loop or `for…of` (NOT `input.filter` with an async predicate — that doesn't await). E.g.:
```ts
import { evalExpression } from '../js-isolate';
const COND_LIMITS = { timeoutMs: 1000, memoryMb: 16 };
// …
  const kept: WorkflowItem[] = [];
  for (const item of input) {
    const resolved = resolveTemplate(raw, ctx, [item]);
    if (!resolved.trim()) continue;
    try {
      const scope = { $input: [item], $json: item.json, $items: [item.json], input: [item] };
      if (await evalExpression(resolved, scope, COND_LIMITS)) kept.push(item);
    } catch (err) {
      throw new Error(`Filter condition failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  ctx.branches[node.id] = kept.length > 0 ? 'true' : 'false';
  return kept;
```
Remove `import vm`.

- [ ] **Step 3: `switch.ts`** — replace the vm call with `if (await evalExpression(resolved, scope, COND_LIMITS)) { branch = rule.name; break; }` (scope as today: `{ $input: input, $json: input[0]?.json, $items: input.map((i) => i.json), input }`); remove `import vm`; keep the `Switch rule "…" failed` catch.

- [ ] **Step 4: tests** — the existing `{if,filter,switch}.test.ts` must stay green (they're already async-awaiting the handlers). ADD an escape-blocked condition test to each (or one shared): a condition `this.constructor.constructor('return process')().mainModule` → the handler does NOT reach the host (either throws `… failed` or evaluates falsy with no host access) — assert the workflow doesn't gain `process`. Update the `run-workflow.test.ts` `condition: 'throw new Error("boom")'` case if needed: a `throw` inside an expression `(throw …)` is a syntax error in expression position — if that test relied on statement-throw semantics, change the fixture to an expression that fails (e.g. `$json.x.y.z` on undefined, or keep `throw` but expect the "Condition failed" wrap). Confirm the intent (a failing condition surfaces as an error) still holds.
- [ ] **Step 5:** `pnpm --filter @openldr/workflows exec tsc --noEmit && pnpm --filter @openldr/workflows exec vitest run src/engine/node-handlers` + `vitest run src/engine/run-workflow.test.ts`. Commit `feat(workflows): route if/filter/switch through the QuickJS isolate (SEC-01)`.

**Gotcha:** `filter.ts` currently uses `input.filter(passes)` with a SYNC predicate; `evalExpression` is async, so you MUST switch to an awaited loop or the filter silently keeps everything (truthy Promises). This is the single easiest correctness bug in this task — the test that "returns only items that pass" guards it.

---

## Task 3: Isolate module — `runScript` (Code node)

**Files:** Modify `packages/workflows/src/engine/js-isolate.ts` (add `runScript`); extend `js-isolate.test.ts`.

- [ ] **Step 1: `runScript`** — like `evalExpression` but: (a) injects `input` + `nodeOutputs` as JSON data + defines `$input`/`$json`/`$items`/`$node`/`console` as JS helpers in-context; (b) binds ONE host function `__log`; (c) wraps the user code in an async IIFE and resolves the returned promise; (d) returns the produced items array.
```ts
import type { WorkflowItem } from './items';
import type { LogLevel } from '../types';

export async function runScript(source: string, opts: {
  input: WorkflowItem[]; nodeOutputs: Record<string, WorkflowItem[]>; limits: JsLimits;
  onLog: (level: LogLevel, message: string) => void;
}): Promise<WorkflowItem[]> {
  const QuickJS = await quickjs();
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(opts.limits.memoryMb * 1024 * 1024);
  const start = Date.now();
  runtime.setInterruptHandler(() => Date.now() - start > opts.limits.timeoutMs);
  try {
    return await Scope.withScopeAsync(async (arena) => {
      const ctx = arena.manage(runtime.newContext());
      // 1) inject data: input, nodeOutputs (JSON literals on global)
      for (const [k, v] of [['input', opts.input], ['nodeOutputs', opts.nodeOutputs]] as const) {
        const h = arena.manage(ctx.unwrapResult(ctx.evalCode(`(${JSON.stringify(v)})`)));
        ctx.setProp(ctx.global, k, h);
      }
      // 2) bind the single host function __log(levelStr, msgStr)
      const logFn = arena.manage(ctx.newFunction('__log', (lvl, msg) => {
        opts.onLog((ctx.getString(lvl) as LogLevel) || 'log', ctx.getString(msg));
      }));
      ctx.setProp(ctx.global, '__log', logFn);
      // 3) define the sandbox helpers + wrap the user code, run, JSON.stringify the awaited result
      const prelude = `
        const $input = input; const $json = (input && input[0]) ? input[0].json : undefined;
        const $items = Array.isArray(input) ? input.map(i => i && i.json) : [];
        const $node = (id) => (nodeOutputs && Object.prototype.hasOwnProperty.call(nodeOutputs, id)) ? nodeOutputs[id] : undefined;
        const __str = (a) => a.map(x => typeof x === 'string' ? x : (()=>{try{return JSON.stringify(x)}catch{return String(x)}})()).join(' ');
        const console = { log:(...a)=>__log('log',__str(a)), info:(...a)=>__log('info',__str(a)), warn:(...a)=>__log('warn',__str(a)), error:(...a)=>__log('error',__str(a)), debug:(...a)=>__log('log',__str(a)) };
      `;
      const wrapped = `${prelude}\n(async () => {\n${source}\n})().then(r => JSON.stringify(r === undefined ? null : r))`;
      const evalRes = ctx.evalCode(wrapped);
      const promiseHandle = arena.manage(ctx.unwrapResult(evalRes));
      // resolve the promise: run pending jobs + await the QuickJS promise
      const resolved = await ctx.resolvePromise(promiseHandle);   // executes jobs; returns a result wrapper
      runtime.executePendingJobs();
      const strHandle = arena.manage(ctx.unwrapResult(resolved));
      const str = ctx.getString(strHandle);
      const parsed = str == null ? null : JSON.parse(str);
      return normalizeItems(parsed);
    });
  } catch (err) {
    throw normalizeIsolateError(err);
  } finally {
    runtime.dispose();
  }
}
```
`normalizeItems(parsed)`: mirror `toItems` semantics (array of `{json}` or bare values → `WorkflowItem[]`) — you can import + reuse `toItems` from `./items` on the host side (pass it the parsed JSON). Prefer reusing `toItems` over re-implementing.

**CRITICAL API caveat:** the promise-resolution dance (`ctx.resolvePromise` / `executePendingJobs` / `unwrapResult`) is the part MOST likely to differ across `quickjs-emscripten` versions — READ the installed version's async/promise example and match it EXACTLY. Since the isolate has NO async host callbacks, the user's async IIFE resolves after `executePendingJobs()` with no external awaits; if the version makes sync-module promise handling awkward, an acceptable simplification is to NOT wrap in an async IIFE and instead require the Code-node return to be synchronous (`return <items>`) — BUT that changes the Code-node contract (no top-level await). Prefer preserving async; fall back to sync-only ONLY if the async path is unworkable with the installed version, and if so, DOCUMENT the contract change and flag it in the report.

- [ ] **Step 2: tests** — Code-node path:
  - **Escape blocked:** a script `return [{ json: { p: typeof process, r: typeof require } }]` → `p === 'undefined'`, `r === 'undefined'`; `this.constructor.constructor('return process')()` in a script → no host `process`.
  - **Behavior:** `return input.map(i => ({ json: { doubled: i.json.n * 2 } }))` over `[{json:{n:2}}]` → `[{json:{doubled:4}}]`; `$json`, `$items`, `$node('x')` resolve; `console.log('hi', {a:1})` → `onLog('log', 'hi {"a":1}')`.
  - **Limits:** `while(true){}` → throws within the budget; big allocation → memory error.
  - **Return normalization:** a bare object, an array, `undefined` → matches `toItems`.
- [ ] **Step 3:** `pnpm --filter @openldr/workflows exec tsc --noEmit && pnpm --filter @openldr/workflows exec vitest run src/engine/js-isolate.test.ts`. Commit `feat(workflows): QuickJS-WASM Code-node execution (runScript) (SEC-01)`.

---

## Task 4: Cut the Code node over + delete the worker/vm sandbox

**Files:** Modify `packages/workflows/src/engine/node-handlers/code.ts`; Delete or gut `packages/workflows/src/engine/sandbox.ts`; Rewrite `packages/workflows/src/engine/sandbox.test.ts` (invert the escape test). Grep for any other `sandbox`/`runInSandbox`/`node:vm`/`node:worker_threads` importers in the engine and update them.

- [ ] **Step 1: `code.ts`** — swap `runInSandbox` → `runScript`:
```ts
// remove: import { runInSandbox } from '../sandbox';
import { runScript } from '../js-isolate';
// keep the ctx.codeLimits.enabled gate (defense-in-depth), but change the warning text:
//   `Workflow Code node ${node.id} is executing in a sandboxed QuickJS isolate (no host filesystem/network/env access).`
// (drop the "HOST-LEVEL privileges / vm is not a security sandbox" wording)
    const result = await runScript(code, {
      input, nodeOutputs: ctx.nodeOutputs, limits: ctx.codeLimits,
      onLog: (level, message) => { const entry = { nodeId: node.id, level, message, ts: Date.now() }; (ctx.logs[node.id] ??= []).push(entry); ctx.emit({ type: 'node:log', entry }); },
    });
    return result; // runScript already returns WorkflowItem[] (via toItems); drop the extra toItems() if redundant
```
Keep the `WORKFLOW_CODE_ENABLED` gate — it's still worth keeping OFF-by-default (a Code node is arbitrary compute + a bigger attack surface than a condition even when sandboxed), but the spec's §5 note (pure compute, no I/O) means the risk is now containment, not host-escape.
- [ ] **Step 2: delete the worker/vm sandbox.** Remove `packages/workflows/src/engine/sandbox.ts` (the `BOOTSTRAP_JS` + `runInSandbox` + `Worker`/`vm` machinery) entirely, OR reduce it to a re-export of `runScript` for any external importer. Grep confirms no remaining `node:worker_threads`/`node:vm` imports in `packages/workflows/src` after this task.
- [ ] **Step 3: invert `sandbox.test.ts`.** The "escape documentation" test that asserted `this.constructor.constructor('return process')()` reaches the host must be REPLACED with an assertion that the Code node CANNOT reach the host (no `process`/`require`/fs), running through `runScript`/`code.ts`. Rename the file to `js-isolate` coverage if `sandbox.ts` is deleted (move the Code-node handler tests to a `code.test.ts` or keep them exercising `codeHandler`).
- [ ] **Step 4: node help / warning copy.** Update the Code node's user-facing description (find it in the studio node palette / node metadata — grep for the Code node's help text) to state it runs sandboxed with no filesystem/network access and is for pure transforms (dedicated nodes for I/O). If the copy lives in i18n, update en/fr/pt.
- [ ] **Step 5:** `pnpm --filter @openldr/workflows exec tsc --noEmit && pnpm --filter @openldr/workflows exec vitest run`. Commit `feat(workflows): Code node runs in the QuickJS isolate; remove worker/vm sandbox (SEC-01)`.

**Gotcha:** `code.ts` previously wrapped `runInSandbox`'s `unknown` result in `toItems`; if `runScript` already returns `WorkflowItem[]` via `toItems`, don't double-normalize. Confirm the one-normalization path.

---

## Task 5: Gate, live smoke, whole-slice review, merge, push

- [ ] **Live smoke** — a throwaway `pnpm --filter @openldr/workflows exec tsx` script (or extend an existing workflow acceptance) that runs a real workflow graph through the engine: an `if` condition (`$json.n > 1`), a `filter`, a `switch`, AND a Code node (`WORKFLOW_CODE_ENABLED=true`) doing a pure transform — assert correct branching + output; PLUS an escape attempt in a condition AND in a Code node — assert NO host access (no `process`, no fs). Paste output. (No external services needed — this is pure in-engine.)
- [ ] **Gate:** `pnpm --filter @openldr/workflows exec tsc --noEmit && pnpm --filter @openldr/workflows exec vitest run` — PASS. Then the CONSUMERS of the engine: `pnpm --filter @openldr/bootstrap exec tsc --noEmit && vitest run`, `pnpm --filter @openldr/server exec tsc --noEmit && vitest run` (they wire the engine + codeLimits) — PASS, no new failures (re-run any known Windows/parallel flake in isolation). Confirm `quickjs-emscripten`'s WASM asset works when the server package runs the engine (not just in workflows' own vitest).
- [ ] **Whole-slice review** (fresh reviewer over `git diff main..HEAD`): NO `node:vm` or `node:worker_threads` remain in `packages/workflows/src` (grep); the escape tests assert the boundary HOLDS (both conditions + Code node) and the OLD "escape works" assertion is gone; memory + interrupt limits are set on every eval; NO host functions bound except `__log`; all handles disposed (no leak); `filter.ts` awaits (doesn't keep everything); the Code-node contract change (pure compute) is documented; `quickjs-emscripten` pinned; no `Co-Authored-By`.
- [ ] **Merge:** `git checkout main && git merge --no-ff feat/workflow-js-isolate -m "Merge branch 'feat/workflow-js-isolate': workflow safe JS isolate (QuickJS-WASM) — SEC-01"`.
- [ ] **Push:** ask the user before `git push origin main`.
- [ ] **Update memory:** a `workflow-js-isolate` note (or extend the workflow-builder note) — SEC-01 DONE (QuickJS-WASM isolate replaces vm for conditions + Code node; escape-blocked; limits; Code node = pure compute); remaining SEC follow-ups = SEC-06 webhook-secret encryption (its own sub-project) + [[marketplace-extensibility-vnext]] audit items.

---

## Self-review notes

- **Spec coverage:** §1 isolate module → T1 (`evalExpression`) + T3 (`runScript`); §2 JSON boundary → T1/T3 marshaling; §3 limits → T1/T3 (memory + interrupt); §4 wiring → T2 (conditions) + T4 (code node, remove vm); §5 pure-compute consequence → T4 (warning/help + the no-host-bindings design); §6 testing → each task's tests + the inverted escape tests + T5 live smoke. All covered.
- **Ordering safety:** dependency + `evalExpression` (T1) before conditions (T2); `runScript` (T3) before the Code-node cutover (T4); everything before the gate/smoke (T5). Conditions (highest live risk, always-on) are fixed by end of T2 — the sharpest hole closes first.
- **Type consistency:** `JsLimits`/`evalExpression`/`runScript` (js-isolate) consumed by the three condition handlers (T2) + `code.ts` (T4); `WorkflowItem`/`toItems`/`LogLevel` reused, not redefined.
- **Security invariants (call out in review):** no `vm`/`worker_threads` left; escape tests inverted to prove containment; limits on every eval; only `__log` bound; handles disposed.
- **Deliberate shortcuts (flagged):** fresh context per eval (no pool); JSON-only boundary; Code nodes lose host I/O; sync-only fallback ONLY if the installed quickjs promise API is unworkable (documented if taken).
- **Plan-time unknowns to resolve during T1/T3:** the EXACT `quickjs-emscripten` API for the installed version (evalCode result shape, `unwrapResult`/`dump`, `Scope`/arena, `resolvePromise`/`executePendingJobs`, and which WASM variant loads under vitest/tsx) — the plan's code is the intended shape; match the real API and report deviations.
