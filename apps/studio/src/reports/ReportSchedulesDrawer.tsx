import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Plus, Play, Pencil, Trash2 } from 'lucide-react';
import { fetchSchedules, updateSchedule, runScheduleNow, deleteSchedule, type ReportSchedule, type ReportParamMeta } from '../api';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TablePagination } from '@/components/ui/table-pagination';
import { ScheduleDialog } from './ScheduleDialog';

interface Props {
  open: boolean;
  reportId: string;
  parameters: ReportParamMeta[];
  options: Record<string, string[]>;
  currentParams: Record<string, string>;
  /** Custom (builder) templates are PDF-only — forwarded to the ScheduleDialog to lock output format. */
  pdfOnly?: boolean;
  onClose: () => void;
}

const WEEKDAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function freqLabel(s: ReportSchedule, t: (k: string) => string): string {
  const f = t(`reports.scheduling.${s.frequency}`);
  if (s.frequency === 'weekly') return `${f} · ${WEEKDAY_ABBR[s.dayOfWeek ?? 1]}`;
  if (s.frequency === 'monthly') return `${f} · ${s.dayOfMonth ?? 1}`;
  return f;
}

export function ReportSchedulesDrawer({ open, reportId, parameters, options, currentParams, pdfOnly, onClose }: Props) {
  const { t } = useTranslation();
  const [schedules, setSchedules] = useState<ReportSchedule[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ReportSchedule | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(undefined);
    fetchSchedules(reportId, { limit: pageSize, offset: page * pageSize })
      .then((res) => { setSchedules(res.schedules); setTotal(res.total); setLoading(false); })
      .catch(() => { setError(t('reports.scheduling.loadError')); setLoading(false); });
  }, [reportId, page, pageSize, t]);

  useEffect(() => { if (open) reload(); }, [open, reload]);
  // Reset to the first page when switching reports.
  useEffect(() => { setPage(0); }, [reportId]);

  const onToggle = async (s: ReportSchedule) => {
    try { await updateSchedule(s.id, { enabled: !s.enabled }); reload(); }
    catch { toast.error(t('reports.scheduling.saveError')); }
  };
  const onRun = async (s: ReportSchedule) => {
    try { await runScheduleNow(s.id); toast.success(t('reports.scheduling.queued')); }
    catch { toast.error(t('reports.scheduling.saveError')); }
  };
  const onDelete = async (id: string) => {
    setConfirmId(null);
    try { await deleteSchedule(id); toast.success(t('reports.scheduling.deleted')); reload(); }
    catch { toast.error(t('reports.scheduling.saveError')); }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-[560px] gap-0 p-0">
        <SheetHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3">
          <div>
            <SheetTitle>{t('reports.scheduling.title')}</SheetTitle>
            <SheetDescription>{reportId}</SheetDescription>
          </div>
          <Button size="sm" className="h-8" onClick={() => { setEditing(null); setDialogOpen(true); }}>
            <Plus className="mr-1 h-3.5 w-3.5" />{t('reports.scheduling.new')}
          </Button>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-auto p-2">
          {error && <div className="px-2 py-1 text-sm text-destructive">{error}</div>}
          {loading ? (
            <div className="p-2 text-sm text-muted-foreground">{t('common.loading')}</div>
          ) : schedules.length === 0 ? (
            <div className="p-2 text-sm text-muted-foreground">{t('reports.scheduling.empty')}</div>
          ) : (
            schedules.map((s) => (
              <div key={s.id} className="mb-2 flex items-center gap-3 rounded-md border border-border px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{freqLabel(s, t)}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{s.outputFormat}</Badge>
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {t('reports.scheduling.nextRun')}: {s.nextDueAt ? new Date(s.nextDueAt).toLocaleString() : '—'}
                    {' · '}{t('reports.scheduling.lastRun')}: {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '—'}
                  </div>
                </div>
                <Switch checked={s.enabled} onCheckedChange={() => void onToggle(s)} aria-label={`enabled-${s.id}`} />
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('reports.scheduling.runNow')} title={t('reports.scheduling.runNow')} onClick={() => void onRun(s)}>
                  <Play className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('reports.scheduling.edit')} onClick={() => { setEditing(s); setDialogOpen(true); }}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={t('reports.scheduling.delete')} onClick={() => setConfirmId(s.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
        {total > 0 && (
          <TablePagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
          />
        )}
      </SheetContent>

      {dialogOpen && (
        <ScheduleDialog
          open={dialogOpen}
          reportId={reportId}
          parameters={parameters}
          options={options}
          initialParams={currentParams}
          existing={editing ?? undefined}
          pdfOnly={pdfOnly}
          onClose={() => setDialogOpen(false)}
          onSaved={reload}
        />
      )}
      <ConfirmDialog
        open={confirmId !== null}
        onOpenChange={(o) => { if (!o) setConfirmId(null); }}
        title={t('reports.scheduling.deleteConfirm')}
        confirmLabel={t('reports.scheduling.delete')}
        cancelLabel={t('reports.scheduling.cancel')}
        destructive
        onConfirm={() => { if (confirmId) void onDelete(confirmId); }}
      />
    </Sheet>
  );
}
