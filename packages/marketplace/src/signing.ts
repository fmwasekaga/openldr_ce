import { createHash, createPublicKey, createPrivateKey, generateKeyPairSync, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { canonicalSigningBytes } from './bundle';

export interface PublisherKeypair {
  publicKeyDer: Uint8Array;   // SPKI DER
  privateKeyDer: Uint8Array;  // PKCS8 DER
  fingerprint: string;        // sha256 hex of publicKeyDer
}

export function keyFingerprint(publicKeyDer: Uint8Array): string {
  return createHash('sha256').update(publicKeyDer).digest('hex');
}

export function generatePublisherKeypair(): PublisherKeypair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const privateKeyDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  return { publicKeyDer, privateKeyDer, fingerprint: keyFingerprint(publicKeyDer) };
}

export function signManifest(manifest: Record<string, unknown>, payloadSha256: string, privateKeyDer: Uint8Array): string {
  const key = createPrivateKey({ key: Buffer.from(privateKeyDer), format: 'der', type: 'pkcs8' });
  // Ed25519: algorithm arg must be null.
  const sig = cryptoSign(null, Buffer.from(canonicalSigningBytes(manifest, payloadSha256)), key);
  return sig.toString('hex');
}

export function verifyArtifact(manifest: Record<string, unknown>, payloadSha256: string, publicKeyDer: Uint8Array): boolean {
  const signature = manifest.signature;
  if (typeof signature !== 'string' || signature.length === 0) return false;
  try {
    const key = createPublicKey({ key: Buffer.from(publicKeyDer), format: 'der', type: 'spki' });
    return cryptoVerify(null, Buffer.from(canonicalSigningBytes(manifest, payloadSha256)), key, Buffer.from(signature, 'hex'));
  } catch {
    return false;
  }
}
