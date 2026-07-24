import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

let mockCanManage = true;
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ hasCapability: (cap: string) => (cap === 'roles.manage' ? mockCanManage : true) }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, listRoles: vi.fn(), deleteRole: vi.fn(), getRoleCatalog: vi.fn(), createRole: vi.fn(), updateRole: vi.fn() };
});

import * as api from '@/api';
import type { RoleRecord } from '@/api';
import { toast } from 'sonner';
import { Roles } from './Roles';

const roles: RoleRecord[] = [
  { id: 'admin', slug: 'lab_admin', name: 'Administrator', description: 'Full access to every capability.', isSystem: true, locked: true, capabilities: ['users.manage'], memberCount: 1 },
  { id: 'r2', slug: 'lab_technician', name: 'Lab Technician', description: 'Day-to-day lab operations.', isSystem: true, locked: false, capabilities: ['users.view'], memberCount: 5 },
  { id: 'r3', slug: 'reviewer', name: 'Reviewer', description: 'Custom role for external reviewers.', isSystem: false, locked: false, capabilities: [], memberCount: 0 },
];

function openDropdown(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCanManage = true;
  (api.listRoles as ReturnType<typeof vi.fn>).mockResolvedValue(roles);
  (api.getRoleCatalog as ReturnType<typeof vi.fn>).mockResolvedValue({ groups: [] });
});

describe('Roles page', () => {
  it('lists roles with name, description, member count, and a System badge', async () => {
    render(<MemoryRouter><Roles /></MemoryRouter>);
    expect(await screen.findByText('Administrator')).toBeTruthy();
    expect(screen.getByText('Full access to every capability.')).toBeTruthy();
    expect(screen.getByText('Reviewer')).toBeTruthy();
    expect(screen.getByText(/1 members/)).toBeTruthy();

    const adminRow = screen.getByText('Administrator').closest('tr')!;
    expect(within(adminRow).getByText('System')).toBeTruthy();
    expect(within(adminRow).getByText('Locked')).toBeTruthy();

    const reviewerRow = screen.getByText('Reviewer').closest('tr')!;
    expect(within(reviewerRow).queryByText('System')).toBeNull();
  });

  it("locked role's delete is disabled", async () => {
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Administrator');

    const trigger = screen.getByTestId('role-actions-admin');
    openDropdown(trigger);

    const deleteItem = await screen.findByTestId('role-delete-admin');
    expect(deleteItem.getAttribute('aria-disabled')).toBe('true');
  });

  it("system (non-locked) role's delete is also disabled", async () => {
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Lab Technician');

    openDropdown(screen.getByTestId('role-actions-r2'));
    const deleteItem = await screen.findByTestId('role-delete-r2');
    expect(deleteItem.getAttribute('aria-disabled')).toBe('true');
  });

  it('custom role can be deleted, after a confirm dialog', async () => {
    (api.deleteRole as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Reviewer');

    openDropdown(screen.getByTestId('role-actions-r3'));
    fireEvent.click(await screen.findByTestId('role-delete-r3'));

    const confirmBtn = await screen.findByRole('button', { name: 'Delete' });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(api.deleteRole).toHaveBeenCalledWith('r3'));
    expect(screen.queryByText('Reviewer')).toBeNull();
  });

  it('"Create role" is shown when the user has roles.manage', async () => {
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Administrator');
    expect(screen.getByTestId('create-role')).toBeTruthy();
  });

  it('"Create role" and the actions kebab are hidden without roles.manage', async () => {
    mockCanManage = false;
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Administrator');
    expect(screen.queryByTestId('create-role')).toBeNull();
    expect(screen.queryByTestId('role-actions-admin')).toBeNull();
    expect(screen.queryByTestId('role-actions-r3')).toBeNull();
  });

  it('shows an empty state with no roles', async () => {
    (api.listRoles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    render(<MemoryRouter><Roles /></MemoryRouter>);
    expect(await screen.findByText(/no roles yet/i)).toBeTruthy();
  });

  it('surfaces a load failure via toast', async () => {
    (api.listRoles as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('opening the create sheet and saving calls createRole with the entered name', async () => {
    (api.createRole as ReturnType<typeof vi.fn>).mockResolvedValue({ ...roles[2], id: 'r4', name: 'New Role' });
    render(<MemoryRouter><Roles /></MemoryRouter>);
    await screen.findByText('Administrator');

    fireEvent.click(screen.getByTestId('create-role'));
    fireEvent.change(await screen.findByTestId('role-name'), { target: { value: 'New Role' } });

    // RoleSheet's Save lives in its own ⋯ (Actions) menu, not a footer button.
    openDropdown(screen.getByTestId('role-actions-trigger'));
    fireEvent.click(await screen.findByTestId('role-save'));

    await waitFor(() => expect(api.createRole).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Role' })));
    expect(await screen.findByText('New Role')).toBeTruthy();
  });
});
