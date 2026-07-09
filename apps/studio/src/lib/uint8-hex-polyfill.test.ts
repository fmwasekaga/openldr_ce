import { describe, it, expect } from 'vitest';
import './uint8-hex-polyfill';

describe('uint8-hex-polyfill', () => {
  it('encodes bytes to a lowercase hex string via toHex', () => {
    expect(new Uint8Array([0, 255, 16]).toHex()).toBe('00ff10');
    expect(new Uint8Array([]).toHex()).toBe('');
    expect(new Uint8Array([0xab, 0xcd, 0xef]).toHex()).toBe('abcdef');
  });

  it('decodes a hex string to bytes via the static fromHex', () => {
    expect(Array.from(Uint8Array.fromHex('00ff10'))).toEqual([0, 255, 16]);
    expect(Array.from(Uint8Array.fromHex(''))).toEqual([]);
  });

  it('round-trips arbitrary byte arrays through toHex/fromHex', () => {
    const original = new Uint8Array([1, 2, 3, 254, 255, 0, 128, 17]);
    const roundTripped = Uint8Array.fromHex(original.toHex());
    expect(Array.from(roundTripped)).toEqual(Array.from(original));
  });

  it('rejects odd-length or non-hex strings via fromHex', () => {
    expect(() => Uint8Array.fromHex('abc')).toThrow(SyntaxError);
    expect(() => Uint8Array.fromHex('zz')).toThrow(SyntaxError);
  });

  it('decodes into an existing buffer via setFromHex, reporting read/written', () => {
    const target = new Uint8Array(2);
    const result = target.setFromHex('00ff10'); // 3 bytes of hex, only room for 2
    expect(result.written).toBe(2);
    expect(result.read).toBe(4);
    expect(Array.from(target)).toEqual([0, 255]);
  });

  it('encodes bytes to base64 via toBase64, matching Buffer semantics', () => {
    // Built from a literal (rather than e.g. TextEncoder) to stay in the same
    // realm as the polyfilled Uint8Array.prototype under jsdom.
    const bytes = new Uint8Array([104, 101, 108, 108, 111, 32, 119, 111, 114, 108, 100]); // "hello world"
    expect(bytes.toBase64()).toBe(Buffer.from(bytes).toString('base64'));
  });

  it('round-trips arbitrary byte arrays through toBase64/fromBase64', () => {
    const original = new Uint8Array([1, 2, 3, 254, 255, 0, 128, 17, 200]);
    const roundTripped = Uint8Array.fromBase64(original.toBase64());
    expect(Array.from(roundTripped)).toEqual(Array.from(original));
  });

  it('supports the base64url alphabet and omitPadding option', () => {
    const bytes = new Uint8Array([251, 255, 191]); // encodes to chars needing +/ vs -_ and padding
    const standard = bytes.toBase64();
    const urlSafe = bytes.toBase64({ alphabet: 'base64url' });
    expect(urlSafe).not.toContain('+');
    expect(urlSafe).not.toContain('/');
    expect(Array.from(Uint8Array.fromBase64(urlSafe, { alphabet: 'base64url' }))).toEqual(Array.from(bytes));

    const noPad = bytes.toBase64({ omitPadding: true });
    expect(noPad.endsWith('=')).toBe(false);
    expect(standard.replace(/=+$/, '')).toBe(noPad);
  });

  it('decodes into an existing buffer via setFromBase64, reporting written length', () => {
    const original = new Uint8Array([10, 20, 30, 40]);
    const target = new Uint8Array(2);
    const result = target.setFromBase64(original.toBase64());
    expect(result.written).toBe(2);
    expect(Array.from(target)).toEqual([10, 20]);
  });
});
