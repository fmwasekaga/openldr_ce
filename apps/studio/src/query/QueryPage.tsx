// apps/studio/src/query/QueryPage.tsx
import { useState } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { AppShell } from '../shell/AppShell';
import { useTranslation } from 'react-i18next';
import { ExplorerTree } from './tree/ExplorerTree';
import { TabBar } from './workspace/TabBar';
import { TableTab } from './workspace/TableTab';
import { QueryTab } from './workspace/QueryTab';
import { useQueryStore } from './store';

function Workspace(): JSX.Element {
  const { tabs, activeId } = useQueryStore();
  const active = tabs.find((t) => t.id === activeId);
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <TabBar />
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        {!active && <div className="grid h-full place-items-center text-sm text-muted-foreground">Select a table or open a query</div>}
        {active?.kind === 'table' && <TableTab tab={active} />}
        {active?.kind === 'dataset' && <TableTab tab={active} />}
        {active?.kind === 'query' && <QueryTab tab={active} />}
      </div>
    </div>
  );
}

export function QueryPage(): JSX.Element {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <AppShell title={t('nav.query')}>
      <div className="flex h-full">
        {collapsed ? (
          <div className="flex w-8 shrink-0 flex-col items-center border-r border-border py-2">
            <button onClick={() => setCollapsed(false)}
              className="rounded p-1 text-muted-foreground hover:bg-accent"
              aria-label={t('query.expandExplorer')} title={t('query.expandExplorer')}>
              <PanelLeftOpen className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex w-60 shrink-0 flex-col border-r border-border" data-testid="query-explorer">
            <div className="flex items-center justify-between px-2 py-1.5">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{t('query.explorer')}</span>
              <button onClick={() => setCollapsed(true)}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
                aria-label={t('query.collapseExplorer')} title={t('query.collapseExplorer')}>
                <PanelLeftClose className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <ExplorerTree />
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1" data-testid="query-workspace">
          <Workspace />
        </div>
      </div>
    </AppShell>
  );
}
