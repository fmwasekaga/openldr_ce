import createPlugin from '@extism/extism';
import type { CurrentPlugin } from '@extism/extism';
import type { PluginRunner, RunOptions } from './runner';

/**
 * Real Extism-backed runner (@extism/extism@1.0.3).
 *
 * Sandbox notes:
 * - Isolation is default-deny: `allowedPaths` is left unset, so the plugin gets
 *   no host filesystem access. WASI is opt-in per plugin.
 * - Network egress is restricted to the granted `allowedHosts` list (passed from the
 *   capability grant / connector via `opts.allowedHosts`). An empty list or undefined
 *   means default-deny — no outbound connections are permitted.
 * - Execution path is chosen per call:
 *     - No egress requested (allowedHosts empty) -> FOREGROUND (in-process). Faster (no
 *       worker spawn); used by ingest converters and sink dry-runs. HTTP is unavailable
 *       here — the http_request stub throws if a foreground plugin attempts egress.
 *     - Egress requested (allowedHosts non-empty) -> WORKER (off-thread). The SDK's
 *       HttpContext performs the fetch on the host restricted to allowedHosts and bridges
 *       it back to the synchronous wasm call via SharedArrayBuffer + Atomics. This is the
 *       only path that can do HTTP (a foreground host function can't return a Promise to a
 *       synchronous wasm import). Verified working on Node 22 (prod) + 24 (dev); the older
 *       `ERR_INVALID_URL` data-URL worker bug is fixed in both.
 * - http_request / http_status_code are supplied by the SDK's HttpContext on the worker
 *   path (it overrides ours). http_headers is NOT supplied by HttpContext but IS imported
 *   by newer extism-pdk builds (e.g. dhis2-sink), so we provide it (0n = no response
 *   headers) on both paths so the module always links. On the foreground path our
 *   http_request stub throws loudly (no silent no-op) if egress is attempted.
 * - The 1.0.3 JS SDK exposes no memory-page/timeout option. The watchdog below bounds
 *   async overruns; on the worker path `plugin.close()` terminates the worker (a hard
 *   stop), on the foreground path it cannot interrupt a synchronous runaway.
 *
 * Crash capture: the SDK spawns its worker internally and does not expose the `Worker`
 * instance, so we cannot attach a direct `worker.on('error')` here. A worker that throws
 * *synchronously* surfaces as a rejected `plugin.call` (caught by the caller — a normal
 * failure, not a process crash); a worker that emits an uncaught async 'error' propagates to
 * the main thread and kills the process before any handler in this function can run. That
 * fatal case is captured out-of-band: every wasm call is stamped in the in-flight registry by
 * the call-path wrapper (`createWasmSink` / `createWasmConverter` via `@openldr/core` `beginOp`),
 * and apps/server's `uncaughtException` handler snapshots that registry into a durable crash
 * marker — so the marker names the plugin id + entrypoint that was running when the worker
 * took the process down.
 */
export function createExtismRunner(): PluginRunner {
  return {
    async run(wasm: Uint8Array, input: Uint8Array, opts: RunOptions): Promise<Uint8Array> {
      const readStr = (cp: CurrentPlugin, offset: bigint): string => {
        const block = cp.read(offset);
        return block ? block.text() : '';
      };

      // Egress requires the off-thread worker path — the only one that can perform HTTP.
      // No host pinned ⇒ stay in-process (ingest converters, sink dry-runs): faster, no egress.
      const useWorker = (opts.allowedHosts?.length ?? 0) > 0;

      const plugin = await createPlugin(
        { wasm: [{ data: wasm }] },
        {
          useWasi: opts.wasi,
          runInWorker: useWorker,
          config: opts.config ?? {},
          allowedHosts: opts.allowedHosts ?? [],
          functions: {
            'extism:host/env': {
              // On the worker path the SDK's HttpContext overrides http_request +
              // http_status_code with real implementations (it does NOT provide
              // http_headers). On the foreground path http_request throws if egress is
              // attempted — never a silent no-op. http_headers (0n = no response headers)
              // is always supplied so newer-extism-pdk modules link on both paths.
              http_request: (_cp: CurrentPlugin, _reqaddr: bigint, _bodyaddr: bigint): bigint => {
                throw new Error('http_request: egress is only available on the worker path (pin an allowedHost)');
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
