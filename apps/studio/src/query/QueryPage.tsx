// apps/studio/src/query/QueryPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen, Database, Table2 } from 'lucide-react';
import { AppShell } from '../shell/AppShell';
import { Button } from '@/components/ui/button';
import { useTranslation } from 'react-i18next';
import { ExplorerTree } from './tree/ExplorerTree';
import { TabBar } from './workspace/TabBar';
import { TableTab } from './workspace/TableTab';
import { QueryTab } from './workspace/QueryTab';
import { useQueryStore } from './store';
import { EmptyState } from '@/components/ui/empty-state';
import { queryApi } from './api';

function Workspace({ canQuery }: { canQuery: boolean }): JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { tabs, activeId } = useQueryStore();
  const active = tabs.find((t) => t.id === activeId);
  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <TabBar canQuery={canQuery} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {!active && (canQuery
          ? <EmptyState icon={<Table2 className="h-6 w-6" />} title={t('query.selectOrOpen')} />
          : <EmptyState
              icon={<Database className="h-6 w-6" />}
              title={t('query.noSourcesTitle')}
              body={t('query.noSources')}
              action={<Button onClick={() => navigate('/settings/connectors')}>{t('query.addConnector')}</Button>}
            />)}
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
  // Default true so the "+" isn't briefly disabled while the availability check is in flight.
  const [canQuery, setCanQuery] = useState(true);
  // The query store is module-level (survives route changes); clear open tabs when leaving so
  // re-entering the page starts from a blank workspace rather than restoring the old session.
  const reset = useQueryStore((s) => s.reset);
  useEffect(() => () => reset(), [reset]);

  // Eagerly check whether there is anything queryable at all (connectors, datasets, or saved
  // custom queries) so the "new query" action can be disabled instead of opening onto a dead end.
  useEffect(() => {
    Promise.all([queryApi.connectors(), queryApi.datasets(), queryApi.list()])
      .then(([c, d, q]) => setCanQuery(c.length + d.length + q.length > 0))
      .catch(() => setCanQuery(false));
  }, []);
  return (
    <AppShell title={t('nav.query')} fullBleed>
      <div className="flex h-full min-h-0">
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
            {/* Match the tab-bar height + separator so the explorer header sits flush with the tabs. */}
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-muted/40 px-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('query.explorer')}</span>
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
          <Workspace canQuery={canQuery} />
        </div>
      </div>
    </AppShell>
  );
}
