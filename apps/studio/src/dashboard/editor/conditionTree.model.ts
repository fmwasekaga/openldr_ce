// Pure state-transition helpers for the recursive AND/OR filter tree (ConditionGroup / ConditionRule
// in @openldr/dashboards). Kept free of React/DOM so they're unit-testable without jsdom or Radix —
// see FilterTreeEditor.tsx, a thin shadcn shell over these functions. Types are defined locally
// (structurally identical to the schema) to match conditionModel.ts's own FilterCondition.

export type TreeRule = { kind: 'rule'; dimension: string; op: string; value: unknown };
export type TreeGroup = { kind: 'group'; combinator: 'and' | 'or'; children: TreeNode[] };
export type TreeNode = TreeRule | TreeGroup;
export type Path = number[];

export function emptyTree(): TreeGroup {
  return { kind: 'group', combinator: 'and', children: [] };
}

/** Adapt a legacy flat filter list into a root AND group of rules. */
export function filtersToTree(filters: { dimension: string; op: string; value: unknown }[]): TreeGroup {
  return { kind: 'group', combinator: 'and', children: filters.map((f) => ({ kind: 'rule', dimension: f.dimension, op: f.op, value: f.value })) };
}

/** True when the node (or any descendant) contains at least one rule. */
export function hasRules(node: TreeNode): boolean {
  return node.kind === 'rule' ? true : node.children.some(hasRules);
}

/** Recursively rebuild the group at `path`, applying `fn` to it; returns a new tree. */
function mapGroupAt(root: TreeGroup, path: Path, fn: (g: TreeGroup) => TreeGroup): TreeGroup {
  if (path.length === 0) return fn(root);
  const [i, ...rest] = path;
  const child = root.children[i];
  if (!child || child.kind !== 'group') return root;
  const children = root.children.slice();
  children[i] = mapGroupAt(child, rest, fn);
  return { ...root, children };
}

export function addRule(root: TreeGroup, path: Path, dims: { key: string }[]): TreeGroup {
  const rule: TreeRule = { kind: 'rule', dimension: dims[0]?.key ?? '', op: 'eq', value: '' };
  return mapGroupAt(root, path, (g) => ({ ...g, children: [...g.children, rule] }));
}

export function addGroup(root: TreeGroup, path: Path): TreeGroup {
  const group: TreeGroup = { kind: 'group', combinator: 'or', children: [] };
  return mapGroupAt(root, path, (g) => ({ ...g, children: [...g.children, group] }));
}

export function setCombinator(root: TreeGroup, path: Path, combinator: 'and' | 'or'): TreeGroup {
  return mapGroupAt(root, path, (g) => ({ ...g, combinator }));
}

/** Patch the rule at `path` (last index addresses a rule within its parent group). */
export function updateRule(root: TreeGroup, path: Path, patch: Partial<TreeRule>): TreeGroup {
  if (path.length === 0) return root;
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  return mapGroupAt(root, parent, (g) => {
    const child = g.children[idx];
    if (!child || child.kind !== 'rule') return g;
    const children = g.children.slice();
    children[idx] = { ...child, ...patch };
    return { ...g, children };
  });
}

/** Remove the node at `path`. Removing the root ([]) yields an empty tree. */
export function removeAt(root: TreeGroup, path: Path): TreeGroup {
  if (path.length === 0) return emptyTree();
  const parent = path.slice(0, -1);
  const idx = path[path.length - 1];
  return mapGroupAt(root, parent, (g) => ({ ...g, children: g.children.filter((_, j) => j !== idx) }));
}

/** Recursively drop every rule whose dimension is in `bound`; prune groups that become empty. */
function pruneBound(node: TreeNode, bound: Set<string>): TreeNode | null {
  if (node.kind === 'rule') return bound.has(node.dimension) ? null : node;
  const children = node.children.map((c) => pruneBound(c, bound)).filter((c): c is TreeNode => c != null);
  return { ...node, children };
}

/** Drop every rule whose dimension is in `keys` (empty groups are kept). Used to clear filter/
 *  filterTree references orphaned by removing an ad-hoc dimension. */
export function pruneDimensions(root: TreeGroup, keys: Set<string>): TreeGroup {
  return pruneBound(root, keys) as TreeGroup;
}

/**
 * Runtime binding: replace bound-dimension rules with the resolved dashboard-filter value(s),
 * ANDed with the rest of the tree. ANDing at a fresh root keeps the injected value correct even
 * when the user's own root group is an OR. Mirrors the flat bindQuery logic.
 */
export function bindFilterTree(tree: TreeGroup, bindings: Record<string, string>, filterValues: Record<string, unknown>): TreeGroup {
  const bound = new Set(Object.keys(bindings));
  const pruned = pruneBound(tree, bound) as TreeGroup;
  const injected: TreeRule[] = [];
  for (const [dimKey, filterId] of Object.entries(bindings)) {
    const v = filterValues[filterId];
    if (v == null || v === '') continue;
    if (typeof v === 'object' && 'from' in v && 'to' in v) {
      const range = v as { from: string; to: string };
      if (range.from) injected.push({ kind: 'rule', dimension: dimKey, op: 'gte', value: range.from });
      if (range.to) injected.push({ kind: 'rule', dimension: dimKey, op: 'lte', value: range.to });
    } else {
      injected.push({ kind: 'rule', dimension: dimKey, op: 'eq', value: v });
    }
  }
  if (injected.length === 0) return pruned;
  const base = hasRules(pruned) ? [pruned] : [];
  return { kind: 'group', combinator: 'and', children: [...base, ...injected] };
}
