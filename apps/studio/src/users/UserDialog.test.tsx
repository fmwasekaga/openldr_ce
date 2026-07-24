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
  // Deliberately last in the list — proves the create-default and no-role-fallback resolve by
  // slug (=== 'lab_technician'), not by "just take the first role".
  { id: 'r3', slug: 'lab_technician', name: 'Lab Technician', description: null, isSystem: true, locked: false, capabilities: [], memberCount: 5 },
];

const editUser: UserSummary = {
  id: 'u1', username: 'bob', firstName: 'Bob', lastName: 'Smith', email: 'bob@x',
  roles: [], enabled: true, createdAt: '2026-01-01T00:00:00Z', extras: {}, formSchemaId: 'form-1', formVersion: 1,
};

/** Open the (single-select) role combobox and pick the option with the given visible text. */
function pickRole(name: string) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Role' }));
  fireEvent.click(screen.getByText(name));
}

/**
 * Open the ⋯ actions menu and click the item matching `itemName` (a RegExp/string passed to
 * getByRole('menuitem', { name })). Radix opens DropdownMenuContent on pointerdown; jsdom
 * sometimes needs a follow-up Enter keydown for the menu to mount — same pattern as
 * forms-builder/FieldEditorSheet.test.tsx.
 */
function clickMenuItem(itemName: string | RegExp) {
  const trigger = screen.getByRole('button', { name: 'Actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menuitem', { name: itemName })) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
  fireEvent.click(screen.getByRole('menuitem', { name: itemName }));
}

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

describe('UserDialog — ⋯ actions menu', () => {
  it('has a ⋯ (Actions) menu trigger, not footer buttons', async () => {
    render(<UserDialog open user={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByRole('combobox', { name: 'Role' });
    expect(screen.getByRole('button', { name: 'Actions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /^create$/i })).toBeNull();
  });
});

describe('UserDialog — role assignment (single-select)', () => {
  it('seeds the role Select from getUserRoles when editing', async () => {
    (api.getUserRoles as ReturnType<typeof vi.fn>).mockResolvedValue([allRoles[0]]);
    render(<UserDialog open user={editUser} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(api.getUserRoles).toHaveBeenCalledWith('u1'));
    const trigger = await screen.findByRole('combobox', { name: 'Role' });
    await waitFor(() => expect(trigger).toHaveTextContent('Lab Admin'));
  });

  it('seeds the role Select from only the first role when the API returns several (does not crash)', async () => {
    (api.getUserRoles as ReturnType<typeof vi.fn>).mockResolvedValue([allRoles[1], allRoles[0]]);
    render(<UserDialog open user={editUser} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    await waitFor(() => expect(api.getUserRoles).toHaveBeenCalledWith('u1'));
    const trigger = await screen.findByRole('combobox', { name: 'Role' });
    await waitFor(() => expect(trigger).toHaveTextContent('Data Analyst'));
  });

  it('create defaults the role Select to Lab Technician (least-privilege), never empty', async () => {
    render(<UserDialog open user={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    const trigger = await screen.findByRole('combobox', { name: 'Role' });
    await waitFor(() => expect(trigger).toHaveTextContent('Lab Technician'));
  });

  it('there is no "No role" option in the Role Select — a user always has exactly one role', async () => {
    render(<UserDialog open user={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    const trigger = await screen.findByRole('combobox', { name: 'Role' });
    await waitFor(() => expect(trigger).toHaveTextContent('Lab Technician'));
    fireEvent.click(trigger);
    expect(screen.queryByText(/no role/i)).toBeNull();
  });

  it('edit: ⋯ → Save calls setUserRoles with the single selected role id for the existing user id (submits via FormRuntime)', async () => {
    (api.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({ ...editUser });
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<UserDialog open user={editUser} onOpenChange={onOpenChange} onSaved={onSaved} />);

    await screen.findByRole('combobox', { name: 'Role' });
    pickRole('Data Analyst');

    clickMenuItem(/^save$/i);

    await waitFor(() => expect(api.setUserRoles).toHaveBeenCalled());
    expect(api.setUserRoles).toHaveBeenCalledWith('u1', ['r2']);
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('edit: a user with no role assigned (legacy data) falls back to the Lab Technician default, never empty', async () => {
    (api.getUserRoles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({ ...editUser });
    render(<UserDialog open user={editUser} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    const trigger = await screen.findByRole('combobox', { name: 'Role' });
    await waitFor(() => expect(trigger).toHaveTextContent('Lab Technician'));

    clickMenuItem(/^save$/i);

    await waitFor(() => expect(api.setUserRoles).toHaveBeenCalledWith('u1', ['r3']));
  });

  it('create: ⋯ → Create calls setUserRoles with the id createUser returns, not a client-side id (submits via FormRuntime)', async () => {
    (api.createUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'new-directory-id', username: 'grace', firstName: 'Grace', lastName: null, email: null,
      roles: [], enabled: true, createdAt: '2026-01-01T00:00:00Z', extras: {}, formSchemaId: 'form-1', formVersion: 1,
    });
    render(<UserDialog open user={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText('Username'), { target: { value: 'grace' } });
    await screen.findByRole('combobox', { name: 'Role' });
    pickRole('Lab Admin');

    clickMenuItem(/^create$/i);

    await waitFor(() => expect(api.createUser).toHaveBeenCalled());
    // createUser payload must not carry a `roles` key — that identity write path is gone.
    expect((api.createUser as ReturnType<typeof vi.fn>).mock.calls[0][0]).not.toHaveProperty('roles');

    await waitFor(() => expect(api.setUserRoles).toHaveBeenCalledWith('new-directory-id', ['r1']));
  });

  it('surfaces a setUserRoles rejection inline, withholds success, and keeps the dialog open', async () => {
    (api.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({ ...editUser });
    (api.setUserRoles as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('cannot remove the last member of a role granting roles.manage'),
    );
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<UserDialog open user={editUser} onOpenChange={onOpenChange} onSaved={onSaved} />);

    await screen.findByRole('combobox', { name: 'Role' });
    clickMenuItem(/^save$/i);

    expect(await screen.findByText(/cannot remove the last member/i)).toBeTruthy();
    // Success is withheld when the role change is rejected: onSaved does NOT fire (so no
    // misleading "saved" toast), and the sheet stays open so the error is visible and the
    // user can pick a valid role and retry.
    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('⋯ → Cancel closes without saving', async () => {
    const onOpenChange = vi.fn();
    render(<UserDialog open user={editUser} onOpenChange={onOpenChange} onSaved={vi.fn()} />);

    await screen.findByRole('combobox', { name: 'Role' });
    clickMenuItem(/^cancel$/i);

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(api.updateUser).not.toHaveBeenCalled();
  });
});

describe('UserDialog — seedless (no published Users form)', () => {
  beforeEach(() => {
    (api.listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('creating a user works with no published Users form: ⋯ → Create calls createUser then setUserRoles (no-form path, direct submit)', async () => {
    (api.createUser as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'seedless-id', username: 'nora', firstName: null, lastName: null, email: null,
      roles: [], enabled: true, createdAt: '2026-01-01T00:00:00Z', extras: {}, formSchemaId: null, formVersion: null,
    });
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<UserDialog open user={null} onOpenChange={onOpenChange} onSaved={onSaved} />);

    await screen.findByText(/no published users form/i);
    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'nora' } });
    await screen.findByRole('combobox', { name: 'Role' });
    pickRole('Lab Admin');

    const trigger = screen.getByRole('button', { name: 'Actions' });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: /^create$/i })) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    const saveItem = screen.getByRole('menuitem', { name: /^create$/i });
    expect(saveItem).not.toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(saveItem);

    await waitFor(() => expect(api.createUser).toHaveBeenCalled());
    const payload = (api.createUser as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toMatchObject({ username: 'nora' });
    // Seedless create must not require (or fabricate) a form schema reference.
    expect(payload).not.toHaveProperty('formSchemaId');
    expect(payload).not.toHaveProperty('formVersion');

    await waitFor(() => expect(api.setUserRoles).toHaveBeenCalledWith('seedless-id', ['r1']));
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('editing a user works with no published Users form: ⋯ → Save works', async () => {
    (api.updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({ ...editUser, formSchemaId: null, formVersion: null });
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(<UserDialog open user={editUser} onOpenChange={onOpenChange} onSaved={onSaved} />);

    await screen.findByText(/no published users form/i);
    clickMenuItem(/^save$/i);

    await waitFor(() => expect(api.updateUser).toHaveBeenCalled());
    expect((api.updateUser as ReturnType<typeof vi.fn>).mock.calls[0][1]).not.toHaveProperty('formSchemaId');
    await waitFor(() => expect(api.setUserRoles).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders exactly one ⋯ actions menu (no duplicate action affordances)', async () => {
    render(<UserDialog open user={null} onOpenChange={vi.fn()} onSaved={vi.fn()} />);
    await screen.findByText(/no published users form/i);
    expect(screen.getAllByRole('button', { name: 'Actions' })).toHaveLength(1);
  });
});
