// apps/studio/src/query/workspace/TabBar.tsx
import { X, Plus, Table2, Zap, Package } from 'lucide-react';
import { useQueryStore, type Tab } from '../store';

function tabIcon(t: Tab) {
  if (t.kind === 'table') return <Table2 className="h-4 w-4 shrink-0" />;
  if (t.kind === 'dataset') return <Package className="h-4 w-4 shrink-0" />;
  return <Zap className="h-4 w-4 shrink-0" />;
}

/** A table tab is "dirty" when its inline SQL diverges from the default browse query. */
function isDirty(t: Tab): boolean {
  return t.kind === 'table' && t.sql !== `select * from "${t.schema}"."${t.table}"`;
}

export function TabBar(): JSX.Element {
  const { tabs, activeId, setActive, closeTab, openQueryTab } = useQueryStore();
  return (
    <div className="flex h-10 items-stretch border-b border-border bg-muted/40">
      {tabs.map((t) => {
        const isActive = t.id === activeId;
        // Flush, full-height rectangular tabs with vertical dividers (DB-tool style). The active tab
        // is marked by a primary top-accent line plus the content-surface background, so it reads
        // clearly in both light and dark mode (a bare background shift alone was invisible in light).
        return (
          <div key={t.id}
            className={`relative flex items-center gap-2 border-r border-border border-t-2 px-4 text-[13px] ${isActive
              ? 'border-t-primary bg-background text-foreground'
              : 'border-t-transparent text-muted-foreground hover:bg-background/40'}`}>
            <button className="flex items-center gap-2" onClick={() => setActive(t.id)}>{tabIcon(t)}{t.title}{isDirty(t) && <span className="text-primary" aria-hidden>*</span>}</button>
            <button aria-label={`close ${t.title}`} onClick={() => closeTab(t.id)}><X className="h-3.5 w-3.5 opacity-60 hover:opacity-100" /></button>
          </div>
        );
      })}
      <button aria-label="new query" className="flex items-center border-r border-border px-3 text-muted-foreground hover:bg-background/30 hover:text-foreground" onClick={() => openQueryTab({})}>
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
