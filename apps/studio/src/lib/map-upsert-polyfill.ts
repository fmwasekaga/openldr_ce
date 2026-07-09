/**
 * Feature-detected polyfill for the TC39 "Map.prototype.getOrInsert" upsert
 * proposal (https://github.com/tc39/proposal-upsert), which adds
 * `getOrInsert(key, value)` and `getOrInsertComputed(key, callbackFn)` to both
 * `Map.prototype` and `WeakMap.prototype`. This is a *separate*, later-landing
 * proposal from the Uint8Array hex/base64 methods (see
 * apps/studio/src/lib/uint8-hex-polyfill.ts) and needs its own polyfill.
 *
 * `pdfjs-dist@^6` calls `getOrInsertComputed` directly with no fallback, and
 * pervasively:
 *   - build/pdf.mjs — ~11 call sites (main-thread realm)
 *   - build/pdf.worker.mjs — ~9 call sites (worker realm), on both plain
 *     `Map` caches *and* a `WeakMap` (`somCache`)
 * On any engine that predates this proposal — including the Chromium pinned
 * for this repo's Playwright e2e harness — `getOrInsertComputed` is
 * `undefined`, and the PDF Document tab throws
 * `... .getOrInsertComputed is not a function` and never renders. (pdfjs does
 * not currently call the non-computed `getOrInsert`, but we install it too for
 * completeness / robustness against pdfjs internals shifting between the two.)
 *
 * Two call sites need this, in two separate JS realms:
 *   1. The main thread — import this module once, as early as possible (see
 *      apps/studio/src/main.tsx), before any pdfjs-dist code runs.
 *   2. The pdf.worker script, which pdfjs runs in a dedicated Worker with its
 *      *own* global scope — patching `Map.prototype`/`WeakMap.prototype` on the
 *      main thread does not reach it. `installMapUpsertPolyfill` is written as a
 *      single self-contained function (no references to module scope)
 *      specifically so `apps/studio/src/reports/pdfWorker.ts` can take its
 *      compiled `.toString()` and inject it into the worker's own script before
 *      the worker's own code runs. Keep all helper logic *inside* this function
 *      body — anything declared outside it will be `undefined` when re-run as an
 *      extracted string in the worker.
 */

// The project's `tsconfig.json` targets `lib: ["ES2022", ...]`, which predates
// this TC39 proposal, so declare the members ambiently (harmless if a newer TS
// lib already declares compatible members — duplicate compatible members
// merge). The `WeakMap<K extends WeakKey, V>` constraint must match the one in
// TypeScript's own lib exactly, or declaration merging errors out.
declare global {
  interface Map<K, V> {
    getOrInsert(key: K, value: V): V;
    getOrInsertComputed(key: K, callbackFn: (key: K) => V): V;
  }
  interface WeakMap<K extends WeakKey, V> {
    getOrInsert(key: K, value: V): V;
    getOrInsertComputed(key: K, callbackFn: (key: K) => V): V;
  }
}

/**
 * Installs `getOrInsert`/`getOrInsertComputed` on `Map.prototype` and
 * `WeakMap.prototype`, skipping any the engine already implements natively.
 * Self-contained on purpose (see module doc) — do not factor helpers out of
 * this function.
 */
export function installMapUpsertPolyfill(): void {
  // Minimal structural view of the receiver shared by Map and WeakMap. Both
  // expose the same has/get/set trio this polyfill relies on.
  interface UpsertMap {
    has(key: unknown): boolean;
    get(key: unknown): unknown;
    set(key: unknown, value: unknown): unknown;
  }

  function getOrInsertImpl(map: UpsertMap, key: unknown, value: unknown): unknown {
    // Per spec: if the key is already present, return the existing value
    // untouched; otherwise insert `value` and return it.
    if (map.has(key)) return map.get(key);
    map.set(key, value);
    return value;
  }

  function getOrInsertComputedImpl(map: UpsertMap, key: unknown, callbackFn: (key: unknown) => unknown): unknown {
    if (typeof callbackFn !== 'function') {
      throw new TypeError('getOrInsertComputed: callback is not a function');
    }
    // Existing key wins without ever invoking the callback (spec: the callback
    // only runs when the key is absent).
    if (map.has(key)) return map.get(key);
    const value = callbackFn(key);
    // The callback may itself have inserted `key` while running; the spec's
    // final step sets `key` to the freshly computed `value` regardless, so an
    // unconditional set here matches its observable result.
    map.set(key, value);
    return value;
  }

  const mapProto = Map.prototype as unknown as Record<string, unknown>;
  const weakMapProto = WeakMap.prototype as unknown as Record<string, unknown>;

  if (typeof mapProto.getOrInsert !== 'function') {
    mapProto.getOrInsert = function getOrInsert(this: UpsertMap, key: unknown, value: unknown): unknown {
      return getOrInsertImpl(this, key, value);
    };
  }
  if (typeof mapProto.getOrInsertComputed !== 'function') {
    mapProto.getOrInsertComputed = function getOrInsertComputed(
      this: UpsertMap,
      key: unknown,
      callbackFn: (key: unknown) => unknown,
    ): unknown {
      return getOrInsertComputedImpl(this, key, callbackFn);
    };
  }
  if (typeof weakMapProto.getOrInsert !== 'function') {
    weakMapProto.getOrInsert = function getOrInsert(this: UpsertMap, key: unknown, value: unknown): unknown {
      return getOrInsertImpl(this, key, value);
    };
  }
  if (typeof weakMapProto.getOrInsertComputed !== 'function') {
    weakMapProto.getOrInsertComputed = function getOrInsertComputed(
      this: UpsertMap,
      key: unknown,
      callbackFn: (key: unknown) => unknown,
    ): unknown {
      return getOrInsertComputedImpl(this, key, callbackFn);
    };
  }
}

/**
 * Whether *this* realm's engine already implemented the upsert methods
 * natively, i.e. no polyfilling was needed here. Gated on `getOrInsertComputed`
 * (the only method pdfjs actually calls) for both `Map` and `WeakMap`. Captured
 * before `installMapUpsertPolyfill()` runs below, because that call patches the
 * prototypes in place — checking `typeof Map.prototype.getOrInsertComputed`
 * *after* installing would always report `true` on the main thread, which is
 * exactly the wrong answer `apps/studio/src/reports/pdfWorker.ts` needs when
 * deciding whether the *worker's* separate realm also needs patching.
 */
export const hasNativeMapUpsertSupport =
  typeof Map.prototype.getOrInsertComputed === 'function' &&
  typeof WeakMap.prototype.getOrInsertComputed === 'function';

installMapUpsertPolyfill();
