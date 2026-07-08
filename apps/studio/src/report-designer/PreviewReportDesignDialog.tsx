import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogClose, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { previewReportDesign } from '../api';
import { PdfCanvasViewer } from '../reports/PdfCanvasViewer';
import type { ReportDesign } from './types';

export function PreviewReportDesignDialog({ open, design, onOpenChange }: {
  open: boolean; design: ReportDesign; onOpenChange: (o: boolean) => void;
}): JSX.Element {
  const { t } = useTranslation();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) { setBlob(null); return; }
    let active = true;
    setLoading(true); setError(undefined); setBlob(null);
    previewReportDesign(design)
      .then((b) => { if (active) { setBlob(b); setLoading(false); } })
      .catch((e: unknown) => { if (active) { setError(e instanceof Error ? e.message : String(e)); setLoading(false); } });
    return () => { active = false; };
    // Re-fetch when the dialog opens or the working design changes (so unsaved edits re-render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, JSON.stringify(design)]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogClose
          aria-label={t('common.close')}
          className="absolute right-4 top-4 z-10 rounded p-1 text-muted-foreground hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" />
        </DialogClose>
        <DialogTitle className="text-base font-semibold">{t('reportDesigner.previewTitle')}</DialogTitle>
        <DialogDescription className="sr-only">{t('reportDesigner.previewTitle')}</DialogDescription>
        <div className="h-[70vh]">
          {loading && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">{t('reportDesigner.rendering')}</div>}
          {error && <div className="p-4 text-sm text-destructive">{t('reportDesigner.previewError')}: {error}</div>}
          {blob && <PdfCanvasViewer blob={blob} fileName={`${design.name || design.id}.pdf`} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
