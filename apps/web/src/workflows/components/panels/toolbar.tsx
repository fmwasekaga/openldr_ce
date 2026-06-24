import { Save, Play, Trash2, Loader2, History, Database } from 'lucide-react';
import { useWorkflowStore } from '../../hooks/use-workflow-store';

interface ToolbarProps {
  onSave: () => void;
  onRun: () => void;
  onHistory: () => void;
  onDatasets: () => void;
  saving: boolean;
  executing: boolean;
}

export function Toolbar({ onSave, onRun, onHistory, onDatasets, saving, executing }: ToolbarProps) {
  const workflowName = useWorkflowStore((s) => s.workflowName);
  const setWorkflowName = useWorkflowStore((s) => s.setWorkflowName);
  const clearCanvas = useWorkflowStore((s) => s.clearCanvas);
  const nodes = useWorkflowStore((s) => s.nodes);
  const workflowId = useWorkflowStore((s) => s.workflowId);

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-4">
      <input
        type="text"
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:border-muted-foreground/50 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/20"
        value={workflowName}
        onChange={(e) => setWorkflowName(e.target.value)}
        placeholder="Untitled Workflow"
      />
      <span className="text-xs text-muted-foreground">·</span>
      <span className="text-xs text-muted-foreground">
        {nodes.length} {nodes.length === 1 ? 'node' : 'nodes'}
      </span>
      <div className="flex-1" />
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/70 disabled:opacity-50"
        onClick={clearCanvas}
        title="Clear canvas (keeps the workflow; Save updates it)"
      >
        <Trash2 className="h-3.5 w-3.5" />
        Clear
      </button>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/70"
        onClick={onDatasets}
        title="View materialized datasets"
      >
        <Database className="h-3.5 w-3.5" />
        Datasets
      </button>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/70 disabled:opacity-50"
        onClick={onHistory}
        disabled={!workflowId}
        title={workflowId ? 'View run history' : 'Save the workflow first'}
      >
        <History className="h-3.5 w-3.5" />
        History
      </button>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground transition-colors hover:bg-secondary/70 disabled:opacity-50"
        onClick={onSave}
        disabled={saving}
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        Save
      </button>
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-md bg-gradient-to-br from-emerald-500 to-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-md shadow-emerald-500/20 transition-all hover:shadow-emerald-500/40 disabled:opacity-50 disabled:shadow-none"
        onClick={onRun}
        disabled={nodes.length === 0 || executing}
      >
        {executing ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Play className="h-3.5 w-3.5 fill-current" />
        )}
        Run
      </button>
    </div>
  );
}
