import { getQuickJS, Scope, type QuickJSWASMModule } from 'quickjs-emscripten';

/** Resource limits for a single isolate evaluation. */
export interface JsLimits {
  /** Wall-clock budget in milliseconds. Evaluation is interrupted once exceeded. */
  timeoutMs: number;
  /** Hard memory ceiling in megabytes for the QuickJS runtime. */
  memoryMb: number;
}

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
