import type { ReactNode } from 'react';
import { StripedEmpty } from '@/components/ui/striped-empty';
import { cn } from '@/lib/cn';

/**
 * A richer empty-state — centered icon + title + body + optional action — matching the
 * Report Designer look. Wraps `StripedEmpty` for the hatched background; use this instead
 * of a bare `StripedEmpty` string whenever the empty state benefits from a call to action.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <StripedEmpty className={cn('flex-1', className)}>
      <div className="flex flex-col items-center gap-2 text-center">
        {icon && <div className="text-muted-foreground">{icon}</div>}
        <p className="text-sm font-medium">{title}</p>
        {body && <p className="max-w-sm text-xs text-muted-foreground">{body}</p>}
        {action && <div className="mt-1">{action}</div>}
      </div>
    </StripedEmpty>
  );
}
