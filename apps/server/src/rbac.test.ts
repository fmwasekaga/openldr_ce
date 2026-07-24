import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { requireRole, requireCapability } from './rbac';
import './auth-plugin'; // pulls in the req.user type augmentation

function appWith(actorRoles: string[] | null) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (actorRoles) req.user = { id: 'a', username: 'a', displayName: null, roles: actorRoles, capabilities: [] };
  });
  app.post('/api/admin', { preHandler: requireRole('lab_admin') }, async () => ({ ok: true }));
  return app;
}

describe('requireRole', () => {
  it('allows a matching role', async () => {
    const res = await appWith(['lab_admin']).inject({ method: 'POST', url: '/api/admin' });
    expect(res.statusCode).toBe(200);
  });
  it('403s a non-matching role', async () => {
    const res = await appWith(['lab_technician']).inject({ method: 'POST', url: '/api/admin' });
    expect(res.statusCode).toBe(403);
  });
  it('401s when there is no actor', async () => {
    const res = await appWith(null).inject({ method: 'POST', url: '/api/admin' });
    expect(res.statusCode).toBe(401);
  });
});

function appWithCapabilities(actorCapabilities: string[] | null) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (actorCapabilities) req.user = { id: 'a', username: 'a', displayName: null, roles: [], capabilities: actorCapabilities };
  });
  app.post('/api/roles', { preHandler: requireCapability('roles.manage') }, async () => ({ ok: true }));
  return app;
}

describe('requireCapability', () => {
  it('allows a matching capability', async () => {
    const res = await appWithCapabilities(['roles.manage']).inject({ method: 'POST', url: '/api/roles' });
    expect(res.statusCode).toBe(200);
  });
  it('403s a missing capability', async () => {
    const res = await appWithCapabilities(['other.cap']).inject({ method: 'POST', url: '/api/roles' });
    expect(res.statusCode).toBe(403);
  });
  it('401s when there is no actor', async () => {
    const res = await appWithCapabilities(null).inject({ method: 'POST', url: '/api/roles' });
    expect(res.statusCode).toBe(401);
  });
});
