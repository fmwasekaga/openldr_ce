import type { ModelDimension } from '../api';

// Studio-local mirror of the dashboards ConditionGroup/ConditionRule shapes (kept loose like
// the api.ts WidgetQuery mirror). Rule value mirrors the flat BuilderFilter value (unknown).
export interface ConditionRule { kind: 'rule'; dimension: string; op: string; value: unknown }
export interface ConditionGroup { kind: 'group'; combinator: 'and' | 'or'; children: ConditionNode[] }
export type ConditionNode = ConditionRule | ConditionGroup;

export interface FlatFilter { dimension: string; op: string; value: unknown }

export function newRule(dimensions: ModelDimension[]): ConditionRule {
  return { kind: 'rule', dimension: dimensions[0]?.key ?? '', op: 'eq', value: '' };
}

export function newGroup(): ConditionGroup {
  return { kind: 'group', combinator: 'and', children: [] };
}

export function seedTreeFromFilters(filters: FlatFilter[]): ConditionGroup {
  return { kind: 'group', combinator: 'and', children: filters.map((f) => ({ kind: 'rule', dimension: f.dimension, op: f.op, value: f.value })) };
}

// True iff the tree can be shown as the simple flat list: a single AND group whose children are all rules.
export function isFlatRepresentable(root: ConditionGroup): boolean {
  return root.combinator === 'and' && root.children.every((c) => c.kind === 'rule');
}

export function flattenToFilters(root: ConditionGroup): FlatFilter[] {
  return root.children.filter((c): c is ConditionRule => c.kind === 'rule').map((r) => ({ dimension: r.dimension, op: r.op, value: r.value }));
}
