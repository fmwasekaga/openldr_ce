import { readFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArtifactManifest, type ArtifactManifest } from './artifact-manifest';
import { verifyArtifact, keyFingerprint } from './signing';

export interface Bundle {
  manifest: ArtifactManifest;
  raw: Record<string, unknown>;
  wasm: Uint8Array;
  publicKeyDer: Uint8Array;
  payloadSha256: string;
  /** Present only for plugin bundles whose manifest declares payload.ui. */
  ui?: Uint8Array;
}

/** Map from payload.kind to the filename stored in the bundle directory. */
const PAYLOAD_FILE: Record<string, string> = {
  plugin: 'plugin.wasm',
  'form-template': 'questionnaire.json',
  'report-template': 'report.json',
};

/** The payload filename for a manifest's payload.kind (defaults to plugin.wasm). */
export function payloadFileName(kind: string): string {
  return PAYLOAD_FILE[kind] ?? 'plugin.wasm';
}

/**
 * Assemble a Bundle from raw manifest JSON + payload bytes + hex public key.
 * Shared by readBundle (local dir) and HttpRegistrySource (remote fetch).
 */
export function assembleBundle(raw: Record<string, unknown>, payload: Uint8Array, pubHex: string, ui?: Uint8Array): Bundle {
  const manifest = parseArtifactManifest(raw);
  const publicKeyDer = Uint8Array.from(Buffer.from(pubHex.trim(), 'hex'));
  const payloadSha256 = createHash('sha256').update(payload).digest('hex');
  return { manifest, raw, wasm: payload, publicKeyDer, payloadSha256, ...(ui ? { ui } : {}) };
}

/** Map from payload.kind to the sha256 field name in the payload object. */
const SHA_FIELD: Record<string, string> = {
  plugin: 'wasmSha256',
  'form-template': 'questionnaireSha256',
  'report-template': 'templateSha256',
};

/**
 * Read a bundle directory containing:
 *   manifest.json          — the (signed) artifact manifest
 *   plugin.wasm            — plugin binary  (payload.kind === 'plugin')
 *   questionnaire.json     — FHIR Questionnaire  (payload.kind === 'form-template')
 *   report.json            — report definition  (payload.kind === 'report-template')
 *   publisher.pub          — hex-encoded SPKI DER public key
 */
export async function readBundle(dir: string): Promise<Bundle> {
  const raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const kind = String((raw.payload as { kind?: string } | null)?.kind ?? 'plugin');
  const payload = new Uint8Array(await readFile(join(dir, payloadFileName(kind))));
  const uiEntry = (raw.payload as { ui?: { entry?: string } } | null)?.ui?.entry;
  if (uiEntry !== undefined && (uiEntry !== basename(uiEntry) || uiEntry === '')) {
    throw new Error(`invalid ui entry '${uiEntry}': must be a plain filename inside the bundle`);
  }
  const ui = uiEntry ? new Uint8Array(await readFile(join(dir, uiEntry))) : undefined;
  const pubHex = await readFile(join(dir, 'publisher.pub'), 'utf8');
  return assembleBundle(raw, payload, pubHex, ui);
}

/**
 * Verify a bundle's integrity and signature.
 * Returns `{ valid: true, fingerprint }` on success, `{ valid: false, fingerprint }` otherwise.
 */
export function verifyBundle(b: Bundle): { valid: boolean; fingerprint: string } {
  const fingerprint = keyFingerprint(b.publicKeyDer);
  const okFp = b.manifest.publisher ? b.manifest.publisher.keyFingerprint === fingerprint : false;
  const kind = String((b.raw.payload as { kind?: string } | null)?.kind ?? 'plugin');
  const shaField = SHA_FIELD[kind] ?? 'wasmSha256';
  const okSha =
    b.raw.payload != null &&
    (b.raw.payload as Record<string, string>)[shaField] === b.payloadSha256;
  // UI integrity: when a manifest declares payload.ui, its bytes must match the signed sha.
  const uiMeta = (b.raw.payload as { ui?: { sha256?: string } } | null)?.ui;
  const okUi = !uiMeta ? true : !!b.ui && createHash('sha256').update(b.ui).digest('hex') === uiMeta.sha256;
  const valid = okFp && okSha && okUi && verifyArtifact(b.raw, b.payloadSha256, b.publicKeyDer);
  return { valid, fingerprint };
}
