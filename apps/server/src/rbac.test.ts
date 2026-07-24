import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { requireRole, requireCapability, requireAnyCapability } from './rbac';
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

function appWithAnyCapability(actorCapabilities: string[] | null) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (actorCapabilities) req.user = { id: 'a', username: 'a', displayName: null, roles: [], capabilities: actorCapabilities };
  });
  app.get('/api/users/:id/roles', { preHandler: requireAnyCapability('roles.view', 'users.view') }, async () => ({ ok: true }));
  return app;
}

describe('requireAnyCapability', () => {
  it('allows an actor holding one of the listed capabilities', async () => {
    const res = await appWithAnyCapability(['users.view']).inject({ method: 'GET', url: '/api/users/u1/roles' });
    expect(res.statusCode).toBe(200);
  });
  it('allows an actor holding the other listed capability', async () => {
    const res = await appWithAnyCapability(['roles.view']).inject({ method: 'GET', url: '/api/users/u1/roles' });
    expect(res.statusCode).toBe(200);
  });
  it('403s when none of the listed capabilities are present', async () => {
    const res = await appWithAnyCapability(['other.cap']).inject({ method: 'GET', url: '/api/users/u1/roles' });
    expect(res.statusCode).toBe(403);
  });
  it('401s when there is no actor', async () => {
    const res = await appWithAnyCapability(null).inject({ method: 'GET', url: '/api/users/u1/roles' });
    expect(res.statusCode).toBe(401);
  });
});
