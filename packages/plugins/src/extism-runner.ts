import createPlugin from '@extism/extism';
import type { CurrentPlugin } from '@extism/extism';
import type { PluginRunner, RunOptions } from './runner';

/**
 * Real Extism-backed runner (@extism/extism@1.0.3).
 *
 * Sandbox notes:
 * - Isolation is default-deny: `allowedPaths`/`allowedHosts` are left unset, so
 *   the plugin gets no host filesystem or network access. WASI is opt-in per plugin.
 * - `runInWorker` is left false: the 1.0.3 worker path bootstraps from an inline
 *   data: URL whose bundle references a relative `worker.js.map`, which Node cannot
 *   resolve (ERR_INVALID_URL) — a known SDK bug. Running in-process avoids it.
 * - The 1.0.3 JS SDK exposes no memory-page or timeout option. The watchdog below
 *   bounds async overruns, but without a worker it cannot interrupt a synchronous
 *   runaway; hard memory + timeout enforcement awaits a newer SDK (tracked as a
 *   follow-up). `opts.memoryMb` is recorded in the manifest but not enforced here.
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
          functions: {
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
