// apps/studio/src/query/workspace/TabBar.tsx
import { X, Plus, Table2, Zap, Package } from 'lucide-react';
import { useQueryStore, type Tab } from '../store';

function tabIcon(t: Tab) {
  if (t.kind === 'table') return <Table2 className="h-4 w-4 shrink-0" />;
  if (t.kind === 'dataset') return <Package className="h-4 w-4 shrink-0" />;
  return <Zap className="h-4 w-4 shrink-0" />;
}

export function TabBar(): JSX.Element {
  const { tabs, activeId, setActive, closeTab, openQueryTab } = useQueryStore();
  return (
    <div className="flex items-stretch border-b border-border bg-muted/40">
      {tabs.map((t) => {
        const active = t.id === activeId;
        // Flush, full-height rectangular tabs separated by vertical dividers (DB-tool style).
        // The active tab uses the panel background and a -mb-px overlap so its bottom covers the
        // bar's border, reading as one surface with the content below.
        return (
          <div key={t.id}
            className={`relative flex items-center gap-2 border-r border-border px-4 py-2.5 text-[13px] ${active
              ? '-mb-px bg-background text-foreground'
              : 'text-muted-foreground hover:bg-background/30'}`}>
            <button className="flex items-center gap-2" onClick={() => setActive(t.id)}>{tabIcon(t)}{t.title}</button>
            <button aria-label={`close ${t.title}`} onClick={() => closeTab(t.id)}><X className="h-3.5 w-3.5 opacity-60 hover:opacity-100" /></button>
          </div>
        );
      })}
      <button aria-label="new query" className="flex items-center px-3 text-muted-foreground hover:bg-background/30 hover:text-foreground" onClick={() => openQueryTab({})}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
