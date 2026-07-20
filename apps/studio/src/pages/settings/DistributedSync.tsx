import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { LoadingState } from '@/components/ui/spinner';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import {
  fetchSyncConfig, saveSyncConfig, fetchSyncStatus, triggerSyncNow, fetchSyncActivity,
  type SyncConfigView, type SyncConfigInput, type SyncMode, type SyncStatus, type SyncDirectionStatus, type SyncActivityRow,
} from '@/api';

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

/** synced → default (primary), failed → destructive, quarantined/diverged → secondary. */
function eventBadgeVariant(event: SyncActivityRow['event']): BadgeProps['variant'] {
  return event === 'synced' ? 'default' : 'secondary';
}

function EventBadge({ event }: { event: SyncActivityRow['event'] }) {
  const { t } = useTranslation();
  return (
    <Badge
      variant={eventBadgeVariant(event)}
      className={event === 'failed' ? 'border-transparent bg-destructive text-destructive-foreground' : undefined}
    >
      {t(`settings.general.sync.event.${event}`)}
    </Badge>
  );
}

function ActivitySheet({ row, onOpenChange }: { row: SyncActivityRow | null; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Sheet open={row !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t('settings.sync.detailTitle')}</SheetTitle>
          <SheetDescription className="break-all font-mono text-xs">{row?.id}</SheetDescription>
        </SheetHeader>
        {row && (
          <div className="min-h-0 flex-1 overflow-y-auto p-4 text-sm">
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2">
              <dt className="text-muted-foreground">{t('settings.sync.cols.direction')}</dt>
              <dd className="font-mono">{row.direction}</dd>
              <dt className="text-muted-foreground">{t('settings.sync.cols.event')}</dt>
              <dd><EventBadge event={row.event} /></dd>
              <dt className="text-muted-foreground">{t('settings.sync.cols.records')}</dt>
              <dd className="font-mono">{row.records.toLocaleString()}</dd>
              <dt className="text-muted-foreground">{t('settings.sync.cols.time')}</dt>
              <dd className="font-mono">{formatTimestamp(row.occurredAt)}</dd>
              {row.error && (
                <>
                  <dt className="text-muted-foreground">{t('settings.general.sync.lastError')}</dt>
                  <dd className="whitespace-pre-wrap break-words text-destructive">{row.error}</dd>
                </>
              )}
            </dl>
            {row.metadata && (
              <div className="mt-4">
                <div className="mb-1 font-medium">{t('settings.sync.metadata')}</div>
                <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                  {JSON.stringify(row.metadata, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function DistributedSync() {
  const { t } = useTranslation();
  const [sync, setSync] = useState<SyncConfigView | null>(null);
  // Write-only secret field: blank ⇒ leave the stored secret unchanged (omit from the PUT payload).
  const [secretInput, setSecretInput] = useState('');
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncActivity, setSyncActivity] = useState<SyncActivityRow[]>([]);
  const [syncSaving, setSyncSaving] = useState(false);
  const [syncNowBusy, setSyncNowBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selected, setSelected] = useState<SyncActivityRow | null>(null);

  // Sync status + activity are best-effort telemetry: a transient failure shouldn't surface a toast.
  const refreshStatus = useCallback(async () => {
    try {
      setSyncStatus(await fetchSyncStatus());
      setSyncActivity(await fetchSyncActivity());
    } catch {
      // swallow — telemetry only
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSync(await fetchSyncConfig());
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [refreshStatus]);
  useEffect(() => { void load(); }, [load]);

  // Poll live status while mounted (config loaded). Cleared on unmount.
  useEffect(() => {
    if (!sync) return;
    const id = setInterval(() => { void refreshStatus(); }, 10_000);
    return () => clearInterval(id);
  }, [sync, refreshStatus]);

  const saveSync = useCallback(async () => {
    if (!sync) return;
    setSyncSaving(true);
    try {
      const input: SyncConfigInput = {
        enabled: sync.enabled,
        mode: sync.mode,
        centralUrl: sync.centralUrl,
        siteId: sync.siteId,
        oidcIssuer: sync.oidcIssuer,
        clientId: sync.clientId,
        intervalMinutes: sync.intervalMinutes,
        // Only send the secret when the operator typed a new one; blank ⇒ preserve the stored value.
        ...(secretInput ? { clientSecret: secretInput } : {}),
      };
      setSync(await saveSyncConfig(input));
      setSecretInput('');
      toast.success(t('settings.general.sync.saved'));
      await refreshStatus();
    } catch (e) {
      toast.error(t('settings.general.sync.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSyncSaving(false);
    }
  }, [sync, secretInput, t, refreshStatus]);

  const doSyncNow = useCallback(async () => {
    setSyncNowBusy(true);
    try {
      const res = await triggerSyncNow();
      if (res.triggered) toast.success(t('settings.general.sync.triggered'));
      else toast.info(t('settings.general.sync.disabledToast'));
      await refreshStatus();
    } catch (e) {
      toast.error(t('settings.general.sync.saveFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSyncNowBusy(false);
    }
  }, [t, refreshStatus]);

  // One-line summary of a sync direction: "not started", or "running/idle · seq N · <time>".
  const directionLine = (dir: SyncDirectionStatus | null): string => {
    if (!dir) return t('settings.general.sync.notStarted');
    const state = dir.running ? t('settings.general.sync.running') : t('settings.general.sync.idle');
    const parts = [state, `seq ${dir.lastSeq}`];
    if (dir.lastSyncedAt) parts.push(new Date(dir.lastSyncedAt).toLocaleString());
    if (dir.lastError) parts.push(`⚠ ${dir.lastError}`);
    return parts.join(' · ');
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return syncActivity;
    return syncActivity.filter((a) =>
      a.direction.toLowerCase().includes(q) ||
      a.event.toLowerCase().includes(q) ||
      (a.error ?? '').toLowerCase().includes(q),
    );
  }, [syncActivity, query]);
  useEffect(() => { setPage(0); }, [query]);
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden" data-testid="distributed-sync-page">
      {loading ? (
        <LoadingState className="flex-1" label={t('common.loading')} />
      ) : error ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-destructive">{error}</div>
      ) : sync ? (
        <Tabs defaultValue="settings" className="flex min-h-0 flex-1 flex-col">
          <TabsList className="mx-4 mt-4">
            <TabsTrigger value="settings">{t('settings.sync.tabs.settings')}</TabsTrigger>
            <TabsTrigger value="activity">{t('settings.sync.tabs.activity')}</TabsTrigger>
          </TabsList>

          {/* ── Settings tab: the sync config form ───────────────────────────── */}
          <TabsContent value="settings" className="min-h-0 overflow-y-auto p-4">
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-sm font-medium">{t('settings.general.sync.enabled.label')}</div>
                  <div className="text-xs text-muted-foreground">{t('settings.general.sync.enabled.description')}</div>
                </div>
                <Switch
                  checked={sync.enabled}
                  onCheckedChange={(v) => setSync({ ...sync, enabled: v })}
                  aria-label={t('settings.general.sync.enabled.label')}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.mode.label')}</div>
                <Select value={sync.mode} onValueChange={(v) => setSync({ ...sync, mode: v as SyncMode })}>
                  <SelectTrigger className="w-96 shrink-0" aria-label={t('settings.general.sync.mode.label')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['push', 'pull', 'bidirectional'] as const).map((m) => (
                      <SelectItem key={m} value={m}>{t(`settings.general.sync.mode.${m}`)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.centralUrl.label')}</div>
                <Input
                  className="w-96 shrink-0"
                  value={sync.centralUrl}
                  placeholder="https://central.example.org"
                  onChange={(e) => setSync({ ...sync, centralUrl: e.target.value })}
                  aria-label={t('settings.general.sync.centralUrl.label')}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.siteId.label')}</div>
                <Input
                  className="w-96 shrink-0"
                  value={sync.siteId}
                  placeholder="lab-site-01"
                  onChange={(e) => setSync({ ...sync, siteId: e.target.value })}
                  aria-label={t('settings.general.sync.siteId.label')}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.oidcIssuer.label')}</div>
                <Input
                  className="w-96 shrink-0"
                  value={sync.oidcIssuer}
                  placeholder="https://central.example.org/auth/realms/openldr"
                  onChange={(e) => setSync({ ...sync, oidcIssuer: e.target.value })}
                  aria-label={t('settings.general.sync.oidcIssuer.label')}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.clientId.label')}</div>
                <Input
                  className="w-96 shrink-0"
                  value={sync.clientId}
                  placeholder="sync-lab-site-01"
                  onChange={(e) => setSync({ ...sync, clientId: e.target.value })}
                  aria-label={t('settings.general.sync.clientId.label')}
                  autoComplete="off"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.clientSecret.label')}</div>
                <Input
                  type="password"
                  className="w-96 shrink-0"
                  value={secretInput}
                  placeholder={sync.clientSecretSet ? t('settings.general.sync.clientSecretSet') : ''}
                  onChange={(e) => setSecretInput(e.target.value)}
                  aria-label={t('settings.general.sync.clientSecret.label')}
                  autoComplete="new-password"
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div className="text-sm font-medium">{t('settings.general.sync.intervalMinutes.label')}</div>
                <Input
                  type="number"
                  min={1}
                  className="w-96 shrink-0"
                  value={sync.intervalMinutes}
                  onChange={(e) => setSync({ ...sync, intervalMinutes: Number(e.target.value) })}
                  aria-label={t('settings.general.sync.intervalMinutes.label')}
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={() => void saveSync()} disabled={syncSaving}>
                  {t('settings.general.sync.save')}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ── Activity tab: live status + the recent-activity table ────────── */}
          <TabsContent value="activity" className="flex min-h-0 flex-col">
            {/* Compact status strip — keeps the vertical budget for the activity table below. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-b border-border px-4 py-2 text-xs">
              <span className={`rounded px-2 py-0.5 ${syncStatus?.enabled ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' : 'bg-muted text-muted-foreground'}`}>
                {syncStatus?.enabled ? t('settings.general.sync.on') : t('settings.general.sync.off')}
              </span>
              <span><span className="text-muted-foreground">{t('settings.general.sync.mode.push')}:</span> <span className="font-mono">{directionLine(syncStatus?.push ?? null)}</span></span>
              <span><span className="text-muted-foreground">{t('settings.general.sync.mode.pull')}:</span> <span className="font-mono">{directionLine(syncStatus?.pull ?? null)}</span></span>
              <span><span className="text-muted-foreground">{t('settings.general.sync.pending')}:</span> <span className="font-mono">{syncStatus?.pendingPush ?? 0}</span></span>
              <span>
                <span className="text-muted-foreground">{t('settings.general.sync.lastChecked')}:</span>{' '}
                <span className="font-mono">
                  {syncStatus?.push?.lastAttemptAt || syncStatus?.pull?.lastAttemptAt
                    ? new Date((syncStatus?.push?.lastAttemptAt ?? syncStatus?.pull?.lastAttemptAt) as string).toLocaleString()
                    : t('settings.general.sync.never')}
                </span>
              </span>
              <span>
                <span className="text-muted-foreground">{t('settings.general.sync.lastSuccess')}:</span>{' '}
                <span className="font-mono">
                  {syncStatus?.push?.lastSuccessAt || syncStatus?.pull?.lastSuccessAt
                    ? new Date((syncStatus?.push?.lastSuccessAt ?? syncStatus?.pull?.lastSuccessAt) as string).toLocaleString()
                    : t('settings.general.sync.never')}
                </span>
              </span>
            </div>

            {/* Recent activity toolbar */}
            <div className="flex items-center gap-2 border-b border-border px-4 py-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('settings.sync.searchPlaceholder')}
                className="h-8 max-w-xs text-xs"
                aria-label={t('settings.sync.searchPlaceholder')}
              />
              <div className="flex-1" />
              <span className="text-xs text-muted-foreground">{t('settings.sync.newestFirst')}</span>
              <span className="h-4 w-px bg-border" aria-hidden="true" />
              <Button variant="secondary" size="sm" className="h-8" onClick={() => void doSyncNow()} disabled={syncNowBusy}>
                {t('settings.general.sync.syncNow')}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
                onClick={() => void refreshStatus()}
                aria-label={t('settings.sync.refresh')}
                title={t('settings.sync.refresh')}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>

            {/* Recent activity table */}
            <div className="flex min-h-0 flex-1 flex-col overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background">
                  <TableRow>
                    <TableHead className="w-24 text-xs uppercase">{t('settings.sync.cols.direction')}</TableHead>
                    <TableHead className="w-32 text-xs uppercase">{t('settings.sync.cols.event')}</TableHead>
                    <TableHead className="w-24 text-right text-xs uppercase">{t('settings.sync.cols.records')}</TableHead>
                    <TableHead className="text-xs uppercase">{t('settings.sync.cols.detail')}</TableHead>
                    <TableHead className="w-44 text-xs uppercase">{t('settings.sync.cols.time')}</TableHead>
                  </TableRow>
                </TableHeader>
                {filtered.length > 0 && (
                  <TableBody className="[&_tr:last-child]:border-b">
                    {pageRows.map((a) => (
                      <TableRow
                        key={a.id}
                        className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                        onClick={() => setSelected(a)}
                        title={t('settings.sync.openDetail')}
                      >
                        <TableCell className="font-mono text-xs text-muted-foreground">{a.direction}</TableCell>
                        <TableCell><EventBadge event={a.event} /></TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">{a.records.toLocaleString()}</TableCell>
                        <TableCell className="max-w-0 truncate text-xs text-muted-foreground" title={a.error ?? undefined}>
                          {a.error ?? '—'}
                        </TableCell>
                        <TableCell><span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{formatTimestamp(a.occurredAt)}</span></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                )}
              </Table>
              {filtered.length === 0 && <StripedEmpty className="flex-1">{t('settings.sync.empty')}</StripedEmpty>}
            </div>

            <TablePagination
              page={page}
              pageSize={pageSize}
              total={filtered.length}
              onPageChange={setPage}
              onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
              leftSlot={<span className="text-muted-foreground">{t('settings.sync.count', { count: filtered.length })}</span>}
            />
          </TabsContent>
        </Tabs>
      ) : null}

      <ActivitySheet row={selected} onOpenChange={(open) => { if (!open) setSelected(null); }} />
    </div>
  );
}
