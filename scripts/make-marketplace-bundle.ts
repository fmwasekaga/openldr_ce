// Build signed marketplace bundles from the bundled WHONET reference plugin.
//
// Produces two bundles that share ONE publisher key (so TOFU pinning holds across
// reinstalls), differing only in their emit-fhir capability grant:
//   - bundles/whonet-narrow  (v1.0.0)  emit-fhir: [Patient]                 -> will violate at ingest
//   - bundles/whonet-wide    (v1.1.0)  emit-fhir: [Patient,Specimen,...]    -> ingests cleanly
//
// Bundles are written into the SEPARATE repo ../openldr-ce-marketplace (publishable).
// The PRIVATE signing key is written under THIS repo at scripts/.marketplace-keys/
// (gitignored) and is NEVER placed in the public marketplace repo.
//
// Run: pnpm make:marketplace-bundle
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generatePublisherKeypair,
  signManifest,
  keyFingerprint,
  type Capability,
} from '@openldr/marketplace';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const marketplaceRepo = join(repoRoot, '..', 'openldr-ce-marketplace');
const keysDir = join(repoRoot, 'scripts', '.marketplace-keys');
const wasmPath = join(repoRoot, 'reference-plugins', 'whonet-sqlite', 'plugin.wasm');

const PUBLISHER = { id: 'openldr-ref', name: 'OpenLDR Reference Publisher' };

/** Load the persisted publisher keypair, or generate + persist it on first run. */
function loadOrCreateKeypair() {
  mkdirSync(keysDir, { recursive: true });
  const privPath = join(keysDir, 'whonet.priv');
  const pubPath = join(keysDir, 'whonet.pub');
  if (existsSync(privPath) && existsSync(pubPath)) {
    const privateKeyDer = Uint8Array.from(Buffer.from(readFileSync(privPath, 'utf8').trim(), 'hex'));
    const publicKeyDer = Uint8Array.from(Buffer.from(readFileSync(pubPath, 'utf8').trim(), 'hex'));
    return { privateKeyDer, publicKeyDer, fingerprint: keyFingerprint(publicKeyDer) };
  }
  const kp = generatePublisherKeypair();
  writeFileSync(privPath, Buffer.from(kp.privateKeyDer).toString('hex'));
  writeFileSync(pubPath, Buffer.from(kp.publicKeyDer).toString('hex'));
  return kp;
}

function buildBundle(opts: {
  dirName: string;
  version: string;
  resourceTypes: string[];
  wasm: Uint8Array;
  wasmSha256: string;
  kp: ReturnType<typeof loadOrCreateKeypair>;
}) {
  const capabilities: Capability[] = [
    { kind: 'emit-fhir', resourceTypes: opts.resourceTypes },
    { kind: 'net-egress', allowedHosts: [] },
  ];
  const base = {
    schemaVersion: 1 as const,
    type: 'plugin' as const,
    id: 'whonet-sqlite',
    version: opts.version,
    description: 'WHONET SQLite -> FHIR R4 (signed marketplace artifact)',
    license: 'Apache-2.0',
    publisher: { id: PUBLISHER.id, name: PUBLISHER.name, keyFingerprint: opts.kp.fingerprint },
    compatibility: { ceVersion: '*' },
    capabilities,
    payload: { kind: 'plugin' as const, wasmSha256: opts.wasmSha256, entrypoint: 'convert', wasi: true, limits: { memoryMb: 256, timeoutMs: 30_000 } },
  };
  const signature = signManifest(base, opts.wasmSha256, opts.kp.privateKeyDer);
  const manifest = { ...base, signature };

  const dir = join(marketplaceRepo, 'bundles', opts.dirName);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(join(dir, 'plugin.wasm'), opts.wasm);
  writeFileSync(join(dir, 'publisher.pub'), Buffer.from(opts.kp.publicKeyDer).toString('hex'));
  console.log(`  ✓ wrote ${opts.dirName} (v${opts.version}, emit-fhir: ${opts.resourceTypes.join(',')}) -> ${dir}`);
}

function main() {
  if (!existsSync(wasmPath)) {
    console.error(`missing ${wasmPath} — run \`pnpm build:plugins\` first`);
    process.exit(1);
  }
  if (!existsSync(marketplaceRepo)) {
    console.error(`missing ${marketplaceRepo} — clone the openldr-ce-marketplace repo as a sibling of this repo`);
    process.exit(1);
  }
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const wasmSha256 = createHash('sha256').update(wasm).digest('hex');
  const kp = loadOrCreateKeypair();

  console.log(`Publisher ${PUBLISHER.id} fingerprint=${kp.fingerprint}`);
  buildBundle({ dirName: 'whonet-narrow', version: '1.0.0', resourceTypes: ['Patient'], wasm, wasmSha256, kp });
  buildBundle({ dirName: 'whonet-wide', version: '1.1.0', resourceTypes: ['Patient', 'Specimen', 'Observation', 'DiagnosticReport', 'ServiceRequest'], wasm, wasmSha256, kp });
  console.log('\n✅ bundles built. Private key (gitignored): scripts/.marketplace-keys/whonet.priv');
}

main();
