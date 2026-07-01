import { Hand, MousePointer2 } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useWorkflowStore } from '../hooks/use-workflow-store';

/**
 * Floating pan/select mode toggle. In `pan` mode (default), left-drag on
 * the canvas pans the viewport. In `select` mode, left-drag draws a
 * box-selection over nodes; panning moves to middle/right mouse button.
 * Either mode keeps keyboard-modifier multi-select (Shift/Ctrl/Meta-click)
 * working, so users can also grab multiple nodes without switching modes.
 */
export function InteractionModeToggle() {
  const mode = useWorkflowStore((s) => s.interactionMode);
  const setMode = useWorkflowStore((s) => s.setInteractionMode);

  return (
    <div className="absolute left-4 top-4 z-10 flex rounded-md border border-border bg-card shadow-lg">
      <ModeButton
        active={mode === 'pan'}
        onClick={() => setMode('pan')}
        title="Pan (drag to move canvas)"
      >
        <Hand className="h-3.5 w-3.5" />
      </ModeButton>
      <ModeButton
        active={mode === 'select'}
        onClick={() => setMode('select')}
        title="Select (drag to box-select nodes)"
      >
        <MousePointer2 className="h-3.5 w-3.5" />
      </ModeButton>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'flex h-8 w-8 items-center justify-center transition-colors first:rounded-l-md last:rounded-r-md',
        active
          ? 'bg-violet-500/20 text-violet-300'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}
