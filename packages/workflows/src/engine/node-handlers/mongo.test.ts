import { describe, it, expect } from 'vitest';
import { mongoHandler } from './mongo';
import { createContext } from '../execution-context';

function fakeCtx(rows: Record<string, unknown>[], meta?: Record<string, unknown>) {
  const calls: unknown[] = [];
  const services = { runConnectorMongo: async (i: unknown) => { calls.push(i); return { rows, meta }; } } as unknown as import('../services').WorkflowServices;
  return { ctx: createContext(undefined, () => {}, [], undefined, services), calls };
}
const node = (cfg: Record<string, unknown>) => ({ id: 'mg1', type: 'action', data: { action: 'mongodb', config: cfg } });

describe('mongoHandler', () => {
  it('find: passes parsed query + maps docs to items', async () => {
    const { ctx, calls } = fakeCtx([{ a: 1 }, { a: 2 }]);
    const result = await mongoHandler(node({ connectorId: 'c1', operation: 'find', collection: 'obs', query: '{"a":1}' }), ctx, []);
    expect(calls[0]).toEqual({ connectorId: 'c1', operation: 'find', collection: 'obs', query: { a: 1 } });
    expect(result).toEqual([{ json: { a: 1 } }, { json: { a: 2 } }]);
  });
  it('insertMany: emits the meta as one item when no rows', async () => {
    const { ctx } = fakeCtx([], { insertedCount: 2 });
    const result = await mongoHandler(node({ connectorId: 'c1', operation: 'insertMany', collection: 'obs', query: '[{"a":1},{"a":2}]' }), ctx, []);
    expect(result).toEqual([{ json: { insertedCount: 2 } }]);
  });
  it('throws on invalid query JSON', async () => {
    const { ctx } = fakeCtx([]);
    await expect(mongoHandler(node({ connectorId: 'c1', operation: 'find', collection: 'o', query: '{bad' }), ctx, [])).rejects.toThrow(/invalid query JSON/);
  });
  it('throws without connector / collection / services', async () => {
    const { ctx } = fakeCtx([]);
    await expect(mongoHandler(node({ connectorId: '', operation: 'find', collection: 'o', query: '{}' }), ctx, [])).rejects.toThrow(/connector is required/);
    await expect(mongoHandler(node({ connectorId: 'c1', operation: 'find', collection: '', query: '{}' }), ctx, [])).rejects.toThrow(/collection is required/);
    const bare = createContext(undefined, () => {});
    await expect(mongoHandler(node({ connectorId: 'c1', operation: 'find', collection: 'o', query: '{}' }), bare, [])).rejects.toThrow(/requires server services/);
  });
});
