import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchReportRuns, type ReportRun } from '../api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';

interface Props {
  open: boolean;
  reportId: string;
  onClose: () => void;
  onApplyParams: (params: Record<string, string>) => void;
}

export function ReportHistoryDrawer({ open, reportId, onClose, onApplyParams }: Props) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    fetchReportRuns({ reportId, limit: 50 })
      .then((res) => {
        if (active) {
          setRuns(res.runs);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setError(t('reports.history.loadError'));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [open, reportId, t]);

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <SheetContent className="w-[520px] gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t('reports.history.title')}</SheetTitle>
          <SheetDescription>{reportId}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : error ? (
            <div className="p-4 text-sm text-destructive">{error}</div>
          ) : runs.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">{t('reports.history.empty')}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('reports.history.colFormat')}</TableHead>
                  <TableHead>{t('reports.history.colRows')}</TableHead>
                  <TableHead>{t('reports.history.colUser')}</TableHead>
                  <TableHead>{t('reports.history.colWhen')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((r) => (
                  <TableRow
                    key={r.id}
                    className="cursor-pointer"
                    onClick={() => {
                      onApplyParams(r.params);
                      onClose();
                    }}
                  >
                    <TableCell>
                      <Badge variant="secondary">{r.format}</Badge>
                    </TableCell>
                    <TableCell className="tabular-nums">{r.rowCount ?? '—'}</TableCell>
                    <TableCell>{r.userName ?? '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {new Date(r.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
