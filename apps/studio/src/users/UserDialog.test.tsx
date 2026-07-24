import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    createUser: vi.fn(),
    updateUser: vi.fn(),
    listPublishedForms: vi.fn(),
    getForm: vi.fn(),
    listRoles: vi.fn(),
    getUserRoles: vi.fn(),
    setUserRoles: vi.fn(),
  };
});

import * as api from '@/api';
import type { RoleRecord, UserSummary } from '@/api';
import { UserDialog } from './UserDialog';

const minimalSchema = {
  id: 'form-1',
  name: 'Users Form',
  version: 1,
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    { id: 'f-firstName', displayLabel: 'First name', description: null, fieldType: 'text', apiProperty: 'firstName', fhirPath: null, required: false, enabled: true, order: 0, cardinality: { min: 0, max: '1' } },
  ],
  sections: [],
  targetPages: ['users'],
  active: true,
  status: 'published',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const allRoles: RoleRecord[] = [
  { id: 'r1', slug: 'lab-admin', name: 'Lab Admin', description: null, isSystem: true, locked: true, capabilities: [], memberCount: 1 },
  { id: 'r2', slug: 'data-analyst', name: 'Data Analyst', description: null, isSystem: false, locked: false, capabilities: [], memberCount: 2 },
];

const editUser: UserSummary = {
  id: 'u1', username: 'bob', firstName: 'Bob', lastName: 'Smith', email: 'bob@x',
  roles: [], enabled: true, createdAt: '2026-01-01T00:00:00Z', extras: {}, formSchemaId: 'form-1', formVersion: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  (api.listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 'form-1', name: 'Users Form', versionLabel: null, status: 'published', active: true, fhirResourceType: null, fieldCount: 1, updatedAt: '2026-01-01T00:00:00Z' },
  ]);
  (api.getForm as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'form-1', name: 'Users Form', versionLabel: null, fhirResourceType: null, status: 'published', active: true,
    schema: minimalSchema, targetPages: ['users'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  });
  (api.listRoles as ReturnType<typeof vi.fn>).mockResolvedValue(allRoles);
  (api.getUserRoles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (api.setUserRoles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

describe('UserDialog — role assignment', () => {
  it('seeds the role checklist from getUserRoles when editing', async () => {
    (api.getUserRoles as ReturnType<typeof vi.fn>).mockResolvedValue([allRoles[0]]);
    render(<UserDialog open user={editUser} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(api.getUserRoles).toHaveBeenCalledWith('u1'));
    await screen.findByLabelText('Lab Admin');

    expect(screen.getByLabelText('Lab Admin')).toBeChecked();
    expect(screen.getByLabelText('Data Analyst')).not.toBeChecked();
  });

  it('create is seeded with no roles selected', async () => {
    render(<UserDialog open user={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await screen.findByLabelText('Lab Admin');
    expect(screen.getByLabelText('Lab Admin')).not.toBeChecked();
    expect(screen.getByLabelText('Data Analyst')).not.toBeChecked();
  });

  it('edit: save calls setUserRoles with the selected role ids for the existing user id', async () => {
    (api.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({ ...editUser });
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<UserDialog open user={editUser} onOpenChange={onOpenChange} onSaved={onSaved} />);

    await screen.findByLabelText('Lab Admin');
    fireEvent.click(screen.getByLabelText('Lab Admin'));
    fireEvent.click(screen.getByLabelText('Data Analyst'));

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.setUserRoles).toHaveBeenCalled());
    const [id, roleIds] = (api.setUserRoles as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(id).toBe('u1');
    expect(roleIds).toEqual(expect.arrayContaining(['r1', 'r2']));
    expect(roleIds).toHaveLength(2);
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('create: calls setUserRoles with the id createUser returns, not a client-side id', async () => {
    (api.createUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'new-directory-id', username: 'grace', firstName: 'Grace', lastName: null, email: null,
      roles: [], enabled: true, createdAt: '2026-01-01T00:00:00Z', extras: {}, formSchemaId: 'form-1', formVersion: 1,
    });
    render(<UserDialog open user={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'grace' } });
    await screen.findByLabelText('Lab Admin');
    fireEvent.click(screen.getByLabelText('Lab Admin'));

    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() => expect(api.createUser).toHaveBeenCalled());
    // createUser payload must not carry a `roles` key — that identity write path is gone.
    expect((api.createUser as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty('roles');

    await waitFor(() => expect(api.setUserRoles).toHaveBeenCalledWith('new-directory-id', ['r1']));
  });

  it('surfaces a setUserRoles rejection inline and keeps the dialog open (identity already saved)', async () => {
    (api.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({ ...editUser });
    (api.setUserRoles as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('cannot remove the last member of a role granting roles.manage'),
    );
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<UserDialog open user={editUser} onOpenChange={onOpenChange} onSaved={onSaved} />);

    await screen.findByLabelText('Lab Admin');
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText(/cannot remove the last member/i)).toBeTruthy();
    // The identity write did succeed — the parent list is still updated — but the sheet
    // stays open so the error is visible and the user can retry role assignment.
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
