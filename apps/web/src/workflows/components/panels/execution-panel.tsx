import { useState } from 'react';
import {
  CheckCircle2,
  Loader2,
  XCircle,
  Activity,
  ChevronDown,
  ChevronUp,
  MousePointerClick,
} from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ExecuteResponse } from '@/api';
import { WorkflowLogView } from './workflow-log-view';
import { useWorkflowStore } from '../../hooks/use-workflow-store';

interface ExecutionPanelProps {
  executing: boolean;
  lastExecution: ExecuteResponse | null;
}

type Tab = 'details' | 'logs';

export function ExecutionPanel({ executing, lastExecution }: ExecutionPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<Tab>('logs');
  const nodeLogs = useWorkflowStore((s) => s.nodeLogs);
  const armed = useWorkflowStore((s) => s.armed);
  const hasLogs = Object.values(nodeLogs).some((l) => l.length > 0);

  if (!executing && !lastExecution && !armed) return null;

  const success = lastExecution?.status === 'completed';
  const statusColor = armed
    ? 'bg-violet-500/15 text-violet-300 border-violet-500/30'
    : executing
      ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      : success
        ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
        : 'bg-rose-500/15 text-rose-400 border-rose-500/30';
  const statusLabel = armed && executing
    ? 'Waiting for webhook'
    : armed
    ? 'Waiting for trigger'
    : executing
      ? 'Running'
      : success
        ? 'Completed'
        : (lastExecution?.status ?? 'Failed');

  return (
    <div className="shrink-0 border-t border-border bg-card">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Execution
          </span>
        </div>
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium',
            statusColor,
          )}
        >
          {armed ? (
            <MousePointerClick className="h-3 w-3" />
          ) : executing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : success ? (
            <CheckCircle2 className="h-3 w-3" />
          ) : (
            <XCircle className="h-3 w-3" />
          )}
          {statusLabel}
        </span>
        {armed && !executing && (
          <span className="text-xs text-muted-foreground">
            Click a highlighted trigger node to start.
          </span>
        )}
        {armed && executing && (
          <span className="text-xs text-muted-foreground">
            Waiting for incoming webhook request...
          </span>
        )}
        {!executing && lastExecution && (
          <span className="text-xs text-muted-foreground">
            {lastExecution.results.length} steps ·{' '}
            {totalDuration(lastExecution.results)}ms
          </span>
        )}
        <div className="flex-1" />
        {(executing || lastExecution || hasLogs) && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            {expanded ? 'Hide details' : 'Show details'}
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
      {expanded && (
        <div className="border-t border-border bg-background/40">
          <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
            <TabButton active={tab === 'logs'} onClick={() => setTab('logs')}>
              Logs
            </TabButton>
            <TabButton active={tab === 'details'} onClick={() => setTab('details')}>
              Details
            </TabButton>
          </div>
          {tab === 'logs' && <WorkflowLogView />}
          {tab === 'details' && lastExecution && (
            <div className="max-h-48 overflow-y-auto px-4 py-2">
              <table className="w-full text-xs">
                <thead className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="py-1 text-left">Node</th>
                    <th className="py-1 text-left">Type</th>
                    <th className="py-1 text-left">Status</th>
                    <th className="py-1 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {lastExecution.results.map((r) => (
                    <tr key={r.nodeId} className="border-t border-border/50">
                      <td className="py-1.5 font-mono text-muted-foreground">{r.nodeId}</td>
                      <td className="py-1.5 text-foreground">{r.type}</td>
                      <td className="py-1.5">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium',
                            r.status === 'success'
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : r.status === 'skipped'
                                ? 'bg-muted text-muted-foreground'
                                : 'bg-rose-500/15 text-rose-400',
                          )}
                        >
                          {r.status === 'success' ? (
                            <CheckCircle2 className="h-2.5 w-2.5" />
                          ) : r.status === 'skipped' ? null : (
                            <XCircle className="h-2.5 w-2.5" />
                          )}
                          {r.status}
                        </span>
                      </td>
                      <td className="py-1.5 text-right font-mono text-muted-foreground">
                        {r.durationMs}ms
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
        active
          ? 'bg-violet-500/20 text-violet-300'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function totalDuration(results: ExecuteResponse['results']) {
  return results.reduce((sum, r) => sum + r.durationMs, 0);
}
