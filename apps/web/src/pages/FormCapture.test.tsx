import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FormCapture } from './FormCapture';
import * as api from '../api';

// New-model FormDefinition: schema is a flat FormSchema
const form: api.FormDefinition = {
  id: 'form-1',
  name: 'Specimen intake',
  versionLabel: 'v1',
  fhirResourceType: 'Questionnaire',
  status: 'draft',
  active: true,
  targetPages: ['forms'],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  schema: {
    id: 'specimen-intake',
    name: 'Specimen intake',
    versionLabel: null,
    fhirVersion: null,
    fhirResourceType: 'Questionnaire',
    fhirProfileUrl: null,
    facilityId: null,
    fields: [
      {
        id: 'patientId',
        fhirPath: null,
        displayLabel: 'Patient ID',
        description: null,
        fieldType: 'text',
        required: true,
        enabled: true,
        order: 1,
        cardinality: { min: 1, max: '1' },
      },
      {
        id: 'hasNotes',
        fhirPath: null,
        displayLabel: 'Add notes?',
        description: null,
        fieldType: 'boolean',
        required: false,
        enabled: true,
        order: 2,
        cardinality: { min: 0, max: '1' },
      },
      {
        id: 'notes',
        fhirPath: null,
        displayLabel: 'Notes',
        description: null,
        fieldType: 'text',
        required: false,
        enabled: true,
        order: 3,
        cardinality: { min: 0, max: '1' },
        visibility: {
          combinator: 'all' as const,
          conditions: [{ fieldId: 'hasNotes', operator: 'equals' as const, value: 'true' }],
        },
      },
    ],
    sections: [],
    targetPages: ['forms'],
    languages: ['en'],
    version: 1,
    active: true,
    status: 'draft',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
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

    // Submit without required field fills
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    expect(await screen.findByText('field patientId is required')).toBeInTheDocument();
    expect(api.submitFormResponse).not.toHaveBeenCalled();

    // Fill required field
    fireEvent.change(screen.getByLabelText('Patient ID'), { target: { value: 'P-100' } });
    // Reveal Notes
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add notes?' }));
    expect(await screen.findByLabelText('Notes')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Notes'), { target: { value: 'Follow up' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() =>
      expect(api.submitFormResponse).toHaveBeenCalledWith(
        'form-1',
        expect.objectContaining({ patientId: 'P-100', hasNotes: true, notes: 'Follow up' }),
      ),
    );
    expect(await screen.findByText('Response captured.')).toBeInTheDocument();
  });
});
