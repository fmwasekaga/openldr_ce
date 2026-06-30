import { useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, XCircle, Download } from 'lucide-react';
import {
  fetchWorkflowRuns,
  fetchWorkflowRun,
  downloadWorkflowArtifact,
  type WorkflowRunSummary,
  type ExecuteResponse,
  type NodeRunResult,
  type LogEntry,
} from '@/api';
import { outputBinaries } from '../../lib/output-binaries';
import { JsonView } from './json-view';
import { cn } from '@/lib/cn';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Bleed } from '@/components/ui/bleed';
import { TablePagination } from '@/components/ui/table-pagination';

interface Props {
  open: boolean;
  workflowId: string;
  onClose: () => void;
}

const SOURCE_VARIANT: Record<WorkflowRunSummary['triggerSource'], string> = {
  manual: 'border-violet-500/40 text-violet-300',
  schedule: 'border-sky-500/40 text-sky-300',
  webhook: 'border-amber-500/40 text-amber-300',
  ingest: 'border-emerald-500/40 text-emerald-300',
  event: 'border-fuchsia-500/40 text-fuchsia-300',
};

/** Coerce the opaque `run.result` into the per-node execution shape, if present. */
function asExecuteResponse(result: unknown): ExecuteResponse | null {
  if (result && typeof result === 'object' && Array.isArray((result as { results?: unknown }).results)) {
    return result as ExecuteResponse;
  }
  return null;
}

export function RunHistoryDrawer({ open, workflowId, onClose }: Props) {
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(0);
  const [runs, setRuns] = useState<WorkflowRunSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const [selected, setSelected] = useState<WorkflowRunSummary | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string>();

  // Reset to the list + first page whenever the drawer opens or the workflow changes.
  useEffect(() => {
    if (!open) return;
    setPage(0);
    setSelected(null);
    setDetailError(undefined);
  }, [open, workflowId]);

  // Load the run list while open.
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    // Fetch one extra row to know whether a "next page" exists (the server has no total count).
    fetchWorkflowRuns(workflowId, { limit: pageSize + 1, offset: page * pageSize })
      .then((res) => { if (active) { setRuns(res); setLoading(false); } })
      .catch(() => { if (active) { setError('Failed to load run history.'); setLoading(false); } });
    return () => { active = false; };
  }, [open, workflowId, page, pageSize]);

  const openRun = (run: WorkflowRunSummary) => {
    setSelected(run);
    setDetailLoading(true);
    setDetailError(undefined);
    fetchWorkflowRun(run.id)
      .then((full) => setSelected(full))
      .catch(() => setDetailError('Failed to load run detail.'))
      .finally(() => setDetailLoading(false));
  };

  const hasNext = runs.length > pageSize;
  const pageRuns = hasNext ? runs.slice(0, pageSize) : runs;
  // Synthesize a total just large enough to keep the pager's Next button live.
  const pseudoTotal = page * pageSize + pageRuns.length + (hasNext ? 1 : 0);

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="flex w-[600px] flex-col gap-0 p-0">
        <SheetHeader className="border-b border-border px-4 py-3">
          <SheetTitle>
            {selected ? (
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="flex items-center gap-1.5 text-left text-sm hover:text-foreground"
              >
                <ArrowLeft className="h-4 w-4" />
                Run history
              </button>
            ) : (
              'Run history'
            )}
          </SheetTitle>
          <SheetDescription>{selected ? selected.id : workflowId}</SheetDescription>
        </SheetHeader>

        {selected ? (
          <RunDetail run={selected} loading={detailLoading} error={detailError} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto">
              {loading ? (
                <div className="p-4 text-sm text-muted-foreground">Loading…</div>
              ) : error ? (
                <div className="p-4 text-sm text-destructive">{error}</div>
              ) : pageRuns.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground">No runs yet.</div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Source</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead>Finished</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pageRuns.map((r) => (
                      <TableRow key={r.id} className="cursor-pointer" onClick={() => openRun(r)}>
                        <TableCell>
                          <Badge variant="outline" className={cn(SOURCE_VARIANT[r.triggerSource])}>
                            {r.triggerSource}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {r.status === 'completed' ? (
                            <Badge variant="outline">Completed</Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-destructive/40 text-destructive"
                              title={r.error ?? ''}
                            >
                              Failed
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(r.startedAt).toLocaleString()}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {new Date(r.finishedAt).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
            {(page > 0 || hasNext) && (
              <TablePagination
                page={page}
                pageSize={pageSize}
                total={pseudoTotal}
                onPageChange={setPage}
                onPageSizeChange={(n) => { setPageSize(n); setPage(0); }}
              />
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function RunDetail({ run, loading, error }: { run: WorkflowRunSummary; loading: boolean; error?: string }) {
  const exec = asExecuteResponse(run.result);
  const results: NodeRunResult[] = exec?.results ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<'output' | 'result' | 'logs'>('output');

  // Reset selection + tab when a different run is opened.
  useEffect(() => {
    setSelectedId(null);
    setTab('output');
  }, [run.id]);

  // Selected node: explicit click, else the first failed node, else the first node.
  const selected =
    results.find((r) => r.nodeId === selectedId) ??
    results.find((r) => r.status === 'error') ??
    results[0] ??
    null;

  const selectedFiles = selected ? outputBinaries(selected.output) : [];
  const selectedLogs: LogEntry[] = selected?.logs ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-medium">
          {run.status === 'completed' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          ) : (
            <XCircle className="h-4 w-4 text-rose-400" />
          )}
          {run.status === 'completed' ? 'Completed' : 'Failed'}
        </span>
        <span>·</span>
        <span>{run.triggerSource}</span>
        <span>·</span>
        <span>{new Date(run.startedAt).toLocaleString()}</span>
      </div>

      {run.error && (
        <div className="border-b border-border bg-rose-500/5 px-4 py-2 font-mono text-[11px] text-rose-400">
          {run.error}
        </div>
      )}

      {loading ? (
        <div className="p-4 text-sm text-muted-foreground">Loading detail…</div>
      ) : error ? (
        <div className="p-4 text-sm text-destructive">{error}</div>
      ) : results.length === 0 ? (
        <div className="p-4 text-sm text-muted-foreground">No per-node results recorded.</div>
      ) : (
        <>
          {/* Master: node table (edge-to-edge row rules via Bleed). */}
          <div className="px-4 pt-3">
            <Bleed>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Node</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow
                      key={r.nodeId}
                      className={cn(
                        'cursor-pointer',
                        selected?.nodeId === r.nodeId && 'bg-violet-500/15 hover:bg-violet-500/20',
                      )}
                      onClick={() => setSelectedId(r.nodeId)}
                    >
                      <TableCell>
                        <span className="text-foreground">{r.label ?? r.nodeId}</span>
                        {r.label && (
                          <span className="ml-1.5 font-mono text-[10px] text-muted-foreground/50">{r.nodeId}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{r.type}</TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            'inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium',
                            r.status === 'success'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : r.status === 'skipped'
                                ? 'bg-muted text-muted-foreground'
                                : 'bg-rose-500/15 text-rose-400',
                          )}
                          title={r.error ?? ''}
                        >
                          {r.status}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">{r.durationMs}ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Bleed>
          </div>

          {/* Detail: selected node's data. */}
          {selected && (
            <div className="flex min-h-0 flex-1 flex-col border-t border-border">
              <div className="flex gap-4 px-4 pt-2 text-[11px]">
                {(['output', 'result', 'logs'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTab(t)}
                    className={cn(
                      'pb-1.5 capitalize',
                      tab === t
                        ? 'border-b-2 border-violet-500 text-foreground'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
              <div className="border-b border-border" />
              <div className="min-h-0 flex-1 overflow-auto pt-2 pb-4">
                {tab === 'output' && (
                  <div className="space-y-2">
                    {selected.output == null ? (
                      <p className="px-4 text-xs italic text-muted-foreground/70">No output recorded.</p>
                    ) : (
                      <JsonView data={selected.output} emptyLabel="" />
                    )}
                    {selectedFiles.map((f) => (
                      <button
                        key={f.field}
                        type="button"
                        onClick={() => void downloadWorkflowArtifact(f.objectKey, f.fileName)}
                        className="inline-flex items-center gap-1.5 self-start rounded px-2 py-1 text-xs font-medium text-violet-400 transition-colors hover:bg-violet-500/10 hover:text-violet-300"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {f.fileName}
                      </button>
                    ))}
                  </div>
                )}
                {tab === 'result' &&
                  (selected.meta == null ? (
                    <p className="px-4 text-xs italic text-muted-foreground/70">No result data.</p>
                  ) : (
                    <JsonView data={selected.meta} emptyLabel="" />
                  ))}
                {tab === 'logs' &&
                  (selectedLogs.length === 0 ? (
                    <p className="px-4 text-xs italic text-muted-foreground/70">No logs.</p>
                  ) : (
                    <div className="bg-muted px-4 py-2 font-mono text-[11px] leading-relaxed">
                      {selectedLogs.map((entry, i) => (
                        <div
                          key={`${entry.ts}-${i}`}
                          className={cn(
                            'whitespace-pre-wrap break-words py-0.5',
                            entry.level === 'error'
                              ? 'text-rose-600 dark:text-rose-400'
                              : entry.level === 'warn'
                                ? 'text-amber-600 dark:text-amber-400'
                                : entry.level === 'info'
                                  ? 'text-sky-600 dark:text-sky-400'
                                  : 'text-foreground',
                          )}
                        >
                          {entry.message}
                        </div>
                      ))}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
