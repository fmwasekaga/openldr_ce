import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormBuilderPage } from './FormBuilderPage';
import * as api from '../api';

const NOW = '2026-01-01T00:00:00.000Z';

function makeFormDef(overrides: Partial<Parameters<typeof Object.assign>[0]> = {}) {
  return {
    id: 'form-1',
    name: 'Specimen intake',
    versionLabel: null,
    fhirResourceType: null,
    status: 'draft' as const,
    active: true,
    schema: {
      id: 'specimen-intake',
      name: 'Specimen intake',
      versionLabel: null,
      fhirVersion: null,
      fhirResourceType: null,
      fhirProfileUrl: null,
      facilityId: null,
      fields: [],
      sections: [],
      targetPages: [],
      version: 1,
      active: true,
      status: 'draft' as const,
      createdAt: NOW,
      updatedAt: NOW,
    },
    targetPages: ['forms'],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/** Open the ⋯ Builder actions dropdown. */
function openBuilderMenu(): void {
  const trigger = screen.getByRole('button', { name: 'Builder actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByText('Save draft')) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
}

describe('FormBuilderPage (three-pane shell)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'createForm').mockResolvedValue(makeFormDef());
  });

  it('renders with /forms/new: the header Form name input is present', () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByLabelText('Form name')).toBeInTheDocument();
  });

  it('renders the Preview pane alongside the field list', () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    // PreviewPane renders a "Preview" heading
    expect(screen.getByText('Preview')).toBeInTheDocument();
  });

  it('adds a field via the header ⋯ menu → Add field', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    // Field card should appear in the field-list pane (may also appear in sheet description)
    await waitFor(() =>
      expect(screen.getAllByText('New text field').length).toBeGreaterThan(0),
    );
  });

  it('selecting a field opens the FieldEditorSheet with "Edit Field" header', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    // Add a field
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    // Sheet is auto-opened (field is auto-selected on add); "Edit Field" heading appears
    expect(await screen.findByText('Edit Field')).toBeInTheDocument();
  });

  it('selects a field card and editing Display Label in the sheet updates the card label', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    // Add field via menu — auto-selected, sheet opens
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    // The sheet shows a "Display Label" input
    const labelInput = await screen.findByLabelText('Display Label');
    expect(labelInput).toBeInTheDocument();
    fireEvent.change(labelInput, { target: { value: 'Patient Name' } });
    // Card label also updates in the field-list pane (may also appear in sheet description)
    await waitFor(() =>
      expect(screen.getAllByText('Patient Name').length).toBeGreaterThan(0),
    );
  });

  it('closing the sheet (onOpenChange false) deselects the field', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    // Sheet is open
    expect(await screen.findByText('Edit Field')).toBeInTheDocument();

    // Close via the sheet's close button (shadcn renders a ×/close button)
    const closeBtn = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);

    // "Edit Field" disappears (sheet closed / deselected)
    await waitFor(() =>
      expect(screen.queryByText('Edit Field')).not.toBeInTheDocument(),
    );
  });

  it('toggles the Enabled checkbox in the sheet', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    // Sheet opens; find the Enabled checkbox inside the sheet
    const enabledCheckbox = await screen.findByLabelText('Enabled');
    // Starts checked (enabled: true)
    expect(enabledCheckbox).toBeChecked();
    fireEvent.click(enabledCheckbox);
    expect(enabledCheckbox).not.toBeChecked();
  });

  it('deletes a field via card ⋯ → Delete', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Add field'));
    // Sheet opens automatically (field auto-selected); close it first so the card is accessible
    const closeBtn = await screen.findByRole('button', { name: /close/i });
    fireEvent.click(closeBtn);
    await waitFor(() => expect(screen.queryByText('Edit Field')).not.toBeInTheDocument());

    // Now the field card ⋯ menu is accessible
    const actionsBtn = screen.getByRole('button', { name: /Actions for New text field/i });
    fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Delete')) {
      fireEvent.keyDown(actionsBtn, { key: 'Enter' });
    }
    fireEvent.click(await screen.findByText('Delete'));
    await waitFor(() =>
      expect(screen.queryAllByText('New text field')).toHaveLength(0),
    );
  });

  it('Save draft: opens ⋯ → Save draft → createForm called', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    // Set a form name via the header input
    const nameInput = screen.getByLabelText('Form name');
    fireEvent.change(nameInput, { target: { value: 'My New Form' } });

    openBuilderMenu();
    fireEvent.click(await screen.findByText('Save draft'));
    await waitFor(() =>
      expect(api.createForm).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'My New Form' }),
      ),
    );
  });

  it('Publish: opens ⋯ → Publish → publishForm called for existing form', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'publishForm').mockResolvedValue({ ...makeFormDef(), status: 'published' as const });

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Publish'));
    await waitFor(() =>
      expect(api.publishForm).toHaveBeenCalledWith('form-1', expect.anything()),
    );
  });

  it('Compare: opens ⋯ → Compare → CompareDialog opens', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue(makeFormDef());
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([]);

    render(
      <MemoryRouter initialEntries={['/forms/form-1/builder']}>
        <Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Compare'));
    expect(await screen.findByText(/Published version|Compare form versions/)).toBeInTheDocument();
  });
});
