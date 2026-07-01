import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import { fetchReportRuns, fetchScheduleRuns, downloadScheduleRun, type ReportRun, type ReportScheduleRun } from '../api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';

interface Props {
  open: boolean;
  reportId: string;
  onClose: () => void;
  onApplyParams: (params: Record<string, string>) => void;
}

export function ReportHistoryDrawer({ open, reportId, onClose, onApplyParams }: Props) {
  const { t } = useTranslation();
  const [tab, setTab] = useState('activity');
  const [pageSize, setPageSize] = useState(25);

  const [runs, setRuns] = useState<ReportRun[]>([]);
  const [actTotal, setActTotal] = useState(0);
  const [actPage, setActPage] = useState(0);
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);

  const [schedRuns, setSchedRuns] = useState<ReportScheduleRun[]>([]);
  const [schedTotal, setSchedTotal] = useState(0);
  const [schedPage, setSchedPage] = useState(0);
  const [schedError, setSchedError] = useState<string>();

  // Reset to the Activity tab + first page whenever the drawer opens or the report changes.
  useEffect(() => {
    if (!open) return;
    setTab('activity');
    setActPage(0);
    setSchedPage(0);
  }, [open, reportId]);

  // Activity runs — always loaded while open.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    fetchReportRuns({ reportId, limit: pageSize, offset: actPage * pageSize })
      .then((res) => { if (active) { setRuns(res.runs); setActTotal(res.total); setLoading(false); } })
      .catch(() => { if (active) { setError(t('reports.history.loadError')); setLoading(false); } });
    return () => { active = false; };
  }, [open, reportId, actPage, pageSize, t]);

  // Scheduled runs — lazily loaded when the tab is shown (and on its page changes).
  useEffect(() => {
    if (!open || tab !== 'scheduled') return;
    let active = true;
    setSchedError(undefined);
    fetchScheduleRuns({ reportId, limit: pageSize, offset: schedPage * pageSize })
      .then((res) => { if (active) { setSchedRuns(res.runs); setSchedTotal(res.total); } })
      .catch(() => { if (active) setSchedError(t('reports.scheduling.runsLoadError')); });
    return () => { active = false; };
  }, [open, tab, reportId, schedPage, pageSize, t]);

  const onPageSize = (n: number) => { setPageSize(n); setActPage(0); setSchedPage(0); };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-[560px] flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t('reports.history.title')}</SheetTitle>
          <SheetDescription>{reportId}</SheetDescription>
        </SheetHeader>
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
          <TabsList className="px-3">
            <TabsTrigger value="activity">{t('reports.scheduling.activity')}</TabsTrigger>
            <TabsTrigger value="scheduled">{t('reports.scheduling.scheduledRuns')}</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
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
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => { onApplyParams(r.params); onClose(); }}>
                        <TableCell><Badge variant="secondary">{r.format}</Badge></TableCell>
                        <TableCell className="tabular-nums">{r.rowCount ?? '—'}</TableCell>
                        <TableCell>{r.userName ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            {actTotal > 0 && (
              <TablePagination page={actPage} pageSize={pageSize} total={actTotal} onPageChange={setActPage} onPageSizeChange={onPageSize} />
            )}
          </TabsContent>

          <TabsContent value="scheduled" className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden">
            <div className="min-h-0 flex-1 overflow-auto">
              {schedError ? (
                <div className="p-4 text-sm text-destructive">{schedError}</div>
              ) : schedRuns.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">{t('reports.scheduling.noRuns')}</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('reports.history.colFormat')}</TableHead>
                      <TableHead>{t('reports.scheduling.colStatus')}</TableHead>
                      <TableHead>{t('reports.history.colWhen')}</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {schedRuns.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell><Badge variant="secondary">{r.outputFormat}</Badge></TableCell>
                        <TableCell>
                          {r.status === 'success'
                            ? <Badge variant="outline">{t('reports.scheduling.statusSuccess')}</Badge>
                            : <Badge variant="outline" className="border-destructive/40 text-destructive" title={r.errorMessage ?? ''}>{t('reports.scheduling.statusFailed')}</Badge>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(r.runAt).toLocaleString()}</TableCell>
                        <TableCell>
                          {r.objectKey && (
                            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => void downloadScheduleRun(r.id)}>
                              <Download className="mr-1 h-3.5 w-3.5" />{t('reports.scheduling.download')}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            {schedTotal > 0 && (
              <TablePagination page={schedPage} pageSize={pageSize} total={schedTotal} onPageChange={setSchedPage} onPageSizeChange={onPageSize} />
            )}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
