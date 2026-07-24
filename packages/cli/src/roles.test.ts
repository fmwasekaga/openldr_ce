import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appCtx: {
    roles: {
      list: vi.fn(),
      getBySlug: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      assignRole: vi.fn(),
      unassignRole: vi.fn(),
    },
    close: vi.fn(),
  },
  createAppContext: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: mocks.createAppContext,
  recordAuditEvent: mocks.recordAuditEvent,
}));

import {
  runRolesList,
  runRolesShow,
  runRolesCreate,
  runRolesEdit,
  runRolesDelete,
  runRolesGrant,
  runRolesRevoke,
  runUserAssignRole,
  runUserUnassignRole,
} from './roles';

const seededRole = {
  id: 'role-1',
  slug: 'lab_manager',
  name: 'Lab Manager',
  description: 'Manage content and analytics',
  isSystem: true,
  locked: false,
  capabilities: ['dashboards.view', 'reports.view'],
  memberCount: 2,
};

const labAdmin = {
  id: 'role-admin',
  slug: 'lab_admin',
  name: 'Administrator',
  description: 'Full access',
  isSystem: true,
  locked: true,
  capabilities: ['dashboards.view'],
  memberCount: 1,
};

describe('roles CLI', () => {
  let out: string;
  let err: string;

  beforeEach(() => {
    vi.clearAllMocks();
    out = '';
    err = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      err += String(chunk);
      return true;
    });
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('list', () => {
    it('prints seeded roles', async () => {
      mocks.appCtx.roles.list.mockResolvedValue([seededRole, labAdmin]);

      const code = await runRolesList({ json: false });

      expect(code).toBe(0);
      expect(out).toContain('lab_manager');
      expect(out).toContain('lab_admin');
      expect(mocks.appCtx.close).toHaveBeenCalled();
    });

    it('emits JSON when --json is passed', async () => {
      mocks.appCtx.roles.list.mockResolvedValue([seededRole]);

      await runRolesList({ json: true });

      expect(JSON.parse(out)).toEqual([seededRole]);
    });
  });

  describe('show', () => {
    it('prints the role by slug', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(seededRole);

      const code = await runRolesShow('lab_manager', { json: false });

      expect(code).toBe(0);
      expect(out).toContain('Lab Manager');
    });

    it('returns non-zero for an unknown slug', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(null);

      const code = await runRolesShow('nope', { json: false });

      expect(code).toBe(1);
      expect(out).toContain('nope');
    });
  });

  describe('create', () => {
    it('persists a role with --caps and audits role.create', async () => {
      mocks.appCtx.roles.create.mockResolvedValue({ ...seededRole, id: 'role-2', slug: 'custom', name: 'Custom' });

      const code = await runRolesCreate('Custom', { json: false, slug: 'custom', desc: 'a custom role', caps: 'dashboards.view,reports.view' });

      expect(code).toBe(0);
      expect(mocks.appCtx.roles.create).toHaveBeenCalledWith({
        name: 'Custom',
        slug: 'custom',
        description: 'a custom role',
        capabilities: ['dashboards.view', 'reports.view'],
      });
      expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorType: 'cli' }),
        expect.objectContaining({ action: 'role.create', entityType: 'role', entityId: 'role-2' }),
      );
    });

    it('rejects an unknown capability in --caps before hitting the store', async () => {
      const code = await runRolesCreate('Custom', { json: false, caps: 'dashboards.view,bogus.cap' });

      expect(code).toBe(1);
      expect(err).toContain('bogus.cap');
      expect(mocks.createAppContext).not.toHaveBeenCalled();
      expect(mocks.appCtx.roles.create).not.toHaveBeenCalled();
    });

    it('creates with an empty capability set when --caps is omitted', async () => {
      mocks.appCtx.roles.create.mockResolvedValue({ ...seededRole, id: 'role-3', capabilities: [] });

      const code = await runRolesCreate('Bare', { json: false });

      expect(code).toBe(0);
      expect(mocks.appCtx.roles.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bare', capabilities: [] }),
      );
    });
  });

  describe('edit', () => {
    it('updates name/description/capabilities', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(seededRole);
      mocks.appCtx.roles.update.mockResolvedValue({ ...seededRole, name: 'Renamed' });

      const code = await runRolesEdit('lab_manager', { json: false, name: 'Renamed', caps: 'dashboards.view' });

      expect(code).toBe(0);
      expect(mocks.appCtx.roles.update).toHaveBeenCalledWith('role-1', { name: 'Renamed', capabilities: ['dashboards.view'] });
    });

    it('returns non-zero for an unknown slug', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(null);

      const code = await runRolesEdit('nope', { json: false, name: 'X' });

      expect(code).toBe(1);
      expect(mocks.appCtx.roles.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown capability in --caps before hitting the store', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(seededRole);

      const code = await runRolesEdit('lab_manager', { json: false, caps: 'bogus.cap' });

      expect(code).toBe(1);
      expect(err).toContain('bogus.cap');
      expect(mocks.appCtx.roles.update).not.toHaveBeenCalled();
    });

    it('surfaces an invariant error (locked role) with the message, exit non-zero', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(labAdmin);
      mocks.appCtx.roles.update.mockRejectedValue(new Error('the Administrator role cannot be modified'));

      const code = await runRolesEdit('lab_admin', { json: false, name: 'Nope' });

      expect(code).toBe(1);
      expect(err).toContain('the Administrator role cannot be modified');
    });
  });

  describe('delete', () => {
    it('removes a role', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(seededRole);
      mocks.appCtx.roles.remove.mockResolvedValue(undefined);

      const code = await runRolesDelete('lab_manager', { json: false });

      expect(code).toBe(0);
      expect(mocks.appCtx.roles.remove).toHaveBeenCalledWith('role-1');
      expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorType: 'cli' }),
        expect.objectContaining({ action: 'role.delete', entityType: 'role', entityId: 'role-1' }),
      );
    });

    it('exits non-zero with the message for a system-role delete invariant', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(labAdmin);
      mocks.appCtx.roles.remove.mockRejectedValue(new Error('system roles cannot be deleted'));

      const code = await runRolesDelete('lab_admin', { json: false });

      expect(code).toBe(1);
      expect(err).toContain('system roles cannot be deleted');
      expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    });

    it('returns non-zero for an unknown slug', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(null);

      const code = await runRolesDelete('nope', { json: false });

      expect(code).toBe(1);
      expect(mocks.appCtx.roles.remove).not.toHaveBeenCalled();
    });
  });

  describe('grant / revoke', () => {
    it('grant adds a capability to the role set', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(seededRole);
      mocks.appCtx.roles.update.mockResolvedValue({ ...seededRole, capabilities: ['dashboards.view', 'reports.view', 'forms.view'] });

      const code = await runRolesGrant('lab_manager', 'forms.view', { json: false });

      expect(code).toBe(0);
      expect(mocks.appCtx.roles.update).toHaveBeenCalledWith('role-1', { capabilities: ['dashboards.view', 'reports.view', 'forms.view'] });
    });

    it('grant is idempotent when the capability is already present', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(seededRole);
      mocks.appCtx.roles.update.mockResolvedValue(seededRole);

      const code = await runRolesGrant('lab_manager', 'dashboards.view', { json: false });

      expect(code).toBe(0);
      expect(mocks.appCtx.roles.update).toHaveBeenCalledWith('role-1', { capabilities: ['dashboards.view', 'reports.view'] });
    });

    it('grant fails clearly on an unknown capability, without hitting the store', async () => {
      const code = await runRolesGrant('lab_manager', 'bogus.cap', { json: false });

      expect(code).toBe(1);
      expect(err).toContain('bogus.cap');
      expect(mocks.createAppContext).not.toHaveBeenCalled();
      expect(mocks.appCtx.roles.update).not.toHaveBeenCalled();
    });

    it('revoke removes a capability from the role set', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(seededRole);
      mocks.appCtx.roles.update.mockResolvedValue({ ...seededRole, capabilities: ['dashboards.view'] });

      const code = await runRolesRevoke('lab_manager', 'reports.view', { json: false });

      expect(code).toBe(0);
      expect(mocks.appCtx.roles.update).toHaveBeenCalledWith('role-1', { capabilities: ['dashboards.view'] });
    });

    it('revoke on an unknown slug returns non-zero', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(null);

      const code = await runRolesRevoke('nope', 'reports.view', { json: false });

      expect(code).toBe(1);
      expect(mocks.appCtx.roles.update).not.toHaveBeenCalled();
    });

    it('grant surfaces a locked-role invariant error, exit non-zero with the message', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(labAdmin);
      mocks.appCtx.roles.update.mockRejectedValue(new Error('the Administrator role cannot be modified'));

      const code = await runRolesGrant('lab_admin', 'reports.view', { json: false });

      expect(code).toBe(1);
      expect(err).toContain('the Administrator role cannot be modified');
    });
  });

  describe('user assign-role / unassign-role', () => {
    it('assign-role resolves the role by slug and writes an assignment', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(seededRole);
      mocks.appCtx.roles.assignRole.mockResolvedValue(undefined);

      const code = await runUserAssignRole('user-1', 'lab_manager', { json: false });

      expect(code).toBe(0);
      expect(mocks.appCtx.roles.assignRole).toHaveBeenCalledWith('user-1', 'role-1');
      expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ actorType: 'cli' }),
        expect.objectContaining({ entityType: 'user', entityId: 'user-1' }),
      );
    });

    it('assign-role on an unknown slug returns non-zero without hitting the store', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(null);

      const code = await runUserAssignRole('user-1', 'nope', { json: false });

      expect(code).toBe(1);
      expect(mocks.appCtx.roles.assignRole).not.toHaveBeenCalled();
    });

    it('unassign-role resolves the role by slug and removes the assignment', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(seededRole);
      mocks.appCtx.roles.unassignRole.mockResolvedValue(undefined);

      const code = await runUserUnassignRole('user-1', 'lab_manager', { json: false });

      expect(code).toBe(0);
      expect(mocks.appCtx.roles.unassignRole).toHaveBeenCalledWith('user-1', 'role-1');
    });

    it('unassign-role surfaces an invariant error (last roles.manage holder), exit non-zero with the message', async () => {
      mocks.appCtx.roles.getBySlug.mockResolvedValue(seededRole);
      mocks.appCtx.roles.unassignRole.mockRejectedValue(new Error('cannot remove the last user holding roles.manage'));

      const code = await runUserUnassignRole('user-1', 'lab_manager', { json: false });

      expect(code).toBe(1);
      expect(err).toContain('cannot remove the last user holding roles.manage');
      expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
    });
  });
});
