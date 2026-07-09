import { type ReactNode } from 'react';
import { Handle, Position, NodeToolbar } from '@xyflow/react';
import { Loader2, Play, Settings, Trash2, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useWorkflowStore, type NodeRunStatus } from '../../hooks/use-workflow-store';
import { NodeIcon } from '../../lib/icons';
import { Button } from '@/components/ui/button';
import { TruncatedText } from '@/components/ui/truncated-text';

export type NodeVariant = 'trigger' | 'action' | 'code' | 'condition' | 'loop' | 'webhook';

interface VariantTokens {
  /** Tailwind class for the handle dot background (uses inline color via !) */
  handleBg: string;
  /** Tailwind border class used to highlight the card when selected */
  selectedBorder: string;
  /** Tailwind text color for the bare icon (no background tile) */
  iconColor: string;
}

const VARIANT_TOKENS: Record<NodeVariant, VariantTokens> = {
  trigger: {
    handleBg: '!bg-emerald-500',
    selectedBorder: 'border-emerald-500',
    iconColor: 'text-emerald-400',
  },
  action: {
    handleBg: '!bg-sky-500',
    selectedBorder: 'border-sky-500',
    iconColor: 'text-sky-400',
  },
  code: {
    handleBg: '!bg-slate-500',
    selectedBorder: 'border-slate-400',
    iconColor: 'text-slate-300',
  },
  condition: {
    handleBg: '!bg-amber-500',
    selectedBorder: 'border-amber-500',
    iconColor: 'text-amber-400',
  },
  loop: {
    handleBg: '!bg-violet-500',
    selectedBorder: 'border-violet-500',
    iconColor: 'text-violet-400',
  },
  webhook: {
    handleBg: '!bg-teal-500',
    selectedBorder: 'border-teal-500',
    iconColor: 'text-teal-400',
  },
};

interface NodeShellProps {
  id: string;
  variant: NodeVariant;
  /** Default icon when data.iconName / data.iconUrl isn't set. */
  icon: LucideIcon;
  /** Dynamic lucide icon name from node data — overrides `icon` when present. */
  iconName?: string;
  /** Custom asset URL (e.g. /node-icons/slack.svg) — takes priority over both. */
  iconUrl?: string;
  label: string;
  subtitle?: string;
  selected?: boolean;
  /** Whether to render the default left target handle */
  hasInput?: boolean;
  /** Whether to render the default right source handle */
  hasOutput?: boolean;
  /** Extra handles (e.g. condition's true/false outputs) rendered after defaults */
  extraHandles?: ReactNode;
  /** Optional content rendered below the label (e.g. branch labels) */
  children?: ReactNode;
}

const SQUARE_SIZE = 'h-[72px] w-[72px]';

/**
 * n8n-style square node. Renders an icon-only square card with the label
 * positioned outside underneath. Flow is horizontal (left → right) so the
 * default handles sit on the left/right edges.
 */
/**
 * Run-state visual tokens. These layer UNDER the selected-border styling so
 * a running node can also be selected and both show. `running` uses a
 * dashed animated outline + spinner overlay; `error` is a persistent red
 * border; `success` is a softer emerald border that sticks around until the
 * next run.
 */
const RUN_STATE_BORDER: Record<NodeRunStatus, string> = {
  idle: '',
  waiting: 'border-violet-400 animate-pulse cursor-pointer',
  running: 'border-violet-400 animate-pulse',
  success: 'border-emerald-500',
  error: 'border-rose-500',
  skipped: 'border-dashed border-muted-foreground/50',
};

export function NodeShell({
  id,
  variant,
  icon: FallbackIcon,
  iconName,
  iconUrl,
  label,
  subtitle,
  selected,
  hasInput = true,
  hasOutput = true,
  extraHandles,
  children,
}: NodeShellProps) {
  const tokens = VARIANT_TOKENS[variant];
  const removeNode = useWorkflowStore((s) => s.removeNode);
  const setConfigNode = useWorkflowStore((s) => s.setConfigNode);
  const runStatus = useWorkflowStore((s) => s.nodeRunStatus[id] ?? ('idle' as NodeRunStatus));
  // Prefer data-driven icon (so library nodes like Slack, Gmail, etc. render
  // their own brand icon); fall back to the component's default lucide icon.
  const hasDataIcon = Boolean(iconUrl || iconName);

  return (
    <>
      <NodeToolbar isVisible={selected} className="flex gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setConfigNode(id)}
          title="Configure"
          className="h-7 w-7 shadow-md"
        >
          <Settings className="h-3.5 w-3.5" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => removeNode(id)}
          title="Delete"
          className="h-7 w-7 shadow-md"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </NodeToolbar>

      {/* The square card itself. Wrapper is `inline-flex flex-col` so the label
          can sit underneath without affecting handle positioning (handles attach
          to the bordered square via relative positioning). Run-state border is
          applied LAST so it wins when a node is both selected and running. */}
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'relative flex shrink-0 items-center justify-center rounded-xl border-2 border-border bg-card shadow-md shadow-black/30 transition-colors',
            SQUARE_SIZE,
            selected && tokens.selectedBorder,
            RUN_STATE_BORDER[runStatus],
          )}
        >
          {runStatus === 'running' && (
            <div className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-white shadow">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            </div>
          )}
          {runStatus === 'waiting' && (
            <div
              className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-white shadow"
              title="Click to run"
            >
              <Play className="h-2.5 w-2.5 fill-current" />
            </div>
          )}
          {hasInput && (
            <Handle
              type="target"
              position={Position.Left}
              className={cn(
                '!h-3 !w-3 !rounded-full !border-2 !border-background transition-all hover:!h-4 hover:!w-4',
                tokens.handleBg,
              )}
            />
          )}
          <div className={cn('flex items-center justify-center', tokens.iconColor)}>
            {hasDataIcon ? (
              <NodeIcon iconName={iconName} iconUrl={iconUrl} className="h-9 w-9" alt={label} />
            ) : (
              <FallbackIcon className="h-9 w-9" />
            )}
          </div>
          {hasOutput && (
            <Handle
              type="source"
              position={Position.Right}
              className={cn(
                '!h-3 !w-3 !rounded-full !border-2 !border-background transition-all hover:!h-4 hover:!w-4',
                tokens.handleBg,
              )}
            />
          )}
          {extraHandles}
        </div>
        <div className="mt-1.5 max-w-[120px] text-center text-[11px] font-medium leading-tight text-foreground">
          {label}
        </div>
        {subtitle && (
          <TruncatedText text={subtitle} className="max-w-[120px] text-center text-[10px] leading-tight text-muted-foreground" />
        )}
        {children}
      </div>
    </>
  );
}
