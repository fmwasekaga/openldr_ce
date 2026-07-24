// Pure selection-state helpers for the capability grid. Kept free of React/DOM so they're
// unit-testable without jsdom or Radix — see CapabilityGrid.tsx, which is a thin shadcn shell
// over these functions. Mirrors the pattern in dashboard/editor/builderForm.model.ts.

import type { CapabilityGroup } from '@/api';

/** Total number of capabilities across all groups. */
export function totalCapabilityCount(groups: CapabilityGroup[]): number {
  return groups.reduce((sum, g) => sum + g.capabilities.length, 0);
}

/** Number of capabilities (across all groups) present in `selected`. */
export function selectedCapabilityCount(groups: CapabilityGroup[], selected: ReadonlySet<string>): number {
  let n = 0;
  for (const g of groups) for (const c of g.capabilities) if (selected.has(c.key)) n++;
  return n;
}

/** Flip a single capability's membership. Never mutates `selected`. */
export function toggleCapability(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
