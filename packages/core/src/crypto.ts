import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { ConfigError, OpenLdrError } from './errors';

// AES-256-GCM. Packed sealed blob = base64(iv ‖ ciphertext ‖ authTag).
const IV_LEN = 12; // GCM standard 96-bit nonce
const TAG_LEN = 16;

/** Parse a base64-encoded 32-byte AES-256 key. Throws a clear ConfigError otherwise. */
export function parseSecretKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, 'base64');
  if (key.length !== 32) {
    throw new ConfigError(`SECRETS_ENCRYPTION_KEY must decode to 32 bytes for AES-256 (got ${key.length})`);
  }
  return key;
}

/** Encrypt `plaintext` with AES-256-GCM under `key`; returns base64(iv ‖ ciphertext ‖ tag). */
export function seal(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

/** Inverse of `seal`. Throws on a wrong key or tampered blob (GCM auth failure) — never
 *  returns partial/garbage plaintext. */
export function open(blob: string, key: Buffer): string {
  const buf = Buffer.from(blob, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new OpenLdrError('sealed secret is too short to be valid');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new OpenLdrError('failed to decrypt sealed secret (wrong key or corrupted data)');
  }
}
