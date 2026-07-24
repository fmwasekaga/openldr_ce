import { describe, it, expect } from 'vitest';
import { makeMigratedDb } from './migrations/internal/test-helpers';
import { createRoleStore } from './role-store';

describe('RoleStore', () => {
  it('seedSystemRoles is idempotent and creates 5 roles with preset caps', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    await store.seedSystemRoles(); // twice — no duplicates
    const roles = await store.list();
    expect(roles.length).toBe(5);
    const admin = roles.find((r) => r.slug === 'lab_admin')!;
    expect(admin.isSystem).toBe(true);
    expect(admin.locked).toBe(true);
    expect(admin.capabilities).toContain('roles.manage');
    await db.destroy();
  });

  it('resolveCapabilities returns the union across assigned roles', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const analyst = (await store.getBySlug('data_analyst'))!;
    const auditor = (await store.getBySlug('system_auditor'))!;
    await store.assignRole('sub-x', analyst.id);
    await store.assignRole('sub-x', auditor.id);
    const caps = await store.resolveCapabilities('sub-x');
    expect(caps).toContain('query.run'); // from analyst
    expect(caps).toContain('audit.view'); // from auditor
    expect(new Set(caps).size).toBe(caps.length); // deduped
    await db.destroy();
  });

  it('create rejects unknown capability', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await expect(store.create({ name: 'X', capabilities: ['not.a.cap'] })).rejects.toThrow();
    await db.destroy();
  });

  it('cannot edit or delete the locked administrator role', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    await expect(store.update(admin.id, { capabilities: ['forms.view'] })).rejects.toThrow();
    await expect(store.remove(admin.id)).rejects.toThrow();
    await db.destroy();
  });

  it('cannot unassign the last roles.manage holder', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    await store.assignRole('sub-admin', admin.id);
    await expect(store.unassignRole('sub-admin', admin.id)).rejects.toThrow();
    await db.destroy();
  });

  it('backfillUserFromRoleNames maps token role names to system roles once', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    await store.backfillUserFromRoleNames('sub-y', ['lab_manager', 'unknown_role']);
    const caps = await store.resolveCapabilities('sub-y');
    expect(caps).toContain('workflows.edit');
    await db.destroy();
  });

  it('remove rejects a non-locked system role', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const manager = (await store.getBySlug('lab_manager'))!;
    await expect(store.remove(manager.id)).rejects.toThrow();
    await db.destroy();
  });

  it('remove rejects deleting the last custom role granting roles.manage', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    const custom = await store.create({ name: 'Super Manager', capabilities: ['roles.manage'] });
    await expect(store.remove(custom.id)).rejects.toThrow();
    await db.destroy();
  });

  it('setUserRoles rejects (without mutating) a write that would leave zero roles.manage holders', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    const technician = (await store.getBySlug('lab_technician'))!;
    // sub-admin is the only holder of roles.manage.
    await store.assignRole('sub-admin', admin.id);

    await expect(store.setUserRoles('sub-admin', [technician.id])).rejects.toThrow();

    // The failed write must not have partially applied.
    const rolesAfter = await store.rolesForUser('sub-admin');
    expect(rolesAfter.map((r) => r.slug)).toEqual(['lab_admin']);
    const caps = await store.resolveCapabilities('sub-admin');
    expect(caps).toContain('roles.manage');
    await db.destroy();
  });

  it('remove rejects deleting a custom role that is the only actual roles.manage holder, even if lab_admin also grants it but has no members', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles(); // lab_admin exists and grants roles.manage, but nobody is assigned to it
    const custom = await store.create({ name: 'Super Manager', capabilities: ['roles.manage'] });
    await store.assignRole('sub-only-admin', custom.id);

    await expect(store.remove(custom.id)).rejects.toThrow();

    // Must not have partially applied.
    const rolesAfter = await store.rolesForUser('sub-only-admin');
    expect(rolesAfter.map((r) => r.slug)).toContain(custom.slug);
    await db.destroy();
  });

  it('remove succeeds deleting a roles.manage-granting custom role when another user still holds roles.manage', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    const custom = await store.create({ name: 'Super Manager', capabilities: ['roles.manage'] });
    await store.assignRole('sub-admin', admin.id); // another real manage holder
    await store.assignRole('sub-custom', custom.id);

    await expect(store.remove(custom.id)).resolves.toBeUndefined();
    expect(await store.get(custom.id)).toBeNull();
    await db.destroy();
  });

  it('setUserRoles succeeds when roles.manage is still held by someone else', async () => {
    const db = await makeMigratedDb();
    const store = createRoleStore(db);
    await store.seedSystemRoles();
    const admin = (await store.getBySlug('lab_admin'))!;
    const technician = (await store.getBySlug('lab_technician'))!;
    await store.assignRole('sub-admin-1', admin.id);
    await store.assignRole('sub-admin-2', admin.id);

    await store.setUserRoles('sub-admin-2', [technician.id]);

    const rolesAfter = await store.rolesForUser('sub-admin-2');
    expect(rolesAfter.map((r) => r.slug)).toEqual(['lab_technician']);
    await db.destroy();
  });
});
