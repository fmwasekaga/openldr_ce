import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Empty-state placeholder with a faint diagonal-hatch background — the "run a query to
 * see …" / "no dashboards" look. Fills its parent (give the parent a height), draws the
 * stripes behind, and centers the content on top.
 *
 * A plain-string child renders as the muted xs caption (the default empty-state look);
 * richer children (e.g. a message + action button, as on the auth screens) bring their
 * own styling and override the caption defaults.
 *
 * The SVG pattern id is per-instance (useId) so several StripedEmpty on one page don't
 * collide on `url(#…)`.
 */
export function StripedEmpty({ children, className }: { children?: ReactNode; className?: string }) {
  const patternId = useId();
  return (
    <div className={cn('relative flex h-full w-full items-center justify-center overflow-hidden', className)}>
      <svg className="absolute inset-0 h-full w-full stroke-foreground/10" fill="none" aria-hidden="true">
        <defs>
          <pattern id={patternId} x="0" y="0" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M-3 13 15-5M-5 5l18-18M-1 21 17 3" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} stroke="none" />
      </svg>
      {children != null && <div className="relative z-10 text-xs text-muted-foreground">{children}</div>}
    </div>
  );
}
