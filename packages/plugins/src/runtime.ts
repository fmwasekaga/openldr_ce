import type { Logger } from '@openldr/core';
import type { BlobStoragePort } from '@openldr/ports';
import type { Converter } from '@openldr/ingest';
import { parseManifest, type PluginManifest } from './manifest';
import { sha256Hex } from './hash';
import type { PluginStore, PluginRow } from './store';
import type { PluginRunner } from './runner';
import { createWasmConverter } from './wasm-converter';

export interface PluginRuntimeDeps {
  blob: BlobStoragePort;
  store: PluginStore;
  runner: PluginRunner;
  logger: Logger;
}

export interface PluginRuntime {
  install(wasm: Uint8Array, rawManifest: unknown): Promise<PluginManifest>;
  list(): Promise<PluginRow[]>;
  test(id: string, version?: string): Promise<{ ok: boolean; error?: string }>;
  remove(id: string, version?: string): Promise<void>;
  load(id: string, version?: string): Promise<Converter | undefined>;
}

function wasmKey(id: string, version: string): string {
  return `plugins/${id}/${version}/plugin.wasm`;
}
function manifestKey(id: string, version: string): string {
  return `plugins/${id}/${version}/manifest.json`;
}

export function createPluginRuntime(deps: PluginRuntimeDeps): PluginRuntime {
  const cache = new Map<string, Converter>();

  async function loadWasm(row: PluginRow): Promise<Uint8Array> {
    const wasm = await deps.blob.get(wasmKey(row.id, row.version));
    const actual = sha256Hex(wasm);
    if (actual !== row.sha256) {
      throw new Error(`plugin ${row.id}@${row.version} sha256 mismatch (expected ${row.sha256}, got ${actual})`);
    }
    return wasm;
  }

  async function load(id: string, version?: string): Promise<Converter | undefined> {
    const row = await deps.store.get(id, version);
    if (!row) return undefined;
    const key = `${row.id}@${row.version}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const wasm = await loadWasm(row);
    const converter = createWasmConverter(row.manifest, wasm, deps.runner, deps.logger);
    cache.set(key, converter);
    return converter;
  }

  return {
    async install(wasm, rawManifest) {
      const manifest = parseManifest(rawManifest);
      const actual = sha256Hex(wasm);
      if (actual !== manifest.wasmSha256) {
        throw new Error(`manifest wasmSha256 (${manifest.wasmSha256}) does not match the wasm (${actual})`);
      }
      await deps.blob.put(wasmKey(manifest.id, manifest.version), wasm, 'application/wasm');
      await deps.blob.put(manifestKey(manifest.id, manifest.version), new TextEncoder().encode(JSON.stringify(manifest)), 'application/json');
      await deps.store.upsert({ id: manifest.id, version: manifest.version, sha256: actual, manifest });
      cache.delete(`${manifest.id}@${manifest.version}`);
      deps.logger.info({ id: manifest.id, version: manifest.version }, 'plugin installed');
      return manifest;
    },
    list: () => deps.store.list(),
    async test(id, version) {
      try {
        const c = await load(id, version);
        if (!c) return { ok: false, error: 'plugin not installed' };
        await c.convert(new Uint8Array(), { batchId: 'plugin-test' });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    remove: (id, version) => deps.store.remove(id, version),
    load,
  };
}
