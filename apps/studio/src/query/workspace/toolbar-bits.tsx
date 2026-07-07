// apps/studio/src/query/workspace/toolbar-bits.tsx
// Small shared bits for the query/table editor toolbars. Each Tooltip needs a TooltipProvider
// ancestor — the toolbars wrap their row in one.
import type { ReactNode } from 'react';
import { Info, CheckCircle2, AlertCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export type RunStatus = 'idle' | 'ok' | 'error';

/** Circular run-status indicator with a tooltip: neutral (idle), green (ok), red (error). */
export function StatusIcon({ status, message }: { status: RunStatus; message: string }): JSX.Element {
  const icon = status === 'ok'
    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
    : status === 'error'
      ? <AlertCircle className="h-4 w-4 text-destructive" />
      : <Info className="h-4 w-4 text-muted-foreground" />;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center" aria-label="run status" role="status">{icon}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-sm break-words">{message}</TooltipContent>
    </Tooltip>
  );
}

/** Ghost icon-only button with a tooltip label. `active` tints it with the brand color. */
export function IconButton({ icon, label, onClick, active }: { icon: ReactNode; label: string; onClick(): void; active?: boolean }): JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button aria-label={label} onClick={onClick}
          className={`rounded p-1.5 hover:bg-accent hover:text-foreground ${active ? 'text-primary' : 'text-muted-foreground'}`}>
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

/** Short, vertically-centered divider between toolbar action groups. */
export function Sep(): JSX.Element {
  return <div className="mx-1 h-5 w-px shrink-0 bg-border" />;
}
