import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { generatePublisherKeypair, signManifest } from './signing';
import { readBundle, verifyBundle, assembleBundle } from './bundle-fs';

/** Inline sha256 — avoid importing @openldr/plugins from marketplace (no-cycle rule). */
function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

async function makeBundle(tamper = false) {
  const dir = await mkdtemp(join(tmpdir(), 'mkt-'));
  const kp = generatePublisherKeypair();
  const wasm = new Uint8Array([1, 2, 3, 4]);
  const wasmSha = sha256Hex(wasm);
  const base = {
    schemaVersion: 1,
    type: 'plugin',
    id: 'demo',
    version: '1.0.0',
    publisher: { id: 'acme', name: 'Acme', keyFingerprint: kp.fingerprint },
    compatibility: { ceVersion: '*' },
    capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
    payload: { kind: 'plugin', wasmSha256: wasmSha },
  };
  const manifest = { ...base, signature: signManifest(base, wasmSha, kp.privateKeyDer) };
  const written = tamper ? { ...manifest, id: 'evil' } : manifest;
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(written));
  await writeFile(join(dir, 'plugin.wasm'), wasm);
  await writeFile(join(dir, 'publisher.pub'), Buffer.from(kp.publicKeyDer).toString('hex'));
  return { dir };
}

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

describe('bundle ui integrity', () => {
  const wasm = new Uint8Array([1, 2, 3]);
  const ui = new TextEncoder().encode('<div>hi</div>');

  function rawManifest(uiSha: string): Record<string, unknown> {
    return {
      schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
      compatibility: { ceVersion: '*' }, capabilities: [],
      payload: { kind: 'plugin', wasmSha256: sha(wasm), ui: { entry: 'ui.html', sha256: uiSha, nav: { label: 'Demo' } } },
    };
  }

  it('assembleBundle carries ui bytes', () => {
    const b = assembleBundle(rawManifest(sha(ui)), wasm, '00', ui);
    expect(b.ui).toEqual(ui);
  });

  it('verifyBundle accepts a signed bundle whose ui.html matches the signed sha', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mkt-ui-ok-'));
    try {
      const kp = generatePublisherKeypair();
      const wasmSha = sha256Hex(wasm);
      const uiSha = sha256Hex(ui);
      const base = {
        schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
        publisher: { id: 'acme', name: 'Acme', keyFingerprint: kp.fingerprint },
        compatibility: { ceVersion: '*' }, capabilities: [],
        payload: { kind: 'plugin', wasmSha256: wasmSha, ui: { entry: 'ui.html', sha256: uiSha, nav: { label: 'Demo' } } },
      };
      const manifest = { ...base, signature: signManifest(base, wasmSha, kp.privateKeyDer) };
      await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
      await writeFile(join(dir, 'plugin.wasm'), wasm);
      await writeFile(join(dir, 'ui.html'), ui);
      await writeFile(join(dir, 'publisher.pub'), Buffer.from(kp.publicKeyDer).toString('hex'));
      const b = await readBundle(dir);
      expect(verifyBundle(b).valid).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('verifyBundle rejects a signed bundle whose ui.html has been tampered', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mkt-ui-bad-'));
    try {
      const kp = generatePublisherKeypair();
      const wasmSha = sha256Hex(wasm);
      const uiSha = sha256Hex(ui);
      const base = {
        schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
        publisher: { id: 'acme', name: 'Acme', keyFingerprint: kp.fingerprint },
        compatibility: { ceVersion: '*' }, capabilities: [],
        payload: { kind: 'plugin', wasmSha256: wasmSha, ui: { entry: 'ui.html', sha256: uiSha, nav: { label: 'Demo' } } },
      };
      const manifest = { ...base, signature: signManifest(base, wasmSha, kp.privateKeyDer) };
      await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
      await writeFile(join(dir, 'plugin.wasm'), wasm);
      // Write tampered ui bytes — sha will not match the signed uiSha
      await writeFile(join(dir, 'ui.html'), new TextEncoder().encode('<script>evil()</script>'));
      await writeFile(join(dir, 'publisher.pub'), Buffer.from(kp.publicKeyDer).toString('hex'));
      const b = await readBundle(dir);
      expect(verifyBundle(b).valid).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('bundle-fs', () => {
  it('reads and verifies a good bundle', async () => {
    const { dir } = await makeBundle();
    const b = await readBundle(dir);
    expect(verifyBundle(b).valid).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects a tampered manifest', async () => {
    const { dir } = await makeBundle(true);
    const b = await readBundle(dir);
    expect(verifyBundle(b).valid).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});
