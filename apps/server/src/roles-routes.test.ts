import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AppContext } from '@openldr/bootstrap';
import type { RoleRecord, RoleStore } from '@openldr/db';
import { OpenLdrError } from '@openldr/core';
import { CAPABILITY_KEYS } from '@openldr/rbac';
import { registerRolesRoutes } from './roles-routes';
import './auth-plugin';

// ---------------------------------------------------------------------------
// fakeRoleStore — in-memory RoleStore mirroring the real invariants
// (packages/db/src/role-store.ts) closely enough to exercise the route's
// error-mapping without a DB.
// ---------------------------------------------------------------------------
const LOCKED_SLUG = 'lab_admin';

interface RoleRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  capabilities: string[];
}

function buildFakeRoleStore() {
  const roles = new Map<string, RoleRow>();
  const userRoles = new Map<string, Set<string>>();
  let seq = 0;

  function toRecord(r: RoleRow): RoleRecord {
    let memberCount = 0;
    for (const set of userRoles.values()) if (set.has(r.id)) memberCount++;
    return {
      id: r.id, slug: r.slug, name: r.name, description: r.description,
      isSystem: r.isSystem, locked: r.slug === LOCKED_SLUG,
      capabilities: [...r.capabilities], memberCount,
    };
  }

  function validateCaps(caps: string[]): void {
    const known = new Set(CAPABILITY_KEYS);
    for (const c of caps) if (!known.has(c)) throw new OpenLdrError(`unknown capability: ${c}`);
  }

  function manageHolderCount(): number {
    const holders = new Set<string>();
    for (const [subject, set] of userRoles) {
      for (const roleId of set) {
        if (roles.get(roleId)?.capabilities.includes('roles.manage')) { holders.add(subject); break; }
      }
    }
    return holders.size;
  }

  const store: RoleStore = {
    async list() { return [...roles.values()].map(toRecord); },
    async get(id) { const r = roles.get(id); return r ? toRecord(r) : null; },
    async getBySlug(slug) { const r = [...roles.values()].find((x) => x.slug === slug); return r ? toRecord(r) : null; },
    async create(input) {
      validateCaps(input.capabilities);
      const slug = input.slug ?? input.name.toLowerCase().replace(/\s+/g, '-');
      const id = `role-${++seq}`;
      roles.set(id, { id, slug, name: input.name, description: input.description ?? null, isSystem: false, capabilities: [...input.capabilities] });
      return toRecord(roles.get(id)!);
    },
    async update(id, patch) {
      const r = roles.get(id);
      if (!r) throw new OpenLdrError(`role ${id} not found`);
      if (r.slug === LOCKED_SLUG) throw new OpenLdrError('the Administrator role cannot be modified');
      if (patch.capabilities) validateCaps(patch.capabilities);
      if (patch.name !== undefined) r.name = patch.name;
      if (patch.description !== undefined) r.description = patch.description;
      if (patch.capabilities) r.capabilities = [...patch.capabilities];
      return toRecord(r);
    },
    async remove(id) {
      const r = roles.get(id);
      if (!r) return;
      if (r.isSystem) throw new OpenLdrError('system roles cannot be deleted');
      if (r.capabilities.includes('roles.manage')) {
        const others = [...roles.values()].some((x) => x.id !== id && x.capabilities.includes('roles.manage'));
        if (!others) throw new OpenLdrError('cannot delete the last role granting roles.manage');
      }
      roles.delete(id);
      for (const set of userRoles.values()) set.delete(id);
    },
    async resolveCapabilities(subject) {
      const set = userRoles.get(subject) ?? new Set<string>();
      const caps = new Set<string>();
      for (const roleId of set) { const r = roles.get(roleId); if (r) for (const c of r.capabilities) caps.add(c); }
      return [...caps];
    },
    async rolesForUser(subject) {
      const set = userRoles.get(subject) ?? new Set<string>();
      return [...set].map((id) => roles.get(id)).filter((r): r is RoleRow => Boolean(r)).map(toRecord);
    },
    async assignRole(subject, roleId) {
      if (!userRoles.has(subject)) userRoles.set(subject, new Set());
      userRoles.get(subject)!.add(roleId);
    },
    async unassignRole(subject, roleId) {
      const role = roles.get(roleId);
      if (role?.capabilities.includes('roles.manage')) {
        const remaining = new Set(userRoles.get(subject) ?? []);
        remaining.delete(roleId);
        const stillHasViaOther = [...remaining].some((id) => roles.get(id)?.capabilities.includes('roles.manage'));
        if (!stillHasViaOther && manageHolderCount() <= 1) throw new OpenLdrError('cannot remove the last user holding roles.manage');
      }
      userRoles.get(subject)?.delete(roleId);
    },
    async setUserRoles(subject, roleIds) {
      const willHaveManage = roleIds.some((id) => roles.get(id)?.capabilities.includes('roles.manage'));
      if (!willHaveManage) {
        const otherHolders = [...userRoles.entries()].some(
          ([s, set]) => s !== subject && [...set].some((id) => roles.get(id)?.capabilities.includes('roles.manage')),
        );
        if (!otherHolders) throw new OpenLdrError('this change would leave no user able to manage roles');
      }
      userRoles.set(subject, new Set(roleIds));
    },
    async seedSystemRoles() { /* unused in these tests */ },
    async backfillUserFromRoleNames() { /* unused in these tests */ },
  };

  return {
    store,
    seedRole(opts: { id?: string; slug: string; name: string; capabilities: string[]; isSystem?: boolean }): string {
      const id = opts.id ?? `role-${++seq}`;
      roles.set(id, { id, slug: opts.slug, name: opts.name, description: null, isSystem: opts.isSystem ?? false, capabilities: [...opts.capabilities] });
      return id;
    },
    assign(subject: string, roleId: string): void {
      if (!userRoles.has(subject)) userRoles.set(subject, new Set());
      userRoles.get(subject)!.add(roleId);
    },
  };
}

type AuditRecord = { actorType: string; actorId: string | null; actorName: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; metadata?: Record<string, unknown> };

function fakeCtx() {
  const { store, seedRole, assign } = buildFakeRoleStore();
  const auditEvents: AuditRecord[] = [];
  const ctx = {
    roles: store,
    audit: { record: async (e: AuditRecord) => { auditEvents.push(e); return { ...e, id: `audit-${auditEvents.length}`, occurredAt: new Date().toISOString() }; } },
    logger: { error() {}, warn() {}, info() {} },
  } as unknown as AppContext & { __auditEvents: AuditRecord[] };
  return { ctx, auditEvents, seedRole, assign };
}

function appWithUser(ctx: AppContext, capabilities: string[]) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => {
    req.user = { id: 'actor-1', username: 'actor', displayName: null, roles: [], capabilities };
  });
  registerRolesRoutes(app, ctx);
  return app;
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------
describe('roles routes — CRUD happy paths', () => {
  it('GET /api/roles lists roles (roles.view)', async () => {
    const { ctx, seedRole } = fakeCtx();
    seedRole({ slug: 'lab_technician', name: 'Lab Technician', capabilities: ['forms.view'] });
    const app = appWithUser(ctx, ['roles.view']);
    const res = await app.inject({ method: 'GET', url: '/api/roles' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RoleRecord[];
    expect(body).toHaveLength(1);
    expect(body[0].slug).toBe('lab_technician');
  });

  it('GET /api/roles/catalog returns capability groups (roles.view)', async () => {
    const { ctx } = fakeCtx();
    const app = appWithUser(ctx, ['roles.view']);
    const res = await app.inject({ method: 'GET', url: '/api/roles/catalog' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { groups: Array<{ key: string }> };
    expect(Array.isArray(body.groups)).toBe(true);
    expect(body.groups.some((g) => g.key === 'roles')).toBe(true);
  });

  it('GET /api/roles/:id returns a role; 404 when missing', async () => {
    const { ctx, seedRole } = fakeCtx();
    const id = seedRole({ slug: 'system_auditor', name: 'System Auditor', capabilities: ['audit.view'] });
    const app = appWithUser(ctx, ['roles.view']);

    const ok = await app.inject({ method: 'GET', url: `/api/roles/${id}` });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as RoleRecord).slug).toBe('system_auditor');

    const missing = await app.inject({ method: 'GET', url: '/api/roles/ghost' });
    expect(missing.statusCode).toBe(404);
  });

  it('POST /api/roles creates a role, 201, audits role.create', async () => {
    const { ctx, auditEvents } = fakeCtx();
    const app = appWithUser(ctx, ['roles.manage']);
    const res = await app.inject({
      method: 'POST', url: '/api/roles',
      payload: { name: 'Report Author', capabilities: ['reports.view', 'reports.edit_templates'] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as RoleRecord;
    expect(body.name).toBe('Report Author');
    expect(body.capabilities).toEqual(['reports.view', 'reports.edit_templates']);

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({ action: 'role.create', entityType: 'role', entityId: body.id, before: null });
    expect(auditEvents[0].actorId).toBe('actor-1');
  });

  it('PUT /api/roles/:id updates a role, audits role.update', async () => {
    const { ctx, seedRole, auditEvents } = fakeCtx();
    const id = seedRole({ slug: 'lab_manager', name: 'Lab Manager', capabilities: ['forms.view'] });
    const app = appWithUser(ctx, ['roles.manage']);

    const res = await app.inject({
      method: 'PUT', url: `/api/roles/${id}`,
      payload: { name: 'Lab Manager v2', capabilities: ['forms.view', 'forms.edit'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RoleRecord;
    expect(body.name).toBe('Lab Manager v2');
    expect(body.capabilities).toEqual(['forms.view', 'forms.edit']);

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({ action: 'role.update', entityType: 'role', entityId: id });
  });

  it('PUT /api/roles/:id → 404 when missing', async () => {
    const { ctx } = fakeCtx();
    const app = appWithUser(ctx, ['roles.manage']);
    const res = await app.inject({ method: 'PUT', url: '/api/roles/ghost', payload: { name: 'X' } });
    expect(res.statusCode).toBe(404);
  });

  it('DELETE /api/roles/:id removes a role, 204, audits role.delete', async () => {
    const { ctx, seedRole, auditEvents } = fakeCtx();
    const id = seedRole({ slug: 'custom_role', name: 'Custom Role', capabilities: ['forms.view'] });
    const app = appWithUser(ctx, ['roles.manage']);

    const res = await app.inject({ method: 'DELETE', url: `/api/roles/${id}` });
    expect(res.statusCode).toBe(204);

    // GET needs roles.view; use a fresh app with view cap to confirm removal.
    const viewApp = appWithUser(ctx, ['roles.view']);
    const check = await viewApp.inject({ method: 'GET', url: `/api/roles/${id}` });
    expect(check.statusCode).toBe(404);

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({ action: 'role.delete', entityType: 'role', entityId: id });
  });

  it('DELETE /api/roles/:id → 404 when missing', async () => {
    const { ctx } = fakeCtx();
    const app = appWithUser(ctx, ['roles.manage']);
    const res = await app.inject({ method: 'DELETE', url: '/api/roles/ghost' });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------
describe('roles routes — capability gating', () => {
  it('403 on mutations without roles.manage', async () => {
    const { ctx, seedRole } = fakeCtx();
    const id = seedRole({ slug: 'x', name: 'X', capabilities: [] });
    const app = appWithUser(ctx, ['roles.view']); // view only

    expect((await app.inject({ method: 'POST', url: '/api/roles', payload: { name: 'Y', capabilities: [] } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `/api/roles/${id}`, payload: { name: 'Z' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/roles/${id}` })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: '/api/users/u1/roles', payload: { roleIds: [] } })).statusCode).toBe(403);
  });

  it('403 on reads without roles.view', async () => {
    const { ctx } = fakeCtx();
    const app = appWithUser(ctx, []); // no capabilities
    expect((await app.inject({ method: 'GET', url: '/api/roles' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/roles/catalog' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/roles/x' })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/users/u1/roles' })).statusCode).toBe(403);
  });

  it('401 when unauthenticated', async () => {
    const { ctx } = fakeCtx();
    const app = Fastify();
    registerRolesRoutes(app, ctx);
    const res = await app.inject({ method: 'GET', url: '/api/roles' });
    expect(res.statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Store-invariant → HTTP mapping
// ---------------------------------------------------------------------------
describe('roles routes — invariant errors map to 4xx', () => {
  it('POST /api/roles with unknown capability → 400', async () => {
    const { ctx } = fakeCtx();
    const app = appWithUser(ctx, ['roles.manage']);
    const res = await app.inject({ method: 'POST', url: '/api/roles', payload: { name: 'Bad', capabilities: ['not.a.cap'] } });
    expect(res.statusCode).toBe(400);
  });

  it('PUT /api/roles/:id on the locked Administrator role → 400', async () => {
    const { ctx, seedRole } = fakeCtx();
    const id = seedRole({ slug: LOCKED_SLUG, name: 'Administrator', capabilities: ['roles.manage'], isSystem: true });
    const app = appWithUser(ctx, ['roles.manage']);
    const res = await app.inject({ method: 'PUT', url: `/api/roles/${id}`, payload: { capabilities: ['forms.view'] } });
    expect(res.statusCode).toBe(400);
  });

  it('DELETE /api/roles/:id on a system role → 409', async () => {
    const { ctx, seedRole } = fakeCtx();
    const id = seedRole({ slug: 'lab_manager', name: 'Lab Manager', capabilities: ['forms.view'], isSystem: true });
    const app = appWithUser(ctx, ['roles.manage']);
    const res = await app.inject({ method: 'DELETE', url: `/api/roles/${id}` });
    expect(res.statusCode).toBe(409);
  });

  it('DELETE /api/roles/:id on the last role granting roles.manage → 409', async () => {
    const { ctx, seedRole } = fakeCtx();
    const id = seedRole({ slug: 'super_manager', name: 'Super Manager', capabilities: ['roles.manage'] });
    const app = appWithUser(ctx, ['roles.manage']);
    const res = await app.inject({ method: 'DELETE', url: `/api/roles/${id}` });
    expect(res.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// User-role assignment
// ---------------------------------------------------------------------------
describe('roles routes — user-role assignment', () => {
  it('GET /api/users/:id/roles returns assigned roles', async () => {
    const { ctx, seedRole, assign } = fakeCtx();
    const id = seedRole({ slug: 'data_analyst', name: 'Data Analyst', capabilities: ['query.run'] });
    assign('subject-1', id);
    const app = appWithUser(ctx, ['roles.view']);
    const res = await app.inject({ method: 'GET', url: '/api/users/subject-1/roles' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RoleRecord[];
    expect(body.map((r) => r.slug)).toEqual(['data_analyst']);
  });

  it('GET /api/users/:id/roles succeeds for an actor with users.view but not roles.view', async () => {
    const { ctx, seedRole, assign } = fakeCtx();
    const id = seedRole({ slug: 'data_analyst', name: 'Data Analyst', capabilities: ['query.run'] });
    assign('subject-1', id);
    const app = appWithUser(ctx, ['users.view']); // no roles.view
    const res = await app.inject({ method: 'GET', url: '/api/users/subject-1/roles' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RoleRecord[];
    expect(body.map((r) => r.slug)).toEqual(['data_analyst']);
  });

  it('PUT /api/users/:id/roles applies via setUserRoles, audits user.assign_role', async () => {
    const { ctx, seedRole, auditEvents } = fakeCtx();
    const analyst = seedRole({ slug: 'data_analyst', name: 'Data Analyst', capabilities: ['query.run'] });
    const admin = seedRole({ slug: LOCKED_SLUG, name: 'Administrator', capabilities: ['roles.manage'], isSystem: true });
    const app = appWithUser(ctx, ['roles.manage']);

    // Give the subject roles.manage via the admin role first so later reassignment away from it can be tested elsewhere.
    const res = await app.inject({ method: 'PUT', url: '/api/users/subject-2/roles', payload: { roleIds: [analyst, admin] } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as RoleRecord[];
    expect(body.map((r) => r.slug).sort()).toEqual(['data_analyst', 'lab_admin']);

    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0]).toMatchObject({ action: 'user.assign_role', entityType: 'user', entityId: 'subject-2' });
  });

  it('PUT /api/users/:id/roles rejects a set that would zero out roles.manage globally → 4xx, no audit', async () => {
    const { ctx, seedRole, assign, auditEvents } = fakeCtx();
    const admin = seedRole({ slug: LOCKED_SLUG, name: 'Administrator', capabilities: ['roles.manage'], isSystem: true });
    const technician = seedRole({ slug: 'lab_technician', name: 'Lab Technician', capabilities: ['forms.view'] });
    // subject-admin is the ONLY holder of roles.manage.
    assign('subject-admin', admin);

    const app = appWithUser(ctx, ['roles.manage']);
    const res = await app.inject({ method: 'PUT', url: '/api/users/subject-admin/roles', payload: { roleIds: [technician] } });
    expect(res.statusCode).toBe(400);

    // Assignment must not have applied.
    const viewApp = appWithUser(ctx, ['roles.view']);
    const check = await viewApp.inject({ method: 'GET', url: '/api/users/subject-admin/roles' });
    expect((check.json() as RoleRecord[]).map((r) => r.slug)).toEqual(['lab_admin']);

    // No audit event recorded for the rejected mutation.
    expect(auditEvents).toHaveLength(0);
  });

  it('PUT /api/users/:id/roles succeeds when another user still holds roles.manage', async () => {
    const { ctx, seedRole, assign } = fakeCtx();
    const admin = seedRole({ slug: LOCKED_SLUG, name: 'Administrator', capabilities: ['roles.manage'], isSystem: true });
    const technician = seedRole({ slug: 'lab_technician', name: 'Lab Technician', capabilities: ['forms.view'] });
    assign('subject-admin-1', admin);
    assign('subject-admin-2', admin);

    const app = appWithUser(ctx, ['roles.manage']);
    const res = await app.inject({ method: 'PUT', url: '/api/users/subject-admin-2/roles', payload: { roleIds: [technician] } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as RoleRecord[]).map((r) => r.slug)).toEqual(['lab_technician']);
  });
});
