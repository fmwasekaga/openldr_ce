// apps/studio/src/query/api.ts
import { authFetch } from '@/api';
import type { CustomQuery, CustomQueryInput, CustomQueryParam } from './custom-query-types';

export interface RunResult { columns: { key: string; label: string }[]; rows: Record<string, unknown>[]; rowCount: number; ms: number; total?: number }
export interface ConnectorRef { id: string; name: string; type: string | null }
export interface DatasetRef { id: string; name: string; rowCount: number }

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.json() as Promise<T>;
}

export const queryApi = {
  connectors: () => authFetch('/api/query/connectors').then(j<ConnectorRef[]>),
  schemas: (id: string) => authFetch(`/api/query/connectors/${id}/schemas`).then(j<string[]>),
  tables: (id: string, schema: string) => authFetch(`/api/query/connectors/${id}/schemas/${schema}/tables`).then(j<string[]>),
  datasets: () => authFetch('/api/query/datasets').then(j<DatasetRef[]>),
  // The datasets/:name route returns { columns, rows, rowCount } with no `ms`, so omit it from the type.
  datasetRows: (name: string) => authFetch(`/api/query/datasets/${encodeURIComponent(name)}`).then(j<Omit<RunResult, 'ms'>>),
  run: (body: { connectorId: string; sql: string; params?: CustomQueryParam[]; values?: Record<string, unknown>; limit?: number; offset?: number }) =>
    authFetch('/api/query/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(j<RunResult>),
  paramOptions: (connectorId: string, optionsSql: string) =>
    authFetch('/api/query/param-options', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ connectorId, optionsSql }) }).then(j<unknown[]>),
  list: () => authFetch('/api/custom-queries').then(j<CustomQuery[]>),
  create: (input: CustomQueryInput) => authFetch('/api/custom-queries', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }).then(j<{ id: string }>),
  update: (id: string, input: Partial<CustomQueryInput>) => authFetch(`/api/custom-queries/${id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }).then(j<{ ok: true }>),
  remove: (id: string) => authFetch(`/api/custom-queries/${id}`, { method: 'DELETE' }).then(j<{ ok: true }>),
};
