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
    install: vi.fn(async (r) => {
      rows = rows.filter((x) => !(x.id === r.id && x.version === r.version));
      rows.push({ ...r, status: 'installed', enabled: true, active: true });
    }),
    get: vi.fn(async (id, version) => rows.find((x) => x.id === id && (version ? x.version === version : x.active && x.enabled))),
    list: vi.fn(async () => rows),
    rollback: vi.fn(async (id, version) => {
      rows = rows.map((x) => x.id === id ? { ...x, active: x.version === version } : x);
    }),
    setEnabled: vi.fn(async (id, enabled) => {
      rows = rows.map((x) => x.id === id ? { ...x, enabled } : x);
    }),
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
  verifyConfig: { devAllowUnsigned: false },
});

describe('PluginRuntime', () => {
  it('install validates sha, writes blob + store', async () => {
    const blobMap = new Map<string, Uint8Array>();
    const store = fakeStore();
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger, ...defaultNewDeps() });
    const out = await rt.install(wasm, { id: 'demo', version: '0.1.0', wasmSha256: sha });
    expect(out.id).toBe('demo');
    expect(blobMap.has('plugins/demo/0.1.0/plugin.wasm')).toBe(true);
    expect(store.install).toHaveBeenCalled();
  });

  it('install rejects a sha mismatch', async () => {
    const rt = createPluginRuntime({ blob: fakeBlob(new Map()), store: fakeStore(), runner: okRunner, logger, ...defaultNewDeps() });
    await expect(rt.install(wasm, { id: 'demo', version: '0.1.0', wasmSha256: 'b'.repeat(64) })).rejects.toThrow(/does not match/);
  });

  it('load fetches, verifies sha, returns a Converter', async () => {
    const blobMap = new Map<string, Uint8Array>([['plugins/demo/0.1.0/plugin.wasm', wasm]]);
    const store = fakeStore([{ id: 'demo', version: '0.1.0', sha256: sha, manifest: fullManifest(), status: 'installed', enabled: true, active: true, approvedBy: null }]);
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
    const store = fakeStore([{ id: 'demo', version: '0.1.0', sha256: sha, manifest: fullManifest(), status: 'installed', enabled: true, active: true, approvedBy: null }]);
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger, ...defaultNewDeps() });
    await expect(rt.load('demo')).rejects.toThrow(/sha256 mismatch/);
  });
});

describe('install — artifact security pipeline', () => {
  const wasmBytes = new Uint8Array([0, 1, 2, 3]);
  const wasmSha = sha256Hex(wasmBytes);

  function fakeDeps() {
    const blobs = new Map<string, Uint8Array>();
    const rows = new Map<string, PluginRow>();
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
          install: async (r: { id: string; version: string; sha256: string; manifest: Record<string, unknown>; approvedBy: string | null }) => {
            rows.set(`${r.id}@${r.version}`, { ...r, status: 'installed', enabled: true, active: true });
          },
          get: async (id: string, v?: string) => rows.get(`${id}@${v}`) as PluginRow | undefined,
          list: async () => [...rows.values()] as PluginRow[],
          rollback: async () => {},
          setEnabled: async () => {},
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
    const rt = createPluginRuntime({ ...deps, trustStore, ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    const m = signedManifest(kp);
    await rt.install(wasmBytes, m, { publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities: m.capabilities } });
    expect(rows.get('demo@1.0.0')).toBeTruthy();
    expect(await trustStore.get('acme')).toEqual({ keyFingerprint: kp.fingerprint });
    expect((audit as Array<{ action: string }>).find((e) => e.action === 'marketplace.install')).toBeTruthy();
  });

  it('rejects a publisher-bearing manifest with no signature unless dev-override', async () => {
    const { deps } = fakeDeps();
    const kp = generatePublisherKeypair();
    const { signature: _drop, ...unsigned } = signedManifest(kp);
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    await expect(rt.install(wasmBytes, unsigned, { publicKeyDer: kp.publicKeyDer })).rejects.toThrow(/signature/i);
  });

  it('rejects on key mismatch with a pinned publisher', async () => {
    const { deps } = fakeDeps();
    const trustStore = inMemoryTrustStore();
    await trustStore.pin({ publisherId: 'acme', keyFingerprint: 'f'.repeat(64), publisherName: 'Acme', approvedBy: null });
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore, ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    await expect(rt.install(wasmBytes, signedManifest(kp), { publicKeyDer: kp.publicKeyDer })).rejects.toThrow(/key/i);
  });

  it('rejects an incompatible CE version', async () => {
    const { deps } = fakeDeps();
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.3.0', verifyConfig: { devAllowUnsigned: false } });
    await expect(rt.install(wasmBytes, signedManifest(kp), { publicKeyDer: kp.publicKeyDer })).rejects.toThrow(/compat/i);
  });

  it('verifies and installs a sparse manifest (no entrypoint/wasi/limits) — raw-vs-Zod-defaulted invariant', async () => {
    const { deps, rows } = fakeDeps();
    const trustStore = inMemoryTrustStore();
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore, ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    // Build a minimal manifest omitting optional payload fields (entrypoint, wasi, limits).
    const base = {
      schemaVersion: 1 as const, type: 'plugin' as const, id: 'sparse', version: '1.0.0',
      publisher: { id: 'acme', name: 'Acme', keyFingerprint: kp.fingerprint },
      compatibility: { ceVersion: '>=0.1.0 <0.2.0' },
      capabilities: [{ kind: 'emit-fhir' as const, resourceTypes: ['Observation'] }],
      payload: { kind: 'plugin' as const, wasmSha256: wasmSha },
    };
    // Sign the literal BEFORE Zod parse — canonical bytes must match what is signed.
    const signature = signManifest(base as Record<string, unknown>, wasmSha, kp.privateKeyDer);
    await rt.install(wasmBytes, { ...base, signature }, { publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities: base.capabilities } });
    expect(rows.get('sparse@1.0.0')).toBeTruthy();
    expect(await trustStore.get('acme')).toEqual({ keyFingerprint: kp.fingerprint });
  });

  it('installs a legacy unsigned plugin manifest (no publisher) hash-only', async () => {
    const { deps, rows } = fakeDeps();
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    const legacy = { id: 'whonet', version: '0.1.0', entrypoint: 'convert', wasmSha256: wasmSha, description: '', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } };
    await rt.install(wasmBytes, legacy);
    expect(rows.get('whonet@0.1.0')).toBeTruthy();
  });

  // ── Task 4: Consent tests ──────────────────────────────────────────────────

  it('requires approval for a publisher-bearing artifact', async () => {
    const { deps } = fakeDeps();
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    // No opts.approval -> reject
    await expect(rt.install(wasmBytes, signedManifest(kp), { publicKeyDer: kp.publicKeyDer })).rejects.toThrow(/approv/i);
  });

  it('installs with approval, persisting capabilities + approver', async () => {
    const { deps, rows } = fakeDeps();
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    const m = signedManifest(kp);
    await rt.install(wasmBytes, m, { publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities: m.capabilities } });
    const row = rows.get('demo@1.0.0');
    expect(row!.approvedBy).toBe('admin');
    expect((row!.manifest as Record<string, unknown>).capabilities).toEqual(m.capabilities);
  });

  it('rejects approval that does not match requested capabilities', async () => {
    const { deps } = fakeDeps();
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    await expect(
      rt.install(wasmBytes, signedManifest(kp), { publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities: [] } }),
    ).rejects.toThrow(/acknowledg/i);
  });

  it('legacy no-publisher manifest installs without approval (unrestricted)', async () => {
    const { deps, rows } = fakeDeps();
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    const legacy = { id: 'whonet', version: '0.1.0', entrypoint: 'convert', wasmSha256: wasmSha, description: '', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } };
    await rt.install(wasmBytes, legacy);
    expect(rows.get('whonet@0.1.0')).toBeTruthy();
  });

  // ── Task 5: Lifecycle tests ────────────────────────────────────────────────

  it('rollback + enable/disable delegate to the store and audit', async () => {
    const { deps, audit } = fakeDeps();
    const trustStore = inMemoryTrustStore();
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore, ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    const m = signedManifest(kp);
    await rt.install(wasmBytes, m, { publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities: m.capabilities } });
    await rt.setEnabled('demo', false, { actor: { id: 'admin', name: 'Admin' } });
    await rt.rollback('demo', '1.0.0', { actor: { id: 'admin', name: 'Admin' } });
    expect(audit.find((e) => (e as { action: string }).action === 'marketplace.disable')).toBeTruthy();
    expect(audit.find((e) => (e as { action: string }).action === 'marketplace.rollback')).toBeTruthy();
  });
});
