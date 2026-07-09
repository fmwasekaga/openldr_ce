import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';
import { AppShell } from '../shell/AppShell';
import {
  fetchReports, fetchReport, fetchReportOptions, logReportRun,
  type ReportSummary, type ReportResult,
} from '../api';
import { ReportLibrary } from '../reports/ReportLibrary';
import { ReportHistoryDrawer } from '../reports/ReportHistoryDrawer';
import { ReportSchedulesDrawer } from '../reports/ReportSchedulesDrawer';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { ReportParametersBar } from '../reports/ReportParametersBar';
import { ReportSummaryStrip } from '../reports/ReportSummaryStrip';
import { ReportActionsMenu } from '../reports/ReportActionsMenu';
import { ReportDocumentTab } from '../reports/ReportDocumentTab';
import { ReportSpreadsheetTab } from '../reports/ReportSpreadsheetTab';
import { computeSummaryMetrics } from '../reports/lib/report-summary';
import {
  loadPinned, savePinned, togglePinned, loadLastParams, saveLastParams,
} from '../reports/lib/report-preferences';
import { NewReportSheet } from '../reports/NewReportSheet';

type Tab = 'document' | 'spreadsheet';

export function Reports() {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const canManageSchedules = hasRole('lab_admin') || hasRole('lab_manager');
  const [schedulesOpen, setSchedulesOpen] = useState(false);
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState(false);
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [params, setParams] = useState<Record<string, string>>({});
  // Params snapshotted at the moment of the last Run, so both result tabs (document
  // PDF + spreadsheet/CSV) always reflect the run that produced `result`, even if the
  // user edits the parameter controls afterwards without re-running.
  const [ranParams, setRanParams] = useState<Record<string, string>>({});
  const [options, setOptions] = useState<Record<string, string[]>>({});
  const [result, setResult] = useState<ReportResult | null>(null);
  const [running, setRunning] = useState(false);
  const [ranAt, setRanAt] = useState('');
  const [activeTab, setActiveTab] = useState<Tab>('document');
  const [error, setError] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);

  const selected = reports.find((r) => r.id === selectedId) ?? null;

  useEffect(() => {
    fetchReports().then(setReports).catch((e) => setError(String(e)));
    setPinnedIds(loadPinned());
  }, []);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setResult(null);
    setActiveTab('document');
    const seeded = loadLastParams()[id] ?? {};
    setParams(seeded);
    setError(undefined);
    setOptions({});
    fetchReportOptions(id).then(setOptions).catch(() => setOptions({}));
  }, []);

  const handleTogglePin = useCallback((id: string) => {
    setPinnedIds((prev) => {
      const next = togglePinned(prev, id);
      savePinned(next);
      return next;
    });
  }, []);

  const canRun = useMemo(() => {
    if (!selected) return false;
    return selected.parameters
      .filter((p) => p.required)
      .every((p) => (p.type === 'daterange' ? Boolean(params.from && params.to) : Boolean(params[p.id])));
  }, [selected, params]);

  const handleRun = useCallback(async () => {
    if (!selectedId) return;
    setRunning(true);
    setError(undefined);
    try {
      const res = await fetchReport(selectedId, params);
      setResult(res);
      setRanParams(params);
      setRanAt(new Date().toLocaleString());
      logReportRun(selectedId, { format: 'preview', rowCount: res.meta.rowCount, params });
      const next = { ...loadLastParams(), [selectedId]: params };
      saveLastParams(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [selectedId, params]);

  const metrics = useMemo(
    () => (selected?.summaryMetrics && result ? computeSummaryMetrics(selected.summaryMetrics, result.rows) : []),
    [selected, result],
  );

  const refreshReports = useCallback(() => {
    fetchReports().then(setReports).catch((e) => setError(String(e)));
  }, []);

  return (
    <AppShell title={t('nav.reports')} fullBleed>
      <div className="flex h-full min-h-0">
        <div className="flex min-h-0 min-w-0 shrink-0 flex-col border-r border-border">
          {!collapsed && (
            <div className="flex items-center justify-end border-b border-border px-2 py-2">
              <LibraryActionsMenu onCreated={refreshReports} />
            </div>
          )}
          <ReportLibrary
            reports={reports}
            selectedId={selectedId}
            onSelect={handleSelect}
            pinnedIds={pinnedIds}
            onTogglePin={handleTogglePin}
            search={search}
            onSearchChange={setSearch}
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed((c) => !c)}
          />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('reports.selectReport')}
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between border-b border-border px-4 py-3">
                <div className="min-w-0">
                  <h2 className="text-[15px] font-semibold">{selected.name}</h2>
                  <p className="truncate text-xs text-muted-foreground">{selected.description}</p>
                </div>
                <ReportActionsMenu
                  onOpenHistory={() => setHistoryOpen(true)}
                  onOpenSchedules={() => setSchedulesOpen(true)}
                  canManageSchedules={canManageSchedules}
                  designId={selected.designId}
                />
              </div>

              <ReportParametersBar
                report={selected}
                params={params}
                options={options}
                onChange={setParams}
                onRun={handleRun}
                running={running}
                canRun={canRun}
              />

              <ReportSummaryStrip metrics={metrics} />

              {error && <div className="border-b border-border px-4 py-3 text-sm text-destructive">{error}</div>}

              {!result ? (
                <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                  {running ? t('reports.running') : t('reports.runReport')}
                </div>
              ) : (
                <>
                  <div className="flex items-center border-b border-border px-4">
                    {(['document', 'spreadsheet'] as Tab[]).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`-mb-px border-b-2 px-3.5 py-2.5 text-[13px] transition-colors ${
                          activeTab === tab
                            ? 'border-[#5A9BD6] text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {tab === 'document' ? t('reports.tabDocument') : t('reports.tabSpreadsheet')}
                      </button>
                    ))}
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      {t('reports.runMeta', { count: result.meta.rowCount, time: ranAt })}
                    </span>
                  </div>

                  <div className="min-h-0 flex-1">
                    {activeTab === 'document' ? (
                      <ReportDocumentTab
                        reportId={selected.id}
                        params={ranParams}
                        onDownload={() => logReportRun(selected.id, { format: 'pdf', rowCount: result.meta.rowCount, params: ranParams })}
                      />
                    ) : (
                      <ReportSpreadsheetTab
                        reportId={selected.id}
                        result={result}
                        params={ranParams}
                        onExport={(format, rowCount) => logReportRun(selected.id, { format, rowCount, params: ranParams })}
                      />
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {selected && (
        <ReportHistoryDrawer
          open={historyOpen}
          reportId={selected.id}
          onClose={() => setHistoryOpen(false)}
          onApplyParams={(p) => { setParams(p); setHistoryOpen(false); }}
        />
      )}

      {selected && (
        <ReportSchedulesDrawer
          open={schedulesOpen}
          reportId={selected.id}
          parameters={selected.parameters}
          options={options}
          currentParams={params}
          onClose={() => setSchedulesOpen(false)}
        />
      )}
    </AppShell>
  );
}

/** Library header ⋯ menu — currently only "New report" (manager-only), opened as a Sheet. */
export function LibraryActionsMenu({ onCreated }: { onCreated?: () => void } = {}): JSX.Element | null {
  const { t } = useTranslation();
  const { hasRole } = useAuth();
  const [sheetOpen, setSheetOpen] = useState(false);
  if (!(hasRole('lab_admin') || hasRole('lab_manager'))) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t('reports.libraryActions')}>
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={() => setSheetOpen(true)}>
            {t('reports.new.button')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <NewReportSheet open={sheetOpen} onOpenChange={setSheetOpen} onCreated={() => onCreated?.()} />
    </>
  );
}
