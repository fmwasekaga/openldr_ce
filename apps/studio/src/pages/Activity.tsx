import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshCw } from 'lucide-react';
import { AppShell } from '@/shell/AppShell';
import { Badge, type BadgeProps } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/cn';
import { fetchActivity, fetchLifecycle, type Lifecycle, type RecentPayload } from '@/api';

/** Fixed stage order of the payload lifecycle. */
const STAGES = ['received', 'validated', 'persisted', 'pushed'] as const;
type StageName = (typeof STAGES)[number];

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
}

/** complete → default (primary), stuck → secondary, failed → destructive. */
function statusBadgeVariant(status: string): BadgeProps['variant'] {
  return status === 'complete' ? 'default' : 'secondary';
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const label = t(`activity.status.${status}`, status);
  const destructive = status === 'failed';
  return (
    <Badge
      variant={statusBadgeVariant(status)}
      className={destructive ? 'border-transparent bg-destructive text-destructive-foreground' : undefined}
    >
      {label}
    </Badge>
  );
}

/**
 * Presentational stage indicator: the four lifecycle stages in order, with the
 * `current` stage (and everything before it) highlighted.
 */
function StageBar({ current }: { current: string }) {
  const { t } = useTranslation();
  const currentIndex = STAGES.indexOf(current as StageName);
  return (
    <div className="flex items-center gap-1" aria-label={t('activity.stages')}>
      {STAGES.map((stage, i) => {
        const reached = currentIndex >= 0 && i <= currentIndex;
        const isCurrent = i === currentIndex;
        return (
          <span
            key={stage}
            title={t(`activity.stage.${stage}`)}
            className={cn(
              'h-1.5 w-6 rounded-full transition-colors',
              reached ? 'bg-primary' : 'bg-muted',
              isCurrent && 'ring-2 ring-primary/30',
            )}
          />
        );
      })}
    </div>
  );
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function LifecycleSheet({
  correlationId,
  lifecycle,
  onOpenChange,
}: {
  correlationId: string | null;
  lifecycle: Lifecycle | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Sheet open={correlationId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>{t('activity.detailTitle')}</SheetTitle>
          <SheetDescription className="break-all font-mono text-xs">{correlationId}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {!lifecycle ? (
            <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
          ) : lifecycle.stages.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('activity.noStages')}</p>
          ) : (
            <ol className="space-y-4">
              {lifecycle.stages.map((s, i) => (
                <li key={`${s.stage}-${i}`} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        'mt-1 h-2.5 w-2.5 shrink-0 rounded-full',
                        s.status === 'failed' ? 'bg-destructive' : 'bg-primary',
                      )}
                    />
                    {i < lifecycle.stages.length - 1 && <span className="mt-1 w-px flex-1 bg-border" />}
                  </div>
                  <div className="min-w-0 pb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{t(`activity.stage.${s.stage}`, s.stage)}</span>
                      <span className="font-mono text-[11px] text-muted-foreground">{formatTimestamp(s.at)}</span>
                    </div>
                    {s.detail && <p className="text-xs text-muted-foreground">{s.detail}</p>}
                    {s.runId && (
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {t('activity.run')}: {s.runId}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

export function Activity() {
  const { t } = useTranslation();
  const [payloads, setPayloads] = useState<RecentPayload[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPayloads(await fetchActivity(200));
    } catch (e) {
      setPayloads([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return payloads;
    return payloads.filter((p) =>
      p.correlationId.toLowerCase().includes(q) ||
      (p.source ?? '').toLowerCase().includes(q) ||
      p.status.toLowerCase().includes(q) ||
      p.currentStage.toLowerCase().includes(q),
    );
  }, [payloads, query]);
  // Keep the page in range as the filter narrows results.
  useEffect(() => { setPage(0); }, [query]);
  const pageRows = filtered.slice(page * pageSize, page * pageSize + pageSize);

  const openPayload = useCallback(async (correlationId: string) => {
    setSelectedId(correlationId);
    setLifecycle(null);
    try {
      setLifecycle(await fetchLifecycle(correlationId));
    } catch {
      setLifecycle(null);
    }
  }, []);

  return (
    <AppShell title={t('nav.activity')} fullBleed>
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('activity.searchPlaceholder')}
            className="h-8 max-w-xs text-xs"
            aria-label={t('activity.searchPlaceholder')}
          />
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">{t('activity.newestFirst')}</span>
          <span className="h-4 w-px bg-border" aria-hidden="true" />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground"
            onClick={() => void load()}
            disabled={loading}
            aria-label={t('activity.refresh')}
            title={t('activity.refresh')}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>

        <div className="flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-56 text-xs uppercase">{t('activity.colPayload')}</TableHead>
                <TableHead className="w-40 text-xs uppercase">{t('activity.colSource')}</TableHead>
                <TableHead className="w-48 text-xs uppercase">{t('activity.colStarted')}</TableHead>
                <TableHead className="w-44 text-xs uppercase">{t('activity.colStage')}</TableHead>
                <TableHead className="text-xs uppercase">{t('activity.colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="[&_tr:last-child]:border-b">
              {loading ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t('common.loading')}</TableCell></TableRow>
              ) : error ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-destructive">{error}</TableCell></TableRow>
              ) : filtered.length === 0 ? (
                <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{t('activity.empty')}</TableCell></TableRow>
              ) : (
                pageRows.map((p) => (
                  <TableRow
                    key={p.correlationId}
                    className="cursor-pointer transition-colors hover:bg-[rgba(70,130,180,0.08)]"
                    onClick={() => { void openPayload(p.correlationId); }}
                    title={t('activity.openDetail')}
                  >
                    <TableCell><span className="font-mono text-xs text-muted-foreground" title={p.correlationId}>{shortId(p.correlationId)}</span></TableCell>
                    <TableCell className="text-sm">{p.source ?? t('activity.noSource')}</TableCell>
                    <TableCell><span className="whitespace-nowrap font-mono text-xs text-muted-foreground">{formatTimestamp(p.startedAt)}</span></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StageBar current={p.currentStage} />
                        <span className="text-[11px] text-muted-foreground">{t(`activity.stage.${p.currentStage}`, p.currentStage)}</span>
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={p.status} /></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <TablePagination
          page={page}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(0); }}
          leftSlot={<span className="text-muted-foreground">{t('activity.count', { count: filtered.length })}</span>}
        />

        <LifecycleSheet
          correlationId={selectedId}
          lifecycle={lifecycle}
          onOpenChange={(open) => { if (!open) { setSelectedId(null); setLifecycle(null); } }}
        />
      </div>
    </AppShell>
  );
}
