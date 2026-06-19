import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FormSchema } from '@/forms-runtime/types';
import { PreviewPane } from './PreviewPane';

const schema: FormSchema = {
  id: 'preview-test',
  name: 'Preview Test Form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'patient-name',
      fhirPath: null,
      displayLabel: 'Patient name',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 0,
      cardinality: { min: 0, max: '1' },
    },
    {
      id: 'sex',
      fhirPath: null,
      displayLabel: 'Sex',
      description: null,
      fieldType: 'select',
      required: false,
      enabled: true,
      order: 1,
      cardinality: { min: 0, max: '1' },
      // No valueSetOptions — lintFormSchema will flag this as 'choice-missing-options' with severity 'error'
    },
  ],
  sections: [],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('PreviewPane', () => {
  it('renders a "Preview" header', () => {
    render(<PreviewPane schema={schema} />);
    expect(screen.getByText(/preview/i)).toBeTruthy();
  });

  it('renders the Patient name field label', () => {
    render(<PreviewPane schema={schema} />);
    expect(screen.getByText('Patient name')).toBeTruthy();
  });

  it('clicking Fill example populates the Patient name text input', () => {
    render(<PreviewPane schema={schema} />);
    const fillBtn = screen.getByRole('button', { name: /fill example/i });
    fireEvent.click(fillBtn);
    const input = screen.getByLabelText('Patient name') as HTMLInputElement;
    expect(input.value).not.toBe('');
    expect(input.value).toBe('Example');
  });

  it('clicking Reset clears the Patient name text input', () => {
    render(<PreviewPane schema={schema} />);
    // Fill first
    fireEvent.click(screen.getByRole('button', { name: /fill example/i }));
    expect((screen.getByLabelText('Patient name') as HTMLInputElement).value).toBe('Example');
    // Reset — remountKey increments so FormRuntime is remounted; re-query after click
    fireEvent.click(screen.getByRole('button', { name: /reset/i }));
    expect((screen.getByLabelText('Patient name') as HTMLInputElement).value).toBe('');
  });

  it('shows a per-field warning marker for the Sex field (lint error: choice-missing-options)', () => {
    render(<PreviewPane schema={schema} />);
    // lintFormSchema flags 'sex' with severity 'error' → FormRuntime renders a '!' marker
    // with title/aria-label containing 'error' or text content '!'
    const marker =
      screen.queryByTitle(/error/i) ??
      screen.queryByLabelText(/error/i) ??
      screen.queryByText('!');
    expect(marker).not.toBeNull();
  });
});
