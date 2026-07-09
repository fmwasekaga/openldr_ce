/**
 * Feature-detected polyfill for the TC39 "Uint8Array to/from base64 and hex"
 * methods (https://github.com/tc39/proposal-arraybuffer-base64), which
 * shipped natively in Chrome 140 / Firefox 133 / Safari 18.2 and later.
 *
 * `pdfjs-dist@^6` calls these directly with no fallback:
 *   - `Uint8Array.prototype.toHex()` — build/pdf.worker.mjs (document
 *     fingerprint hashing)
 *   - `Uint8Array.prototype.toBase64()` — build/pdf.mjs (font/image data URLs,
 *     signature data)
 *   - `Uint8Array.fromBase64()` (static) — build/pdf.mjs, build/pdf.worker.mjs
 *     (signature data)
 * On any browser older than the versions above (including the Chromium
 * pinned for this repo's Playwright e2e harness) these are `undefined`, and
 * the PDF Document tab throws `... .toHex is not a function` / `.toBase64 is
 * not a function` and never renders.
 *
 * Two call sites need this, in two separate JS realms:
 *   1. The main thread — import this module once, as early as possible (see
 *      apps/studio/src/main.tsx), before any pdfjs-dist code runs.
 *   2. The pdf.worker script, which pdfjs runs in a dedicated Worker with its
 *      *own* global scope — patching `Uint8Array.prototype` on the main
 *      thread does not reach it. `installUint8ArrayHexBase64Polyfill` is
 *      written as a single self-contained function (no references to module
 *      scope) specifically so `apps/studio/src/reports/pdfWorker.ts` can take
 *      its compiled `.toString()` and inject it into the worker's own script
 *      before the worker's own code runs. Keep all helper logic *inside* this
 *      function body — anything declared outside it will be `undefined` when
 *      re-run as an extracted string in the worker.
 */

interface Base64Options {
  alphabet?: 'base64' | 'base64url';
  omitPadding?: boolean;
}

interface FromResult {
  read: number;
  written: number;
}

// The project's `tsconfig.json` targets `lib: ["ES2022", ...]`, which predates
// these TC39 methods, so declare them ambiently (harmless if a newer TS lib
// already has compatible declarations — duplicate compatible members merge).
declare global {
  interface Uint8Array {
    toHex(): string;
    setFromHex(hex: string): FromResult;
    toBase64(options?: Base64Options): string;
    setFromBase64(base64: string, options?: Base64Options): FromResult;
  }
  interface Uint8ArrayConstructor {
    fromHex(hex: string): Uint8Array;
    fromBase64(base64: string, options?: Base64Options): Uint8Array;
  }
}

/**
 * Installs the polyfill methods on `Uint8Array`/`Uint8Array.prototype`,
 * skipping any the engine already implements natively. Self-contained on
 * purpose (see module doc) — do not factor helpers out of this function.
 */
export function installUint8ArrayHexBase64Polyfill(): void {
  const HEX_CHARS = '0123456789abcdef';

  function hexCharToNibble(code: number): number {
    if (code >= 48 && code <= 57) return code - 48; // 0-9
    if (code >= 97 && code <= 102) return code - 97 + 10; // a-f
    if (code >= 65 && code <= 70) return code - 65 + 10; // A-F
    throw new SyntaxError('Uint8Array hex polyfill: invalid hex character');
  }

  function toHexImpl(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i];
      out += HEX_CHARS[byte >> 4] + HEX_CHARS[byte & 0x0f];
    }
    return out;
  }

  function fromHexImpl(hex: string): Uint8Array {
    if (hex.length % 2 !== 0) {
      throw new SyntaxError('Uint8Array.fromHex: string length must be even');
    }
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) {
      const hi = hexCharToNibble(hex.charCodeAt(i * 2));
      const lo = hexCharToNibble(hex.charCodeAt(i * 2 + 1));
      out[i] = (hi << 4) | lo;
    }
    return out;
  }

  function setFromHexImpl(target: Uint8Array, hex: string): FromResult {
    // Decode as many whole byte-pairs as fit into `target`, stopping at the
    // first invalid pair (matches the spec's "best effort, partial write"
    // behaviour for setFromHex/setFromBase64).
    const maxBytes = Math.min(target.length, Math.floor(hex.length / 2));
    let written = 0;
    for (; written < maxBytes; written++) {
      let hi: number;
      let lo: number;
      try {
        hi = hexCharToNibble(hex.charCodeAt(written * 2));
        lo = hexCharToNibble(hex.charCodeAt(written * 2 + 1));
      } catch {
        break;
      }
      target[written] = (hi << 4) | lo;
    }
    return { read: written * 2, written };
  }

  const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function alphabetFor(options?: Base64Options): string {
    return options?.alphabet === 'base64url' ? BASE64URL_ALPHABET : BASE64_ALPHABET;
  }

  function toBase64Impl(bytes: Uint8Array, options?: Base64Options): string {
    const chars = alphabetFor(options);
    const omitPadding = options?.omitPadding ?? false;
    let out = '';
    let i = 0;
    for (; i + 3 <= bytes.length; i += 3) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
      out += chars[(n >> 18) & 0x3f] + chars[(n >> 12) & 0x3f] + chars[(n >> 6) & 0x3f] + chars[n & 0x3f];
    }
    const remaining = bytes.length - i;
    if (remaining === 1) {
      const n = bytes[i] << 16;
      out += chars[(n >> 18) & 0x3f] + chars[(n >> 12) & 0x3f];
      if (!omitPadding) out += '==';
    } else if (remaining === 2) {
      const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
      out += chars[(n >> 18) & 0x3f] + chars[(n >> 12) & 0x3f] + chars[(n >> 6) & 0x3f];
      if (!omitPadding) out += '=';
    }
    return out;
  }

  function base64CharToSextet(char: string, alphabet: string): number {
    const idx = alphabet.indexOf(char);
    if (idx === -1) {
      throw new SyntaxError(`Uint8Array base64 polyfill: invalid character "${char}"`);
    }
    return idx;
  }

  function fromBase64Impl(base64: string, options?: Base64Options): Uint8Array {
    const alphabet = alphabetFor(options);
    const cleaned = base64.replace(/=+$/, '');
    if (cleaned.length % 4 === 1) {
      throw new SyntaxError('Uint8Array.fromBase64: invalid base64 string length');
    }
    const byteLength = Math.floor((cleaned.length * 3) / 4);
    const out = new Uint8Array(byteLength);
    let outIdx = 0;
    for (let i = 0; i < cleaned.length; i += 4) {
      const c0 = base64CharToSextet(cleaned[i], alphabet);
      const c1 = i + 1 < cleaned.length ? base64CharToSextet(cleaned[i + 1], alphabet) : 0;
      const hasC2 = i + 2 < cleaned.length;
      const hasC3 = i + 3 < cleaned.length;
      const c2 = hasC2 ? base64CharToSextet(cleaned[i + 2], alphabet) : 0;
      const c3 = hasC3 ? base64CharToSextet(cleaned[i + 3], alphabet) : 0;
      const n = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
      if (outIdx < out.length) out[outIdx++] = (n >> 16) & 0xff;
      if (hasC2 && outIdx < out.length) out[outIdx++] = (n >> 8) & 0xff;
      if (hasC3 && outIdx < out.length) out[outIdx++] = n & 0xff;
    }
    return out;
  }

  function setFromBase64Impl(target: Uint8Array, base64: string, options?: Base64Options): FromResult {
    const decoded = fromBase64Impl(base64, options);
    const written = Math.min(target.length, decoded.length);
    target.set(decoded.subarray(0, written));
    return { read: base64.length, written };
  }

  const proto = Uint8Array.prototype as unknown as Record<string, unknown>;
  const ctor = Uint8Array as unknown as Record<string, unknown>;

  if (typeof proto.toHex !== 'function') {
    proto.toHex = function toHex(this: Uint8Array): string {
      return toHexImpl(this);
    };
  }
  if (typeof ctor.fromHex !== 'function') {
    ctor.fromHex = function fromHex(hex: string): Uint8Array {
      return fromHexImpl(hex);
    };
  }
  if (typeof proto.setFromHex !== 'function') {
    proto.setFromHex = function setFromHex(this: Uint8Array, hex: string): FromResult {
      return setFromHexImpl(this, hex);
    };
  }
  if (typeof proto.toBase64 !== 'function') {
    proto.toBase64 = function toBase64(this: Uint8Array, options?: Base64Options): string {
      return toBase64Impl(this, options);
    };
  }
  if (typeof ctor.fromBase64 !== 'function') {
    ctor.fromBase64 = function fromBase64(base64: string, options?: Base64Options): Uint8Array {
      return fromBase64Impl(base64, options);
    };
  }
  if (typeof proto.setFromBase64 !== 'function') {
    proto.setFromBase64 = function setFromBase64(this: Uint8Array, base64: string, options?: Base64Options): FromResult {
      return setFromBase64Impl(this, base64, options);
    };
  }
}

/**
 * Whether *this* realm's engine already implemented all six methods natively,
 * i.e. no polyfilling was needed here. Captured before `installUint8ArrayHexBase64Polyfill()`
 * runs below, because that call patches `Uint8Array.prototype`/`Uint8Array` in
 * place — checking `typeof Uint8Array.prototype.toHex` *after* installing
 * would always report `true` on the main thread, which is exactly the wrong
 * answer `apps/studio/src/reports/pdfWorker.ts` needs when deciding whether
 * the *worker's* separate realm also needs patching.
 */
export const hasNativeUint8ArrayHexBase64Support =
  typeof Uint8Array.prototype.toHex === 'function' &&
  typeof Uint8Array.prototype.toBase64 === 'function' &&
  typeof Uint8Array.fromBase64 === 'function';

installUint8ArrayHexBase64Polyfill();
