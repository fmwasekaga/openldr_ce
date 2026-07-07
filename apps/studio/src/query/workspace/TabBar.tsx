// apps/studio/src/query/workspace/TabBar.tsx
import { X, Plus, Table2, Zap, Package } from 'lucide-react';
import { useQueryStore, type Tab } from '../store';

function tabIcon(t: Tab) {
  if (t.kind === 'table') return <Table2 className="h-3.5 w-3.5" />;
  if (t.kind === 'dataset') return <Package className="h-3.5 w-3.5" />;
  return <Zap className="h-3.5 w-3.5" />;
}

export function TabBar(): JSX.Element {
  const { tabs, activeId, setActive, closeTab, openQueryTab } = useQueryStore();
  return (
    <div className="flex items-end gap-0.5 border-b border-border bg-muted/40 px-2">
      {tabs.map((t) => (
        <div key={t.id}
          className={`flex items-center gap-1.5 rounded-t border border-b-0 px-3 py-1.5 text-xs ${t.id === activeId ? 'border-border bg-background text-foreground' : 'border-transparent text-muted-foreground'}`}>
          <button className="flex items-center gap-1.5" onClick={() => setActive(t.id)}>{tabIcon(t)}{t.title}</button>
          <button aria-label={`close ${t.title}`} onClick={() => closeTab(t.id)}><X className="h-3 w-3 opacity-60 hover:opacity-100" /></button>
        </div>
      ))}
      <button aria-label="new query" className="px-2 py-1.5 text-muted-foreground hover:text-foreground" onClick={() => openQueryTab({})}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
