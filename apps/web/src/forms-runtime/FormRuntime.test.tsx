import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormRuntime } from './FormRuntime';
import type { FormSchema } from './types';

// New flat-model schema: required text field, a boolean, and a conditional text field.
const schema: FormSchema = {
  id: 'f1',
  name: 'Test form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
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
      id: 'addNotes',
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
      // Only visible when addNotes === 'true'
      visibility: {
        combinator: 'all',
        conditions: [{ fieldId: 'addNotes', operator: 'equals', value: 'true' }],
      },
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

// Minimal schema for preview-hook tests
const previewSchema: FormSchema = {
  id: 'p1',
  name: 'Preview form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'name',
      fhirPath: null,
      displayLabel: 'Name',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 1,
      cardinality: { min: 0, max: '1' },
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

// Schema with a required field and a field with description for indicator tests
const indicatorSchema: FormSchema = {
  id: 'ind1',
  name: 'Indicator form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'req-field',
      fhirPath: null,
      displayLabel: 'Required Field',
      description: null,
      fieldType: 'text',
      required: true,
      enabled: true,
      order: 1,
      cardinality: { min: 1, max: '1' },
    },
    {
      id: 'desc-field',
      fhirPath: null,
      displayLabel: 'Described Field',
      description: 'Enter the patient age in years',
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 2,
      cardinality: { min: 0, max: '1' },
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

// Schema with two sections for grouping tests.
const sectionedSchema: FormSchema = {
  id: 'sectioned',
  name: 'Sectioned form',
  versionLabel: null,
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [
    {
      id: 'fname',
      fhirPath: null,
      displayLabel: 'First name',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 1,
      section: 'main',
      cardinality: { min: 0, max: '1' },
    },
    {
      id: 'testType',
      fhirPath: null,
      displayLabel: 'Test type',
      description: null,
      fieldType: 'text',
      required: false,
      enabled: true,
      order: 2,
      section: 'extra',
      cardinality: { min: 0, max: '1' },
    },
  ],
  sections: [
    { id: 'main', label: 'Patient', order: 0 },
    { id: 'extra', label: 'Order Details', order: 1 },
  ],
  targetPages: [],
  languages: ['en'],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('FormRuntime', () => {
  it('required validation blocks submit and shows error', async () => {
    const onSubmit = vi.fn();
    render(<FormRuntime schema={schema} submitLabel="Submit" onSubmit={onSubmit} />);
    // Patient ID is rendered
    expect(screen.getByLabelText('Patient ID')).toBeInTheDocument();
    // Notes is hidden (visibility not satisfied)
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();

    // Submit without filling required field
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(await screen.findByText('field patientId is required')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('toggling boolean reveals conditional field', async () => {
    const onSubmit = vi.fn();
    render(<FormRuntime schema={schema} submitLabel="Submit" onSubmit={onSubmit} />);

    // Notes hidden initially
    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument();

    // Toggle the boolean checkbox
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add notes?' }));
    // Notes should now be visible
    expect(await screen.findByLabelText('Notes')).toBeInTheDocument();
  });

  it('complete submit calls onSubmit with answers keyed by field id', async () => {
    const onSubmit = vi.fn();
    render(<FormRuntime schema={schema} submitLabel="Submit" onSubmit={onSubmit} />);

    // Fill Patient ID
    fireEvent.change(screen.getByLabelText('Patient ID'), { target: { value: 'P-001' } });
    // Toggle boolean to reveal Notes
    fireEvent.click(screen.getByRole('checkbox', { name: 'Add notes?' }));
    // Fill Notes
    fireEvent.change(await screen.findByLabelText('Notes'), { target: { value: 'Some note' } });

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    await vi.waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ patientId: 'P-001', addNotes: true, notes: 'Some note' }),
    );
  });

  it('initialAnswers pre-fills the field input', () => {
    render(
      <FormRuntime
        schema={previewSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
        initialAnswers={{ name: 'Seed' }}
      />,
    );
    const input = screen.getByLabelText('Name') as HTMLInputElement;
    expect(input.value).toBe('Seed');
  });

  it('required field shows a "Required" indicator with aria-label', () => {
    render(
      <FormRuntime
        schema={indicatorSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // The "!" span has aria-label="Required"
    const marker = screen.getByLabelText('Required');
    expect(marker).toBeTruthy();
    expect(marker.textContent).toBe('!');
  });

  it('field with description shows a "?" help indicator with aria-label = description', () => {
    render(
      <FormRuntime
        schema={indicatorSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // The "?" span has aria-label equal to the description text
    const marker = screen.getByLabelText('Enter the patient age in years');
    expect(marker).toBeTruthy();
    expect(marker.textContent).toBe('?');
  });

  it('required field does NOT show a "?" help indicator when description is null', () => {
    render(
      <FormRuntime
        schema={indicatorSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // req-field has no description — only "!" should appear for it, not "?"
    // Confirm only one "?" in total (for desc-field)
    const questionMarkers = screen.getAllByText('?');
    expect(questionMarkers).toHaveLength(1);
  });

  // ── Section grouping ─────────────────────────────────────────────────────────

  it('renders section headers when schema has sections', () => {
    render(
      <FormRuntime
        schema={sectionedSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // Both section labels must appear as headers
    expect(screen.getByText('Patient')).toBeTruthy();
    expect(screen.getByText('Order Details')).toBeTruthy();
  });

  it('renders fields under correct section headers', () => {
    render(
      <FormRuntime
        schema={sectionedSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // Field labels are still in the document
    expect(screen.getByLabelText('First name')).toBeTruthy();
    expect(screen.getByLabelText('Test type')).toBeTruthy();
    // Section headers appear before their fields in DOM order
    const patientHeader = screen.getByText('Patient');
    const firstNameInput = screen.getByLabelText('First name');
    expect(
      patientHeader.compareDocumentPosition(firstNameInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    const orderHeader = screen.getByText('Order Details');
    const testTypeInput = screen.getByLabelText('Test type');
    expect(
      orderHeader.compareDocumentPosition(testTypeInput) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders fields as flat list with no section headers when schema has no sections', () => {
    render(
      <FormRuntime
        schema={previewSchema}
        submitLabel=""
        footer={null}
        onSubmit={() => {}}
      />,
    );
    // Field appears
    expect(screen.getByLabelText('Name')).toBeTruthy();
    // No section header elements
    expect(screen.queryByText('Patient')).toBeNull();
    expect(screen.queryByText('Order Details')).toBeNull();
  });
});
