import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  appCtx: {
    users: {
      list: vi.fn(),
      get: vi.fn(),
      create: vi.fn(),
      setRoles: vi.fn(),
      setStatus: vi.fn(),
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

import { runUserCreate, runUserSetRole, runUserSetStatus } from './user';

describe('user CLI audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    mocks.createAppContext.mockResolvedValue(mocks.appCtx);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('user create audits user.create (cli, local backend)', async () => {
    mocks.appCtx.users.create.mockResolvedValue({ id: 'u1', username: 'bob', roles: ['lab_tech'] });

    const code = await runUserCreate({ username: 'bob', role: ['lab_tech'], json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'user.create',
        entityType: 'user',
        entityId: 'u1',
        metadata: expect.objectContaining({ username: 'bob', roles: ['lab_tech'], backend: 'local' }),
      }),
    );
  });

  it('user set-role audits user.update (cli, local backend)', async () => {
    mocks.appCtx.users.get.mockResolvedValue({ id: 'u1', username: 'bob', roles: [] });
    mocks.appCtx.users.setRoles.mockResolvedValue(undefined);

    const code = await runUserSetRole('u1', ['lab_admin'], { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'user.update',
        entityType: 'user',
        entityId: 'u1',
        metadata: expect.objectContaining({ roles: ['lab_admin'], backend: 'local' }),
      }),
    );
  });

  it('user activate audits user.status with enabled:true (cli, local backend)', async () => {
    mocks.appCtx.users.get.mockResolvedValue({ id: 'u1', username: 'bob', roles: [] });
    mocks.appCtx.users.setStatus.mockResolvedValue(undefined);

    const code = await runUserSetStatus('u1', 'active', { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'user.status',
        entityType: 'user',
        entityId: 'u1',
        metadata: expect.objectContaining({ enabled: true, backend: 'local' }),
      }),
    );
  });

  it('user deactivate audits user.status with enabled:false (cli, local backend)', async () => {
    mocks.appCtx.users.get.mockResolvedValue({ id: 'u1', username: 'bob', roles: [] });
    mocks.appCtx.users.setStatus.mockResolvedValue(undefined);

    const code = await runUserSetStatus('u1', 'disabled', { json: true });

    expect(code).toBe(0);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorType: 'cli' }),
      expect.objectContaining({
        action: 'user.status',
        entityType: 'user',
        entityId: 'u1',
        metadata: expect.objectContaining({ enabled: false, backend: 'local' }),
      }),
    );
  });

  it('does not audit when the target user is not found (set-role)', async () => {
    mocks.appCtx.users.get.mockResolvedValue(undefined);

    const code = await runUserSetRole('missing', ['lab_admin'], { json: true });

    expect(code).toBe(1);
    expect(mocks.appCtx.users.setRoles).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it('does not audit when the target user is not found (set-status)', async () => {
    mocks.appCtx.users.get.mockResolvedValue(undefined);

    const code = await runUserSetStatus('missing', 'active', { json: true });

    expect(code).toBe(1);
    expect(mocks.appCtx.users.setStatus).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });
});
