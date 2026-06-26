import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { generatePublisherKeypair, packBundle, verifyBundle } from './index';
import { LocalRegistrySource, HttpRegistrySource, collapseByLatest, validateRegistryUrl } from './registry-source';

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

  const noHeaders = { get: () => null };
  function mockFetch() {
    return vi.fn(async (url: string) => {
      const u = String(url);
      const okText = (body: string) => ({ ok: true, status: 200, headers: noHeaders, text: async () => body }) as unknown as Response;
      if (u.endsWith('/index.json')) return okText(indexJson);
      if (u.endsWith('/bundles/demo-1/manifest.json')) return okText(manifestJson);
      if (u.endsWith('/bundles/demo-1/plugin.wasm')) return { ok: true, status: 200, headers: noHeaders, arrayBuffer: async () => wasmBytes.buffer.slice(wasmBytes.byteOffset, wasmBytes.byteOffset + wasmBytes.byteLength) } as unknown as Response;
      if (u.endsWith('/bundles/demo-1/publisher.pub')) return okText(pubHex);
      return { ok: false, status: 404, headers: noHeaders, text: async () => 'nope' } as unknown as Response;
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

describe('HttpRegistrySource ui fetch', () => {
  it('fetches the ui asset declared by payload.ui.entry', async () => {
    const wasm = new Uint8Array([1, 2, 3]);
    const ui = new TextEncoder().encode('<div>remote-panel</div>');
    const { createHash } = await import('node:crypto');
    const manifest = {
      schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
      compatibility: { ceVersion: '*' }, capabilities: [],
      payload: { kind: 'plugin', wasmSha256: createHash('sha256').update(wasm).digest('hex'),
        ui: { entry: 'ui.html', sha256: createHash('sha256').update(ui).digest('hex'), nav: { label: 'Demo' } } },
    };
    const index = { schemaVersion: 1, name: 'r', updatedAt: 't', packages: [
      { id: 'demo', kind: 'plugin', latestVersion: '1.0.0', publisher: '', summary: '', path: 'demo' },
    ] };

    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/plugin.wasm')) return new Response(wasm);
      const body =
        u.endsWith('/index.json') ? JSON.stringify(index) :
        u.endsWith('/manifest.json') ? JSON.stringify(manifest) :
        u.endsWith('/publisher.pub') ? '00' :
        u.endsWith('/ui.html') ? new TextDecoder().decode(ui) : null;
      return new Response(body, { status: body == null ? 404 : 200 });
    }) as unknown as typeof fetch;

    const src = new HttpRegistrySource('https://reg.example', fetchImpl);
    const bundle = await src.getBundle('demo');
    expect(bundle.ui && new TextDecoder().decode(bundle.ui)).toBe('<div>remote-panel</div>');
  });

  it('does not fetch a ui asset for a bundle without payload.ui', async () => {
    const wasm = new Uint8Array([9, 9]);
    const { createHash } = await import('node:crypto');
    const manifest = {
      schemaVersion: 1, type: 'plugin', id: 'noui', version: '1.0.0',
      compatibility: { ceVersion: '*' }, capabilities: [],
      payload: { kind: 'plugin', wasmSha256: createHash('sha256').update(wasm).digest('hex') },
    };
    const index = { schemaVersion: 1, name: 'r', updatedAt: 't', packages: [
      { id: 'noui', kind: 'plugin', latestVersion: '1.0.0', publisher: '', summary: '', path: 'noui' },
    ] };
    let uiRequested = false;
    const fetchImpl = (async (url: string | URL) => {
      const u = String(url);
      if (u.endsWith('/ui.html')) { uiRequested = true; return new Response(null, { status: 404 }); }
      if (u.endsWith('/plugin.wasm')) return new Response(wasm);
      const body = u.endsWith('/index.json') ? JSON.stringify(index) : u.endsWith('/manifest.json') ? JSON.stringify(manifest) : u.endsWith('/publisher.pub') ? '00' : null;
      return new Response(body, { status: body == null ? 404 : 200 });
    }) as unknown as typeof fetch;
    const src = new HttpRegistrySource('https://reg.example', fetchImpl);
    const bundle = await src.getBundle('noui');
    expect(bundle.ui).toBeUndefined();
    expect(uiRequested).toBe(false);
  });
});

describe('validateRegistryUrl (SEC-09)', () => {
  it('accepts https for a public host', () => {
    expect(validateRegistryUrl('https://registry.example').href).toBe('https://registry.example/');
  });
  it('accepts http for loopback (localhost / 127.0.0.1 / [::1])', () => {
    expect(validateRegistryUrl('http://localhost:8080').hostname).toBe('localhost');
    expect(validateRegistryUrl('http://127.0.0.1:8080').hostname).toBe('127.0.0.1');
    expect(validateRegistryUrl('http://[::1]:8080').hostname).toBe('[::1]');
  });
  it('rejects http for a non-loopback host', () => {
    expect(() => validateRegistryUrl('http://registry.example')).toThrow(/https/i);
  });
  it('rejects link-local / metadata IP', () => {
    expect(() => validateRegistryUrl('https://169.254.169.254')).toThrow(/blocked|internal/i);
  });
  it('rejects private IPv4 ranges', () => {
    expect(() => validateRegistryUrl('http://10.0.0.5')).toThrow();
    expect(() => validateRegistryUrl('https://192.168.1.1')).toThrow(/blocked|internal/i);
    expect(() => validateRegistryUrl('https://172.16.0.1')).toThrow(/blocked|internal/i);
  });
  it('rejects unique-local + link-local IPv6 literals', () => {
    expect(() => validateRegistryUrl('https://[fc00::1]')).toThrow(/blocked|internal/i);
    expect(() => validateRegistryUrl('https://[fe80::1]')).toThrow(/blocked|internal/i);
  });
  it('rejects non-http(s) schemes', () => {
    expect(() => validateRegistryUrl('file:///etc')).toThrow(/scheme/i);
    expect(() => validateRegistryUrl('gopher://x')).toThrow(/scheme/i);
  });
});

describe('HttpRegistrySource SSRF guard (SEC-09)', () => {
  it('throws in the constructor on a blocked baseUrl', () => {
    expect(() => new HttpRegistrySource('http://169.254.169.254')).toThrow();
    expect(() => new HttpRegistrySource('http://registry.example')).toThrow(/https/i);
  });

  it('rejects a redirect to an internal host', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.endsWith('/index.json')) {
        return { ok: false, status: 302, headers: { get: (h: string) => (h.toLowerCase() === 'location' ? 'https://169.254.169.254/index.json' : null) }, text: async () => '' } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => 'x' } as unknown as Response;
    });
    const src = new HttpRegistrySource('https://reg.example', fetchMock as unknown as typeof fetch);
    await expect(src.list()).rejects.toThrow(/blocked|internal/i);
  });

  it('follows a redirect to an allowed https host', async () => {
    const index = JSON.stringify({ schemaVersion: 1, name: 'M', updatedAt: 'now', packages: [] });
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url);
      if (u === 'https://reg.example/index.json') {
        return { ok: false, status: 302, headers: { get: (h: string) => (h.toLowerCase() === 'location' ? 'https://mirror.example/index.json' : null) }, text: async () => '' } as unknown as Response;
      }
      if (u === 'https://mirror.example/index.json') {
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => index } as unknown as Response;
      }
      return { ok: false, status: 404, headers: { get: () => null }, text: async () => 'x' } as unknown as Response;
    });
    const src = new HttpRegistrySource('https://reg.example', fetchMock as unknown as typeof fetch);
    await expect(src.list()).resolves.toEqual([]);
  });

  it('caps a too-many-redirects loop', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false, status: 302,
      headers: { get: (h: string) => (h.toLowerCase() === 'location' ? 'https://reg.example/index.json' : null) },
      text: async () => '',
    }) as unknown as Response);
    const src = new HttpRegistrySource('https://reg.example', fetchMock as unknown as typeof fetch);
    await expect(src.list()).rejects.toThrow(/too many redirects/i);
  });
});

describe('HttpRegistrySource byte caps (SEC-10)', () => {
  const base = 'https://reg.example';
  const okIndex = JSON.stringify({ schemaVersion: 1, name: 'M', updatedAt: 'now', packages: [] });

  it('rejects an index whose Content-Length exceeds the cap', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? String(50 * 1024 * 1024) : null) },
      text: async () => okIndex,
    }) as unknown as Response);
    const src = new HttpRegistrySource(base, fetchMock as unknown as typeof fetch);
    await expect(src.list()).rejects.toThrow(/too large|exceeds|cap/i);
  });

  it('rejects an index whose body exceeds the cap even when Content-Length lies', async () => {
    const huge = JSON.stringify({ schemaVersion: 1, name: 'M', updatedAt: 'now', packages: [], pad: 'x'.repeat(2 * 1024 * 1024) });
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: () => null }, // no Content-Length
      arrayBuffer: async () => new TextEncoder().encode(huge).buffer,
      text: async () => huge,
    }) as unknown as Response);
    const src = new HttpRegistrySource(base, fetchMock as unknown as typeof fetch);
    await expect(src.list()).rejects.toThrow(/too large|exceeds|cap/i);
  });

  it('accepts a normal-sized index', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === 'content-length' ? String(okIndex.length) : null) },
      text: async () => okIndex,
    }) as unknown as Response);
    const src = new HttpRegistrySource(base, fetchMock as unknown as typeof fetch);
    await expect(src.list()).resolves.toEqual([]);
  });
});

describe('LocalRegistrySource containment (SEC-09)', () => {
  it('allows a dir inside the configured root', () => {
    expect(() => new LocalRegistrySource('/srv/registries/foo', '/srv/registries')).not.toThrow();
  });
  it('rejects a dir outside the configured root', () => {
    expect(() => new LocalRegistrySource('/etc', '/srv/registries')).toThrow(/contain|inside|root/i);
    expect(() => new LocalRegistrySource('/srv/registries/../etc', '/srv/registries')).toThrow(/contain|inside|root/i);
  });
  it('preserves current behavior when the root is empty/unset', () => {
    expect(() => new LocalRegistrySource('/etc', '')).not.toThrow();
    expect(() => new LocalRegistrySource('/etc')).not.toThrow();
  });
});

const L = (ref: string, id: string, version: string) => ({ ref, id, version, type: 'plugin', publisher: null });

describe('collapseByLatest', () => {
  it('returns one listing per id, choosing the highest semver, with all versions attached', () => {
    const out = collapseByLatest([
      L('whonet-narrow', 'whonet-sqlite', '1.0.0'),
      L('whonet-wide', 'whonet-sqlite', '1.1.0'),
      L('dhis2-sink', 'dhis2-sink', '0.1.0'),
    ]);
    expect(out).toHaveLength(2);
    const whonet = out.find((l) => l.id === 'whonet-sqlite')!;
    expect(whonet.version).toBe('1.1.0');
    expect(whonet.ref).toBe('whonet-wide');
    expect(whonet.versions).toEqual([
      { version: '1.1.0', ref: 'whonet-wide' },
      { version: '1.0.0', ref: 'whonet-narrow' },
    ]);
  });
  it('handles patch/minor/major ordering and a lone version', () => {
    const out = collapseByLatest([L('a-2', 'a', '2.0.0'), L('a-10', 'a', '10.0.0'), L('a-2-1', 'a', '2.1.0')]);
    expect(out).toHaveLength(1);
    expect(out[0].version).toBe('10.0.0');
    expect(out[0].versions!.map((v) => v.version)).toEqual(['10.0.0', '2.1.0', '2.0.0']);
  });
});
