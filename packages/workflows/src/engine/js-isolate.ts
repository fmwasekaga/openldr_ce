import {
  getQuickJS,
  Scope,
  type QuickJSWASMModule,
  type QuickJSContext,
  type QuickJSRuntime,
} from 'quickjs-emscripten';
import type { WorkflowItem } from './items';
import { toItems } from './items';
import type { LogLevel } from '../types';

/** Resource limits for a single isolate evaluation. */
export interface JsLimits {
  /** Wall-clock budget in milliseconds. Evaluation is interrupted once exceeded. */
  timeoutMs: number;
  /** Hard memory ceiling in megabytes for the QuickJS runtime. */
  memoryMb: number;
}

/**
 * Shared limits for branching-condition evaluation (if/filter/switch). Conditions
 * are short boolean expressions, so a tight 1s / 16MB budget is ample.
 */
export const COND_LIMITS: JsLimits = { timeoutMs: 1000, memoryMb: 16 };

// Module-level singleton of the QuickJS WASM module. getQuickJS() itself returns
// a shared singleton, but we memoize the promise so concurrent callers await one load.
let modPromise: Promise<QuickJSWASMModule> | null = null;
function quickjs(): Promise<QuickJSWASMModule> {
  return (modPromise ??= getQuickJS());
}

/**
 * Own the full QuickJS runtime lifecycle for a single evaluation and yield a live
 * context to `fn`. Factored out so the security-critical machinery is STRUCTURAL —
 * `evalExpression` and `runScript` share one implementation and cannot drift:
 *
 *  - `setMemoryLimit` + `setInterruptHandler` are installed on the runtime BEFORE
 *    any user code runs, giving hard memory + wall-time ceilings.
 *  - The context lives in a `Scope` arena so every handle is disposed automatically.
 *  - Any QuickJS error, interrupt (timeout) or memory-limit hit surfaces as a thrown
 *    host `Error`.
 *  - The runtime is ALWAYS disposed in `finally`.
 */
async function withIsolate<R>(
  limits: JsLimits,
  fn: (io: { ctx: QuickJSContext; arena: Scope; rt: QuickJSRuntime }) => R | Promise<R>,
): Promise<R> {
  const QuickJS = await quickjs();
  let runtime: QuickJSRuntime | undefined;
  try {
    // Create+configure inside try so any throw here still hits the finally dispose.
    runtime = QuickJS.newRuntime();
    // Limits MUST be set before any evaluation runs.
    runtime.setMemoryLimit(limits.memoryMb * 1024 * 1024);
    const start = Date.now();
    runtime.setInterruptHandler(() => Date.now() - start > limits.timeoutMs);
    const rt = runtime;
    return await Scope.withScopeAsync(async (arena) => {
      const ctx = arena.manage(rt.newContext());
      return fn({ ctx, arena, rt });
    });
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    runtime?.dispose();
  }
}

/**
 * Inject `value` as the global `key` inside the isolate, as pure JSON data (no live
 * host references). `undefined` — and any non-serializable value such as a
 * function/symbol, which `JSON.stringify` drops — is normalized to null so the
 * injected literal is always valid and the var is defined. A value that cannot be
 * serialized at all (bigint, circular) throws a clear per-key host `Error`.
 */
function injectJson(ctx: QuickJSContext, arena: Scope, key: string, value: unknown): void {
  let json: string;
  try {
    const s = JSON.stringify(value === undefined ? null : value);
    json = s === undefined ? 'null' : s; // functions/symbols → null, matching undefined
  } catch (e) {
    throw new Error(
      `Cannot inject scope variable "${key}": ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  const handle = arena.manage(ctx.unwrapResult(ctx.evalCode(`(${json})`)));
  ctx.setProp(ctx.global, key, handle);
}

/**
 * Evaluate a JS expression inside a hardened QuickJS-WASM isolate.
 *
 * NO host functions/objects are bound into the context — user code cannot reach Node
 * globals (`process`, `require`, `globalThis.process`, the host event loop). Runtime
 * lifecycle + limits + disposal are owned by {@link withIsolate}; the security
 * invariants live there.
 *
 * `scope` variables are injected as pure JSON data (round-tripped, no live host
 * references) via {@link injectJson}. The result is marshaled back out with
 * `ctx.dump` (native JSON value).
 */
export async function evalExpression(
  source: string,
  scope: Record<string, unknown>,
  limits: JsLimits,
): Promise<unknown> {
  return withIsolate(limits, ({ ctx, arena }) => {
    for (const [key, value] of Object.entries(scope)) {
      injectJson(ctx, arena, key, value);
    }
    // Wrap in parens so an object-literal expression isn't parsed as a block.
    const handle = arena.manage(ctx.unwrapResult(ctx.evalCode(`(${source})`)));
    return ctx.dump(handle);
  });
}

/**
 * Execute a Code node's user JavaScript inside a hardened QuickJS-WASM isolate and
 * return the produced items.
 *
 * This is the pure-compute replacement for the old `vm` + worker_thread sandbox.
 * The Code node has NO host I/O: the ONLY host function bound into the context is
 * `__log` (backing `console.*`). Everything else — `$input`/`$json`/`$items`/
 * `$node`/`console` — is defined in JS-land by the prelude, so `process`, `require`,
 * the host filesystem/network and the host event loop are all unreachable.
 *
 * Runtime lifecycle, limits and disposal are owned by {@link withIsolate}. `input`
 * and `nodeOutputs` are injected as pure JSON via {@link injectJson}. The user code
 * is wrapped in an async IIFE (so top-level `await`/`return` work), the returned
 * QuickJS promise is resolved on the host via `resolvePromise` + `executePendingJobs`,
 * and the settled value is marshaled out with `ctx.dump` and normalized through
 * {@link toItems} exactly as the old sandbox did.
 */
export async function runScript(
  source: string,
  opts: {
    input: WorkflowItem[];
    nodeOutputs: Record<string, WorkflowItem[]>;
    limits: JsLimits;
    onLog: (level: LogLevel, message: string) => void;
  },
): Promise<WorkflowItem[]> {
  return withIsolate(opts.limits, async ({ ctx, arena, rt }) => {
    // 1) Inject data as pure JSON literals (no live host references).
    injectJson(ctx, arena, 'input', opts.input);
    injectJson(ctx, arena, 'nodeOutputs', opts.nodeOutputs);

    // 2) Bind the ONLY host function: __log(levelStr, msgStr) → opts.onLog.
    const logFn = arena.manage(
      ctx.newFunction('__log', (lvl, msg) => {
        opts.onLog((ctx.getString(lvl) as LogLevel) || 'log', ctx.getString(msg));
      }),
    );
    ctx.setProp(ctx.global, '__log', logFn);

    // 3) Prelude defines the sandbox helpers in JS-land (no further host bindings). It is
    //    a SINGLE line, and the async IIFE opens on that same line, so user-code line 1
    //    maps to isolate line 1 (stack-trace line numbers stay operator-legible).
    const prelude =
      `const $input = input; const $json = (input && input[0]) ? input[0].json : undefined; ` +
      `const $items = Array.isArray(input) ? input.map(i => i && i.json) : []; ` +
      `const $node = (id) => (nodeOutputs && Object.prototype.hasOwnProperty.call(nodeOutputs, id)) ? nodeOutputs[id] : undefined; ` +
      `const __str = (a) => a.map(x => typeof x === 'string' ? x : (()=>{try{return JSON.stringify(x)}catch{return String(x)}})()).join(' '); ` +
      `const console = { log:(...a)=>__log('log',__str(a)), info:(...a)=>__log('info',__str(a)), warn:(...a)=>__log('warn',__str(a)), error:(...a)=>__log('error',__str(a)), debug:(...a)=>__log('log',__str(a)) };`;
    const wrapped = `${prelude}(async () => {\n${source}\n})()`;

    const promiseHandle = arena.manage(ctx.unwrapResult(ctx.evalCode(wrapped)));
    // Resolve the QuickJS promise on the host. resolvePromise installs the .then
    // bridge; executePendingJobs drives the VM's job queue so the async IIFE (which
    // has NO external host awaits) settles synchronously; then we await the bridge.
    const settledPromise = ctx.resolvePromise(promiseHandle);
    // The ExecutePendingJobsResult is intentionally discarded: a job that throws
    // rejects the promise, which surfaces via unwrapResult(settled) below, and any
    // stray handle it left is freed when the runtime is disposed in withIsolate.
    rt.executePendingJobs();
    const settled = await settledPromise;
    const resultHandle = arena.manage(ctx.unwrapResult(settled));
    const value = ctx.dump(resultHandle);
    return toItems(value);
  });
}
