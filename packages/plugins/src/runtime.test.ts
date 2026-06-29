import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { createPluginRuntime } from './runtime';
import { sha256Hex } from './hash';
import type { PluginStore, PluginRow } from './store';
import type { PluginRunner } from './runner';
import { generatePublisherKeypair, signManifest, createTrustStore, pluginManifestToArtifact } from '@openldr/marketplace';
import { parseManifest } from './manifest';

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() } as never;
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

  it('accepts approval where acknowledged capabilities have the same values but different key insertion order', async () => {
    const { deps, rows } = fakeDeps();
    const kp = generatePublisherKeypair();
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    const m = signedManifest(kp);
    // artifact has { kind: 'emit-fhir', resourceTypes: ['Observation'] }; acknowledge with keys in different insertion order
    const acknowledgedCapabilities = [{ resourceTypes: ['Observation'], kind: 'emit-fhir' as const }];
    await rt.install(wasmBytes, m, { publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities } });
    expect(rows.get('demo@1.0.0')).toBeTruthy();
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

// ── Task 7: runtime enforcement integration ────────────────────────────────────

describe('runtime load() — emit-fhir enforcement', () => {
  const wasmBytes2 = new Uint8Array([0, 1, 2, 3]);
  const wasmSha2 = sha256Hex(wasmBytes2);
  const enc2 = (s: string) => new TextEncoder().encode(s);

  function fakeDeps2(runnerOutput: string) {
    const blobs = new Map<string, Uint8Array>();
    const rows = new Map<string, PluginRow>();
    const fakeRunner: PluginRunner = { run: vi.fn(async () => enc2(runnerOutput)) };
    return {
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
        runner: fakeRunner,
        logger: { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} } as never,
      },
      fakeRunner,
    };
  }

  function signedManifestNarrow(kp: ReturnType<typeof generatePublisherKeypair>) {
    const base = {
      schemaVersion: 1 as const, type: 'plugin' as const, id: 'demo', version: '1.0.0',
      publisher: { id: 'acme', name: 'Acme', keyFingerprint: kp.fingerprint },
      compatibility: { ceVersion: '>=0.1.0 <0.2.0' },
      capabilities: [{ kind: 'emit-fhir' as const, resourceTypes: ['Patient'] }],
      payload: { kind: 'plugin' as const, wasmSha256: wasmSha2, entrypoint: 'convert', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } },
    };
    return { ...base, signature: signManifest(base as Record<string, unknown>, wasmSha2, kp.privateKeyDer) };
  }

  it('load().convert() rejects when the runner emits a resourceType outside the emit-fhir grant', async () => {
    const kp = generatePublisherKeypair();
    const { deps } = fakeDeps2('{"resourceType":"Observation","id":"o1","status":"final","code":{"text":"x"}}\n');
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    const m = signedManifestNarrow(kp);
    await rt.install(wasmBytes2, m, { publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities: m.capabilities } });
    const converter = await rt.load('demo', '1.0.0');
    expect(converter).toBeDefined();
    await expect(converter!.convert(new Uint8Array(), { batchId: 'test' })).rejects.toThrow(/capability|not permitted|Observation/i);
  });

  it('load().convert() succeeds when the runner emits a resourceType inside the emit-fhir grant', async () => {
    const kp = generatePublisherKeypair();
    const { deps } = fakeDeps2('{"resourceType":"Patient","id":"p1"}\n');
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    const m = signedManifestNarrow(kp);
    await rt.install(wasmBytes2, m, { publicKeyDer: kp.publicKeyDer, approval: { approvedBy: 'admin', acknowledgedCapabilities: m.capabilities } });
    const converter = await rt.load('demo', '1.0.0');
    const resources = await converter!.convert(new Uint8Array(), { batchId: 'test' });
    expect(resources[0].resourceType).toBe('Patient');
  });

  // ── Regression for f48b571 ──────────────────────────────────────────────────
  // A flat *legacy* manifest (no publisher/signature) that declares emit-fhir
  // capabilities must yield an ENFORCED grant after install. Before the fix,
  // pluginManifestToArtifact() dropped the declared array, so install persisted an
  // empty emit-fhir grant and load().convert() fail-closed rejected every resource
  // the plugin emitted (this is what broke whonet ingestion + `pnpm e2e:seed`).
  //
  // Contract note — "declare-or-denied" (the intended, security-preferred posture):
  // the install path force-normalizes EVERY manifest into an ArtifactManifest, whose
  // `capabilities` defaults to []. So a freshly installed row ALWAYS carries a
  // capabilities array; readGrant() therefore returns { legacy:false } for it and the
  // grant is enforced. A capability-LESS legacy manifest persists [] ⇒ an enforced
  // empty grant (emits nothing), NOT unrestricted. readGrant()'s legacy/unrestricted
  // branch only fires for genuinely pre-capability rows that were persisted without the
  // field at all (grandfathered). The two declared types below must pass and the
  // undeclared type must be rejected.
  const legacyWithCaps = {
    id: 'whonet-sqlite', version: '0.1.0', entrypoint: 'convert', wasmSha256: wasmSha2,
    description: '', license: 'MIT', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient', 'Specimen', 'Observation'] }],
  };

  it('install(legacy manifest with emit-fhir caps) ⇒ enforced grant permits exactly the declared types', async () => {
    const { deps } = fakeDeps2(
      '{"resourceType":"Patient","id":"p1"}\n{"resourceType":"Specimen","id":"s1"}\n{"resourceType":"Observation","id":"o1","status":"final","code":{"text":"x"}}\n',
    );
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    await rt.install(wasmBytes2, legacyWithCaps); // legacy ⇒ no publisher ⇒ no signature/approval required
    const converter = await rt.load('whonet-sqlite', '0.1.0');
    const resources = await converter!.convert(new Uint8Array(), { batchId: 'test' });
    expect(resources.map((r) => r.resourceType)).toEqual(['Patient', 'Specimen', 'Observation']);
  });

  it('install(legacy manifest with emit-fhir caps) ⇒ enforced grant rejects an undeclared type', async () => {
    const { deps } = fakeDeps2('{"resourceType":"Organization","id":"org1","name":"Lab"}\n');
    const rt = createPluginRuntime({ ...deps, trustStore: inMemoryTrustStore(), ceVersion: '0.1.0', verifyConfig: { devAllowUnsigned: false } });
    await rt.install(wasmBytes2, legacyWithCaps);
    const converter = await rt.load('whonet-sqlite', '0.1.0');
    await expect(converter!.convert(new Uint8Array(), { batchId: 'test' })).rejects.toThrow(/not permitted|capability|Organization/i);
  });
});

describe('workflowNodes survive the manifest round-trip', () => {
  it('legacy manifest → artifact payload → legacy manifest preserves workflowNodes', () => {
    const node = {
      id: 'src', label: 'Src', kind: 'source', entrypoint: 'convert',
      ports: { inputs: [], outputs: [{ name: 'out' }] }, capabilities: [],
    };
    const artifact = pluginManifestToArtifact({
      id: 'p', version: '1.0.0', wasmSha256: 'a'.repeat(64), workflowNodes: [node],
    });
    const payload = artifact.payload as { wasmSha256: string; workflowNodes?: { id: string }[] };
    expect(payload.workflowNodes![0].id).toBe('src');

    // Re-derive the flat manifest the way runtime.ts does for the install return value.
    const flat = parseManifest({
      id: artifact.id, version: artifact.version, wasmSha256: payload.wasmSha256,
      workflowNodes: payload.workflowNodes,
    });
    expect(flat.workflowNodes).toHaveLength(1);
  });
});

describe('loadSink', () => {
  const sinkWasm = new TextEncoder().encode('\0asm sink bytes');
  const sinkSha = sha256Hex(sinkWasm);
  const sinkRow: PluginRow = {
    id: 'dhis2-sink', version: '0.1.0', sha256: sinkSha,
    manifest: {
      id: 'dhis2-sink', version: '0.1.0', kind: 'sink', entrypoint: 'convert',
      entrypoints: ['health_check', 'push_aggregate'], wasmSha256: sinkSha,
      description: '', license: 'x', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 },
      capabilities: [{ kind: 'net-egress', allowedHosts: [] }],
    },
    status: 'installed', enabled: true, active: true, approvedBy: null,
  };

  it('loads a sink and invoke() round-trips JSON through the runner', async () => {
    const blobMap = new Map<string, Uint8Array>([['plugins/dhis2-sink/0.1.0/plugin.wasm', sinkWasm]]);
    const store = fakeStore([sinkRow]);
    const runner: PluginRunner = { run: vi.fn(async () => enc('{"ok":true}')) };
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner, logger, ...defaultNewDeps() });
    const sink = await rt.loadSink('dhis2-sink');
    expect(sink?.id).toBe('dhis2-sink');
    expect(sink?.entrypoints).toEqual(['health_check', 'push_aggregate']);
    expect(await sink!.invoke('health_check', {})).toEqual({ ok: true });
  });

  it('returns undefined for an unknown sink', async () => {
    const rt = createPluginRuntime({ blob: fakeBlob(new Map()), store: fakeStore(), runner: okRunner, logger, ...defaultNewDeps() });
    expect(await rt.loadSink('nope')).toBeUndefined();
  });

  it('throws when loadSink targets a source plugin with no entrypoints (without fetching its wasm)', async () => {
    const store = fakeStore([{ id: 'demo', version: '0.1.0', sha256: sha, manifest: fullManifest(), status: 'installed', enabled: true, active: true, approvedBy: null }]);
    const blob = fakeBlob(new Map());
    const rt = createPluginRuntime({ blob, store, runner: okRunner, logger, ...defaultNewDeps() });
    await expect(rt.loadSink('demo')).rejects.toThrow(/not invokable/);
    // The kind/entrypoint check must precede the blob fetch, so a non-invokable plugin is rejected without I/O.
    expect(((blob as any).get).mock.calls.length).toBe(0);
  });

  it('loadSink loads a source plugin that exposes named entrypoints', async () => {
    const convWasm = new TextEncoder().encode('\0asm convert bytes');
    const convSha = sha256Hex(convWasm);
    const sourceRow: PluginRow = {
      id: 'whonet-sqlite', version: '0.1.0', sha256: convSha,
      manifest: {
        id: 'whonet-sqlite', version: '0.1.0', kind: 'source', entrypoint: 'convert',
        entrypoints: ['wf_convert'], wasmSha256: convSha,
        description: '', license: 'x', wasi: true, limits: { memoryMb: 256, timeoutMs: 30000 },
      },
      status: 'installed', enabled: true, active: true, approvedBy: null,
    };
    const blobMap = new Map<string, Uint8Array>([['plugins/whonet-sqlite/0.1.0/plugin.wasm', convWasm]]);
    const store = fakeStore([sourceRow]);
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger, ...defaultNewDeps() });
    const sink = await rt.loadSink('whonet-sqlite');
    expect(sink).toBeDefined();
    expect(sink!.entrypoints).toContain('wf_convert');
  });

  it('caches the loaded sink (one blob fetch across two loads)', async () => {
    const blobMap = new Map<string, Uint8Array>([['plugins/dhis2-sink/0.1.0/plugin.wasm', sinkWasm]]);
    const blob = fakeBlob(blobMap);
    const store = fakeStore([sinkRow]);
    const rt = createPluginRuntime({ blob, store, runner: okRunner, logger, ...defaultNewDeps() });
    await rt.loadSink('dhis2-sink');
    await rt.loadSink('dhis2-sink');
    expect(((blob as any).get).mock.calls.length).toBe(1);
  });
});

// ── Task 4: ui install + loadUi ──────────────────────────────────────────────

describe('runtime ui install', () => {
  it('persists ui.html to blob and serves it via loadUi', async () => {
    const blobMap = new Map<string, Uint8Array>();
    const store = fakeStore();
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger, ...defaultNewDeps() });
    const wasmBytes = new Uint8Array([1, 2, 3]);
    const ui = new TextEncoder().encode('<div>panel</div>');
    const manifest = pluginManifestToArtifact({
      id: 'ui-demo', version: '1.0.0', kind: 'sink', entrypoints: ['echo'],
      wasmSha256: createHash('sha256').update(wasmBytes).digest('hex'),
      capabilities: [],
      ui: { entry: 'ui.html', sha256: createHash('sha256').update(ui).digest('hex'), nav: { label: 'Demo' } },
    });
    await rt.install(wasmBytes, manifest, { ui });
    const served = await rt.loadUi('ui-demo');
    expect(new TextDecoder().decode(served!)).toBe('<div>panel</div>');
  });

  it('rejects install when ui bytes do not match the manifest sha', async () => {
    const blobMap = new Map<string, Uint8Array>();
    const store = fakeStore();
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store, runner: okRunner, logger, ...defaultNewDeps() });
    const wasmBytes = new Uint8Array([1, 2, 3]);
    const ui = new TextEncoder().encode('<div>panel</div>');
    const manifest = pluginManifestToArtifact({
      id: 'ui-demo', version: '1.0.0', kind: 'sink', entrypoints: ['echo'],
      wasmSha256: createHash('sha256').update(wasmBytes).digest('hex'),
      capabilities: [],
      ui: { entry: 'ui.html', sha256: 'f'.repeat(64), nav: { label: 'Demo' } },
    });
    await expect(rt.install(wasmBytes, manifest, { ui })).rejects.toThrow(/ui/i);
  });

  // SEC-11: loadUi must re-hash the stored bytes against the signed manifest sha and fail closed on tamper.
  it('loadUi serves the bytes when their sha matches the manifest ui.sha256', async () => {
    const ui = new TextEncoder().encode('<div>panel</div>');
    const uiSha = sha256Hex(ui);
    const row: PluginRow = {
      id: 'ui-demo', version: '1.0.0', sha256: sha,
      manifest: { id: 'ui-demo', version: '1.0.0', schemaVersion: 1, payload: { kind: 'plugin', ui: { entry: 'ui.html', sha256: uiSha } } },
      status: 'installed', enabled: true, active: true, approvedBy: null,
    };
    const blobMap = new Map<string, Uint8Array>([['plugins/ui-demo/1.0.0/ui.html', ui]]);
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store: fakeStore([row]), runner: okRunner, logger, ...defaultNewDeps() });
    const served = await rt.loadUi('ui-demo');
    expect(new TextDecoder().decode(served!)).toBe('<div>panel</div>');
  });

  it('loadUi fails closed (returns undefined + warns) when stored ui bytes do NOT match the manifest sha', async () => {
    (logger as unknown as { warn: ReturnType<typeof vi.fn> }).warn.mockClear();
    const declared = new TextEncoder().encode('<div>panel</div>');
    const declaredSha = sha256Hex(declared);
    const tampered = new TextEncoder().encode('<script>evil()</script>'); // different bytes than the manifest declares
    const row: PluginRow = {
      id: 'ui-demo', version: '1.0.0', sha256: sha,
      manifest: { id: 'ui-demo', version: '1.0.0', schemaVersion: 1, payload: { kind: 'plugin', ui: { entry: 'ui.html', sha256: declaredSha } } },
      status: 'installed', enabled: true, active: true, approvedBy: null,
    };
    const blobMap = new Map<string, Uint8Array>([['plugins/ui-demo/1.0.0/ui.html', tampered]]);
    const rt = createPluginRuntime({ blob: fakeBlob(blobMap), store: fakeStore([row]), runner: okRunner, logger, ...defaultNewDeps() });
    const served = await rt.loadUi('ui-demo');
    expect(served).toBeUndefined();
    expect((logger as unknown as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalled();
  });
});
