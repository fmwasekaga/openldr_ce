import createPlugin from '@extism/extism';
import type { CurrentPlugin } from '@extism/extism';
import type { PluginRunner, RunOptions } from './runner';

/**
 * Real Extism-backed runner (@extism/extism@1.0.3).
 *
 * Sandbox notes:
 * - Isolation is default-deny: `allowedPaths` is left unset, so the plugin gets
 *   no host filesystem access. WASI is opt-in per plugin.
 * - Network egress is now restricted to the granted `allowedHosts` list (passed
 *   from the capability grant via `opts.allowedHosts`). An empty list or undefined
 *   means default-deny — no outbound connections are permitted.
 * - `runInWorker` is left false: the 1.0.3 worker path bootstraps from an inline
 *   data: URL whose bundle references a relative `worker.js.map`, which Node cannot
 *   resolve (ERR_INVALID_URL) — a known SDK bug. Running in-process avoids it.
 * - The 1.0.3 JS SDK exposes no memory-page or timeout option. The watchdog below
 *   bounds async overruns, but without a worker it cannot interrupt a synchronous
 *   runaway; hard memory + timeout enforcement awaits a newer SDK (tracked as a
 *   follow-up). `opts.memoryMb` is recorded in the manifest but not enforced here.
 * - HTTP egress is NOT supported on this path (1.0.3 limitation). The real HttpContext
 *   that performs fetches is only wired in createBackgroundPlugin, not the foreground
 *   path we use; and the worker/background path has the ERR_INVALID_URL bug above. So
 *   wasm plugins that import the `extism:host/env` http_* symbols (e.g. the dhis2-sink,
 *   built with a newer extism-pdk) need those imports *present* merely to instantiate.
 *   We provide them: http_request THROWS a clear error if actually invoked (no silent
 *   no-op), and http_status_code/http_headers return 0 so a module that never calls
 *   http_request (e.g. a dry-run mapping path) links and runs. Real HTTP egress from
 *   wasm awaits a host-SDK upgrade — see the DHIS2 sink-plugin workstream (SP-6).
 */
export function createExtismRunner(): PluginRunner {
  return {
    async run(wasm: Uint8Array, input: Uint8Array, opts: RunOptions): Promise<Uint8Array> {
      const readStr = (cp: CurrentPlugin, offset: bigint): string => {
        const block = cp.read(offset);
        return block ? block.text() : '';
      };

      const plugin = await createPlugin(
        { wasm: [{ data: wasm }] },
        {
          useWasi: opts.wasi,
          runInWorker: false,
          config: opts.config ?? {},
          allowedHosts: opts.allowedHosts ?? [],
          functions: {
            // The Extism 1.0.3 foreground runner executes wasm synchronously; host
            // functions cannot be async. The SDK's real HttpContext (which makes actual
            // fetch calls) is only wired in the background/worker path — and the worker
            // path has a known Node ERR_INVALID_URL bug in 1.0.3, so we keep runInWorker
            // false. Provide stubs that allow WebAssembly to link and dry-run paths to
            // work; real HTTP push is covered by SP-6 live e2e against DHIS2.
            // http_headers is required by newer extism-pdk builds but absent from the SDK.
            'extism:host/env': {
              http_request: (_cp: CurrentPlugin, _reqaddr: bigint, _bodyaddr: bigint): bigint => {
                throw new Error('http_request: real HTTP egress requires the worker path (deferred to SP-6 e2e)');
              },
              http_status_code: (_cp: CurrentPlugin): number => 0,
              http_headers: (_cp: CurrentPlugin): bigint => 0n,
            },
            'extism:host/user': {
              log(cp: CurrentPlugin, level: bigint, msg: bigint) {
                opts.host.log(readStr(cp, level) || 'info', readStr(cp, msg));
              },
              progress(_cp: CurrentPlugin, done: bigint, total: bigint) {
                opts.host.progress(Number(done), Number(total));
              },
            },
          },
        },
      );

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`plugin timed out after ${opts.timeoutMs}ms`)), opts.timeoutMs);
      });

      try {
        const out: Awaited<ReturnType<typeof plugin.call>> = await Promise.race([plugin.call(opts.entrypoint, input), timeout]);
        return out ? new Uint8Array(out.bytes()) : new Uint8Array();
      } finally {
        if (timer) clearTimeout(timer);
        await plugin.close();
      }
    },
  };
}
