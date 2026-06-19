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
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(api.createForm).toHaveBeenCalledWith(expect.objectContaining({ name: 'Specimen intake' })));
  });
});
