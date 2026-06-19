import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField } from '@openldr/forms/pure';
import type { PickedTerm } from '@/terminology/TermPicker';
import { CodesEditor } from './CodesEditor';

// Mock TermPicker so we can drive its onChange without real API calls.
vi.mock('@/terminology/TermPicker', () => ({
  TermPicker: ({
    onChange,
  }: {
    value: PickedTerm | null;
    onChange: (v: PickedTerm | null) => void;
    systemId: string;
  }) => (
    <button
      type="button"
      data-testid="term-picker-trigger"
      onClick={() =>
        onChange({
          system: 'http://loinc.org',
          code: '718-7',
          display: 'Hemoglobin',
        })
      }
    >
      Pick term
    </button>
  ),
}));

const BASE_FIELD: FormField = {
  id: 'f-1',
  displayLabel: 'Haemoglobin',
  fieldType: 'number',
  required: false,
  enabled: true,
  fhirPath: null,
  order: 0,
  cardinality: { min: 0, max: '1' },
  description: null,
  code: [{ system: 'http://loinc.org', code: '718-7', display: 'Hgb' }],
};

function renderEditor(overrides: Partial<FormField> = {}) {
  const onUpdate = vi.fn();
  const field = { ...BASE_FIELD, ...overrides };
  const utils = render(<CodesEditor field={field} onUpdate={onUpdate} />);
  return { ...utils, onUpdate };
}

describe('CodesEditor', () => {
  describe('renders existing codes', () => {
    it('shows the code value for an existing coding', () => {
      renderEditor();
      expect(screen.getByText('718-7')).toBeTruthy();
    });

    it('shows the display for an existing coding', () => {
      renderEditor();
      expect(screen.getByText('Hgb')).toBeTruthy();
    });
  });

  describe('remove code', () => {
    it('clicking the remove button calls onUpdate with an empty code array', () => {
      const { onUpdate } = renderEditor();
      const removeBtn = screen.getByRole('button', { name: /remove code/i });
      fireEvent.click(removeBtn);
      expect(onUpdate).toHaveBeenCalledWith({ code: [] });
    });
  });

  describe('add code via TermPicker', () => {
    it('calls onUpdate appending the new coding to existing codes when TermPicker picks a term', () => {
      // Field already has one code; picking another should append.
      const existingCode = { system: 'http://snomed.info/sct', code: '12345', display: 'Test' };
      const { onUpdate } = renderEditor({ code: [existingCode] });

      fireEvent.click(screen.getByTestId('term-picker-trigger'));

      expect(onUpdate).toHaveBeenCalledWith({
        code: [
          existingCode,
          { system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' },
        ],
      });
    });

    it('calls onUpdate with just the new coding when code array is empty', () => {
      const { onUpdate } = renderEditor({ code: [] });
      fireEvent.click(screen.getByTestId('term-picker-trigger'));
      expect(onUpdate).toHaveBeenCalledWith({
        code: [{ system: 'http://loinc.org', code: '718-7', display: 'Hemoglobin' }],
      });
    });
  });

  describe('empty code array', () => {
    it('renders no chips when code is undefined', () => {
      renderEditor({ code: undefined });
      expect(screen.queryByRole('button', { name: /remove code/i })).toBeNull();
    });
  });
});
