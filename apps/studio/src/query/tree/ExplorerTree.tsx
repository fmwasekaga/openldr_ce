// apps/studio/src/query/tree/ExplorerTree.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Plug, Package, Zap, Table2, Trash2 } from 'lucide-react';
import { queryApi, type ConnectorRef, type DatasetRef } from '../api';
import { useQueryStore } from '../store';
import type { CustomQuery } from '../custom-query-types';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

function Row({ depth, open, onClick, icon, label, active }:
  { depth: number; open?: boolean; onClick(): void; icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <button onClick={onClick}
      className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-sm hover:bg-accent ${active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground'}`}
      style={{ paddingLeft: 8 + depth * 14 }}>
      {open === undefined ? <span className="w-3.5" /> : open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      {icon}<span className="truncate">{label}</span>
    </button>
  );
}

export function ExplorerTree(): JSX.Element {
  const { t } = useTranslation();
  const openTableTab = useQueryStore((s) => s.openTableTab);
  const openDatasetTab = useQueryStore((s) => s.openDatasetTab);
  const openQueryTab = useQueryStore((s) => s.openQueryTab);
  const tabs = useQueryStore((s) => s.tabs);
  const closeTab = useQueryStore((s) => s.closeTab);

  const [openBranch, setOpenBranch] = useState<Record<string, boolean>>({});
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [datasets, setDatasets] = useState<DatasetRef[]>([]);
  const [queries, setQueries] = useState<CustomQuery[]>([]);
  const [schemas, setSchemas] = useState<Record<string, string[]>>({});
  const [tables, setTables] = useState<Record<string, string[]>>({});

  const toggle = (k: string) => setOpenBranch((o) => ({ ...o, [k]: !o[k] }));

  // Explorer loads are best-effort; surface a failed fetch to the console rather than
  // leaving it as a silent unhandled rejection (the branch simply stays empty).
  const onErr = (what: string) => (e: unknown) => console.error(`[query-explorer] failed to load ${what}`, e);

  useEffect(() => { if (openBranch.connectors && connectors.length === 0) queryApi.connectors().then(setConnectors).catch(onErr('connectors')); }, [openBranch.connectors]);
  useEffect(() => { if (openBranch.datasets && datasets.length === 0) queryApi.datasets().then(setDatasets).catch(onErr('datasets')); }, [openBranch.datasets]);
  useEffect(() => { if (openBranch.queries && queries.length === 0) queryApi.list().then(setQueries).catch(onErr('custom queries')); }, [openBranch.queries]);

  const loadSchemas = (id: string) => { toggle(`c:${id}`); if (!schemas[id]) queryApi.schemas(id).then((s) => setSchemas((m) => ({ ...m, [id]: s }))).catch(onErr('schemas')); };
  const loadTables = (id: string, schema: string) => {
    const key = `${id}/${schema}`; toggle(`s:${key}`);
    if (!tables[key]) queryApi.tables(id, schema).then((tb) => setTables((m) => ({ ...m, [key]: tb }))).catch(onErr('tables'));
  };

  // Delete a custom query (Rename/Duplicate deferred — a full context menu is out of scope for v1).
  // Confirmed via the shared shadcn ConfirmDialog rather than window.confirm.
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const doDelete = async (id: string): Promise<void> => {
    try {
      await queryApi.remove(id);
      const open = tabs.find((tb) => tb.kind === 'query' && tb.customQueryId === id);
      if (open) closeTab(open.id);
      setQueries(await queryApi.list());
    } catch (e) { onErr('delete query')(e); }
  };

  return (
    <div className="flex h-full flex-col overflow-auto py-2 text-sm">
      <Row depth={0} open={!!openBranch.connectors} onClick={() => toggle('connectors')} icon={<Plug className="h-3.5 w-3.5" />} label={t('query.connectors')} />
      {openBranch.connectors && connectors.map((c) => (
        <div key={c.id}>
          <Row depth={1} open={!!openBranch[`c:${c.id}`]} onClick={() => loadSchemas(c.id)} icon={<span>🗄</span>} label={c.name} />
          {openBranch[`c:${c.id}`] && (schemas[c.id] ?? []).map((sc) => (
            <div key={sc}>
              <Row depth={2} open={!!openBranch[`s:${c.id}/${sc}`]} onClick={() => loadTables(c.id, sc)} icon={<Package className="h-3.5 w-3.5" />} label={sc} />
              {openBranch[`s:${c.id}/${sc}`] && (tables[`${c.id}/${sc}`] ?? []).map((tb) => (
                <Row key={tb} depth={3} onClick={() => openTableTab({ connectorId: c.id, schema: sc, table: tb })} icon={<Table2 className="h-3.5 w-3.5" />} label={tb} />
              ))}
            </div>
          ))}
        </div>
      ))}

      <Row depth={0} open={!!openBranch.datasets} onClick={() => toggle('datasets')} icon={<Package className="h-3.5 w-3.5" />} label={t('query.datasets')} />
      {openBranch.datasets && datasets.map((d) => (
        <Row key={d.id} depth={1} onClick={() => openDatasetTab({ name: d.name })} icon={<Table2 className="h-3.5 w-3.5" />} label={d.name} />
      ))}

      <Row depth={0} open={!!openBranch.queries} onClick={() => toggle('queries')} icon={<Zap className="h-3.5 w-3.5" />} label={t('query.customQueries')} />
      {openBranch.queries && queries.map((q) => (
        <div key={q.id} className="group relative">
          <Row depth={1} onClick={() => openQueryTab({ customQueryId: q.id, title: q.name, connectorId: q.connectorId, sql: q.sql, params: q.params })} icon={<Zap className="h-3.5 w-3.5" />} label={q.name} />
          <button onClick={(e) => { e.stopPropagation(); setDeleteId(q.id); }}
            className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-destructive group-hover:block"
            aria-label={t('query.deleteQuery')} title={t('query.deleteQuery')}>
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(o) => { if (!o) setDeleteId(null); }}
        title={t('query.confirmDeleteQuery')}
        confirmLabel={t('query.deleteQuery')}
        cancelLabel={t('common.cancel')}
        destructive
        onConfirm={() => { const id = deleteId; setDeleteId(null); if (id) void doDelete(id); }}
      />
    </div>
  );
}
