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

describe('FormBuilderPage', () => {
  beforeEach(() => {
    vi.spyOn(api, 'createForm').mockResolvedValue(makeFormDef());
  });

  it('creates a draft form when Save draft is clicked', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Specimen intake' } });
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Save draft'));
    await waitFor(() =>
      expect(api.createForm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Specimen intake' })),
    );
  });

  it('adds a field and shows it in the list', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(screen.getByText('New field')).toBeInTheDocument();
  });

  it('edits the display label of a selected field', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    // Click the field row to select it
    fireEvent.click(screen.getByText('New field'));
    // Edit the display label in the inline panel
    const labelInput = screen.getByLabelText('Display label');
    fireEvent.change(labelInput, { target: { value: 'Patient Name' } });
    expect(screen.getByDisplayValue('Patient Name')).toBeInTheDocument();
  });

  it('deletes a field', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/new']}>
        <Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add field' }));
    expect(screen.getByText('New field')).toBeInTheDocument();
    // Click the delete button on the field row (× button)
    fireEvent.click(screen.getByRole('button', { name: 'Delete field New field' }));
    expect(screen.queryByText('New field')).not.toBeInTheDocument();
  });

  it('opens CompareDialog when Compare is clicked for an existing form', async () => {
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
    expect(await screen.findByText('Compare form versions')).toBeInTheDocument();
  });
});

function openBuilderMenu(): void {
  const trigger = screen.getByRole('button', { name: 'Builder actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByText('Save draft')) fireEvent.keyDown(trigger, { key: 'Enter' });
}
