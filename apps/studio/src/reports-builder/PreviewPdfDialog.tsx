import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { previewReportTemplate } from '../api';
import { PdfCanvasViewer } from '../reports/PdfCanvasViewer';

export function PreviewPdfDialog({ open, reportId, params, onClose }: {
  open: boolean; reportId: string; params: Record<string, string>; onClose: () => void;
}): JSX.Element {
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) { setBlob(null); return; }
    let active = true;
    setLoading(true); setError(undefined); setBlob(null);
    previewReportTemplate(reportId, params)
      .then((b) => { if (active) { setBlob(b); setLoading(false); } })
      .catch((e: unknown) => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reportId, JSON.stringify(params)]);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-4xl">
        <DialogTitle className="text-base font-semibold">Preview</DialogTitle>
        <DialogDescription className="sr-only">Report PDF preview</DialogDescription>
        <div className="h-[70vh]">
          {loading && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Rendering…</div>}
          {error && <div className="p-4 text-sm text-destructive">{error}</div>}
          {blob && <PdfCanvasViewer blob={blob} fileName={`${reportId}.pdf`} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
