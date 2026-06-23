import { useState } from 'react';
import { X, Settings2, ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useWorkflowStore } from '../../hooks/use-workflow-store';
import { pickForm } from '../node-forms';
import type { WorkflowNodeData } from '../../lib/types';

type Tab = 'config' | 'input' | 'output';

/**
 * Right-side panel that edits the currently selected node. Organized into
 * three tabs: Config (the form), Input (what the node received last run),
 * and Output (what the node produced last run).
 */
export function NodeConfigPanel() {
  const configNodeId = useWorkflowStore((s) => s.configNodeId);
  const nodes = useWorkflowStore((s) => s.nodes);
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData);
  const setConfigNode = useWorkflowStore((s) => s.setConfigNode);
  const nodeRunInput = useWorkflowStore((s) => s.nodeRunInput);
  const nodeRunOutput = useWorkflowStore((s) => s.nodeRunOutput);
  const nodeRunError = useWorkflowStore((s) => s.nodeRunError);

  const [tab, setTab] = useState<Tab>('config');

  const configNode = nodes.find((n) => n.id === configNodeId);
  if (!configNode) return null;

  const Form = pickForm(configNode);
  const update = (patch: Partial<WorkflowNodeData>) =>
    updateNodeData(configNode.id, patch);

  const isTrigger =
    configNode.type === 'trigger' || configNode.type === 'webhook';

  const runInput = configNodeId ? nodeRunInput[configNodeId] : undefined;
  const runOutput = configNodeId ? nodeRunOutput[configNodeId] : undefined;
  const runError = configNodeId ? nodeRunError[configNodeId] : undefined;

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Settings2 className="h-4 w-4 text-violet-400" />
          <h2 className="text-sm font-semibold text-foreground">Configure Node</h2>
        </div>
        <button
          type="button"
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          onClick={() => setConfigNode(null)}
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Tab row */}
      <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        <TabButton active={tab === 'config'} onClick={() => setTab('config')}>
          <Settings2 className="h-3 w-3" />
          Config
        </TabButton>
        {!isTrigger && (
          <TabButton active={tab === 'input'} onClick={() => setTab('input')}>
            <ArrowDownToLine className="h-3 w-3" />
            Input
          </TabButton>
        )}
        <TabButton active={tab === 'output'} onClick={() => setTab('output')}>
          <ArrowUpFromLine className="h-3 w-3" />
          Output
        </TabButton>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {tab === 'config' && <Form node={configNode} update={update} />}
        {tab === 'input' && <JsonView data={runInput} emptyLabel="Run the workflow to see input data." />}
        {tab === 'output' && (
          <div className="space-y-3">
            {runError && (
              <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-400">
                <span className="font-semibold">Error:</span> {runError}
              </div>
            )}
            <JsonView data={runOutput} emptyLabel="Run the workflow to see output data." />
          </div>
        )}
      </div>
    </aside>
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
        'flex items-center gap-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors',
        active
          ? 'bg-violet-500/20 text-violet-300'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

function JsonView({ data, emptyLabel }: { data: unknown; emptyLabel: string }) {
  if (data === undefined || data === null) {
    return (
      <p className="text-xs text-muted-foreground/70 italic">{emptyLabel}</p>
    );
  }

  let formatted: string;
  try {
    formatted = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  } catch {
    formatted = String(data);
  }

  return (
    <pre className="max-h-[60vh] overflow-auto rounded-md border border-border bg-background/60 p-3 font-mono text-[11px] leading-relaxed text-foreground/90 whitespace-pre-wrap wrap-break-word">
      {formatted}
    </pre>
  );
}
