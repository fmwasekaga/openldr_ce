// apps/studio/src/query/QueryPage.tsx
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
    <div className="flex h-full flex-1 flex-col">
      <TabBar />
      <div className="min-h-0 flex-1">
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
  return (
    <AppShell title={t('nav.query')}>
      <div className="flex h-full">
        <div className="w-60 border-r border-border" data-testid="query-explorer">
          <ExplorerTree />
        </div>
        <div className="flex flex-1" data-testid="query-workspace">
          <Workspace />
        </div>
      </div>
    </AppShell>
  );
}
