import { describe, it, expect, vi } from 'vitest';
import { createPluginNodeService } from './plugin-node-service';

const ECHO_NODE = {
  id: 'echo', label: 'Echo', kind: 'transform', entrypoint: 'wf_echo',
  ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }, capabilities: [],
};
const PUSH_NODE = {
  id: 'push', label: 'Push', kind: 'sink', entrypoint: 'wf_push',
  ports: { inputs: [{ name: 'in' }], outputs: [] }, capabilities: ['net-egress', 'host:connectors'],
};

function pluginRow(workflowNodes: unknown[], opts: { id?: string; enabled?: boolean; capabilities?: unknown } = {}) {
  return {
    id: opts.id ?? 'p', version: '1.0.0', enabled: opts.enabled ?? true,
    manifest: {
      schemaVersion: 1, type: 'plugin', id: opts.id ?? 'p', version: '1.0.0',
      compatibility: { ceVersion: '*' }, capabilities: opts.capabilities ?? [],
      payload: { kind: 'plugin', wasmSha256: 'a'.repeat(64), workflowNodes },
    } as Record<string, unknown>,
  };
}

function deps(over: Partial<Parameters<typeof createPluginNodeService>[0]> = {}, invoke = vi.fn().mockResolvedValue({ items: [], meta: { ok: true } })) {
  const base = {
    plugins: {
      list: vi.fn().mockResolvedValue([pluginRow([ECHO_NODE])]),
      loadSink: vi.fn().mockResolvedValue({ invoke, invokeBytes: vi.fn() }),
    },
    connectors: {
      get: vi.fn().mockResolvedValue({ pluginId: 'p', allowedHost: 'dhis2.example', enabled: true }),
      getDecryptedConfig: vi.fn().mockResolvedValue({ baseUrl: 'https://dhis2.example', username: 'u', password: 'pw' }),
    },
    secretsKey: 'key',
    policy: () => ({ egressEnabled: true }),
    blob: { get: vi.fn(), put: vi.fn().mockResolvedValue(undefined) },
    maxFileBytes: 52_428_800,
  };
  return { deps: { ...base, ...over }, invoke };
}

describe('createPluginNodeService', () => {
  it('throws for an unknown/disabled plugin', async () => {
    const { deps: d } = deps({ plugins: { list: vi.fn().mockResolvedValue([]), loadSink: vi.fn() } } as never);
    await expect(createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: {}, items: [] }))
      .rejects.toThrow(/not installed or disabled/i);
  });

  it('throws for an unknown node id', async () => {
    const { deps: d } = deps();
    await expect(createPluginNodeService(d)({ pluginId: 'p', nodeId: 'nope', config: {}, items: [] }))
      .rejects.toThrow(/no workflow node/i);
  });

  it('invokes the entrypoint with {items,config}, no connector → no egress, foreground', async () => {
    const { deps: d, invoke } = deps();
    const out = await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: { note: 'x' }, items: [{ json: { a: 1 } }] });
    expect(invoke).toHaveBeenCalledWith('wf_echo', { items: [{ json: { a: 1 } }], config: { note: 'x' } }, { config: {}, allowedHosts: [] });
    expect(out).toEqual({ items: [], meta: { ok: true } });
  });

  it('resolves a connector for a net-egress sink and pins the host (real push)', async () => {
    const { deps: d, invoke } = deps({
      plugins: { list: vi.fn().mockResolvedValue([pluginRow([PUSH_NODE], { capabilities: [{ kind: 'net-egress', allowedHosts: [] }, { kind: 'host:connectors' }] })]), loadSink: vi.fn().mockResolvedValue({ invoke: vi.fn().mockResolvedValue({ items: [] }), invokeBytes: vi.fn() }) },
    } as never);
    // re-bind invoke spy through loadSink
    const sinkInvoke = vi.fn().mockResolvedValue({ items: [] });
    (d.plugins.loadSink as ReturnType<typeof vi.fn>).mockResolvedValue({ invoke: sinkInvoke, invokeBytes: vi.fn() });
    await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'push', config: { connectorId: 'c1', period: '2026Q1', dryRun: false }, items: [{ json: { a: 1 } }] });
    expect(d.connectors.getDecryptedConfig).toHaveBeenCalledWith('c1', 'key');
    const [entry, input, opts] = sinkInvoke.mock.calls[0];
    expect(entry).toBe('wf_push');
    // secrets ride opts.config, NOT the JSON input; connectorId stripped from input.config
    expect(input).toEqual({ items: [{ json: { a: 1 } }], config: { period: '2026Q1', dryRun: false } });
    expect(opts).toEqual({ config: { baseUrl: 'https://dhis2.example', username: 'u', password: 'pw' }, allowedHosts: ['dhis2.example'] });
  });

  it('does NOT pin a host on a dry-run even with a connector', async () => {
    const sinkInvoke = vi.fn().mockResolvedValue({ items: [] });
    const { deps: d } = deps({
      plugins: { list: vi.fn().mockResolvedValue([pluginRow([PUSH_NODE], { capabilities: [{ kind: 'net-egress', allowedHosts: [] }, { kind: 'host:connectors' }] })]), loadSink: vi.fn().mockResolvedValue({ invoke: sinkInvoke, invokeBytes: vi.fn() }) },
    } as never);
    await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'push', config: { connectorId: 'c1', dryRun: true }, items: [] });
    expect(sinkInvoke.mock.calls[0][2].allowedHosts).toEqual([]);
  });

  it('normalizes a missing items field in the response to []', async () => {
    const { deps: d } = deps({}, vi.fn().mockResolvedValue({ meta: { only: 'meta' } }));
    const out = await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: {}, items: [] });
    expect(out).toEqual({ items: [], meta: { only: 'meta' } });
  });
});

const BYTES_NODE = {
  id: 'convert', label: 'Convert', kind: 'transform', entrypoint: 'wf_convert', abi: 'bytes', binaryField: 'file',
  ports: { inputs: [{ name: 'in' }], outputs: [{ name: 'out' }] }, capabilities: [],
};

describe('createPluginNodeService abi:bytes', () => {
  it('abi:bytes reads the input item binary, fetches the blob, and calls invokeBytes', async () => {
    const invokeBytes = vi.fn().mockResolvedValue({ items: [{ json: { line: 'a' } }] });
    const blobGet = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const { deps: d } = deps({
      plugins: { list: vi.fn().mockResolvedValue([pluginRow([BYTES_NODE])]), loadSink: vi.fn().mockResolvedValue({ invoke: vi.fn(), invokeBytes }) },
      blob: { get: blobGet }, maxFileBytes: 1000,
    } as never);
    const items = [{ json: {}, binary: { file: { objectKey: 'uploads/x', contentType: 'application/octet-stream', byteSize: 3 } } }];
    const out = await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'convert', config: {}, items });
    expect(blobGet).toHaveBeenCalledWith('uploads/x');
    expect(invokeBytes).toHaveBeenCalledWith('wf_convert', new Uint8Array([1, 2, 3]), { config: {}, allowedHosts: [] });
    expect(out).toEqual({ items: [{ json: { line: 'a' } }] });
  });

  it('abi:bytes throws when the input item has no file', async () => {
    const { deps: d } = deps({
      plugins: { list: vi.fn().mockResolvedValue([pluginRow([BYTES_NODE])]), loadSink: vi.fn().mockResolvedValue({ invoke: vi.fn(), invokeBytes: vi.fn() }) },
      blob: { get: vi.fn() }, maxFileBytes: 1000,
    } as never);
    await expect(createPluginNodeService(d)({ pluginId: 'p', nodeId: 'convert', config: {}, items: [{ json: {} }] })).rejects.toThrow(/no file/i);
  });

  it('abi:bytes enforces the size cap (declared byteSize over limit)', async () => {
    const { deps: d } = deps({
      plugins: { list: vi.fn().mockResolvedValue([pluginRow([BYTES_NODE])]), loadSink: vi.fn().mockResolvedValue({ invoke: vi.fn(), invokeBytes: vi.fn() }) },
      blob: { get: vi.fn(), put: vi.fn().mockResolvedValue(undefined) }, maxFileBytes: 2,
    } as never);
    const items = [{ json: {}, binary: { file: { objectKey: 'k', contentType: 'x', byteSize: 99 } } }];
    await expect(createPluginNodeService(d)({ pluginId: 'p', nodeId: 'convert', config: {}, items })).rejects.toThrow(/limit|large|exceed/i);
  });
});

describe('createPluginNodeService binary output', () => {
  it('materializes an item emitting inline base64 into a BinaryRef under workflow-artifacts/', async () => {
    const put = vi.fn().mockResolvedValue(undefined);
    const emitted = { items: [{ json: { ok: true }, binary: { out: { contentType: 'text/plain', fileName: 'hello.txt', dataBase64: 'aGVsbG8=' } } }] };
    const { deps: d } = deps({}, vi.fn().mockResolvedValue(emitted));
    d.blob = { get: vi.fn(), put };
    const out = await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: {}, items: [] });
    expect(put).toHaveBeenCalledWith(expect.stringMatching(/^workflow-artifacts\/.+\/hello\.txt$/), expect.any(Uint8Array), 'text/plain');
    const ref = out.items[0].binary!.out as { objectKey: string; contentType: string; fileName: string; byteSize: number };
    expect(ref.objectKey).toMatch(/^workflow-artifacts\//);
    expect(ref.byteSize).toBe(5);
    expect((ref as { dataBase64?: unknown }).dataBase64).toBeUndefined();
  });
  it('leaves an already-materialized BinaryRef (no dataBase64) untouched', async () => {
    const put = vi.fn();
    const passthrough = { items: [{ json: {}, binary: { in: { objectKey: 'workflow-uploads/x/f', contentType: 'x', byteSize: 3 } } }] };
    const { deps: d } = deps({}, vi.fn().mockResolvedValue(passthrough));
    d.blob = { get: vi.fn(), put };
    const out = await createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: {}, items: [] });
    expect(put).not.toHaveBeenCalled();
    expect(out.items[0].binary!.in).toEqual({ objectKey: 'workflow-uploads/x/f', contentType: 'x', byteSize: 3 });
  });
  it('throws when an emitted file exceeds the cap', async () => {
    const big = Buffer.from('x'.repeat(20)).toString('base64');
    const { deps: d } = deps({}, vi.fn().mockResolvedValue({ items: [{ json: {}, binary: { out: { contentType: 'text/plain', dataBase64: big } } }] }));
    d.blob = { get: vi.fn(), put: vi.fn() }; d.maxFileBytes = 3;
    await expect(createPluginNodeService(d)({ pluginId: 'p', nodeId: 'echo', config: {}, items: [] })).rejects.toThrow(/limit|exceed|large/i);
  });
});
