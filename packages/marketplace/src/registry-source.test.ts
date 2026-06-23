import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { generatePublisherKeypair, packBundle, verifyBundle } from './index';
import { LocalRegistrySource, HttpRegistrySource } from './registry-source';

let dir: string;
let manifestJson: string;
let wasmBytes: Uint8Array;
let pubHex: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'reg-src-'));
  const kp = generatePublisherKeypair();
  const manifest = {
    schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
    publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) },
    compatibility: { ceVersion: '*' },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    payload: { kind: 'plugin', wasmSha256: '0'.repeat(64) },
  };
  const bundleDir = join(dir, 'demo-1');
  await packBundle({ manifest, payload: new Uint8Array([1, 2, 3, 4]), outDir: bundleDir, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
  manifestJson = readFileSync(join(bundleDir, 'manifest.json'), 'utf8');
  wasmBytes = new Uint8Array(readFileSync(join(bundleDir, 'plugin.wasm')));
  pubHex = readFileSync(join(bundleDir, 'publisher.pub'), 'utf8');
});
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

describe('LocalRegistrySource', () => {
  it('lists and gets a verifiable bundle', async () => {
    const src = new LocalRegistrySource(dir);
    const list = await src.list();
    expect(list.map((l) => l.ref)).toContain('demo-1');
    const b = await src.getBundle('demo-1');
    expect(verifyBundle(b).valid).toBe(true);
  });
});

describe('HttpRegistrySource', () => {
  const base = 'https://example.test/mkt';
  const indexJson = JSON.stringify({
    schemaVersion: 1, name: 'M', updatedAt: 'now',
    packages: [{ id: 'demo', kind: 'plugin', latestVersion: '1.0.0', publisher: 'Acme', summary: 's', path: 'bundles/demo-1', signatureFingerprint: 'x' }],
  });

  function mockFetch() {
    return vi.fn(async (url: string) => {
      const u = String(url);
      const okText = (body: string) => ({ ok: true, status: 200, text: async () => body }) as unknown as Response;
      if (u.endsWith('/index.json')) return okText(indexJson);
      if (u.endsWith('/bundles/demo-1/manifest.json')) return okText(manifestJson);
      if (u.endsWith('/bundles/demo-1/plugin.wasm')) return { ok: true, status: 200, arrayBuffer: async () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) } as unknown as Response;
      if (u.endsWith('/bundles/demo-1/publisher.pub')) return okText(pubHex);
      return { ok: false, status: 404, text: async () => 'nope' } as unknown as Response;
    });
  }

  it('lists from index.json without downloading payloads', async () => {
    const fetchMock = mockFetch();
    const src = new HttpRegistrySource(base, fetchMock as unknown as typeof fetch);
    const list = await src.list();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ref: 'demo-1', id: 'demo', version: '1.0.0', type: 'plugin' });
    expect(fetchMock.mock.calls.every((c) => String(c[0]).endsWith('/index.json'))).toBe(true);
  });

  it('getBundle assembles a verifiable bundle from fetched files', async () => {
    const src = new HttpRegistrySource(base, mockFetch() as unknown as typeof fetch);
    await src.list();
    const b = await src.getBundle('demo-1');
    expect(verifyBundle(b).valid).toBe(true);
  });

  it('throws a registry-unreachable error when index.json is missing', async () => {
    const fetchMock = vi.fn(async () => ({ ok: false, status: 404, text: async () => 'x' }) as unknown as Response);
    const src = new HttpRegistrySource(base, fetchMock as unknown as typeof fetch);
    await expect(src.list()).rejects.toThrow();
  });

  it('rejects an unsafe index path (SSRF guard)', async () => {
    const evilIndex = JSON.stringify({ schemaVersion: 1, name: 'M', updatedAt: 'now', packages: [{ id: 'demo', kind: 'plugin', latestVersion: '1.0.0', publisher: 'A', summary: 's', path: 'https://evil.test/x', signatureFingerprint: 'x' }] });
    const fetchMock = vi.fn(async (url: string) => ({ ok: true, status: 200, text: async () => evilIndex }) as unknown as Response);
    const src = new HttpRegistrySource(base, fetchMock as unknown as typeof fetch);
    await src.list();
    await expect(src.getBundle('x')).rejects.toThrow(/unsafe index path/);
  });
});
