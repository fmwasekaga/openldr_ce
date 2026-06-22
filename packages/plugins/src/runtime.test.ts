import { describe, it, expect, vi } from 'vitest';
import { createPluginRuntime } from './runtime';
import { sha256Hex } from './hash';
import type { PluginStore, PluginRow } from './store';
import type { PluginRunner } from './runner';
import { generatePublisherKeypair, signManifest, createTrustStore } from '@openldr/marketplace';

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

function inMemoryTrustStore() {
  const m = new Map<string, { keyFingerprint: string }>();
  return {
    get: async (id: string) => m.get(id),
    pin: async (i: { publisherId: string; keyFingerprint: string; publisherName: string; approvedBy: string | null }) => {
      m.set(i.publisherId, { keyFingerprint: i.keyFingerprint });
    },
  };
}

const defaultNewDeps = () => ({
  trustStore: inMemoryTrustStore(),
  ceVersion: '0.1.0',
  verifyConfig: { devAllowUnsigned: false, autoPinFirstUse: true },
});

describe('PluginRuntime', () => {
  it('install validates sha, writes blob + store', async () => {
    const blobMap = new Map<string, Uint8Array>();
    const store = fakeStore();
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger, ...defaultNewDeps() });
    const out = await rt.install(wasm, { id: 'demo', version: '0.1.0', wasmSha256: sha });
    expect(out.id).toBe('demo');
    expect(blobMap.has('plugins/demo/0.1.0/plugin.wasm')).toBe(true);
    expect(store.upsert).toHaveBeenCalled();
  });

  it('install rejects a sha mismatch', async () => {
    const rt = createPluginRuntime({ blob: fakeBlob(new Map()), store: fakeStore(), runner: okRunner, logger, ...defaultNewDeps() });
    await expect(rt.install(wasm, { id: 'demo', version: '0.1.0', wasmSha256: 'b'.repeat(64) })).rejects.toThrow(/does not match/);
  });

  it('load fetches, verifies sha, returns a Converter', async () => {
    const blobMap = new Map<string, Uint8Array>([['plugins/demo/0.1.0/plugin.wasm', wasm]]);
    const store = fakeStore([{ id: 'demo', version: '0.1.0', sha256: sha, manifest: fullManifest(), status: 'installed' }]);
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger, ...defaultNewDeps() });
    const c = await rt.load('demo');
    expect(c?.id).toBe('demo');
    const resources = await c!.convert(enc('in'), { batchId: 'b' });
    expect(resources[0].resourceType).toBe('Patient');
  });

  it('load returns undefined for an unknown plugin', async () => {
    const rt = createPluginRuntime({ blob: fakeBlob(new Map()), store: fakeStore(), runner: okRunner, logger, ...defaultNewDeps() });
    expect(await rt.load('nope')).toBeUndefined();
  });

  it('load throws on a blob sha mismatch', async () => {
    const blobMap = new Map<string, Uint8Array>([['plugins/demo/0.1.0/plugin.wasm', enc('tampered')]]);
    const store = fakeStore([{ id: 'demo', version: '0.1.0', sha256: sha, manifest: fullManifest(), status: 'installed' }]);
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger, ...defaultNewDeps() });
    await expect(rt.load('demo')).rejects.toThrow(/sha256 mismatch/);
  });
});

describe('install — artifact security pipeline', () => {
  const wasmBytes = new Uint8Array([0, 1, 2, 3]);
  const wasmSha = sha256Hex(wasmBytes);

  function fakeDeps() {
    const blobs = new Map<string, Uint8Array>();
    const rows = new Map<string, unknown>();
    const audit: unknown[] = [];
    return {
      audit,
      rows,
      deps: {
        blob: {
          put: async (k: string, b: Uint8Array) => { blobs.set(k, b); },
          get: async (k: string) => blobs.get(k)!,
          delete: async (k: string) => { blobs.delete(k); },
        } as never,
        store: {
          upsert: async (r: PluginRow) => { rows.set(`${r.id}@${r.version}`, { ...r, status: 'installed' }); },
          get: async (id: string, v?: string) => rows.get(`${id}@${v}`) as PluginRow | undefined,
          list: async () => [...rows.values()] as PluginRow[],
          remove: async () => {},
        } as PluginStore,
        runner: {} as PluginRunner,
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } as never,
        recordInstall: async (e: unknown) => { audit.push(e); },
      },
    };
  }

  function signedManifest(kp: ReturnType<typeof generatePublisherKeypair>) {
    const base = {
      schemaVersion: 1 as const, type: 'plugin' as const, id: 'demo', version: '1.0.0',
      publisher: { id: 'acme', name: 'Acme', keyFingerprint: kp.fingerprint },
      compatibility: { ceVersion: '>=0.1.0 <0.2.0' },
      capabilities: [{ kind: 'emit-fhir' as const, resourceTypes: ['Observation'] }],
      payload: { kind: 'plugin' as const, wasmSha256: wasmSha, entrypoint: 'convert', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } },
    };
    return { ...base, signature: signManifest(base as Record<string, unknown>, wasmSha, kp.privateKeyDer) };
  }

  it('installs a valid signed artifact, pins the publisher, and audits', async () => {
    const { deps, rows, audit } = fakeDeps();
    const trustStore = inMemoryTrustStore();
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore, ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false, autoPinFirstUse: true } });
    await rt.install(wasmBytes, signedManifest(kp), { publicKeyDer: kp.publicKeyDer, actor: { id: 'admin', name: 'Admin' } });
    expect(rows.get('demo@1.0.0')).toBeTruthy();
    expect(await trustStore.get('acme')).toEqual({ keyFingerprint: kp.fingerprint });
    expect((audit as Array<{ action: string }>).find((e) => e.action === 'marketplace.install')).toBeTruthy();
  });

  it('rejects a publisher-bearing manifest with no signature unless dev-override', async () => {
    const { deps } = fakeDeps();
    const kp = generatePublisherKeypair();
    const { signature: _drop, ...unsigned } = signedManifest(kp);
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false, autoPinFirstUse: true } });
    await expect(rt.install(wasmBytes, unsigned, { publicKeyDer: kp.publicKeyDer })).rejects.toThrow(/signature/i);
  });

  it('rejects on key mismatch with a pinned publisher', async () => {
    const { deps } = fakeDeps();
    const trustStore = inMemoryTrustStore();
    await trustStore.pin({ publisherId: 'acme', keyFingerprint: 'f'.repeat(64), publisherName: 'Acme', approvedBy: null });
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore, ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false, autoPinFirstUse: true } });
    await expect(rt.install(wasmBytes, signedManifest(kp), { publicKeyDer: kp.publicKeyDer })).rejects.toThrow(/key/i);
  });

  it('rejects an incompatible CE version', async () => {
    const { deps } = fakeDeps();
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.3.0', verifyConfig: { devAllowUnsigned: false, autoPinFirstUse: true } });
    await expect(rt.install(wasmBytes, signedManifest(kp), { publicKeyDer: kp.publicKeyDer })).rejects.toThrow(/compat/i);
  });

  it('installs a legacy unsigned plugin manifest (no publisher) hash-only', async () => {
    const { deps, rows } = fakeDeps();
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false, autoPinFirstUse: true } });
    const legacy = { id: 'whonet', version: '0.1.0', entrypoint: 'convert', wasmSha256: wasmSha, description: '', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } };
    await rt.install(wasmBytes, legacy);
    expect(rows.get('whonet@0.1.0')).toBeTruthy();
  });
});
