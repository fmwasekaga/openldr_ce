import { createConnectorMongo, type MongoConn } from './connector-mongo';

export interface ConnectorMongoDeps {
  connectors: { get(id: string): Promise<{ type: string | null; enabled: boolean } | null>; getDecryptedConfig(id: string, key: string | undefined): Promise<Record<string, string>> };
  secretsKey: string | undefined;
  connect?: (config: Record<string, string>) => Promise<MongoConn>;
}

/** Serialize a mongo doc to plain JSON (ObjectId/Date → string) via JSON round-trip. */
function toPlain(doc: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
}

export function createConnectorMongoRunner(deps: ConnectorMongoDeps) {
  const connect = deps.connect ?? createConnectorMongo;
  return async ({ connectorId, operation, collection, query }: { connectorId: string; operation: string; collection: string; query: unknown }) => {
    const c = await deps.connectors.get(connectorId);
    if (!c || !c.enabled) throw new Error(`connector ${connectorId} not found or disabled`);
    if (c.type !== 'mongodb') throw new Error(`connector ${connectorId} is not a mongodb connector`);
    const config = await deps.connectors.getDecryptedConfig(connectorId, deps.secretsKey);
    const conn = await connect(config);
    try {
      const coll = conn.db.collection(collection);
      if (operation === 'insertMany') {
        const docs = Array.isArray(query) ? query : [query];
        const r = await coll.insertMany(docs as Record<string, unknown>[]);
        return { rows: [], meta: { insertedCount: r.insertedCount } };
      }
      if (operation === 'aggregate') {
        const docs = await coll.aggregate(Array.isArray(query) ? (query as Record<string, unknown>[]) : []).toArray();
        return { rows: docs.map(toPlain) };
      }
      const docs = await coll.find((query ?? {}) as Record<string, unknown>).toArray();
      return { rows: docs.map(toPlain) };
    } finally {
      await conn.close();
    }
  };
}
