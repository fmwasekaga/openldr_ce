import type { Logger } from '@openldr/core';
import { validateResource, type FhirResource } from '@openldr/fhir';
import type { Converter, ConvertContext } from '@openldr/ingest';
import type { PluginManifest } from './manifest';
import type { PluginRunner, RunnerHostFns } from './runner';

const decoder = new TextDecoder();

function parseNdjson(bytes: Uint8Array): FhirResource[] {
  const text = decoder.decode(bytes);
  const out: FhirResource[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed: unknown = JSON.parse(trimmed);
    const result = validateResource(parsed);
    if (!result.ok) {
      const first = result.outcome.issue[0];
      throw new Error(`plugin emitted invalid FHIR: ${first?.diagnostics ?? 'validation failed'}`);
    }
    out.push(result.resource);
  }
  return out;
}

export function createWasmConverter(
  manifest: PluginManifest,
  wasm: Uint8Array,
  runner: PluginRunner,
  logger: Logger,
): Converter {
  const host: RunnerHostFns = {
    log(level, msg) {
      const fn = (logger as unknown as Record<string, (o: unknown, m?: string) => void>)[level] ?? logger.info;
      fn.call(logger, { plugin: manifest.id }, msg);
    },
    progress(done, total) {
      logger.debug({ plugin: manifest.id, done, total }, 'plugin progress');
    },
  };
  return {
    id: manifest.id,
    version: manifest.version,
    async convert(raw: Uint8Array, ctx: ConvertContext): Promise<FhirResource[]> {
      const out = await runner.run(wasm, raw, {
        entrypoint: manifest.entrypoint,
        wasi: manifest.wasi,
        memoryMb: manifest.limits.memoryMb,
        timeoutMs: manifest.limits.timeoutMs,
        config: ctx.config,
        host,
      });
      return parseNdjson(out);
    },
  };
}
