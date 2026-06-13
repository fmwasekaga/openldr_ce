import { describe, it, expect, vi } from 'vitest';
import { createPluginRuntime } from './runtime';
import { sha256Hex } from './hash';
import type { PluginStore, PluginRow } from './store';
import type { PluginRunner } from './runner';

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
const wasm = new TextEncoder().encode('\0asm fake bytes');
const sha = sha256Hex(wasm);
const enc = (s: string) => new TextEncoder().encode(s);

const fullManifest = (over: Partial<PluginRow['manifest']> = {}) => ({
  id: 'demo', version: '0.1.0', entrypoint: 'convert', wasmSha256: sha, description: '', license: 'x', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 }, ...over,
});

function fakeStore(initial: PluginRow[] = []): PluginStore {
  let rows = [...initial];
  return {
    upsert: vi.fn(async (r) => {
      rows = rows.filter((x) => !(x.id === r.id && x.version === r.version));
      rows.push({ ...r, status: 'installed' });
    }),
    get: vi.fn(async (id, version) => rows.find((x) => x.id === id && (version ? x.version === version : true))),
    list: vi.fn(async () => rows),
    remove: vi.fn(async (id, version) => {
      rows = rows.filter((x) => !(x.id === id && (version ? x.version === version : true)));
    }),
  };
}

function fakeBlob(map: Map<string, Uint8Array>) {
  return {
    put: vi.fn(async (k: string, b: Uint8Array) => { map.set(k, b); }),
    get: vi.fn(async (k: string) => { const v = map.get(k); if (!v) throw new Error('missing blob'); return v; }),
    exists: vi.fn(), presign: vi.fn(), healthCheck: vi.fn(),
  } as never;
}

const okRunner: PluginRunner = { run: vi.fn(async () => enc('{"resourceType":"Patient","id":"p1"}\n')) };

describe('PluginRuntime', () => {
  it('install validates sha, writes blob + store', async () => {
    const blobMap = new Map<string, Uint8Array>();
    const store = fakeStore();
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger });
    const out = await rt.install(wasm, { id: 'demo', version: '0.1.0', wasmSha256: sha });
    expect(out.id).toBe('demo');
    expect(blobMap.has('plugins/demo/0.1.0/plugin.wasm')).toBe(true);
    expect(store.upsert).toHaveBeenCalled();
  });

  it('install rejects a sha mismatch', async () => {
    const rt = createPluginRuntime({ blob: fakeBlob(new Map()), store: fakeStore(), runner: okRunner, logger });
    await expect(rt.install(wasm, { id: 'demo', version: '0.1.0', wasmSha256: 'b'.repeat(64) })).rejects.toThrow(/does not match/);
  });

  it('load fetches, verifies sha, returns a Converter', async () => {
    const blobMap = new Map<string, Uint8Array>([['plugins/demo/0.1.0/plugin.wasm', wasm]]);
    const store = fakeStore([{ id: 'demo', version: '0.1.0', sha256: sha, manifest: fullManifest(), status: 'installed' }]);
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger });
    const c = await rt.load('demo');
    expect(c?.id).toBe('demo');
    const resources = await c!.convert(enc('in'), { batchId: 'b' });
    expect(resources[0].resourceType).toBe('Patient');
  });

  it('load returns undefined for an unknown plugin', async () => {
    const rt = createPluginRuntime({ blob: fakeBlob(new Map()), store: fakeStore(), runner: okRunner, logger });
    expect(await rt.load('nope')).toBeUndefined();
  });

  it('load throws on a blob sha mismatch', async () => {
    const blobMap = new Map<string, Uint8Array>([['plugins/demo/0.1.0/plugin.wasm', enc('tampered')]]);
    const store = fakeStore([{ id: 'demo', version: '0.1.0', sha256: sha, manifest: fullManifest(), status: 'installed' }]);
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger });
    await expect(rt.load('demo')).rejects.toThrow(/sha256 mismatch/);
  });
});
