import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { useWorkflowStore } from '../../hooks/use-workflow-store';
import type { LogEntry, LogLevel } from '@/api';

const LEVEL_CLASS: Record<LogLevel, string> = {
  log: 'text-foreground',
  info: 'text-sky-400',
  warn: 'text-amber-400',
  error: 'text-rose-400',
};

const LEVEL_PREFIX: Record<LogLevel, string> = {
  log: '›',
  info: 'ⓘ',
  warn: '⚠',
  error: '✖',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

/**
 * Per-node log viewer rendered inside the ExecutionPanel. Flattens the
 * store's `nodeLogs` map into a single stream ordered by timestamp, with
 * an optional filter chip for each node that has produced logs.
 */
export function WorkflowLogView() {
  const nodeLogs = useWorkflowStore((s) => s.nodeLogs);
  const nodes = useWorkflowStore((s) => s.nodes);
  const nodeRunError = useWorkflowStore((s) => s.nodeRunError);
  const [filter, setFilter] = useState<string | null>(null);

  const labelFor = (nodeId: string): string => {
    const node = nodes.find((n) => n.id === nodeId);
    return (node?.data as { label?: string } | undefined)?.label ?? nodeId;
  };

  const allEntries: LogEntry[] = useMemo(() => {
    const out: LogEntry[] = [];
    for (const entries of Object.values(nodeLogs)) {
      for (const e of entries) out.push(e);
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }, [nodeLogs]);

  const visible = filter ? allEntries.filter((e) => e.nodeId === filter) : allEntries;
  const errorNodes = Object.entries(nodeRunError).filter(([, err]) => err);
  const nodeIdsWithLogs = Object.keys(nodeLogs).filter((id) => (nodeLogs[id] ?? []).length > 0);

  return (
    <div className="flex flex-col">
      {(nodeIdsWithLogs.length > 0 || errorNodes.length > 0) && (
        <div className="flex flex-wrap items-center gap-1 border-b border-border bg-background/40 px-3 py-1.5">
          <button
            type="button"
            onClick={() => setFilter(null)}
            className={cn(
              'rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider transition-colors',
              filter === null
                ? 'bg-violet-500/20 text-violet-300'
                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
            )}
          >
            all ({allEntries.length})
          </button>
          {nodeIdsWithLogs.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors',
                filter === id
                  ? 'bg-violet-500/20 text-violet-300'
                  : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
              title={id}
            >
              {labelFor(id)} ({nodeLogs[id]?.length ?? 0})
            </button>
          ))}
        </div>
      )}
      <div className="max-h-48 overflow-y-auto bg-[#0a0a0b] px-3 py-2 font-mono text-[11px] leading-relaxed">
        {errorNodes.map(([id, err]) => (
          <div key={`err-${id}`} className="flex items-start gap-2 py-0.5 text-rose-400">
            <span className="shrink-0 select-none text-muted-foreground/60">
              [{labelFor(id)}]
            </span>
            <span className="shrink-0 select-none">✖</span>
            <span className="whitespace-pre-wrap break-words">{err}</span>
          </div>
        ))}
        {visible.length === 0 && errorNodes.length === 0 ? (
          <div className="text-muted-foreground/60">
            No log output yet. Use a Log node or call <code>console.log</code> inside a Code node.
          </div>
        ) : (
          visible.map((entry, i) => (
            <div key={`${entry.nodeId}-${entry.ts}-${i}`} className="flex items-start gap-2 py-0.5">
              <span className="shrink-0 select-none text-muted-foreground/40">
                {formatTime(entry.ts)}
              </span>
              <span className="shrink-0 select-none text-muted-foreground/60">
                [{labelFor(entry.nodeId)}]
              </span>
              <span className={cn('shrink-0 select-none', LEVEL_CLASS[entry.level])}>
                {LEVEL_PREFIX[entry.level]}
              </span>
              <span className={cn('whitespace-pre-wrap break-words', LEVEL_CLASS[entry.level])}>
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
