import { describe, it, expect } from 'vitest';
import { runStoredQuery } from './custom-query-run';
it('runs a stored query through substitute→validate→connector', async () => {
  const deps = {
    customQueries: { get: async () => ({ id: 'q', name: 'q', connectorId: 'c', sql: 'select 1 as a', params: [] }) },
    runConnectorSql: async () => ({ columns: [{ key: 'a', label: 'a' }], rows: [{ a: 1 }] }),
  };
  expect((await runStoredQuery(deps as any, 'q', {})).rows).toEqual([{ a: 1 }]);
});
