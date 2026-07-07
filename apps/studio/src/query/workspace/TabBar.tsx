// apps/studio/src/query/workspace/TabBar.tsx
import { X, Plus, Table2, Zap, Package } from 'lucide-react';
import { useQueryStore, type Tab } from '../store';

function tabIcon(t: Tab) {
  if (t.kind === 'table') return <Table2 className="h-4 w-4" />;
  if (t.kind === 'dataset') return <Package className="h-4 w-4" />;
  return <Zap className="h-4 w-4" />;
}

export function TabBar(): JSX.Element {
  const { tabs, activeId, setActive, closeTab, openQueryTab } = useQueryStore();
  return (
    <div className="flex items-end gap-1 border-b border-border bg-background pl-3 pr-2 pt-2">
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <div key={t.id}
            className={`relative flex items-center gap-2 rounded-t-lg border px-4 py-2 text-[13px] ${active
              ? '-mb-px z-10 border-border border-b-transparent bg-background text-foreground'
              : 'border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/50'}`}>
            <button className="flex items-center gap-2" onClick={() => setActive(t.id)}>{tabIcon(t)}{t.title}</button>
            <button aria-label={`close ${t.title}`} onClick={() => closeTab(t.id)}><X className="h-3.5 w-3.5 opacity-60 hover:opacity-100" /></button>
          </div>
        );
      })}
      <button aria-label="new query" className="mb-1 ml-0.5 rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => openQueryTab({})}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
