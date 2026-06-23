import type { Logger } from '@openldr/core';
import type { Capability } from '@openldr/marketplace';
import type { PluginManifest } from './manifest';
import type { PluginRunner, RunnerHostFns } from './runner';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export interface SinkInvokeOptions {
  /** Extism config map — the per-call connection/secrets (e.g. baseUrl, username, password). */
  config?: Record<string, string>;
  /** Concrete egress host(s) the connector pins for this call, e.g. ['dhis2.example.org:443'].
   *  Omit/empty for a dry-run (no network). */
  allowedHosts?: string[];
}

/** A loaded sink plugin: invoke one of its named entrypoints with a JSON request,
 *  get back the parsed JSON response. Mirrors `Converter` for sinks. */
export interface WasmSink {
  id: string;
  version: string;
  entrypoints: string[];
  invoke(entrypoint: string, input: unknown, opts?: SinkInvokeOptions): Promise<unknown>;
}

export function createWasmSink(
  manifest: PluginManifest,
  wasm: Uint8Array,
  runner: PluginRunner,
  logger: Logger,
  grant?: Capability[],
): WasmSink {
  const host: RunnerHostFns = {
    log(level, msg) {
      const fn = (logger as unknown as Record<string, (o: unknown, m?: string) => void>)[level] ?? logger.info;
      fn.call(logger, { plugin: manifest.id }, msg);
    },
    progress(done, total) {
      logger.debug({ plugin: manifest.id, done, total }, 'sink progress');
    },
  };
  // `grant === undefined` = a genuinely pre-capability (grandfathered) row -> unrestricted.
  // Any installed sink carries a grant array, so egress is gated on the net-egress capability.
  const enforced = grant !== undefined;
  const hasNetEgress = enforced && grant.some((c) => c.kind === 'net-egress');

  return {
    id: manifest.id,
    version: manifest.version,
    entrypoints: manifest.entrypoints,
    async invoke(entrypoint: string, input: unknown, opts: SinkInvokeOptions = {}): Promise<unknown> {
      if (!manifest.entrypoints.includes(entrypoint)) {
        throw new Error(
          `sink ${manifest.id}: unknown entrypoint '${entrypoint}' (declared: ${manifest.entrypoints.join(', ') || 'none'})`,
        );
      }
      // Egress model (deliberately differs from the converter): the connector pins the
      // CONCRETE host at runtime via opts.allowedHosts — trusted host-side config from the
      // resolved connector. The plugin's net-egress capability is an INTENT/presence gate
      // only; its declared allowedHosts list is usually empty ("host decides"), so we must
      // NOT replace opts.allowedHosts with allowedHosts(grant) (that would pin [] = deny-all
      // and break every real push). Extism enforces that only the pinned host is reachable.
      // Fail-closed: a host may only be pinned if the plugin declared net-egress intent.
      if (opts.allowedHosts && opts.allowedHosts.length > 0 && enforced && !hasNetEgress) {
        throw new Error(
          `sink ${manifest.id}: egress to ${opts.allowedHosts.join(', ')} requested but the plugin has no net-egress capability`,
        );
      }
      const out = await runner.run(wasm, encoder.encode(JSON.stringify(input ?? {})), {
        entrypoint,
        wasi: manifest.wasi,
        memoryMb: manifest.limits.memoryMb,
        timeoutMs: manifest.limits.timeoutMs,
        config: opts.config,
        host,
        allowedHosts: opts.allowedHosts,
      });
      const text = decoder.decode(out).trim();
      if (!text) return {};
      try {
        return JSON.parse(text) as unknown;
      } catch (err) {
        throw new Error(
          `sink ${manifest.id} entrypoint '${entrypoint}' returned invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
