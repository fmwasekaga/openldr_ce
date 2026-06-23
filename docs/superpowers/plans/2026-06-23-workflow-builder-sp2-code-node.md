# Workflow Builder — SP-2 Sandboxed Code Node — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the workflow Code node execute analyst-authored JavaScript over lab data in a `worker_thread` + `vm` sandbox with a hard timeout, memory cap, crash isolation, captured console → live logs, and only `$input`/`$node`/`console` exposed.

**Architecture:** A new `packages/workflows/src/engine/sandbox.ts` owns the worker mechanics: `new Worker(BOOTSTRAP_JS, { eval: true, resourceLimits, workerData })` runs the user code in a `vm` context, posts console calls + the result back, and is hard-terminated past a timeout. A thin `codeHandler` relays logs to the SSE stream and returns the result. Limits come from `@openldr/config` (`WORKFLOW_CODE_TIMEOUT_MS`/`_MEMORY_MB`) threaded through `RunWorkflowOptions` → `ExecutionContext`, keeping the engine pure.

**Tech Stack:** TypeScript, Node `worker_threads` + `vm` (Node 24), Vitest, Zod (config), React (palette enable).

**Reference spec:** `docs/superpowers/specs/2026-06-23-workflow-builder-sp2-code-node-design.md`
**Builds on:** merged `main` (`478398d`) with SP-1 + SP-4.

---

## Conventions
- CWD is the worktree `D:/Projects/Repositories/openldr_ce/.claude/worktrees/feat-workflow-builder-sp2`. Deps installed.
- Commit after each task with the shown message. Package gate after package tasks; full `turbo` gate at the end.
- No migrations in SP-2.

---

## Task 1: The sandbox runner (`sandbox.ts`)

**Files:**
- Create: `packages/workflows/src/engine/sandbox.ts`
- Create: `packages/workflows/src/engine/sandbox.test.ts`

- [ ] **Step 1: Write the failing test** (`sandbox.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { runInSandbox } from './sandbox';
import type { LogLevel } from '../types';

const LIMITS = { timeoutMs: 2000, memoryMb: 64 };
const run = (code: string, input: unknown = undefined, nodeOutputs: Record<string, unknown> = {}, onLog: (l: LogLevel, m: string) => void = () => {}) =>
  runInSandbox(code, { input, nodeOutputs, limits: LIMITS, onLog });

describe('runInSandbox', () => {
  it('returns a computed value from $input', async () => {
    expect(await run('return { doubled: $input * 2 };', 21)).toEqual({ doubled: 42 });
  });

  it('captures console.log via onLog', async () => {
    const logs: string[] = [];
    await run("console.log('hi', $input);", { a: 1 }, {}, (_l, m) => logs.push(m));
    expect(logs).toContain('hi {"a":1}');
  });

  it('exposes $node() over the snapshot', async () => {
    expect(await run("return $node('n1').v;", undefined, { n1: { v: 7 } })).toBe(7);
  });

  it('does not expose require/process/fetch', async () => {
    expect(await run('return typeof require + "," + typeof process + "," + typeof fetch;')).toBe('undefined,undefined,undefined');
  });

  it('rejects on a thrown error', async () => {
    await expect(run('throw new Error("boom");')).rejects.toThrow(/boom/);
  });

  it('kills an infinite loop at the timeout', async () => {
    await expect(runInSandbox('while (true) {}', { input: undefined, nodeOutputs: {}, limits: { timeoutMs: 300, memoryMb: 64 }, onLog: () => {} }))
      .rejects.toThrow(/timed out/);
  });

  it('rejects a non-serializable return with a clear message', async () => {
    await expect(run('return () => 1;')).rejects.toThrow(/non-serializable/);
  });

  it('returns executed marker for empty-ish code that returns nothing', async () => {
    expect(await run('const x = 1;')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @openldr/workflows test sandbox`
Expected: FAIL — no `./sandbox`.

- [ ] **Step 3: Write `sandbox.ts`**

```ts
import { Worker } from 'node:worker_threads';
import type { LogLevel } from '../types';

export interface SandboxLimits {
  timeoutMs: number;
  memoryMb: number;
}

export interface RunInSandboxOpts {
  input: unknown;
  nodeOutputs: Record<string, unknown>;
  limits: SandboxLimits;
  onLog: (level: LogLevel, message: string) => void;
}

/**
 * Bootstrap executed inside the worker (plain JS, eval mode → CommonJS, so
 * `require` is available here even though the package is ESM). It builds a vm
 * context exposing only $input/$node/console, runs the user code wrapped in an
 * async IIFE (so top-level await/return work), and posts results/logs back.
 */
export const BOOTSTRAP_JS = `
const { parentPort, workerData } = require('node:worker_threads');
const vm = require('node:vm');
const { code, input, nodeOutputs } = workerData;
function stringify(args) {
  return args.map((a) => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');
}
const mk = (level) => (...args) => parentPort.postMessage({ kind: 'log', level, message: stringify(args) });
const sandbox = {
  $input: input,
  input,
  $node: (id) => (nodeOutputs && Object.prototype.hasOwnProperty.call(nodeOutputs, id)) ? nodeOutputs[id] : undefined,
  console: { log: mk('log'), info: mk('info'), warn: mk('warn'), error: mk('error'), debug: mk('log') },
};
const wrapped = '(async () => {\\n' + code + '\\n})()';
(async () => {
  try {
    const result = await vm.runInNewContext(wrapped, sandbox, { displayErrors: true });
    try {
      parentPort.postMessage({ kind: 'done', result });
    } catch (e) {
      parentPort.postMessage({ kind: 'error', message: 'Code node returned a non-serializable value' });
    }
  } catch (err) {
    parentPort.postMessage({ kind: 'error', message: (err && err.message) ? err.message : String(err) });
  }
})();
`;

export function runInSandbox(code: string, opts: RunInSandboxOpts): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(BOOTSTRAP_JS, {
        eval: true,
        resourceLimits: { maxOldGenerationSizeMb: opts.limits.memoryMb },
        workerData: { code, input: opts.input, nodeOutputs: opts.nodeOutputs },
      });
    } catch (err) {
      reject(new Error(`Code node could not start: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error(`Code node timed out after ${opts.limits.timeoutMs}ms`))),
      opts.limits.timeoutMs,
    );

    worker.on('message', (msg: { kind: string; level?: LogLevel; message?: unknown; result?: unknown }) => {
      if (msg.kind === 'log') opts.onLog((msg.level ?? 'log') as LogLevel, String(msg.message ?? ''));
      else if (msg.kind === 'done') finish(() => resolve(msg.result));
      else if (msg.kind === 'error') finish(() => reject(new Error(String(msg.message ?? 'Code node error'))));
    });
    worker.on('error', (err) => finish(() => reject(new Error(`Code node crashed: ${err.message}`))));
    worker.on('exit', (exitCode) => {
      if (!settled) {
        finish(() => reject(new Error(exitCode === 0 ? 'Code node exited without a result' : 'Code node exceeded its memory limit')));
      }
    });
  });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @openldr/workflows test sandbox`
Expected: PASS (8 tests). If the `require`-in-eval-worker test fails (some Node builds run eval workers as ESM where `require` is undefined), switch the bootstrap to import via `createRequire` is NOT available without require — instead change the worker to use top-level `import`? No: keep CommonJS by confirming Node runs eval workers as CJS (Node 24 does). If it genuinely fails, the fallback is to write the worker as a real `.cjs` file under `src/engine/` and pass its path (no eval) — but try the eval path first per the spec.

- [ ] **Step 5: Commit**

```bash
git add packages/workflows/src/engine/sandbox.ts packages/workflows/src/engine/sandbox.test.ts
git commit -m "feat(workflows): worker_thread + vm code sandbox runner"
```

---

## Task 2: codeHandler + limit threading + integration

**Files:**
- Modify: `packages/workflows/src/engine/execution-context.ts`
- Modify: `packages/workflows/src/engine/run-workflow.ts`
- Create: `packages/workflows/src/engine/node-handlers/code.ts`
- Modify: `packages/workflows/src/engine/node-handlers/index.ts`
- Modify: `packages/workflows/src/engine/run-workflow.test.ts` (add a code integration case)

- [ ] **Step 1: Thread `codeLimits` through the context.** In `execution-context.ts`, add the field + param (default to 5000/128 so the engine runs standalone in tests):

```ts
export interface ExecutionContext {
  input: unknown;
  nodeOutputs: Record<string, unknown>;
  logs: Record<string, import('../types').LogEntry[]>;
  emit: (evt: RunEvent) => void;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string | null }>;
  /** Limits for the Code node sandbox. */
  codeLimits: { timeoutMs: number; memoryMb: number };
}

export function createContext(
  input: unknown,
  emit: (evt: RunEvent) => void,
  edges: ExecutionContext['edges'] = [],
  codeLimits: ExecutionContext['codeLimits'] = { timeoutMs: 5000, memoryMb: 128 },
): ExecutionContext {
  return { input, nodeOutputs: {}, logs: {}, emit, edges, codeLimits };
}
```

- [ ] **Step 2: Pass it from the runner.** In `run-workflow.ts`: add to `RunWorkflowOptions` and forward it to `createContext`.

```ts
export interface RunWorkflowOptions {
  input?: unknown;
  onEvent?: (evt: RunEvent) => void;
  codeLimits?: { timeoutMs: number; memoryMb: number };
}
```
and change the `createContext(...)` call to:
```ts
  const ctx = createContext(opts.input, opts.onEvent ?? (() => {}), edges, opts.codeLimits);
```
(When `opts.codeLimits` is undefined, `createContext`'s default applies.)

- [ ] **Step 3: Write `code.ts`**

```ts
import type { NodeHandler } from './types';
import { runInSandbox } from '../sandbox';

/**
 * Run the node's JavaScript in the worker+vm sandbox. Console output streams
 * live as node:log; the return value becomes the node output. Limits come from
 * ctx.codeLimits (config-driven).
 */
export const codeHandler: NodeHandler = async (node, ctx, upstream) => {
  const code = (node.data.code as string | undefined) ?? '';
  if (!code.trim()) return { executed: true, output: undefined };

  try {
    return await runInSandbox(code, {
      input: upstream,
      nodeOutputs: ctx.nodeOutputs,
      limits: ctx.codeLimits,
      onLog: (level, message) => {
        const entry = { nodeId: node.id, level, message, ts: Date.now() };
        (ctx.logs[node.id] ??= []).push(entry);
        ctx.emit({ type: 'node:log', entry });
      },
    });
  } catch (err) {
    throw new Error(`Code node error: ${err instanceof Error ? err.message : String(err)}`);
  }
};
```

- [ ] **Step 4: Route `type: 'code'` to it.** In `node-handlers/index.ts`, import `codeHandler` and add it to `TYPE_HANDLERS`:

```ts
import { codeHandler } from './code';
// ...
const TYPE_HANDLERS: Record<string, NodeHandler> = {
  trigger: triggerHandler,
  code: codeHandler,
};
```

- [ ] **Step 5: Add an integration test** to `run-workflow.test.ts`:

```ts
  it('runs a code node, streams its log, and passes its output downstream', async () => {
    const nodes = [
      { id: 't', type: 'trigger', data: {} },
      { id: 'c', type: 'code', data: { code: "console.log('in code'); return { n: 42 };" } },
      { id: 'l', type: 'action', data: { action: 'log', message: 'n={{ $input.n }}' } },
    ];
    const edges = [
      { id: 'e1', source: 't', target: 'c' },
      { id: 'e2', source: 'c', target: 'l' },
    ];
    const events: RunEvent[] = [];
    const res = await runWorkflow(nodes, edges, { onEvent: (e) => events.push(e) });
    expect(res.status).toBe('completed');
    const cOut = res.results.find((r) => r.nodeId === 'c')?.output;
    expect(cOut).toEqual({ n: 42 });
    expect(events.some((e) => e.type === 'node:log' && e.entry.message === 'in code')).toBe(true);
  });
```

- [ ] **Step 6: Run + commit**

Run: `pnpm --filter @openldr/workflows test && pnpm --filter @openldr/workflows typecheck`
Expected: all green.

```bash
git add packages/workflows/src/engine/execution-context.ts packages/workflows/src/engine/run-workflow.ts packages/workflows/src/engine/node-handlers/code.ts packages/workflows/src/engine/node-handlers/index.ts packages/workflows/src/engine/run-workflow.test.ts
git commit -m "feat(workflows): code node handler + config-driven sandbox limits"
```

---

## Task 3: Config flags + server limit passing

**Files:**
- Modify: `packages/config/src/schema.ts` (+ `schema.test.ts`)
- Modify: `apps/server/src/workflows-routes.ts` (execute-stream passes codeLimits)
- Modify: `packages/workflows/src/trigger-runner.ts` (RunnerDeps.codeLimits → runWorkflow)
- Modify: `packages/bootstrap/src/index.ts` (construct runner with cfg limits)

- [ ] **Step 1: Add config flags.** In `packages/config/src/schema.ts`, near the `DASHBOARD_SQL_*` block:

```ts
    WORKFLOW_CODE_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    WORKFLOW_CODE_MEMORY_MB: z.coerce.number().int().positive().default(128),
```

- [ ] **Step 2: Add a config test** to `schema.test.ts`:

```ts
  it('defaults the workflow code sandbox limits', () => {
    const cfg = ConfigSchema.parse(base);
    expect(cfg.WORKFLOW_CODE_TIMEOUT_MS).toBe(5000);
    expect(cfg.WORKFLOW_CODE_MEMORY_MB).toBe(128);
  });
```
(`base` is the existing minimal valid env object in that test file — reuse it.)

Run: `pnpm --filter @openldr/config test` → green.

- [ ] **Step 3: Pass limits from the execute-stream route.** In `apps/server/src/workflows-routes.ts`, change the manual run call to include `codeLimits`:

```ts
      const result = await runWorkflow(def.nodes, def.edges, {
        input: body.input,
        onEvent: send,
        codeLimits: { timeoutMs: ctx.cfg.WORKFLOW_CODE_TIMEOUT_MS, memoryMb: ctx.cfg.WORKFLOW_CODE_MEMORY_MB },
      });
```

- [ ] **Step 4: Thread limits into the trigger runner.** In `packages/workflows/src/trigger-runner.ts`:
  - add to `RunnerDeps`: `codeLimits?: { timeoutMs: number; memoryMb: number };`
  - in `runAndRecord`, pass it: `await deps.runWorkflow(def.nodes, def.edges, { input, codeLimits: deps.codeLimits });`

- [ ] **Step 5: Supply it in bootstrap.** In `packages/bootstrap/src/index.ts`, where `createWorkflowTriggerRunner({...})` is constructed, add:

```ts
    codeLimits: { timeoutMs: cfg.WORKFLOW_CODE_TIMEOUT_MS, memoryMb: cfg.WORKFLOW_CODE_MEMORY_MB },
```

- [ ] **Step 6: Gate + commit**

Run: `pnpm --filter @openldr/config typecheck && pnpm --filter @openldr/workflows typecheck && pnpm --filter @openldr/bootstrap typecheck && pnpm --filter @openldr/server typecheck`
Expected: green.

```bash
git add packages/config/src/schema.ts packages/config/src/schema.test.ts apps/server/src/workflows-routes.ts packages/workflows/src/trigger-runner.ts packages/bootstrap/src/index.ts
git commit -m "feat(config): WORKFLOW_CODE_* limits + thread to manual + triggered runs"
```

---

## Task 4: Enable the Code node in the web palette

**Files:**
- Modify: `apps/web/src/workflows/constants.ts`
- Modify: `apps/web/src/workflows/components/node-forms/code-form.tsx`

- [ ] **Step 1: Enable the tile.** In `constants.ts`, add the code template id to `IMPLEMENTED_TEMPLATE_IDS` (READ the file to confirm the exact id — likely `code`):

```ts
  // code
  'code',
```

- [ ] **Step 2: Mark TypeScript as not-yet-runnable** in `code-form.tsx` so users aren't misled — disable the TS option:

```tsx
          <option value="javascript">JavaScript</option>
          <option value="typescript" disabled>TypeScript (coming soon)</option>
```

- [ ] **Step 3: Gate + commit**

Run: `pnpm --filter @openldr/web typecheck && pnpm --filter @openldr/web test`
Expected: green.

```bash
git add apps/web/src/workflows/constants.ts apps/web/src/workflows/components/node-forms/code-form.tsx
git commit -m "feat(web): enable Code node tile (JS only; TS coming soon)"
```

---

## Task 5: Full gate + verification

- [ ] **Step 1: Full monorepo gate**

Run: `pnpm turbo typecheck lint test build`
Expected: all PASS. If `@openldr/web#test` flakes in parallel (known Terminology flake), re-run isolated: `pnpm --filter @openldr/web test`.

- [ ] **Step 2: depcruise**

Run: `pnpm depcruise`
Expected: clean — no new forbidden edges (`sandbox.ts` uses only `node:worker_threads`).

- [ ] **Step 3: Manual e2e** (needs live stack + login): drag Manual Trigger → Code (`console.log('hi', $input); return { ok: true };`) → Log (`{{ $input.ok }}`); Run; confirm the Code node animates, its `console.log` streams in the Logs tab, and the Log node shows `true`. Also confirm an infinite-loop code node fails with a timeout error after ~5s and the run is recorded as failed in Run History.

- [ ] **Step 4: Commit any fixes, then finish**

```bash
git add -A && git commit -m "chore(workflows): SP-2 verification fixes"
```

Proceed to `superpowers:finishing-a-development-branch`.

---

## Self-review notes (author)

- **Spec coverage:** §2 sandbox → Task 1; codeHandler + limit threading → Task 2; §6 config → Task 3; §7 web → Task 4; §8 testing → Tasks 1,2,3 + Task 5.
- **Type consistency:** `runInSandbox`/`RunInSandboxOpts`/`SandboxLimits`/`BOOTSTRAP_JS`, `ExecutionContext.codeLimits`, `RunWorkflowOptions.codeLimits`, `RunnerDeps.codeLimits`, `codeHandler` are used identically across tasks. `codeLimits` shape `{ timeoutMs, memoryMb }` is uniform everywhere.
- **Soft spots flagged for the implementer to verify against real files:** `require` availability in an eval worker on the installed Node (Task 1 Step 4 — fallback noted); the real `code` template id in `constants.ts` (Task 4); the existing `base` env fixture name in `schema.test.ts` (Task 3); the exact `createWorkflowTriggerRunner({...})` call site in `bootstrap/index.ts` (Task 3).
- **Placeholder scan:** none — all code blocks concrete; "verify against real file" notes are guardrails, not deferrals.
