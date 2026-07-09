import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { installUint8ArrayHexBase64Polyfill, hasNativeUint8ArrayHexBase64Support } from '@/lib/uint8-hex-polyfill';

/**
 * pdfjs-dist@6 runs its worker in a dedicated Worker (its own JS realm), and
 * that worker script calls `Uint8Array.prototype.toHex()` / `.toBase64()` /
 * `Uint8Array.fromBase64()` directly with no fallback (see
 * apps/studio/src/lib/uint8-hex-polyfill.ts for the full rundown). The
 * polyfill imported in main.tsx only patches the *main* thread's
 * `Uint8Array` — it never reaches the worker's separate global scope. On
 * browsers without native support we fetch the built worker script and
 * prepend the same polyfill (as a self-contained IIFE, via
 * `Function.prototype.toString`) before creating the Blob URL pdfjs's worker
 * is instantiated from.
 */
let workerReadyPromise: Promise<void> | null = null;

export function ensurePdfWorkerConfigured(): Promise<void> {
  if (!workerReadyPromise) {
    workerReadyPromise = configureWorker();
  }
  return workerReadyPromise;
}

async function configureWorker(): Promise<void> {
  if (hasNativeUint8ArrayHexBase64Support) {
    // Native support (checked before this module's own polyfill import could
    // have patched the main thread's Uint8Array): no need for the fetch+Blob
    // indirection below.
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    return;
  }
  try {
    const response = await fetch(workerUrl);
    if (!response.ok) throw new Error(`Failed to fetch pdf worker script: ${response.status}`);
    let workerSource = await response.text();
    // In dev, Vite's middleware rewrites `import.meta.url`-relative asset
    // loads inside this file into an `import { injectQuery } from
    // "/studio/@vite/client"` plus root-relative ("/...") specifiers
    // elsewhere. Those resolve fine for a normal http(s) worker URL, but a
    // `blob:` URL has no hierarchical base to resolve a root-relative
    // specifier against ("Invalid relative url or base scheme isn't
    // hierarchical"). Make them absolute against the current origin --
    // a no-op in a production build, where nothing root-relative is injected.
    workerSource = workerSource.replace(
      /(\bfrom\s*|\bimport\s*\(\s*)(["'])(\/[^"']+)\2/g,
      (_match, prefix: string, quote: string, path: string) => `${prefix}${quote}${location.origin}${path}${quote}`,
    );
    const polyfillSnippet = `(${installUint8ArrayHexBase64Polyfill.toString()})();`;
    const blob = new Blob([polyfillSnippet, '\n', workerSource], { type: 'text/javascript' });
    pdfjs.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);
  } catch {
    // Best-effort: if we can't fetch+patch the worker script (offline, a test
    // environment without a real fetch/network stack, etc.) fall back to the
    // plain worker URL -- no worse than before this fix.
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  }
}
