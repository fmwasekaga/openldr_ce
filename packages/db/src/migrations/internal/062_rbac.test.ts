import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './test-helpers';

describe('062_rbac', () => {
  it('creates rbac tables and the users.rbac_initialized column', async () => {
    const db = await makeMigratedDb();
    // insert a role + capability + assignment round-trips
    await db.insertInto('roles').values({ id: 'r1', slug: 'content-editor', name: 'Content editor', description: null, is_system: false }).execute();
    await db.insertInto('role_capabilities').values({ role_id: 'r1', capability: 'dashboards.edit' }).execute();
    await db.insertInto('user_roles').values({ user_id: 'sub-1', role_id: 'r1' }).execute();

    const caps = await db.selectFrom('user_roles')
      .innerJoin('role_capabilities', 'role_capabilities.role_id', 'user_roles.role_id')
      .select('role_capabilities.capability')
      .where('user_roles.user_id', '=', 'sub-1')
      .execute();
    expect(caps.map((c) => c.capability)).toEqual(['dashboards.edit']);

    // rbac_initialized defaults false
    await db.insertInto('users').values({ id: 'u1', username: 'bob', roles: JSON.stringify([]) as never }).execute();
    const u = await db.selectFrom('users').select(['rbac_initialized']).where('id', '=', 'u1').executeTakeFirstOrThrow();
    expect(Boolean(u.rbac_initialized)).toBe(false);
  });

  it('slug is unique', async () => {
    const db = await makeMigratedDb();
    await db.insertInto('roles').values({ id: 'a', slug: 'dup', name: 'A', description: null, is_system: false }).execute();
    await expect(
      db.insertInto('roles').values({ id: 'b', slug: 'dup', name: 'B', description: null, is_system: false }).execute(),
    ).rejects.toThrow();
  });
});
