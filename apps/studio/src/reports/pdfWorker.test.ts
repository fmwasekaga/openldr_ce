import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' } }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'https://example.test/pdf.worker.min.mjs' }));

describe('ensurePdfWorkerConfigured', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('points at the plain worker URL when the engine already has native support for both APIs', async () => {
    vi.doMock('@/lib/uint8-hex-polyfill', () => ({
      hasNativeUint8ArrayHexBase64Support: true,
      installUint8ArrayHexBase64Polyfill: () => {},
    }));
    vi.doMock('@/lib/map-upsert-polyfill', () => ({
      hasNativeMapUpsertSupport: true,
      installMapUpsertPolyfill: () => {},
    }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const pdfjs = await import('pdfjs-dist');
    const { ensurePdfWorkerConfigured } = await import('./pdfWorker');
    await ensurePdfWorkerConfigured();

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('https://example.test/pdf.worker.min.mjs');
    // The fetch+Blob indirection is unnecessary (and skipped) when native support exists.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches the worker script, prepends both polyfills, and points at a Blob URL when Uint8Array support is missing', async () => {
    vi.doMock('@/lib/uint8-hex-polyfill', () => ({
      hasNativeUint8ArrayHexBase64Support: false,
      installUint8ArrayHexBase64Polyfill: function installUint8ArrayHexBase64Polyfill() {
        /* noop stand-in -- the real implementation is covered by uint8-hex-polyfill.test.ts */
      },
    }));
    vi.doMock('@/lib/map-upsert-polyfill', () => ({
      hasNativeMapUpsertSupport: true,
      installMapUpsertPolyfill: function installMapUpsertPolyfill() {
        /* noop stand-in -- the real implementation is covered by map-upsert-polyfill.test.ts */
      },
    }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('/* original worker body */') });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock-worker');

    const pdfjs = await import('pdfjs-dist');
    const { ensurePdfWorkerConfigured } = await import('./pdfWorker');
    await ensurePdfWorkerConfigured();

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/pdf.worker.min.mjs');
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('blob:mock-worker');
    const blobArg = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blobArg.type).toBe('text/javascript');
    const blobText = await blobArg.text();
    expect(blobText).toContain('installUint8ArrayHexBase64Polyfill');
    expect(blobText).toContain('installMapUpsertPolyfill');
    expect(blobText).toContain('/* original worker body */');
  });

  it('takes the Blob path when only the Map upsert API is missing', async () => {
    vi.doMock('@/lib/uint8-hex-polyfill', () => ({
      hasNativeUint8ArrayHexBase64Support: true,
      installUint8ArrayHexBase64Polyfill: function installUint8ArrayHexBase64Polyfill() {},
    }));
    vi.doMock('@/lib/map-upsert-polyfill', () => ({
      hasNativeMapUpsertSupport: false,
      installMapUpsertPolyfill: function installMapUpsertPolyfill() {},
    }));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('/* original worker body */') });
    vi.stubGlobal('fetch', fetchMock);
    URL.createObjectURL = vi.fn(() => 'blob:mock-worker');

    const pdfjs = await import('pdfjs-dist');
    const { ensurePdfWorkerConfigured } = await import('./pdfWorker');
    await ensurePdfWorkerConfigured();

    expect(fetchMock).toHaveBeenCalledWith('https://example.test/pdf.worker.min.mjs');
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('blob:mock-worker');
  });

  it('only configures the worker once across repeated calls (cached promise)', async () => {
    vi.doMock('@/lib/uint8-hex-polyfill', () => ({
      hasNativeUint8ArrayHexBase64Support: true,
      installUint8ArrayHexBase64Polyfill: () => {},
    }));
    vi.doMock('@/lib/map-upsert-polyfill', () => ({
      hasNativeMapUpsertSupport: true,
      installMapUpsertPolyfill: () => {},
    }));
    const { ensurePdfWorkerConfigured } = await import('./pdfWorker');
    const first = ensurePdfWorkerConfigured();
    const second = ensurePdfWorkerConfigured();
    expect(first).toBe(second);
    await first;
  });

  it('falls back to the plain worker URL if fetching/patching the worker script fails', async () => {
    vi.doMock('@/lib/uint8-hex-polyfill', () => ({
      hasNativeUint8ArrayHexBase64Support: false,
      installUint8ArrayHexBase64Polyfill: function installUint8ArrayHexBase64Polyfill() {},
    }));
    vi.doMock('@/lib/map-upsert-polyfill', () => ({
      hasNativeMapUpsertSupport: false,
      installMapUpsertPolyfill: function installMapUpsertPolyfill() {},
    }));
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('offline'))),
    );

    const pdfjs = await import('pdfjs-dist');
    const { ensurePdfWorkerConfigured } = await import('./pdfWorker');
    await ensurePdfWorkerConfigured();

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe('https://example.test/pdf.worker.min.mjs');
  });
});
