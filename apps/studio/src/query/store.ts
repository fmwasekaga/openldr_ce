// apps/studio/src/query/store.ts
import { create } from 'zustand';
import type { CustomQueryParam } from './custom-query-types';

let seq = 0;
const nextId = () => `t${++seq}`;

export interface TableTab {
  id: string; kind: 'table'; connectorId: string; type: string; schema: string; table: string; title: string;
  // Inline ad-hoc SQL for this table view: `sql` is the query the grid runs (defaults to a plain
  // browse SELECT); `showSql` toggles the inline editor's visibility.
  sql: string; showSql: boolean;
}
export interface DatasetTab { id: string; kind: 'dataset'; name: string; title: string }
export interface QueryTab {
  id: string; kind: 'query'; title: string;
  customQueryId?: string; connectorId?: string; sql: string; params: CustomQueryParam[]; dirty: boolean;
}
export type Tab = TableTab | DatasetTab | QueryTab;

interface State {
  tabs: Tab[];
  activeId: string | null;
  openTableTab(t: { connectorId: string; type: string; schema: string; table: string }): void;
  openDatasetTab(d: { name: string }): void;
  openQueryTab(q: { title?: string; customQueryId?: string; connectorId?: string; sql?: string; params?: CustomQueryParam[] }): void;
  setActive(id: string): void;
  closeTab(id: string): void;
  patchQuery(id: string, patch: Partial<QueryTab>): void;
  patchTable(id: string, patch: Partial<TableTab>): void;
  /** Clear all open tabs — used to reset the workspace to a blank state when leaving the page. */
  reset(): void;
}

export const useQueryStore = create<State>((set, get) => ({
  tabs: [], activeId: null,
  openTableTab({ connectorId, type, schema, table }) {
    const existing = get().tabs.find((t) => t.kind === 'table' && t.connectorId === connectorId && t.schema === schema && t.table === table);
    if (existing) { set({ activeId: existing.id }); return; }
    const sql =
      type === 'microsoft-sql' ? `select * from [${schema}].[${table}]`
      : type === 'mysql' ? `select * from \`${schema}\`.\`${table}\``
      : `select * from "${schema}"."${table}"`;
    const tab: TableTab = { id: nextId(), kind: 'table', connectorId, type, schema, table, title: table,
      sql, showSql: false };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  openDatasetTab({ name }) {
    const existing = get().tabs.find((t) => t.kind === 'dataset' && t.name === name);
    if (existing) { set({ activeId: existing.id }); return; }
    const tab: DatasetTab = { id: nextId(), kind: 'dataset', name, title: name };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  openQueryTab(q) {
    if (q.customQueryId) {
      const existing = get().tabs.find((t) => t.kind === 'query' && t.customQueryId === q.customQueryId);
      if (existing) { set({ activeId: existing.id }); return; }
    }
    const n = get().tabs.filter((t) => t.kind === 'query').length + 1;
    const tab: QueryTab = { id: nextId(), kind: 'query', title: q.title ?? `Query #${n}`,
      customQueryId: q.customQueryId, connectorId: q.connectorId, sql: q.sql ?? '', params: q.params ?? [], dirty: false };
    set((s) => ({ tabs: [...s.tabs, tab], activeId: tab.id }));
  },
  setActive(id) { set({ activeId: id }); },
  closeTab(id) {
    const { tabs, activeId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    let active = activeId;
    if (activeId === id) active = next[idx] ? next[idx].id : next[idx - 1]?.id ?? null;
    set({ tabs: next, activeId: active });
  },
  patchQuery(id, patch) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && t.kind === 'query' ? { ...t, ...patch } : t)) }));
  },
  patchTable(id, patch) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id && t.kind === 'table' ? { ...t, ...patch } : t)) }));
  },
  reset() { set({ tabs: [], activeId: null }); },
}));
