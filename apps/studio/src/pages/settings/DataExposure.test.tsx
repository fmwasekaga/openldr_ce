import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'me', username: 'admin', roles: ['lab_admin'] }, hasCapability: () => true }) }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() }, Toaster: () => null }));
vi.mock('@/api', async (orig) => {
  const actual = await orig<typeof import('@/api')>();
  return { ...actual, getColumnPolicy: vi.fn(), saveColumnPolicy: vi.fn() };
});
import * as api from '@/api';
import { toast } from 'sonner';
import { DataExposure } from './DataExposure';

// The header ⋯ menu (Save/Discard) is a Radix DropdownMenu — jsdom needs pointerDown
// to open it, falling back to Enter (see Connectors.test.tsx for the same pattern).
function openPageMenu() {
  const trigger = screen.getByTestId('data-exposure-menu-trigger');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

const fixture = [
  {
    table: 'patients',
    label: 'Patient',
    columns: [
      { name: 'sex', hidden: false, pii: false },
      { name: 'national_id', hidden: true, pii: true },
    ],
  },
  {
    table: 'specimens',
    label: 'Specimen',
    columns: [
      { name: 'collected_at', hidden: false, pii: false },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  (api.getColumnPolicy as any).mockResolvedValue(fixture);
  (api.saveColumnPolicy as any).mockResolvedValue(undefined);
});

describe('DataExposure page', () => {
  it('renders one section per table and a PII badge for pii columns', async () => {
    render(<MemoryRouter><DataExposure /></MemoryRouter>);
    expect(await screen.findByText('national_id')).toBeTruthy();
    expect(screen.getByText('sex')).toBeTruthy();
    expect(screen.getByText('Patient')).toBeTruthy();
    expect(screen.getByText('Specimen')).toBeTruthy();
    expect(screen.getByText(/PII/i)).toBeInTheDocument();
  });

  it('asks to confirm when un-hiding a PII column, and Save omits it from the hidden list once confirmed', async () => {
    render(<MemoryRouter><DataExposure /></MemoryRouter>);
    await screen.findByText('national_id');

    fireEvent.click(screen.getByLabelText('toggle national_id'));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent(/national_id/);

    fireEvent.click(screen.getByRole('button', { name: /un-?hide/i }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    openPageMenu();
    fireEvent.click(await screen.findByTestId('data-exposure-save'));

    await waitFor(() => expect(api.saveColumnPolicy).toHaveBeenCalledWith({
      patients: [],
      specimens: [],
    }));
    expect(toast.success).toHaveBeenCalled();
  });

  it('cancelling the confirm leaves the PII column hidden', async () => {
    render(<MemoryRouter><DataExposure /></MemoryRouter>);
    await screen.findByText('national_id');

    fireEvent.click(screen.getByLabelText('toggle national_id'));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    openPageMenu();
    fireEvent.click(await screen.findByTestId('data-exposure-save'));

    await waitFor(() => expect(api.saveColumnPolicy).toHaveBeenCalledWith({
      patients: ['national_id'],
      specimens: [],
    }));
  });

  it('toggling a non-PII column applies immediately, without a confirm dialog', async () => {
    render(<MemoryRouter><DataExposure /></MemoryRouter>);
    await screen.findByText('sex');

    fireEvent.click(screen.getByLabelText('toggle sex'));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    openPageMenu();
    fireEvent.click(await screen.findByTestId('data-exposure-save'));

    await waitFor(() => expect(api.saveColumnPolicy).toHaveBeenCalledWith({
      patients: ['national_id', 'sex'],
      specimens: [],
    }));
  });

  it('discard reloads from the server, dropping local edits', async () => {
    render(<MemoryRouter><DataExposure /></MemoryRouter>);
    await screen.findByText('sex');

    fireEvent.click(screen.getByLabelText('toggle sex'));
    openPageMenu();
    fireEvent.click(await screen.findByTestId('data-exposure-discard'));

    await waitFor(() => expect(api.getColumnPolicy).toHaveBeenCalledTimes(2));
  });
});
