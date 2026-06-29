import { describe, it, expect, vi } from 'vitest';
import { sqlHandler } from './sql';
import { createContext } from '../execution-context';
import type { WorkflowServices } from '../services';

describe('sqlHandler', () => {
  it('calls runSql and returns rowsToItems result', async () => {
    const runSql = vi.fn(async () => ({ columns: [{ key: 'a', label: 'A' }], rows: [{ a: 1 }, { a: 2 }] }));
    const ctx = createContext(undefined, () => {}, [], undefined, { runSql } as unknown as WorkflowServices);
    const out = await sqlHandler(
      { id: 'n1', type: 'action', data: { config: { sql: 'SELECT 1' } } },
      ctx,
      [],
    );
    expect(runSql).toHaveBeenCalledWith('SELECT 1');
    expect(out).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });

  it('resolves templates in the sql string against input items', async () => {
    const runSql = vi.fn(async () => ({ columns: [], rows: [] }));
    const ctx = createContext(undefined, () => {}, [], undefined, { runSql } as unknown as WorkflowServices);
    await sqlHandler(
      { id: 'n1', type: 'action', data: { config: { sql: 'SELECT * FROM {{ $json.table }}' } } },
      ctx,
      [{ json: { table: 'amr' } }],
    );
    expect(runSql).toHaveBeenCalledWith('SELECT * FROM amr');
  });

  it('throws when sql is empty', async () => {
    const ctx = createContext(undefined, () => {}, [], undefined, {
      runSql: vi.fn(),
    } as unknown as WorkflowServices);
    await expect(
      sqlHandler({ id: 'n1', type: 'action', data: { config: { sql: '   ' } } }, ctx, []),
    ).rejects.toThrow(/query is required/);
  });

  it('throws when services are absent', async () => {
    const ctx = createContext(undefined, () => {});
    await expect(
      sqlHandler({ id: 'n1', type: 'action', data: { config: { sql: 'SELECT 1' } } }, ctx, []),
    ).rejects.toThrow(/requires server services/);
  });
});
