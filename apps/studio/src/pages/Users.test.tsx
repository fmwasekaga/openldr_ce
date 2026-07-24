import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return {
    ...actual,
    listUsers: vi.fn(),
    setUserStatus: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    resetUserPassword: vi.fn(),
    sendUserResetEmail: vi.fn(),
    forceUserLogout: vi.fn(),
    listPublishedForms: vi.fn(),
    getForm: vi.fn(),
    listRoles: vi.fn(),
    getUserRoles: vi.fn(),
    setUserRoles: vi.fn(),
  };
});
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'me', username: 'me', displayName: null, roles: ['lab_admin'] }, loading: false, hasCapability: () => true }),
}));

import { listUsers, setUserStatus, createUser, updateUser, sendUserResetEmail, listPublishedForms, getForm, listRoles, getUserRoles, type UserSummary } from '@/api';
import { Users } from './Users';

// Minimal published form + schema for UserDialog tests
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
    { id: 'f-phone', displayLabel: 'Phone', description: null, fieldType: 'text', apiProperty: 'phone', fhirPath: null, required: false, enabled: true, order: 1, cardinality: { min: 0, max: '1' } },
  ],
  sections: [],
  targetPages: ['users'],
  active: true,
  status: 'published',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

const rows: UserSummary[] = [
  { id: 'me', username: 'me', firstName: 'Me', lastName: null, email: 'me@x', roles: ['lab_admin'], enabled: true, createdAt: '2026-01-01T00:00:00Z', extras: {}, formSchemaId: null, formVersion: null },
  { id: 'u2', username: 'bob', firstName: 'Bob', lastName: 'Smith', email: 'bob@x', roles: ['lab_technician'], enabled: true, createdAt: '2026-01-02T00:00:00Z', extras: {}, formSchemaId: null, formVersion: null },
  { id: 'u3', username: 'old', firstName: 'Old', lastName: null, email: 'old@x', roles: [], enabled: false, createdAt: '2026-01-03T00:00:00Z', extras: {}, formSchemaId: null, formVersion: null },
  { id: 'u4', username: 'ada', firstName: 'Ada', lastName: 'L', email: 'ada@x', roles: ['lab_technician'], enabled: true, createdAt: '2026-01-04T00:00:00Z', extras: { phone: '555-1234' }, formSchemaId: 'form-1', formVersion: 1 },
];

beforeEach(() => {
  vi.clearAllMocks();
  (listUsers as ReturnType<typeof vi.fn>).mockResolvedValue(rows);
  (listPublishedForms as ReturnType<typeof vi.fn>).mockResolvedValue([
    { id: 'form-1', name: 'Users Form', versionLabel: null, status: 'published', active: true, fhirResourceType: null, fieldCount: 2, updatedAt: '2026-01-01T00:00:00Z' },
  ]);
  (getForm as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'form-1', name: 'Users Form', versionLabel: null, fhirResourceType: null, status: 'published', active: true,
    schema: minimalSchema, targetPages: ['users'], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  });
  (createUser as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: 'u5', username: 'grace', firstName: 'Grace', lastName: 'Hopper', email: 'grace@test.local',
    roles: ['data_analyst'], enabled: true, createdAt: '2026-01-05T00:00:00Z', extras: {}, formSchemaId: 'form-1', formVersion: 1,
  });
  (listRoles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  (getUserRoles as ReturnType<typeof vi.fn>).mockResolvedValue([]);
});

function openDropdown(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

describe('Users page', () => {
  it('lists active users by default (disabled hidden)', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>);
    // 'me' now appears in the AppShell sidebar footer too; scope to a table row.
    await waitFor(() => expect(screen.getAllByText('me').find(el => el.closest('tr'))).toBeTruthy());
    expect(screen.getAllByText('bob').find(el => el.closest('tr'))).toBeTruthy();
    expect(screen.queryByText('old')).toBeNull(); // default active-only filter hides disabled
  });

  it('renders full name from firstName + lastName', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('bob')).toBeTruthy());
    // bob has firstName='Bob', lastName='Smith' → full name cell
    expect(screen.getByText('Bob Smith')).toBeTruthy();
  });

  it('disables another user behind a confirm dialog', async () => {
    (setUserStatus as ReturnType<typeof vi.fn>).mockResolvedValue({ ...rows[1], enabled: false });
    render(<MemoryRouter><Users /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('bob')).toBeTruthy());

    const bobRow = screen.getByText('bob').closest('tr')!;
    const trigger = within(bobRow).getByLabelText(/actions for bob/i);
    openDropdown(trigger);

    const disableItem = await screen.findByText('Disable');
    fireEvent.click(disableItem);

    // ConfirmDialog appears — click the confirm button (role=button name=Disable)
    const confirmBtn = await screen.findByRole('button', { name: 'Disable' });
    fireEvent.click(confirmBtn);

    await waitFor(() => expect(setUserStatus).toHaveBeenCalledWith('u2', false));
  });

  it('blocks disabling your own account (menu item is disabled)', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>);
    // 'me' now appears twice: once in the AppShell header (username indicator) and once in the
    // table row. Use getAllByText and pick the one inside a <tr>.
    await waitFor(() => expect(screen.getAllByText('me').length).toBeGreaterThan(0));

    const meCell = screen.getAllByText('me').find(el => el.closest('tr'))!;
    const meRow = meCell.closest('tr')!;
    const trigger = within(meRow).getByLabelText(/actions for me/i);
    openDropdown(trigger);

    const item = (await screen.findByText(/disable/i)).closest('[role="menuitem"]') as HTMLElement;
    expect(item.getAttribute('aria-disabled')).toBe('true');
  });

  it('send reset email calls sendUserResetEmail', async () => {
    (sendUserResetEmail as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<MemoryRouter><Users /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('ada')).toBeTruthy());

    const adaRow = screen.getByText('ada').closest('tr')!;
    const trigger = within(adaRow).getByLabelText(/actions for ada/i);
    openDropdown(trigger);

    const sendEmailItem = await screen.findByText(/send reset email/i);
    fireEvent.click(sendEmailItem);

    await waitFor(() => expect(sendUserResetEmail).toHaveBeenCalledWith('u4'));
    expect(await screen.findByText(/reset email sent to ada/i)).toBeTruthy();
  });

  it('edit dialog does not send roles on the identity payload (role assignment is a separate call)', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('bob')).toBeTruthy());

    (updateUser as ReturnType<typeof vi.fn>).mockResolvedValue({ ...rows[1] });

    const bobRow = screen.getByText('bob').closest('tr')!;
    const trigger = within(bobRow).getByLabelText(/actions for bob/i);
    openDropdown(trigger);
    const editItem = await screen.findByText(/^edit$/i);
    fireEvent.click(editItem);

    await screen.findByRole('button', { name: /^save$/i });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(updateUser).toHaveBeenCalled());
    const updateCall = (updateUser as ReturnType<typeof vi.fn>).mock.calls[0][1] as Record<string, unknown>;
    expect(updateCall).not.toHaveProperty('roles');
  });

  it('opens "New user" from the toolbar dropdown, fills username, and calls createUser with CORE + extras split', async () => {
    render(<MemoryRouter><Users /></MemoryRouter>);
    // 'me' appears in sidebar footer + header + table row; scope to table row.
    await waitFor(() => expect(screen.getAllByText('me').find(el => el.closest('tr'))).toBeTruthy());

    // Open the toolbar "User actions" dropdown
    const toolbarTrigger = screen.getByLabelText('User actions');
    openDropdown(toolbarTrigger);

    const newUserItem = await screen.findByText('New user');
    fireEvent.click(newUserItem);

    // Wait for the schema to load and dialog to show fixed fields
    const usernameInput = await screen.findByLabelText('Username');
    fireEvent.change(usernameInput, { target: { value: 'grace' } });

    // FormRuntime renders the firstName CORE field
    const firstNameInput = await screen.findByLabelText('First name');
    fireEvent.change(firstNameInput, { target: { value: 'Grace' } });

    // FormRuntime renders the phone extras field
    const phoneInput = await screen.findByLabelText('Phone');
    fireEvent.change(phoneInput, { target: { value: '555-9999' } });

    // Submit via the form's Create button
    fireEvent.click(screen.getByRole('button', { name: /^create$/i }));

    await waitFor(() =>
      expect(createUser).toHaveBeenCalledWith(expect.objectContaining({
        username: 'grace',
        firstName: 'Grace',
        extras: expect.objectContaining({ phone: expect.objectContaining({ value: '555-9999' }) }),
        formSchemaId: 'form-1',
      })),
    );
  });
});
