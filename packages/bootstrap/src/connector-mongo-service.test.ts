import { describe, it, expect, vi } from 'vitest';
import { createConnectorMongoRunner } from './connector-mongo-service';

const connectorsFake = (rec: unknown) => ({
  get: vi.fn(async () => rec as never),
  getDecryptedConfig: vi.fn(async () => ({ host: 'h', port: '27017', database: 'd' })),
});
function fakeMongo(docs: Record<string, unknown>[]) {
  let closed = false;
  const conn = { db: { collection: () => ({
    find: () => ({ toArray: async () => docs }),
    aggregate: () => ({ toArray: async () => docs }),
    insertMany: async (d: unknown[]) => ({ insertedCount: d.length }),
  }) }, close: async () => { closed = true; } };
  return { connect: async () => conn as never, isClosed: () => closed };
}

describe('createConnectorMongoRunner', () => {
  it('find returns serialized rows and closes', async () => {
    const m = fakeMongo([{ _id: 'x', a: 1 }]);
    const run = createConnectorMongoRunner({ connectors: connectorsFake({ type: 'mongodb', enabled: true }), secretsKey: 'k', connect: m.connect });
    const res = await run({ connectorId: 'm1', operation: 'find', collection: 'c', query: {} });
    expect(res.rows).toEqual([{ _id: 'x', a: 1 }]);
    expect(m.isClosed()).toBe(true);
  });
  it('insertMany returns meta.insertedCount', async () => {
    const m = fakeMongo([]);
    const run = createConnectorMongoRunner({ connectors: connectorsFake({ type: 'mongodb', enabled: true }), secretsKey: 'k', connect: m.connect });
    const res = await run({ connectorId: 'm1', operation: 'insertMany', collection: 'c', query: [{ a: 1 }, { a: 2 }] });
    expect(res.meta).toEqual({ insertedCount: 2 });
  });
  it('throws for wrong type', async () => {
    const run = createConnectorMongoRunner({ connectors: connectorsFake({ type: 'postgres', enabled: true }), secretsKey: 'k', connect: vi.fn() as never });
    await expect(run({ connectorId: 'x', operation: 'find', collection: 'c', query: {} })).rejects.toThrow(/not a mongodb connector/);
  });
});
