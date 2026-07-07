// apps/studio/src/query/tree/ExplorerTree.tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ChevronDown, Plug, Package, Zap, Table2 } from 'lucide-react';
import { queryApi, type ConnectorRef, type DatasetRef } from '../api';
import { useQueryStore } from '../store';
import type { CustomQuery } from '../custom-query-types';

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

  const [openBranch, setOpenBranch] = useState<Record<string, boolean>>({});
  const [connectors, setConnectors] = useState<ConnectorRef[]>([]);
  const [datasets, setDatasets] = useState<DatasetRef[]>([]);
  const [queries, setQueries] = useState<CustomQuery[]>([]);
  const [schemas, setSchemas] = useState<Record<string, string[]>>({});
  const [tables, setTables] = useState<Record<string, string[]>>({});

  const toggle = (k: string) => setOpenBranch((o) => ({ ...o, [k]: !o[k] }));

  useEffect(() => { if (openBranch.connectors && connectors.length === 0) queryApi.connectors().then(setConnectors); }, [openBranch.connectors]);
  useEffect(() => { if (openBranch.datasets && datasets.length === 0) queryApi.datasets().then(setDatasets); }, [openBranch.datasets]);
  useEffect(() => { if (openBranch.queries && queries.length === 0) queryApi.list().then(setQueries); }, [openBranch.queries]);

  const loadSchemas = (id: string) => { toggle(`c:${id}`); if (!schemas[id]) queryApi.schemas(id).then((s) => setSchemas((m) => ({ ...m, [id]: s }))); };
  const loadTables = (id: string, schema: string) => {
    const key = `${id}/${schema}`; toggle(`s:${key}`);
    if (!tables[key]) queryApi.tables(id, schema).then((tb) => setTables((m) => ({ ...m, [key]: tb })));
  };

  return (
    <div className="flex h-full flex-col overflow-auto py-2 text-sm">
      <div className="px-3 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">System</div>

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
        <Row key={q.id} depth={1} onClick={() => openQueryTab({ customQueryId: q.id, title: q.name, connectorId: q.connectorId, sql: q.sql, params: q.params })} icon={<Zap className="h-3.5 w-3.5" />} label={q.name} />
      ))}
    </div>
  );
}
