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

/** Number of a single group's capabilities present in `selected`. */
export function groupSelectedCount(group: CapabilityGroup, selected: ReadonlySet<string>): number {
  let n = 0;
  for (const c of group.capabilities) if (selected.has(c.key)) n++;
  return n;
}

/** True when every capability in the group is selected (false for an empty group). */
export function isGroupFullySelected(group: CapabilityGroup, selected: ReadonlySet<string>): boolean {
  return group.capabilities.length > 0 && group.capabilities.every((c) => selected.has(c.key));
}

/** True when some, but not all, of the group's capabilities are selected. */
export function isGroupPartiallySelected(group: CapabilityGroup, selected: ReadonlySet<string>): boolean {
  const any = group.capabilities.some((c) => selected.has(c.key));
  return any && !isGroupFullySelected(group, selected);
}

/** True when every capability across every group is selected. */
export function isAllSelected(groups: CapabilityGroup[], selected: ReadonlySet<string>): boolean {
  return groups.length > 0 && groups.every((g) => isGroupFullySelected(g, selected));
}

/** Flip a single capability's membership. Never mutates `selected`. */
export function toggleCapability(selected: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(selected);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Add (checked=true) or remove (checked=false) every capability in one group. */
export function setGroupSelected(selected: ReadonlySet<string>, group: CapabilityGroup, checked: boolean): Set<string> {
  const next = new Set(selected);
  for (const c of group.capabilities) {
    if (checked) next.add(c.key);
    else next.delete(c.key);
  }
  return next;
}

/** Add (checked=true) or remove (checked=false) every capability across every group. */
export function setAllSelected(groups: CapabilityGroup[], selected: ReadonlySet<string>, checked: boolean): Set<string> {
  const next = new Set(selected);
  for (const g of groups) {
    for (const c of g.capabilities) {
      if (checked) next.add(c.key);
      else next.delete(c.key);
    }
  }
  return next;
}
