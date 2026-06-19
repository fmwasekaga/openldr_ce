import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FormBuilderPage } from './FormBuilderPage';
import * as api from '../api';

describe('FormBuilderPage', () => {
  beforeEach(() => {
    vi.spyOn(api, 'createForm').mockResolvedValue({
      id: 'form-1',
      name: 'Specimen intake',
      versionLabel: null,
      fhirResourceType: null,
      status: 'draft',
      active: true,
      schema: { id: 'specimen-intake', name: 'Specimen intake', title: { en: 'Specimen intake' }, status: 'active', languages: ['en'], sections: [{ id: 'main', title: { en: 'Main' }, fields: [] }] },
      targetPages: ['forms'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('creates a new form draft from the builder', async () => {
    render(<MemoryRouter initialEntries={['/forms/new']}><Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Form name'), { target: { value: 'Specimen intake' } });
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Save draft'));
    await waitFor(() => expect(api.createForm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Specimen intake' })));
  });

  it('adds, edits, searches, selects, and deletes fields', async () => {
    render(<MemoryRouter initialEntries={['/forms/new']}><Routes><Route path="/forms/new" element={<FormBuilderPage />} /></Routes></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Add string field' }));
    expect(screen.getByText('New string field')).toBeInTheDocument();
    fireEvent.click(screen.getByText('New string field'));
    fireEvent.change(screen.getByLabelText('Field label'), { target: { value: 'Patient ID' } });
    expect(screen.getByText('Patient ID')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Search fields'), { target: { value: 'patient' } });
    expect(screen.getByText('Patient ID')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete selected field' }));
    expect(screen.queryByText('Patient ID')).not.toBeInTheDocument();
  });

  it('publishes and compares against a published version', async () => {
    vi.spyOn(api, 'getForm').mockResolvedValue({
      id: 'form-1',
      name: 'Specimen intake',
      versionLabel: 'v1',
      fhirResourceType: null,
      status: 'draft',
      active: true,
      schema: { id: 'specimen-intake', name: 'Specimen intake', title: { en: 'Specimen intake' }, status: 'active', languages: ['en'], sections: [{ id: 'main', title: { en: 'Main' }, fields: [{ id: 'patientId', type: 'string', label: { en: 'Patient ID' } }] }] },
      targetPages: ['forms'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    vi.spyOn(api, 'publishForm').mockResolvedValue(await api.getForm('form-1'));
    vi.spyOn(api, 'listFormVersions').mockResolvedValue([{ id: 'fv-1', formId: 'form-1', version: 1, versionLabel: 'v1', name: 'Specimen intake', fhirResourceType: null, targetPages: ['forms'], publishedAt: '2026-01-01T00:00:00.000Z', publishedBy: null }]);
    vi.spyOn(api, 'getFormVersion').mockResolvedValue({ id: 'fv-1', formId: 'form-1', version: 1, versionLabel: 'v1', name: 'Specimen intake', fhirResourceType: null, targetPages: ['forms'], publishedAt: '2026-01-01T00:00:00.000Z', publishedBy: null, schema: { id: 'specimen-intake', name: 'Specimen intake', title: { en: 'Specimen intake' }, status: 'active', languages: ['en'], sections: [] }, questionnaire: {} });

    render(<MemoryRouter initialEntries={['/forms/form-1/builder']}><Routes><Route path="/forms/:id/builder" element={<FormBuilderPage />} /></Routes></MemoryRouter>);
    expect(await screen.findByDisplayValue('Specimen intake')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add section/i })).toBeInTheDocument();
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Publish'));
    await waitFor(() => expect(api.publishForm).toHaveBeenCalledWith('form-1', expect.objectContaining({ versionLabel: 'v1' })));
    openBuilderMenu();
    fireEvent.click(await screen.findByText('Compare'));
    expect(await screen.findByText(/Published version v1/)).toBeInTheDocument();
  });
});

function openBuilderMenu(): void {
  const trigger = screen.getByRole('button', { name: 'Builder actions' });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByText('Save draft')) fireEvent.keyDown(trigger, { key: 'Enter' });
}
