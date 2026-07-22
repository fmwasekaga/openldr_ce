import type { ReactNode } from 'react';

/**
 * Consistent, title-less header for settings sub-pages. The left sub-nav already names
 * the page, so this only carries a short description and optional page-level actions —
 * no `<h1>`. Edge-to-edge (matches the `@/components/ui/bleed` convention for these panes).
 */
export function SettingsHeader({ description, actions }: { description: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <div className="min-w-0 text-sm text-muted-foreground">{description}</div>
      {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
    </div>
  );
}
