// apps/studio/src/query/store.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useQueryStore } from './store';

describe('query store', () => {
  beforeEach(() => useQueryStore.setState({ tabs: [], activeId: null }));

  it('opens a table tab and activates it', () => {
    useQueryStore.getState().openTableTab({ connectorId: 'c1', type: 'postgres', schema: 'public', table: 'products' });
    const s = useQueryStore.getState();
    expect(s.tabs).toHaveLength(1);
    expect(s.tabs[0].kind).toBe('table');
    expect(s.activeId).toBe(s.tabs[0].id);
    expect(s.tabs[0]).toMatchObject({ type: 'postgres', sql: 'select * from "public"."products"' });
  });

  it('does not duplicate an already-open table tab', () => {
    const open = useQueryStore.getState().openTableTab;
    open({ connectorId: 'c1', type: 'postgres', schema: 'public', table: 'products' });
    open({ connectorId: 'c1', type: 'postgres', schema: 'public', table: 'products' });
    expect(useQueryStore.getState().tabs).toHaveLength(1);
  });

  it('quotes identifiers with brackets for SQL Server connectors', () => {
    useQueryStore.getState().openTableTab({ connectorId: 'c2', type: 'microsoft-sql', schema: 'public', table: 'products' });
    const s = useQueryStore.getState();
    expect(s.tabs[0]).toMatchObject({ type: 'microsoft-sql', sql: 'select * from [public].[products]' });
  });

  it('opens a query tab and closes tabs, re-activating a neighbour', () => {
    const st = useQueryStore.getState();
    st.openQueryTab({ title: 'Query #1' });
    st.openQueryTab({ title: 'Query #2' });
    const [a, b] = useQueryStore.getState().tabs;
    useQueryStore.getState().closeTab(b.id);
    expect(useQueryStore.getState().tabs.map((t) => t.id)).toEqual([a.id]);
    expect(useQueryStore.getState().activeId).toBe(a.id);
  });
});
