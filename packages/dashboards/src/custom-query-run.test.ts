import { describe, it, expect } from 'vitest';
import { runStoredQuery } from './custom-query-run';
it('runs a stored query through substitute→validate→connector', async () => {
  const deps = {
    customQueries: { get: async () => ({ id: 'q', name: 'q', connectorId: 'c', sql: 'select 1 as a', params: [] }) },
    runConnectorSql: async () => ({ columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] }),
  };
  expect((await runStoredQuery(deps as any, 'q', {})).rows).toEqual([{ a: 1 }]);
});

it('delegates row-cap pagination to runConnectorSql instead of wrapping the SQL itself', async () => {
  let received: { connectorId: string; sql: string; rowCap?: number; offset?: number } | undefined;
  const deps = {
    customQueries: { get: async () => ({ id: 'q', name: 'q', connectorId: 'conn-1', sql: 'select 1 as a', params: [] }) },
    runConnectorSql: async (input: { connectorId: string; sql: string; rowCap?: number; offset?: number }) => {
      received = input;
      return { columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] };
    },
  };
  await runStoredQuery(deps as any, 'q', {});
  expect(received).toEqual({ connectorId: 'conn-1', sql: 'select 1 as a', rowCap: 1000 });
});
