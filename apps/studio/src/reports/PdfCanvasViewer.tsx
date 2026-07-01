import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFDocumentLoadingTask, RenderTask } from 'pdfjs-dist';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.2;

interface Props {
  blob: Blob;
  fileName: string;
  onDownload?: () => void;
}

export function PdfCanvasViewer({ blob, fileName, onDownload }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<PDFDocumentProxy | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);

  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [scale, setScale] = useState(1.2);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setErrorMsg('');
    blob
      .arrayBuffer()
      .then((buf) => {
        if (cancelled) return;
        const task = pdfjs.getDocument({ data: new Uint8Array(buf) });
        loadingTaskRef.current = task;
        return task.promise.then((doc) => {
          if (cancelled) return;
          docRef.current = doc;
          setNumPages(doc.numPages);
          setPageNum(1);
          setStatus('ready');
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
      renderTaskRef.current?.cancel();
      void loadingTaskRef.current?.destroy();
      loadingTaskRef.current = null;
      docRef.current = null;
    };
  }, [blob]);

  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (status !== 'ready' || !doc || !canvas) return;
    let cancelled = false;
    renderTaskRef.current?.cancel();
    doc
      .getPage(pageNum)
      .then((page) => {
        if (cancelled) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr });
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width / dpr)}px`;
        canvas.style.height = `${Math.floor(viewport.height / dpr)}px`;
        // pdfjs v6: prefer the `canvas` parameter; `canvasContext` is the legacy path.
        const task = page.render({ canvas, viewport });
        renderTaskRef.current = task;
        task.promise.catch(() => {});
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setStatus('error');
          setErrorMsg(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [pageNum, scale, status]);

  const handleDownload = useCallback(() => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    onDownload?.();
  }, [blob, fileName, onDownload]);

  if (status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm text-destructive">{t('reports.pdfRenderError')}</p>
        <p className="text-xs text-muted-foreground">{errorMsg}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border bg-[#1b1b1b] px-3 py-1.5 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
            className="rounded p-1 hover:bg-[rgba(70,130,180,0.12)] disabled:opacity-30"
            aria-label={t('common.previous')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="tabular-nums">{numPages > 0 ? `${pageNum} / ${numPages}` : '—'}</span>
          <button
            onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
            disabled={pageNum >= numPages}
            className="rounded p-1 hover:bg-[rgba(70,130,180,0.12)] disabled:opacity-30"
            aria-label={t('common.next')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale((s) => Math.max(MIN_SCALE, Math.round((s - SCALE_STEP) * 10) / 10))}
            className="rounded p-1 hover:bg-[rgba(70,130,180,0.12)]"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="w-10 text-center tabular-nums">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale((s) => Math.min(MAX_SCALE, Math.round((s + SCALE_STEP) * 10) / 10))}
            className="rounded p-1 hover:bg-[rgba(70,130,180,0.12)]"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
        </div>
        <button
          onClick={handleDownload}
          className="ml-auto flex items-center gap-1.5 rounded px-2 py-1 hover:bg-[rgba(70,130,180,0.12)]"
        >
          <Download className="h-3.5 w-3.5" />
          {t('reports.download')}
        </button>
      </div>
      <div className="flex-1 overflow-auto bg-[#262626] p-5">
        {status === 'loading' ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : (
          <div className="flex justify-center">
            <canvas ref={canvasRef} className="shadow-lg" />
          </div>
        )}
      </div>
    </div>
  );
}
