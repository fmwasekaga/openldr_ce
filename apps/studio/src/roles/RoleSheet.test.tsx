import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@/i18n';

let mockCanManage = true;
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ hasCapability: (cap: string) => (cap === 'roles.manage' ? mockCanManage : true) }) }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getRoleCatalog: vi.fn(), createRole: vi.fn(), updateRole: vi.fn() };
});

import * as api from '@/api';
import type { RoleRecord } from '@/api';
import { RoleSheet } from './RoleSheet';

const catalog = {
  groups: [
    {
      key: 'users', label: 'Users',
      capabilities: [
        { key: 'users.view', group: 'users', label: 'View users', description: 'See the user list' },
        { key: 'users.manage', group: 'users', label: 'Manage users', description: 'Create, edit, and delete users' },
      ],
    },
    {
      key: 'roles', label: 'Roles',
      capabilities: [
        { key: 'roles.view', group: 'roles', label: 'View roles', description: 'See roles' },
        { key: 'roles.manage', group: 'roles', label: 'Manage roles', description: 'Create, edit, and delete roles' },
      ],
    },
  ],
};

const existingRole: RoleRecord = {
  id: 'r1', slug: 'data-analyst', name: 'Data Analyst', description: 'Read-only reporting access',
  isSystem: false, locked: false, capabilities: ['users.view'], memberCount: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCanManage = true;
  (api.getRoleCatalog as ReturnType<typeof vi.fn>).mockResolvedValue(catalog);
});

describe('RoleSheet', () => {
  it('group "select all" checks every capability in that group and updates the counter', async () => {
    render(<RoleSheet open role={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    const usersGroup = await screen.findByTestId('capability-group-users');
    expect(screen.getByTestId('capability-count').textContent).toMatch(/0 of 4 selected/);

    const groupSelectAll = within(usersGroup).getByLabelText('Select all');
    fireEvent.click(groupSelectAll);

    expect(within(usersGroup).getByLabelText(/View users/)).toBeChecked();
    expect(within(usersGroup).getByLabelText(/Manage users/)).toBeChecked();
    expect(screen.getByTestId('capability-count').textContent).toMatch(/2 of 4 selected/);
  });

  it('global "select all" checks every capability across every group', async () => {
    render(<RoleSheet open role={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await screen.findByTestId('capability-group-users');
    fireEvent.click(screen.getByTestId('capability-select-all'));

    await waitFor(() => expect(screen.getByTestId('capability-count').textContent).toMatch(/4 of 4 selected/));
  });

  it('save (create) posts name, slug, and the selected capability keys', async () => {
    (api.createRole as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existingRole, id: 'r2', name: 'Reviewer', slug: 'reviewer', capabilities: ['users.view', 'roles.view'] });
    const onSaved = vi.fn();
    render(<RoleSheet open role={null} onOpenChange={vi.fn()} onSaved={onSaved} />);

    fireEvent.change(screen.getByTestId('role-name'), { target: { value: 'Reviewer' } });
    // Slug auto-derives from name on create
    await waitFor(() => expect((screen.getByTestId('role-slug') as HTMLInputElement).value).toBe('reviewer'));

    const usersGroup = await screen.findByTestId('capability-group-users');
    fireEvent.click(within(usersGroup).getByLabelText(/View users/));
    const rolesGroup = screen.getByTestId('capability-group-roles');
    fireEvent.click(within(rolesGroup).getByLabelText(/View roles/));

    fireEvent.click(screen.getByTestId('role-save'));

    await waitFor(() => expect(api.createRole).toHaveBeenCalledWith({
      name: 'Reviewer', slug: 'reviewer', description: null, capabilities: expect.arrayContaining(['users.view', 'roles.view']),
    }));
    const call = (api.createRole as ReturnType<typeof vi.fn>).mock.calls[0][0] as { capabilities: string[] };
    expect(call.capabilities).toHaveLength(2);
    expect(onSaved).toHaveBeenCalled();
  });

  it('save (edit) posts name, description, and capabilities but never slug', async () => {
    (api.updateRole as ReturnType<typeof vi.fn>).mockResolvedValue({ ...existingRole, name: 'Data Analyst (renamed)' });
    render(<RoleSheet open role={existingRole} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await screen.findByTestId('capability-group-users');
    fireEvent.change(screen.getByTestId('role-name'), { target: { value: 'Data Analyst (renamed)' } });
    fireEvent.click(screen.getByTestId('role-save'));

    await waitFor(() => expect(api.updateRole).toHaveBeenCalledWith('r1', {
      name: 'Data Analyst (renamed)', description: 'Read-only reporting access', capabilities: ['users.view'],
    }));
  });

  it('slug field is disabled when editing an existing role (immutable after creation)', async () => {
    render(<RoleSheet open role={existingRole} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByTestId('capability-group-users');
    expect(screen.getByTestId('role-slug')).toBeDisabled();
  });

  it('locked role renders a read-only grid, disabled fields, and no Save button', async () => {
    const lockedRole: RoleRecord = { ...existingRole, id: 'admin', name: 'Administrator', slug: 'lab_admin', locked: true, isSystem: true };
    render(<RoleSheet open role={lockedRole} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await screen.findByTestId('capability-group-users');
    expect(screen.getByTestId('role-name')).toBeDisabled();
    expect(screen.getByTestId('role-slug')).toBeDisabled();
    expect(screen.getByTestId('role-locked-notice')).toBeTruthy();
    expect(screen.queryByTestId('role-save')).toBeNull();

    const usersGroup = screen.getByTestId('capability-group-users');
    expect(within(usersGroup).getByLabelText(/View users/)).toBeDisabled();
  });

  it('users with roles.view only (no roles.manage) get a read-only sheet, no Save button', async () => {
    mockCanManage = false;
    render(<RoleSheet open role={existingRole} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await screen.findByTestId('capability-group-users');
    expect(screen.getByTestId('role-name')).toBeDisabled();
    expect(screen.queryByTestId('role-save')).toBeNull();
  });

  it('surfaces a server error inline instead of throwing', async () => {
    (api.createRole as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('create role failed: the built-in Administrator role is locked'));
    render(<RoleSheet open role={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await screen.findByTestId('capability-group-users');
    fireEvent.change(screen.getByTestId('role-name'), { target: { value: 'Reviewer' } });
    fireEvent.click(screen.getByTestId('role-save'));

    expect(await screen.findByTestId('role-sheet-error')).toHaveTextContent(/locked/i);
  });
});
