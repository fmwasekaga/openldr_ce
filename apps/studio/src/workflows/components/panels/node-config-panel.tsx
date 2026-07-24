import { useState } from 'react';
import { X, Settings2, ArrowDownToLine, ArrowUpFromLine, Download } from 'lucide-react';
import { cn } from '@/lib/cn';
import { downloadWorkflowArtifact } from '@/api';
import { useWorkflowStore } from '../../hooks/use-workflow-store';
import { pickForm } from '../node-forms';
import type { WorkflowNodeData } from '../../lib/types';
import { JsonView } from './json-view';
import { outputBinaries } from '../../lib/output-binaries';

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
  const nodeRunMeta = useWorkflowStore((s) => s.nodeRunMeta);
  const nodeRunError = useWorkflowStore((s) => s.nodeRunError);

  const [tab, setTab] = useState<Tab>('config');
  const [width, setWidth] = useState<number>(() => {
    const v = Number(localStorage.getItem('wf.configPanelWidth'));
    return v >= 280 && v <= 760 ? v : 320;
  });

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(760, Math.max(280, startW + (startX - ev.clientX)));
      setWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // persist the latest width
      setWidth((w) => {
        localStorage.setItem('wf.configPanelWidth', String(w));
        return w;
      });
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const configNode = nodes.find((n) => n.id === configNodeId);
  if (!configNode) return null;

  const Form = pickForm(configNode);
  const update = (patch: Partial<WorkflowNodeData>) =>
    updateNodeData(configNode.id, patch);

  const isTrigger =
    configNode.type === 'trigger' || configNode.type === 'webhook';

  const runInput = configNodeId ? nodeRunInput[configNodeId] : undefined;
  const runOutput = configNodeId ? nodeRunOutput[configNodeId] : undefined;
  const runMeta = configNodeId ? nodeRunMeta[configNodeId] : undefined;
  const runError = configNodeId ? nodeRunError[configNodeId] : undefined;

  return (
    <aside
      style={{ width }}
      className="relative flex h-full shrink-0 flex-col border-l border-border bg-card max-w-[88vw]"
    >
      <div
        onMouseDown={startResize}
        onDoubleClick={() => {
          setWidth(320);
          localStorage.setItem('wf.configPanelWidth', '320');
        }}
        title="Drag to resize · double-click to reset"
        className="absolute left-0 top-0 z-10 h-full w-1.5 -translate-x-1/2 cursor-col-resize bg-transparent hover:bg-violet-500/40"
      />
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
            {outputBinaries(runOutput).map((f) => (
              <button key={f.field} type="button" onClick={() => void downloadWorkflowArtifact(f.objectKey, f.fileName)}
                className="inline-flex items-center gap-1.5 rounded border border-border px-2 py-1 text-xs font-medium text-violet-400 hover:bg-violet-500/10">
                <Download className="h-3.5 w-3.5" /> {f.fileName}
              </button>
            ))}
            {runMeta !== undefined && runMeta !== null && (
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Result</p>
                <JsonView data={runMeta} emptyLabel="" />
              </div>
            )}
            {runMeta !== undefined && runMeta !== null && (
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Items</p>
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
