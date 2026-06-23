# Workflow Builder — SP-2: Sandboxed Code Node (Design)

**Date:** 2026-06-23
**Status:** Design — awaiting user approval of the written spec
**Branch / worktree:** `feat/workflow-builder-sp2` (off merged `main` `478398d`, which already contains SP-1 + SP-4)
**Builds on:** SP-1 (`packages/workflows` engine, node-handler registry, `ExecutionContext`, SSE `node:log` protocol) + SP-4 (run history, triggers). SP-3 (domain nodes) is independent and not required.

---

## 1. Background & goal

SP-1 ported the visual builder but left the **Code node** unimplemented (it falls through to `defaultHandler`, and is disabled in the palette). The standalone executes code with Node's `vm` in-process with a 5s timeout — which has **no memory cap, no hard kill, and no crash isolation**, and shares the server process. SP-2 replaces that with a **`worker_thread` + `vm` sandbox** so analyst-authored JavaScript can run over real lab data safely: hard timeout, memory cap, crash isolation, and a minimal global surface.

The Code node is where the "Node.js analysis project" logic the user used to manage separately now lives, inline in a workflow.

### Threat model
The Code node is authored only by `lab_admin`/`lab_manager` (workflow create/edit is RBAC-gated). The dominant risks are **accidents** — infinite loops, runaway memory, an accidental filesystem write — plus defense-in-depth against a pasted malicious snippet or a compromised account. It is **not** designed to run code from anonymous/untrusted authors.

### Confirmed decisions
| Decision | Choice |
| --- | --- |
| Isolation | **`worker_thread` + `vm` context + `resourceLimits` + watchdog `terminate()`.** Per-worker OS permissions are infeasible (Node's permission model is process-wide), so a stronger OS-level fs/net boundary (separate process / isolated-vm) is explicitly deferred. |
| Language | **JavaScript only in v1.** The form keeps a language field; TypeScript is shown as not-yet-runnable (transpilation deferred — would add esbuild to the sandbox). |
| Exposed globals | `$input` (upstream output), `$node('id')` (snapshot of prior node outputs), `console` (captured → `node:log`), async/`await`, return value = node output. **No `require`/`process`/`fetch`/`fs`.** |
| Limits | Config-driven: `WORKFLOW_CODE_TIMEOUT_MS` (default 5000), `WORKFLOW_CODE_MEMORY_MB` (default 128). Code node enabled by default (RBAC-gated + sandboxed). |
| Worker bootstrap | **Eval-string bootstrap** (`new Worker(BOOTSTRAP_JS, { eval: true })`) — avoids the `.ts`-worker-loading problem (server runs via `tsx`; the package ships `src` with no build). |

### Rejected alternatives
- **child_process + Node permission model:** OS-enforced fs denial, but heavier (process spawn per run) and the permission model doesn't gate outbound network anyway. Deferred as future hardening.
- **isolated-vm:** gold-standard V8-isolate sandbox, but adds a native/prebuilt dependency and build complexity to the CE stack. Deferred.
- **Shipped `.js` worker file / `.ts` worker via tsx execArgv:** awkward/fragile in a src-only, tsx-run package. Rejected in favor of the eval-string bootstrap.

---

## 2. Architecture

All new logic lives in `packages/workflows` (engine package); the server only passes config-derived limits.

```
packages/workflows/src/engine/
  sandbox.ts          # runInSandbox(code, { input, nodeOutputs, timeoutMs, memoryMb, onLog }) -> Promise<unknown>
  sandbox.test.ts
  node-handlers/
    code.ts           # codeHandler: reads limits from ctx, calls runInSandbox, relays logs, returns output
    index.ts          # route node.type === 'code' -> codeHandler (replace defaultHandler fallthrough)
```

- **`sandbox.ts`** owns the worker mechanics and is independently testable without the runner. It exports `runInSandbox` and the `BOOTSTRAP_JS` string.
- **`code.ts`** is a thin handler: pulls `timeoutMs`/`memoryMb` from `ctx`, calls `runInSandbox`, relays `onLog` callbacks to `ctx.emit`/`ctx.logs`, returns the result.

### `runInSandbox` flow
1. `new Worker(BOOTSTRAP_JS, { eval: true, resourceLimits: { maxOldGenerationSizeMb: memoryMb }, workerData: { code, input, nodeOutputs } })`.
2. The bootstrap (plain JS string) builds a `vm` context exposing only `$input`, `$node(id)` (reads `workerData.nodeOutputs`), and a `console` shim whose calls `parentPort.postMessage({ kind: 'log', entry })`. It runs `(async () => { <code> })()`, then `postMessage({ kind: 'done', result })` or `{ kind: 'error', message }`.
3. The main thread:
   - on `{kind:'log'}` → `onLog(entry)` (relayed live);
   - on `{kind:'done'}` → resolve with `result`;
   - on `{kind:'error'}` → reject with the message;
   - on worker `error`/`exit(non-zero)` → reject (OOM shows here);
   - a `setTimeout(timeoutMs)` watchdog → `worker.terminate()` + reject `"code timed out after Nms"`.
4. `finally`: ensure the worker is terminated and the timer cleared (no leaks).

### Limit threading (keeps the engine pure)
- `RunWorkflowOptions` gains `codeLimits?: { timeoutMs: number; memoryMb: number }`; `createContext`/`ExecutionContext` carry it; `codeHandler` reads `ctx.codeLimits` (falling back to the 5000/128 defaults if absent, so the engine works standalone in tests).
- The server (manual `execute-stream` route and the trigger runner's `runWorkflow` calls) passes `codeLimits` from `ctx.cfg.WORKFLOW_CODE_TIMEOUT_MS`/`_MEMORY_MB`.

---

## 3. Data & serialization

`workerData` and `postMessage` use the structured-clone algorithm. `$input` and `nodeOutputs` originate from prior nodes (JSON-shaped), so they clone cleanly. The user's return value is structured-clone-serialized back to the main thread; a non-serializable return (function, symbol) surfaces as a clear `node:error` (`"Code node returned a non-serializable value"`). `$node('id')` returns the cloned snapshot taken at worker spawn (consistent with the standalone, which passed `ctx.nodeOutputs` by reference but read-only in practice).

## 4. Console capture → live logs

The worker's `console.{log,info,warn,error,debug}` shim stringifies args (same `stringifyArgs` as the standalone) and posts `{kind:'log', entry:{nodeId,level,message,ts}}`. The handler relays each to `ctx.logs[nodeId]` + `ctx.emit({type:'node:log', entry})` as they arrive — preserving the existing SSE protocol and the live Logs tab. (The `nodeId` is stamped by the handler, not the worker.)

## 5. Errors

- User `throw` → `{kind:'error'}` → handler throws `Code node error: <msg>` → runner emits `node:error` and halts (existing behavior).
- Timeout → watchdog terminates the worker → `Code node timed out after <ms>ms`.
- OOM / worker crash → `error`/non-zero `exit` → `Code node exceeded its memory limit` / `Code node crashed`.
- Empty code → returns `{ executed: true, output: undefined }` (matches standalone).

## 6. Config

Add to `@openldr/config` schema (with the existing flag conventions + defaults): `WORKFLOW_CODE_TIMEOUT_MS` (number, default 5000) and `WORKFLOW_CODE_MEMORY_MB` (number, default 128). Surfaced on `ctx.cfg` and threaded as above. No enable/disable flag in v1 (RBAC + sandbox are the gates); a kill-switch can be added later if needed.

## 7. Web

- Add `code` to `IMPLEMENTED_TEMPLATE_IDS` in `apps/web/src/workflows/constants.ts` so the tile is draggable.
- Keep the existing `code-form.tsx` (textarea + `$input` hint). Default the language to `javascript`; render the TypeScript option as disabled or labeled "(coming soon)" so users aren't misled. No other UI change — execution state/logs already render via the SP-1 panels.

## 8. Testing

- **`sandbox.test.ts`** (the core): returns a computed value from `$input`; captures `console.log` via `onLog`; **`require`/`process`/`fetch` are undefined** inside the sandbox (assert the code throws/returns accordingly); **infinite loop is killed** by the timeout (use a short `timeoutMs`); a `throw` rejects with the message; a non-serializable return rejects clearly; `$node('id')` reads the snapshot. (Memory-cap assertion is best-effort — a large-allocation test with a tiny `memoryMb` should reject; mark it as potentially environment-sensitive.)
- **Integration:** a `runWorkflow` test — trigger → code (`console.log('hi'); return { n: ($input?.x ?? 1) * 2 }`) → log — emits `node:log` then `node:success` with the doubled output.
- Full `turbo typecheck lint test build` + depcruise green. Manual e2e (run a Code node in the live UI, see logs stream + output) deferred to acceptance (needs live stack).

## 9. Collision / scope

All additive: new `sandbox.ts` + `code.ts`, a one-line `index.ts` route change, `RunWorkflowOptions`/`ExecutionContext` field, two config flags, one `IMPLEMENTED_TEMPLATE_IDS` entry, and the limit-passing at the two server call sites. No migrations. Independent of the marketplace work.

## 10. Open questions / deferred
- Stronger isolation (child_process + permission model, or isolated-vm) — deferred; revisit if untrusted authorship ever becomes a requirement.
- TypeScript execution (esbuild transpile in the sandbox) — deferred.
- A per-run worker pool (reuse workers across executions) for throughput — deferred; v1 spawns one worker per code-node run (code runs are infrequent and bounded).
- Exposing a curated, safe stdlib subset (e.g. a frozen `Math`/`Date`, a `fetch` allow-list) — deferred.
