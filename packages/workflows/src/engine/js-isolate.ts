import { getQuickJS, Scope, type QuickJSWASMModule } from 'quickjs-emscripten';
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
 * Evaluate a JS expression inside a hardened QuickJS-WASM isolate.
 *
 * Security invariants:
 *  - NO host functions/objects are bound into the context — user code cannot reach
 *    Node globals (`process`, `require`, `globalThis.process`, the host event loop).
 *  - `setMemoryLimit` and `setInterruptHandler` are installed on the runtime BEFORE
 *    any user code runs, giving hard memory + wall-time ceilings.
 *  - Every QuickJS handle is disposed via the `Scope` arena, and the runtime is
 *    always disposed in `finally`.
 *  - Any QuickJS error, interrupt (timeout), or memory-limit hit surfaces as a
 *    thrown host `Error`.
 *
 * `scope` variables are injected as pure JSON data (round-tripped, no live host
 * references). The result is marshaled back out with `ctx.dump` (native JSON value).
 */
export async function evalExpression(
  source: string,
  scope: Record<string, unknown>,
  limits: JsLimits,
): Promise<unknown> {
  const QuickJS = await quickjs();
  let runtime: ReturnType<QuickJSWASMModule['newRuntime']> | undefined;
  try {
    // Create+configure inside try so any throw here still hits the finally dispose.
    runtime = QuickJS.newRuntime();
    // Limits MUST be set before any evaluation runs.
    runtime.setMemoryLimit(limits.memoryMb * 1024 * 1024);
    const start = Date.now();
    runtime.setInterruptHandler(() => Date.now() - start > limits.timeoutMs);
    const rt = runtime;
    return Scope.withScope((arena) => {
      const ctx = arena.manage(rt.newContext());

      // Inject each scope var as JSON data. `undefined` (and any non-serializable
      // value such as a function/symbol, which JSON.stringify drops) is normalized
      // to null so the injected literal is always valid and the var is defined.
      for (const [key, value] of Object.entries(scope)) {
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

      // Wrap in parens so an object-literal expression isn't parsed as a block.
      const result = ctx.evalCode(`(${source})`);
      const handle = arena.manage(ctx.unwrapResult(result));
      return ctx.dump(handle);
    });
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    runtime?.dispose();
  }
}

/**
 * Shared limits for Code-node execution. Code nodes do real per-item compute, so
 * they get a more generous budget than boolean conditions.
 */
export const CODE_LIMITS: JsLimits = { timeoutMs: 30_000, memoryMb: 128 };

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
 * Security invariants (mirror {@link evalExpression}):
 *  - The only host binding is `__log`.
 *  - `setMemoryLimit` + `setInterruptHandler` are installed BEFORE any user code runs.
 *  - Every handle is disposed via the `Scope` arena; the runtime is disposed in `finally`.
 *  - Any QuickJS error, interrupt (timeout) or memory-limit hit surfaces as a host `Error`.
 *
 * The user code is wrapped in an async IIFE (so top-level `await`/`return` work), the
 * returned QuickJS promise is resolved on the host via `resolvePromise` +
 * `executePendingJobs`, and the settled value is marshaled out with `ctx.dump` and
 * normalized through {@link toItems} exactly as the old sandbox did.
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
  const QuickJS = await quickjs();
  let runtime: ReturnType<QuickJSWASMModule['newRuntime']> | undefined;
  try {
    // Create+configure inside try so any throw here still hits the finally dispose.
    runtime = QuickJS.newRuntime();
    // Limits MUST be set before any evaluation runs.
    runtime.setMemoryLimit(opts.limits.memoryMb * 1024 * 1024);
    const start = Date.now();
    runtime.setInterruptHandler(() => Date.now() - start > opts.limits.timeoutMs);
    const rt = runtime;
    return await Scope.withScopeAsync(async (arena) => {
      const ctx = arena.manage(rt.newContext());

      // 1) Inject data as pure JSON literals (no live host references). Same per-key
      //    safe-serialize guard evalExpression uses: undefined / non-serializable → null.
      const injections: [string, unknown][] = [
        ['input', opts.input],
        ['nodeOutputs', opts.nodeOutputs],
      ];
      for (const [key, value] of injections) {
        let json: string;
        try {
          const s = JSON.stringify(value === undefined ? null : value);
          json = s === undefined ? 'null' : s;
        } catch (e) {
          throw new Error(
            `Cannot inject "${key}": ${e instanceof Error ? e.message : String(e)}`,
          );
        }
        const handle = arena.manage(ctx.unwrapResult(ctx.evalCode(`(${json})`)));
        ctx.setProp(ctx.global, key, handle);
      }

      // 2) Bind the ONLY host function: __log(levelStr, msgStr) → opts.onLog.
      const logFn = arena.manage(
        ctx.newFunction('__log', (lvl, msg) => {
          opts.onLog((ctx.getString(lvl) as LogLevel) || 'log', ctx.getString(msg));
        }),
      );
      ctx.setProp(ctx.global, '__log', logFn);

      // 3) Prelude defines the sandbox helpers in JS-land (no further host bindings).
      //    User code is wrapped in an async IIFE so top-level await/return work.
      const prelude = `
        const $input = input; const $json = (input && input[0]) ? input[0].json : undefined;
        const $items = Array.isArray(input) ? input.map(i => i && i.json) : [];
        const $node = (id) => (nodeOutputs && Object.prototype.hasOwnProperty.call(nodeOutputs, id)) ? nodeOutputs[id] : undefined;
        const __str = (a) => a.map(x => typeof x === 'string' ? x : (()=>{try{return JSON.stringify(x)}catch{return String(x)}})()).join(' ');
        const console = { log:(...a)=>__log('log',__str(a)), info:(...a)=>__log('info',__str(a)), warn:(...a)=>__log('warn',__str(a)), error:(...a)=>__log('error',__str(a)), debug:(...a)=>__log('log',__str(a)) };
      `;
      const wrapped = `${prelude}\n(async () => {\n${source}\n})()`;

      const promiseHandle = arena.manage(ctx.unwrapResult(ctx.evalCode(wrapped)));
      // Resolve the QuickJS promise on the host. resolvePromise installs the .then
      // bridge; executePendingJobs drives the VM's job queue so the async IIFE (which
      // has NO external host awaits) settles synchronously; then we await the bridge.
      const settledPromise = ctx.resolvePromise(promiseHandle);
      rt.executePendingJobs();
      const settled = await settledPromise;
      const resultHandle = arena.manage(ctx.unwrapResult(settled));
      const value = ctx.dump(resultHandle);
      return toItems(value);
    });
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  } finally {
    runtime?.dispose();
  }
}
