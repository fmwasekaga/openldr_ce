import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { parseArtifactManifest, type ArtifactManifest } from './artifact-manifest';
import { verifyArtifact, keyFingerprint } from './signing';

export interface Bundle {
  manifest: ArtifactManifest;
  raw: Record<string, unknown>;
  wasm: Uint8Array;
  publicKeyDer: Uint8Array;
  payloadSha256: string;
}

/**
 * Read a bundle directory containing:
 *   manifest.json   — the (signed) artifact manifest
 *   plugin.wasm     — the plugin binary
 *   publisher.pub   — hex-encoded SPKI DER public key
 */
export async function readBundle(dir: string): Promise<Bundle> {
  const raw = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')) as Record<string, unknown>;
  const manifest = parseArtifactManifest(raw);
  const wasm = new Uint8Array(await readFile(join(dir, 'plugin.wasm')));
  const pubHex = (await readFile(join(dir, 'publisher.pub'), 'utf8')).trim();
  const publicKeyDer = Uint8Array.from(Buffer.from(pubHex, 'hex'));
  const payloadSha256 = createHash('sha256').update(wasm).digest('hex');
  return { manifest, raw, wasm, publicKeyDer, payloadSha256 };
}

/**
 * Verify a bundle's integrity and signature.
 * Returns `{ valid: true, fingerprint }` on success, `{ valid: false, fingerprint }` otherwise.
 */
export function verifyBundle(b: Bundle): { valid: boolean; fingerprint: string } {
  const fingerprint = keyFingerprint(b.publicKeyDer);
  const okFp = b.manifest.publisher ? b.manifest.publisher.keyFingerprint === fingerprint : false;
  const okSha =
    b.raw.payload != null &&
    (b.raw.payload as { wasmSha256?: string }).wasmSha256 === b.payloadSha256;
  const valid = okFp && okSha && verifyArtifact(b.raw, b.payloadSha256, b.publicKeyDer);
  return { valid, fingerprint };
}
