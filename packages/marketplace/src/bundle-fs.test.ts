import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { generatePublisherKeypair, signManifest } from './signing';
import { readBundle, verifyBundle } from './bundle-fs';

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
