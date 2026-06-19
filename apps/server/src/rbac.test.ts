import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { requireRole } from './rbac';
import './auth-plugin'; // pulls in the req.user type augmentation

function appWith(actorRoles: string[] | null) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    if (actorRoles) req.user = { id: 'a', username: 'a', displayName: null, roles: actorRoles };
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
