import { describe, it, expect } from 'vitest';
import { generatePublisherKeypair, signManifest, verifyArtifact, keyFingerprint } from './signing';

const manifest = { type: 'plugin', id: 'demo', version: '1.0.0' };
const payloadSha = 'a'.repeat(64);

describe('signing', () => {
  it('round-trips: sign then verify succeeds', () => {
    const kp = generatePublisherKeypair();
    const signature = signManifest(manifest, payloadSha, kp.privateKeyDer);
    expect(verifyArtifact({ ...manifest, signature }, payloadSha, kp.publicKeyDer)).toBe(true);
  });
  it('fingerprint is the sha256 of the public key DER', () => {
    const kp = generatePublisherKeypair();
    expect(kp.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(keyFingerprint(kp.publicKeyDer)).toBe(kp.fingerprint);
  });
  it('rejects a tampered manifest', () => {
    const kp = generatePublisherKeypair();
    const signature = signManifest(manifest, payloadSha, kp.privateKeyDer);
    expect(verifyArtifact({ ...manifest, id: 'evil', signature }, payloadSha, kp.publicKeyDer)).toBe(false);
  });
  it('rejects a tampered payload hash', () => {
    const kp = generatePublisherKeypair();
    const signature = signManifest(manifest, payloadSha, kp.privateKeyDer);
    expect(verifyArtifact({ ...manifest, signature }, 'b'.repeat(64), kp.publicKeyDer)).toBe(false);
  });
  it('rejects a wrong key', () => {
    const kp = generatePublisherKeypair();
    const other = generatePublisherKeypair();
    const signature = signManifest(manifest, payloadSha, kp.privateKeyDer);
    expect(verifyArtifact({ ...manifest, signature }, payloadSha, other.publicKeyDer)).toBe(false);
  });
  it('returns false when signature is absent', () => {
    const kp = generatePublisherKeypair();
    expect(verifyArtifact(manifest, payloadSha, kp.publicKeyDer)).toBe(false);
  });
});
