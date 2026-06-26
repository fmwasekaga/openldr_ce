import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Full-bleed helpers for the app's standard `p-4` page containers (the settings pages
 * and similar use `... p-4`). They negative-margin to the content-pane edges so that
 * rules, tab headers and tables read EDGE-TO-EDGE instead of stopping at the page
 * padding — while page text/content stays inset.
 *
 * Convention (so `-mx-4` lands exactly on the pane edges): use these as a DIRECT child
 * of the `p-4` container — not nested inside extra horizontal padding or a scroll
 * container. For a different page padding, pass the matching `-mx-*` via `className`.
 */

/** A full-bleed horizontal divider (edge-to-edge rule). */
export function Divider({ className }: { className?: string }) {
  return <div className={cn('-mx-4 border-b border-border', className)} />;
}

/** Full-bleed wrapper for content whose own borders should reach the edges (e.g. a
 *  Table: its cells keep `px-4`, so content stays aligned while the row rules bleed). */
export function Bleed({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('-mx-4', className)}>{children}</div>;
}
