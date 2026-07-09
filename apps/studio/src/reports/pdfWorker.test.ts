import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: { workerSrc: '' } }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'https://example.test/pdf.worker.min.mjs' }));

describe('ensurePdfWorkerConfigured', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it('points at the plain worker URL when the engine already has native hex/base64 support', async () => {
    vi.doMock('@/lib/uint8-hex-polyfill', () => ({
      hasNativeUint8ArrayHexBase64Support: true,
      installUint8ArrayHexBase64Polyfill: () => {},
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

  it('fetches the worker script, prepends the polyfill, and points at a Blob URL when native support is missing', async () => {
    vi.doMock('@/lib/uint8-hex-polyfill', () => ({
      hasNativeUint8ArrayHexBase64Support: false,
      installUint8ArrayHexBase64Polyfill: function installUint8ArrayHexBase64Polyfill() {
        /* noop stand-in -- the real implementation is covered by uint8-hex-polyfill.test.ts */
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
    const blobArgs = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blobArgs.type).toBe('text/javascript');
  });

  it('only configures the worker once across repeated calls (cached promise)', async () => {
    vi.doMock('@/lib/uint8-hex-polyfill', () => ({
      hasNativeUint8ArrayHexBase64Support: true,
      installUint8ArrayHexBase64Polyfill: () => {},
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
