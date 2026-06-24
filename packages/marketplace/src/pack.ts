import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArtifactManifest, type ArtifactManifest } from './artifact-manifest';
import { signManifest, keyFingerprint } from './signing';
import { readBundle, verifyBundle } from './bundle-fs';

export interface PackInput {
  manifest: Record<string, unknown>; // unsigned artifact manifest (publisher.keyFingerprint + payload sha are overwritten)
  payload: Uint8Array;
  outDir: string;
  privateKeyDer: Uint8Array;
  publicKeyDer: Uint8Array;
  /** UI bytes (ui.html) for a plugin whose manifest declares payload.ui.entry. Required when the
   *  manifest declares a webview ui entry; ignored otherwise. */
  ui?: Uint8Array;
}
export interface PackResult { bundleDir: string; fingerprint: string; manifest: ArtifactManifest }

const PAYLOAD_FILE: Record<string, string> = {
  plugin: 'plugin.wasm',
  'form-template': 'questionnaire.json',
  'report-template': 'report.json',
};
const SHA_FIELD: Record<string, string> = {
  plugin: 'wasmSha256',
  'form-template': 'questionnaireSha256',
  'report-template': 'templateSha256',
};

export async function packBundle(input: PackInput): Promise<PackResult> {
  const fingerprint = keyFingerprint(input.publicKeyDer);
  const payloadSha = createHash('sha256').update(input.payload).digest('hex');

  // Build the unsigned manifest with sha + publisher fingerprint filled in; drop any stale signature.
  const draft = { ...input.manifest } as Record<string, unknown>;
  delete draft.signature;
  const publisher = { ...(draft.publisher as Record<string, unknown> | undefined) };
  publisher.keyFingerprint = fingerprint;
  draft.publisher = publisher;
  const payload = { ...(draft.payload as Record<string, unknown>) };
  const kind = String(payload.kind);
  const shaField = SHA_FIELD[kind];
  if (!shaField) throw new Error(`packBundle: unsupported payload kind ${kind}`);
  payload[shaField] = payloadSha;
  draft.payload = payload;

  const parsed = parseArtifactManifest(draft); // validates before signing
  const signature = signManifest(parsed as unknown as Record<string, unknown>, payloadSha, input.privateKeyDer);
  const signedManifest = { ...(parsed as unknown as Record<string, unknown>), signature };

  // A webview ui contribution declares a single ui.html (basename); write its bytes alongside the
  // payload so readBundle finds it. readBundle re-validates uiEntry === basename(uiEntry), so the
  // join can't escape outDir. If the manifest declares no ui entry, input.ui is ignored.
  const uiEntry = (parsed.payload as { ui?: { entry?: string } }).ui?.entry;
  if (uiEntry && !input.ui) {
    throw new Error('packBundle: manifest declares payload.ui.entry but no ui bytes were provided');
  }

  await mkdir(input.outDir, { recursive: true });
  await writeFile(join(input.outDir, 'manifest.json'), JSON.stringify(signedManifest, null, 2));
  await writeFile(join(input.outDir, PAYLOAD_FILE[kind]), input.payload);
  if (uiEntry && input.ui) await writeFile(join(input.outDir, uiEntry), input.ui);
  await writeFile(join(input.outDir, 'publisher.pub'), Buffer.from(input.publicKeyDer).toString('hex'));

  // Self-check: the bundle we just wrote must verify.
  const check = verifyBundle(await readBundle(input.outDir));
  if (!check.valid) throw new Error('packBundle: produced an invalid bundle (internal error)');

  return { bundleDir: input.outDir, fingerprint, manifest: parsed };
}
