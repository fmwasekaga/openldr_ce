import { describe, it, expect, vi } from 'vitest';
import { handleIngestEvent, chainResolvers, registryResolver, ConverterRegistry } from '@openldr/ingest';
import type { BatchStore } from '@openldr/ingest';
import { createPluginRuntime } from './runtime';
import { sha256Hex } from './hash';
import type { PluginRow, PluginStore } from './store';
import type { PluginRunner } from './runner';

const logger = { info: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;
const enc = (s: string) => new TextEncoder().encode(s);
const wasm = enc('fake-wasm');
const sha = sha256Hex(wasm);

const row: PluginRow = {
  id: 'whonet-sqlite', version: '0.1.0', sha256: sha, status: 'installed', enabled: true, active: true, approvedBy: null,
  manifest: { id: 'whonet-sqlite', version: '0.1.0', entrypoint: 'convert', wasmSha256: sha, description: '', license: 'Apache-2.0', wasi: false, limits: { memoryMb: 256, timeoutMs: 30000 } },
};

const store: PluginStore = {
  install: vi.fn(), list: vi.fn(async () => [row]), remove: vi.fn(),
  rollback: vi.fn(), setEnabled: vi.fn(),
  get: vi.fn(async (id) => (id === 'whonet-sqlite' ? row : undefined)),
};
const blob = {
  get: vi.fn(async () => wasm), put: vi.fn(), exists: vi.fn(), presign: vi.fn(), healthCheck: vi.fn(),
} as never;
const runner: PluginRunner = { run: vi.fn(async () => enc('{"resourceType":"Patient","id":"p1"}\n{"resourceType":"Specimen","id":"s1","subject":{"reference":"Patient/p1"}}\n')) };

function inMemoryTrustStore() {
  const m = new Map<string, { keyFingerprint: string }>();
  return {
    get: async (id: string) => m.get(id),
    pin: async (i: { publisherId: string; keyFingerprint: string; publisherName: string; approvedBy: string | null }) => {
      m.set(i.publisherId, { keyFingerprint: i.keyFingerprint });
    },
  };
}

describe('plugin → handleIngestEvent (hermetic)', () => {
  it('resolves a plugin converter and persists its resources with plugin provenance', async () => {
    const runtime = createPluginRuntime({
      blob, store, runner, logger,
      trustStore: inMemoryTrustStore(),
      ceVersion: '0.1.0',
      verifyConfig: { devAllowUnsigned: false },
    });
    const resolver = chainResolvers(registryResolver(new ConverterRegistry()), { resolve: (id) => runtime.load(id) });
    const persist = vi.fn(async (rs: unknown[]) => rs.map(() => ({ saved: true, flattened: 'written' as const })));
    const batches = { markProcessing: vi.fn(), markDone: vi.fn(), markFailed: vi.fn() } as unknown as BatchStore;

    await handleIngestEvent(
      { blob, persist, resolver, batches, logger },
      { type: 'ingest.received', payload: { batchId: 'b1', blobKey: 'k', source: 'lab', converter: 'whonet-sqlite' } },
    );

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ resourceType: 'Patient' })]),
      expect.objectContaining({ pluginId: 'whonet-sqlite', pluginVersion: '0.1.0', sourceSystem: 'lab', batchId: 'b1' }),
    );
    expect((persist.mock.calls[0][0] as unknown[]).length).toBe(2);
    expect(batches.markDone).toHaveBeenCalledWith('b1', 2);
  });
});
