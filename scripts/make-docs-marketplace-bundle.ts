import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generatePublisherKeypair,
  keyFingerprint,
  packBundle,
  pluginManifestToArtifact,
} from '@openldr/marketplace';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const keysDir = join(root, 'scripts', '.marketplace-keys');
const sourceDir = join(root, 'reference-plugins', 'test-sink');
const outRoot = join(root, '.docs-marketplace');
const outDir = join(outRoot, 'bundles', 'test-sink');
const PUBLISHER = { id: 'openldr-docs', name: 'OpenLDR Documentation Samples' };

function loadOrCreateKeypair() {
  mkdirSync(keysDir, { recursive: true });
  const privPath = join(keysDir, 'docs.priv');
  const pubPath = join(keysDir, 'docs.pub');
  if (existsSync(privPath) && existsSync(pubPath)) {
    const privateKeyDer = Uint8Array.from(Buffer.from(readFileSync(privPath, 'utf8').trim(), 'hex'));
    const publicKeyDer = Uint8Array.from(Buffer.from(readFileSync(pubPath, 'utf8').trim(), 'hex'));
    return { privateKeyDer, publicKeyDer, fingerprint: keyFingerprint(publicKeyDer) };
  }
  const keypair = generatePublisherKeypair();
  writeFileSync(privPath, Buffer.from(keypair.privateKeyDer).toString('hex'));
  writeFileSync(pubPath, Buffer.from(keypair.publicKeyDer).toString('hex'));
  return keypair;
}

async function main() {
  const manifestPath = join(sourceDir, 'manifest.json');
  const wasmPath = join(sourceDir, 'plugin.wasm');
  if (!existsSync(manifestPath) || !existsSync(wasmPath)) {
    throw new Error(`missing test-sink build artifacts in ${sourceDir}; run pnpm build:test-sink first`);
  }

  const flat = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const manifest = {
    ...pluginManifestToArtifact(flat),
    summary: 'Training sink used by the OpenLDR web documentation',
    description: 'Training sink used by the OpenLDR web documentation',
    publisher: { id: PUBLISHER.id, name: PUBLISHER.name, keyFingerprint: '0'.repeat(64) },
  } as Record<string, unknown>;
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const keypair = loadOrCreateKeypair();
  const packed = await packBundle({
    manifest,
    payload: wasm,
    outDir,
    privateKeyDer: keypair.privateKeyDer,
    publicKeyDer: keypair.publicKeyDer,
  });

  mkdirSync(outRoot, { recursive: true });
  writeFileSync(
    join(outRoot, 'index.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        packages: [
          {
            id: packed.manifest.id,
            kind: packed.manifest.type,
            latestVersion: packed.manifest.version,
            publisher: PUBLISHER.name,
            summary: 'Training sink used by the OpenLDR web documentation',
            path: 'bundles/test-sink',
            signatureFingerprint: packed.fingerprint,
          },
        ],
      },
      null,
      2,
    ),
  );
  console.log(`wrote docs marketplace bundle -> ${outDir}`);
}

main();
