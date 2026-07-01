import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchReportPdf } from '../api';
import { PdfCanvasViewer } from './PdfCanvasViewer';

interface Props {
  reportId: string;
  params: Record<string, string>;
  onDownload?: () => void;
}

export function ReportDocumentTab({ reportId, params, onDownload }: Props) {
  const { t } = useTranslation();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(true);
  const key = `${reportId}?${new URLSearchParams(params).toString()}`;

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    setBlob(null);
    fetchReportPdf(reportId, params)
      .then((b) => {
        if (active) {
          setBlob(b);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (active) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center">
        <p className="text-sm text-destructive">{t('reports.pdfRenderError')}</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }
  if (!blob) return null;
  return <PdfCanvasViewer blob={blob} fileName={`${reportId}.pdf`} onDownload={onDownload} />;
}
