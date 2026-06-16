import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FormCapture } from './FormCapture';
import * as api from '../api';

const form = {
  id: 'form-1',
  name: 'Specimen intake',
  versionLabel: 'v1',
  fhirResourceType: 'Questionnaire',
  status: 'draft' as const,
  active: true,
  targetPages: ['forms'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  schema: {
    id: 'specimen-intake',
    name: 'Specimen intake',
    title: { en: 'Specimen intake' },
    status: 'active',
    languages: ['en'],
    sections: [
      {
        id: 'main',
        title: { en: 'Main' },
        fields: [
          { id: 'patientId', type: 'string', label: { en: 'Patient ID' }, required: true },
          { id: 'hasNotes', type: 'boolean', label: { en: 'Add notes?' } },
          { id: 'notes', type: 'text', label: { en: 'Notes' }, visibility: { whenField: 'hasNotes', equals: true } },
        ],
      },
    ],
  },
};

describe('FormCapture page', () => {
  beforeEach(() => {
    vi.spyOn(api, 'getForm').mockResolvedValue(form);
    vi.spyOn(api, 'submitFormResponse').mockResolvedValue({ resourceType: 'QuestionnaireResponse' });
  });

  it('renders fields, applies visibility, validates required fields, and submits answers', async () => {
    render(
      <MemoryRouter initialEntries={['/forms/form-1']}>
        <Routes><Route path="/forms/:id" element={<FormCapture />} /></Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Specimen intake')).toBeInTheDocument();
    expect(screen.getByLabelText('Patient ID')).toBeInTheDocument();
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(await screen.findByText('field patientId is required')).toBeInTheDocument();
    expect(api.submitFormResponse).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Patient ID'), { target: { value: 'P-100' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add notes?' }));
    expect(await screen.findByLabelText('Notes')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Follow up' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));

    await waitFor(() => expect(api.submitFormResponse).toHaveBeenCalledWith('form-1', expect.objectContaining({ patientId: 'P-100', hasNotes: true, notes: 'Follow up' })));
    expect(await screen.findByText('Response captured.')).toBeInTheDocument();
  });
});
