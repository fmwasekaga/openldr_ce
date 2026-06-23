import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { seal, open, parseSecretKey } from './crypto';

const key = randomBytes(32);
const b64Key = key.toString('base64');

describe('crypto (AES-256-GCM)', () => {
  it('round-trips plaintext through seal/open', () => {
    const secret = JSON.stringify({ baseUrl: 'https://dhis2.example', username: 'admin', password: 'p@ss' });
    const blob = seal(secret, key);
    expect(blob).not.toContain('admin'); // ciphertext, not plaintext
    expect(open(blob, key)).toBe(secret);
  });

  it('produces a different blob each time (random IV) but opens to the same plaintext', () => {
    const a = seal('x', key);
    const b = seal('x', key);
    expect(a).not.toBe(b);
    expect(open(a, key)).toBe('x');
    expect(open(b, key)).toBe('x');
  });

  it('fails closed on a wrong key', () => {
    const blob = seal('secret', key);
    expect(() => open(blob, randomBytes(32))).toThrow(/decrypt/i);
  });

  it('fails closed on a tampered blob', () => {
    const blob = seal('secret', key);
    const raw = Buffer.from(blob, 'base64');
    raw[raw.length - 1] ^= 0xff; // flip a bit in the auth tag
    expect(() => open(raw.toString('base64'), key)).toThrow(/decrypt/i);
  });

  it('rejects a too-short blob', () => {
    expect(() => open(Buffer.from('short').toString('base64'), key)).toThrow(/too short/i);
  });

  it('parseSecretKey accepts a 32-byte base64 key', () => {
    expect(parseSecretKey(b64Key)).toEqual(key);
  });

  it('parseSecretKey rejects a wrong-length key', () => {
    expect(() => parseSecretKey(randomBytes(16).toString('base64'))).toThrow(/32 bytes/);
  });
});
