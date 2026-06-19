import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import { registerOntologyRoutes } from './ontology-routes';
import './auth-plugin';

function fakeCtx() {
  const auditEvents: Array<{ action: string; entityType: string; entityId: string; actorId: string | null }> = [];
  const ctx = {
    terminology: {
      ontology: {
        listDistributions: async () => [],
        getDistribution: async (id: string) => ({ id, name: 'dist' }),
        unlink: async () => {},
      },
    },
    audit: { record: async (e: any) => { auditEvents.push(e); return e; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext;
  return { ctx, auditEvents };
}

describe('ontology routes audit', () => {
  it('audits a distribution delete with the request actor', async () => {
    const app = Fastify();
    app.addHook('onRequest', async (req) => { req.user = { id: 'admin1', username: 'admin', displayName: null, roles: ['lab_admin'] }; });
    const { ctx, auditEvents } = fakeCtx();
    registerOntologyRoutes(app, ctx);
    const res = await app.inject({ method: 'DELETE', url: '/api/terminology/ontology/distributions/dist1' });
    expect(res.statusCode).toBe(204);
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({ action: 'ontology_distribution.delete', entityType: 'ontology_distribution', entityId: 'dist1', actorId: 'admin1' });
  });
});
