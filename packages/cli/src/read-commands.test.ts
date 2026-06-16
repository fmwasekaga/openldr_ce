import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockCtx = vi.hoisted(() => ({
  close: vi.fn(),
  users: { list: vi.fn() },
  audit: { list: vi.fn() },
  forms: { list: vi.fn() },
}));

vi.mock('@openldr/config', () => ({
  loadConfig: vi.fn(() => ({ config: true })),
}));

vi.mock('@openldr/bootstrap', () => ({
  createAppContext: vi.fn(async () => mockCtx),
}));

import { runAuditList } from './audit';
import { runFormsList } from './forms';
import { runUsersList } from './user';

describe('read-only list commands', () => {
  let writeSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true) as unknown as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    writeSpy.mockRestore();
  });

  it('lists users as JSON and closes the app context', async () => {
    const users = [
      {
        id: 'user-12345678',
        username: 'alice',
        displayName: 'Alice Example',
        email: 'alice@example.test',
        roles: ['lab_admin'],
        status: 'active',
        subject: null,
      },
    ];
    mockCtx.users.list.mockResolvedValueOnce(users);

    await expect(runUsersList({ json: true })).resolves.toBe(0);

    expect(mockCtx.users.list).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith(JSON.stringify(users, null, 2) + '\n');
    expect(mockCtx.close).toHaveBeenCalledTimes(1);
  });

  it('passes audit filters through and prints tab-separated rows', async () => {
    mockCtx.audit.list.mockResolvedValueOnce([
      {
        id: 'audit-1',
        occurredAt: '2026-06-16T10:00:00.000Z',
        actorName: 'system',
        action: 'form.publish',
        entityType: 'form',
        entityId: 'form-1',
      },
    ]);

    await expect(runAuditList({ action: 'form.publish', entity: 'form', from: '2026-06-01', to: '2026-06-16', json: false })).resolves.toBe(0);

    expect(mockCtx.audit.list).toHaveBeenCalledWith({
      actorId: undefined,
      entityType: 'form',
      entityId: undefined,
      action: 'form.publish',
      from: '2026-06-01',
      to: '2026-06-16',
    });
    expect(writeSpy).toHaveBeenCalledWith('2026-06-16T10:00:00.000Z\tsystem\tform.publish\tform\tform-1\n');
    expect(mockCtx.close).toHaveBeenCalledTimes(1);
  });

  it('lists forms as tab-separated rows', async () => {
    mockCtx.forms.list.mockResolvedValueOnce([
      {
        id: 'form-1',
        name: 'Specimen intake',
        versionLabel: 'v1',
        status: 'published',
        active: true,
        fhirResourceType: 'Observation',
        fieldCount: 4,
        updatedAt: '2026-06-16T10:00:00.000Z',
      },
    ]);

    await expect(runFormsList({ json: false })).resolves.toBe(0);

    expect(mockCtx.forms.list).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith('form-1\tSpecimen intake\tpublished\tactive\tObservation\t4\tv1\n');
    expect(mockCtx.close).toHaveBeenCalledTimes(1);
  });
});
