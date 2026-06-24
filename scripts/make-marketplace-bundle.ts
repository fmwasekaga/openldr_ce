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
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generatePublisherKeypair,
  keyFingerprint,
  packBundle,
  pluginManifestToArtifact,
  type Capability,
} from '@openldr/marketplace';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');
const marketplaceRepo = join(repoRoot, '..', 'openldr-ce-marketplace');
const keysDir = join(repoRoot, 'scripts', '.marketplace-keys');
const wasmPath = join(repoRoot, 'reference-plugins', 'whonet-sqlite', 'plugin.wasm');
const dhis2SinkDir = join(repoRoot, 'reference-plugins', 'dhis2-sink');

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

async function buildBundle(opts: {
  dirName: string;
  version: string;
  resourceTypes: string[];
  wasm: Uint8Array;
  kp: ReturnType<typeof loadOrCreateKeypair>;
}) {
  const capabilities: Capability[] = [
    { kind: 'emit-fhir', resourceTypes: opts.resourceTypes },
    { kind: 'net-egress', allowedHosts: [] },
  ];
  const manifest = {
    schemaVersion: 1 as const,
    type: 'plugin' as const,
    id: 'whonet-sqlite',
    version: opts.version,
    description: 'WHONET SQLite -> FHIR R4 (signed marketplace artifact)',
    license: 'Apache-2.0',
    publisher: { id: PUBLISHER.id, name: PUBLISHER.name, keyFingerprint: '0'.repeat(64) },
    compatibility: { ceVersion: '*' },
    capabilities,
    payload: { kind: 'plugin' as const, wasmSha256: '0'.repeat(64), entrypoint: 'convert', wasi: true, limits: { memoryMb: 256, timeoutMs: 30_000 } },
  };

  const outDir = join(marketplaceRepo, 'bundles', opts.dirName);
  await packBundle({
    manifest,
    payload: opts.wasm,
    outDir,
    privateKeyDer: opts.kp.privateKeyDer,
    publicKeyDer: opts.kp.publicKeyDer,
  });
  console.log(`  ✓ wrote ${opts.dirName} (v${opts.version}, emit-fhir: ${opts.resourceTypes.join(',')}) -> ${outDir}`);
}

/** Pack the dhis2-sink reference plugin into bundles/dhis2-sink so it appears in the
 *  Marketplace "Browse" tab. Reuses the shared publisher keypair (TOFU consistency).
 *  The flat built manifest (kind/entrypoints/capabilities/readme/wasmSha256) is adapted
 *  via pluginManifestToArtifact; packBundle recomputes the payload sha + signs. */
async function buildDhis2SinkBundle(kp: ReturnType<typeof loadOrCreateKeypair>) {
  const flatPath = join(dhis2SinkDir, 'manifest.json');
  const wasmPathDhis2 = join(dhis2SinkDir, 'plugin.wasm');
  if (!existsSync(flatPath) || !existsSync(wasmPathDhis2)) {
    console.error(`missing dhis2-sink build artifacts in ${dhis2SinkDir} — run \`pnpm build:dhis2-sink\` first`);
    process.exit(1);
  }
  const flat = JSON.parse(readFileSync(flatPath, 'utf8'));
  // Adapt the flat manifest -> artifact manifest (carries kind->pluginKind, entrypoints,
  // capabilities, readme, compatibility:{ceVersion:'*'}), then attach the publisher block.
  const art = {
    ...pluginManifestToArtifact(flat),
    publisher: { id: PUBLISHER.id, name: PUBLISHER.name, keyFingerprint: '0'.repeat(64) },
  } as unknown as Record<string, unknown>;

  const wasm = new Uint8Array(readFileSync(wasmPathDhis2));
  const outDir = join(marketplaceRepo, 'bundles', 'dhis2-sink');
  await packBundle({
    manifest: art,
    payload: wasm,
    outDir,
    privateKeyDer: kp.privateKeyDer,
    publicKeyDer: kp.publicKeyDer,
  });
  console.log(`  ✓ wrote dhis2-sink (v${flat.version}, kind=${flat.kind}) -> ${outDir}`);
}

async function main() {
  if (!existsSync(wasmPath)) {
    console.error(`missing ${wasmPath} — run \`pnpm build:plugins\` first`);
    process.exit(1);
  }
  if (!existsSync(marketplaceRepo)) {
    console.error(`missing ${marketplaceRepo} — clone the openldr-ce-marketplace repo as a sibling of this repo`);
    process.exit(1);
  }
  const wasm = new Uint8Array(readFileSync(wasmPath));
  const kp = loadOrCreateKeypair();

  console.log(`Publisher ${PUBLISHER.id} fingerprint=${kp.fingerprint}`);
  await buildBundle({ dirName: 'whonet-narrow', version: '1.0.0', resourceTypes: ['Patient'], wasm, kp });
  await buildBundle({ dirName: 'whonet-wide', version: '1.1.0', resourceTypes: ['Patient', 'Specimen', 'Observation', 'DiagnosticReport', 'ServiceRequest'], wasm, kp });
  await buildDhis2SinkBundle(kp);
  console.log('\n✅ bundles built. Private key (gitignored): scripts/.marketplace-keys/whonet.priv');
}

main();
