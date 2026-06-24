import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePublisherKeypair } from './signing';
import { readBundle, verifyBundle } from './bundle-fs';
import { packBundle } from './pack';

const baseManifest = {
  schemaVersion: 1, type: 'plugin', id: 'demo', version: '1.0.0',
  publisher: { id: 'acme', name: 'Acme', keyFingerprint: '0'.repeat(64) }, // placeholder, packBundle overwrites
  compatibility: { ceVersion: '*' },
  capabilities: [{ kind: 'emit-fhir', resourceTypes: ['Patient'] }],
  payload: { kind: 'plugin', wasmSha256: '0'.repeat(64) }, // placeholder, packBundle overwrites
};

describe('packBundle', () => {
  it('writes a signed bundle that verifies, filling sha + publisher fingerprint', async () => {
    const out = await mkdtemp(join(tmpdir(), 'pack-'));
    const kp = generatePublisherKeypair();
    const wasm = new Uint8Array([1, 2, 3, 4]);
    const res = await packBundle({ manifest: structuredClone(baseManifest), payload: wasm, outDir: out, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
    expect(res.fingerprint).toBe(kp.fingerprint);
    const bundle = await readBundle(out);
    expect(verifyBundle(bundle).valid).toBe(true);
    expect(bundle.manifest.publisher?.keyFingerprint).toBe(kp.fingerprint);
    expect((bundle.manifest.payload as { wasmSha256: string }).wasmSha256).not.toBe('0'.repeat(64));
    // payload written under the conventional filename
    expect(new Uint8Array(await readFile(join(out, 'plugin.wasm')))).toEqual(wasm);
    await rm(out, { recursive: true, force: true });
  });

  it('a tampered written manifest fails verification', async () => {
    const out = await mkdtemp(join(tmpdir(), 'pack-'));
    const kp = generatePublisherKeypair();
    await packBundle({ manifest: structuredClone(baseManifest), payload: new Uint8Array([9]), outDir: out, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
    const m = JSON.parse(await readFile(join(out, 'manifest.json'), 'utf8'));
    m.id = 'evil';
    await writeFile(join(out, 'manifest.json'), JSON.stringify(m));
    expect(verifyBundle(await readBundle(out)).valid).toBe(false);
    await rm(out, { recursive: true, force: true });
  });

  it('packs a form-template payload under questionnaire.json', async () => {
    const out = await mkdtemp(join(tmpdir(), 'pack-'));
    const kp = generatePublisherKeypair();
    const formManifest = { ...structuredClone(baseManifest), type: 'form-template', capabilities: [], payload: { kind: 'form-template', questionnaireSha256: '0'.repeat(64) } };
    await packBundle({ manifest: formManifest, payload: new TextEncoder().encode('{"resourceType":"Questionnaire"}'), outDir: out, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
    expect(verifyBundle(await readBundle(out)).valid).toBe(true);
    expect(await readFile(join(out, 'questionnaire.json'), 'utf8')).toContain('Questionnaire');
    await rm(out, { recursive: true, force: true });
  });

  it('packs a UI-bearing plugin: writes ui.html and the bundle verifies', async () => {
    const out = await mkdtemp(join(tmpdir(), 'pack-'));
    const kp = generatePublisherKeypair();
    const wasm = new Uint8Array([1, 2, 3, 4]);
    const uiBytes = new TextEncoder().encode('<div>Demo UI</div>');
    const uiSha = createHash('sha256').update(uiBytes).digest('hex');
    const uiManifest = {
      ...structuredClone(baseManifest),
      payload: { kind: 'plugin', wasmSha256: '0'.repeat(64), ui: { entry: 'ui.html', sha256: uiSha, nav: { label: 'Demo' } } },
    };
    await packBundle({ manifest: uiManifest, payload: wasm, ui: uiBytes, outDir: out, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer });
    expect(new Uint8Array(await readFile(join(out, 'ui.html')))).toEqual(uiBytes);
    const bundle = await readBundle(out);
    expect(verifyBundle(bundle).valid).toBe(true);
    expect(bundle.ui).toEqual(uiBytes);
    await rm(out, { recursive: true, force: true });
  });

  it('throws a clear error when the manifest declares payload.ui.entry but no ui bytes are provided', async () => {
    const out = await mkdtemp(join(tmpdir(), 'pack-'));
    const kp = generatePublisherKeypair();
    const uiBytes = new TextEncoder().encode('<div>Demo UI</div>');
    const uiSha = createHash('sha256').update(uiBytes).digest('hex');
    const uiManifest = {
      ...structuredClone(baseManifest),
      payload: { kind: 'plugin', wasmSha256: '0'.repeat(64), ui: { entry: 'ui.html', sha256: uiSha, nav: { label: 'Demo' } } },
    };
    await expect(
      packBundle({ manifest: uiManifest, payload: new Uint8Array([1]), outDir: out, privateKeyDer: kp.privateKeyDer, publicKeyDer: kp.publicKeyDer }),
    ).rejects.toThrow(/no ui bytes/i);
    await rm(out, { recursive: true, force: true });
  });
});
