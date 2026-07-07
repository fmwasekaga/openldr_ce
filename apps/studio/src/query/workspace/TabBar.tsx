// apps/studio/src/query/workspace/TabBar.tsx
import { X, Plus, Table2, Zap, Package, Code2 } from 'lucide-react';
import { useQueryStore, type Tab } from '../store';

function tabIcon(t: Tab) {
  if (t.kind === 'table') return <Table2 className="h-4 w-4 shrink-0" />;
  if (t.kind === 'dataset') return <Package className="h-4 w-4 shrink-0" />;
  return <Zap className="h-4 w-4 shrink-0" />;
}

export function TabBar(): JSX.Element {
  const { tabs, activeId, setActive, closeTab, openQueryTab, patchTable } = useQueryStore();
  const active = tabs.find((t) => t.id === activeId);
  return (
    <div className="flex h-10 items-stretch border-b border-border bg-muted/40">
      {tabs.map((t) => {
        const isActive = t.id === activeId;
        // Flush, full-height rectangular tabs with vertical dividers (DB-tool style). The active
        // tab uses the panel bg + a -mb-px overlap so its bottom merges with the content below.
        return (
          <div key={t.id}
            className={`relative flex items-center gap-2 border-r border-border px-4 text-[13px] ${isActive
              ? '-mb-px bg-background text-foreground'
              : 'text-muted-foreground hover:bg-background/30'}`}>
            <button className="flex items-center gap-2" onClick={() => setActive(t.id)}>{tabIcon(t)}{t.title}</button>
            <button aria-label={`close ${t.title}`} onClick={() => closeTab(t.id)}><X className="h-3.5 w-3.5 opacity-60 hover:opacity-100" /></button>
          </div>
        );
      })}
      <button aria-label="new query" className="flex items-center border-r border-border px-3 text-muted-foreground hover:bg-background/30 hover:text-foreground" onClick={() => openQueryTab({})}>
        <Plus className="h-4 w-4" />
      </button>
      {active?.kind === 'table' && (
        <button aria-label="toggle SQL editor"
          className={`ml-auto mr-2 flex items-center gap-1 self-center rounded px-2 py-1 text-xs ${active.showSql
            ? 'bg-primary text-primary-foreground'
            : 'border border-border text-muted-foreground hover:text-foreground'}`}
          onClick={() => patchTable(active.id, { showSql: !active.showSql })}>
          <Code2 className="h-3.5 w-3.5" /> SQL
        </button>
      )}
    </div>
  );
}
