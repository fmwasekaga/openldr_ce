import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Forms } from './Forms';
import * as api from '../api';

const importedSchema = {
  id: 'specimen-intake',
  name: 'Specimen intake',
  title: { en: 'Specimen intake' },
  status: 'active',
  languages: ['en'],
  sections: [
    {
      id: 'main',
      title: { en: 'Main' },
      fields: [{ id: 'patientId', type: 'string', label: { en: 'Patient ID' }, required: false }],
    },
  ],
};

const form: api.FormSummary = {
  id: 'form-1',
  name: 'Specimen intake',
  versionLabel: 'v1',
  status: 'draft',
  active: true,
  fhirResourceType: 'Questionnaire',
  targetPages: ['forms'],
  fieldCount: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('Forms page', () => {
  beforeEach(() => {
    vi.spyOn(api, 'listForms').mockResolvedValue([form]);
    vi.spyOn(api, 'createForm').mockResolvedValue({ ...form, schema: importedSchema, targetPages: ['forms'], createdAt: form.updatedAt });
    vi.spyOn(api, 'setFormStatus').mockImplementation(async (_id, status) => ({ ...form, status, schema: importedSchema, targetPages: ['forms'], createdAt: form.updatedAt }));
    vi.spyOn(api, 'publishForm').mockResolvedValue({ ...form, status: 'published', schema: importedSchema, targetPages: ['forms'], createdAt: form.updatedAt });
    vi.spyOn(api, 'deleteForm').mockResolvedValue();
    vi.spyOn(api, 'exportFormBundle').mockResolvedValue(undefined);
  });

  it('lists forms, imports JSON, and exposes row actions', async () => {
    render(<MemoryRouter><Forms /></MemoryRouter>);

    expect(await screen.findByText('Specimen intake')).toBeInTheDocument();
    expect(screen.getByText('Questionnaire')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Form actions' })).toBeEnabled();

    const file = new File([JSON.stringify(importedSchema)], 'specimen-intake.json', { type: 'application/json' });
    fireEvent.change(screen.getByLabelText(/import form json/i), { target: { files: [file] } });

    await waitFor(() => expect(api.createForm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Specimen intake', schema: importedSchema })));

    fireEvent.pointerDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Publish')) fireEvent.keyDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Publish'));
    await waitFor(() => expect(api.publishForm).toHaveBeenCalledWith('form-1', expect.objectContaining({ versionLabel: 'v1' })));

    fireEvent.pointerDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Export')) fireEvent.keyDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { key: 'Enter' });
    expect(await screen.findByRole('menuitem', { name: 'Export' })).toHaveAttribute('href', '/api/forms/form-1/questionnaire');

    fireEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    fireEvent.click(await screen.findByRole('button', { name: /^delete$/i }));
    await waitFor(() => expect(api.deleteForm).toHaveBeenCalledWith('form-1'));
  });

  it('opens the builder from the New menu action', async () => {
    render(
      <MemoryRouter initialEntries={['/forms']}>
        <Routes>
          <Route path="/forms" element={<Forms />} />
          <Route path="/forms/new" element={<div>Builder opened</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Specimen intake')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Form actions' }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('New')) fireEvent.keyDown(screen.getByRole('button', { name: 'Form actions' }), { key: 'Enter' });
    fireEvent.click(await screen.findByText('New'));
    expect(await screen.findByText('Builder opened')).toBeInTheDocument();
  });

  it('routes a standalone form (targets the Forms page) to the run/submit view on row click', async () => {
    render(
      <MemoryRouter initialEntries={['/forms']}>
        <Routes>
          <Route path="/forms" element={<Forms />} />
          <Route path="/forms/:id" element={<div>Run view</div>} />
          <Route path="/forms/:id/builder" element={<div>Builder view</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText('Specimen intake'));
    expect(await screen.findByText('Run view')).toBeInTheDocument();
  });

  it('routes a page-allocated form to the builder on row click', async () => {
    const allocated: api.FormSummary = { ...form, id: 'form-9', name: 'Order entry', targetPages: ['orders'] };
    vi.spyOn(api, 'listForms').mockResolvedValue([allocated]);
    render(
      <MemoryRouter initialEntries={['/forms']}>
        <Routes>
          <Route path="/forms" element={<Forms />} />
          <Route path="/forms/:id" element={<div>Run view</div>} />
          <Route path="/forms/:id/builder" element={<div>Builder view</div>} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(await screen.findByText('Order entry'));
    expect(await screen.findByText('Builder view')).toBeInTheDocument();
  });

  it('exports a published form as a marketplace bundle', async () => {
    const published: api.FormSummary = { ...form, status: 'published' };
    vi.spyOn(api, 'listForms').mockResolvedValue([published]);
    render(<MemoryRouter><Forms /></MemoryRouter>);
    expect(await screen.findByText('Specimen intake')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByTestId('export-bundle-form-1')) fireEvent.keyDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('export-bundle-form-1'));
    await waitFor(() => expect(api.exportFormBundle).toHaveBeenCalledWith('form-1'));
  });

  it('duplicates forms from row actions', async () => {
    const duplicateSpy = vi.spyOn(api, 'duplicateForm').mockResolvedValue({ ...form, id: 'form-2', name: 'Specimen intake copy', schema: importedSchema, targetPages: ['forms'], createdAt: form.updatedAt });
    render(<MemoryRouter><Forms /></MemoryRouter>);
    expect(await screen.findByText('Specimen intake')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('Duplicate')) fireEvent.keyDown(screen.getByRole('button', { name: /actions for specimen intake/i }), { key: 'Enter' });
    fireEvent.click(await screen.findByText('Duplicate'));
    await waitFor(() => expect(duplicateSpy).toHaveBeenCalledWith('form-1'));
  });
});
