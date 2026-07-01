import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField } from '@openldr/forms/pure';
import { OptionsEditor } from './OptionsEditor';

const SELECT_FIELD: FormField = {
  id: 'f-1',
  displayLabel: 'Status',
  fieldType: 'select',
  required: false,
  enabled: true,
  fhirPath: null,
  order: 0,
  cardinality: { min: 0, max: '1' },
  description: null,
  valueSetOptions: [{ code: 'a', display: 'A' }],
};

function renderEditor(overrides: Partial<FormField> = {}) {
  const onUpdate = vi.fn();
  const field = { ...SELECT_FIELD, ...overrides };
  const utils = render(<OptionsEditor field={field} onUpdate={onUpdate} />);
  return { ...utils, onUpdate };
}

describe('OptionsEditor', () => {
  describe('renders existing options', () => {
    it('shows a row for the existing option code', () => {
      renderEditor();
      const codeInputs = screen.getAllByRole('textbox', { name: /option code/i });
      expect((codeInputs[0] as HTMLInputElement).value).toBe('a');
    });

    it('shows a row for the existing option display', () => {
      renderEditor();
      const displayInputs = screen.getAllByRole('textbox', { name: /option display/i });
      expect((displayInputs[0] as HTMLInputElement).value).toBe('A');
    });
  });

  describe('editing code', () => {
    it('calls onUpdate with updated code when code input changes', () => {
      const { onUpdate } = renderEditor();
      const codeInput = screen.getAllByRole('textbox', { name: /option code/i })[0];
      fireEvent.change(codeInput, { target: { value: 'b' } });
      expect(onUpdate).toHaveBeenCalledWith({
        valueSetOptions: [{ code: 'b', display: 'A' }],
      });
    });
  });

  describe('editing display', () => {
    it('calls onUpdate with updated display when display input changes', () => {
      const { onUpdate } = renderEditor();
      const displayInput = screen.getAllByRole('textbox', { name: /option display/i })[0];
      fireEvent.change(displayInput, { target: { value: 'Alpha' } });
      expect(onUpdate).toHaveBeenCalledWith({
        valueSetOptions: [{ code: 'a', display: 'Alpha' }],
      });
    });
  });

  describe('Add option', () => {
    it('has an "Add option" button', () => {
      renderEditor();
      expect(screen.getByRole('button', { name: /add option/i })).toBeTruthy();
    });

    it('clicking Add option appends an empty row', () => {
      const { onUpdate } = renderEditor();
      fireEvent.click(screen.getByRole('button', { name: /add option/i }));
      expect(onUpdate).toHaveBeenCalledWith({
        valueSetOptions: [
          { code: 'a', display: 'A' },
          { code: '', display: '' },
        ],
      });
    });
  });

  describe('remove option', () => {
    it('clicking remove drops the row and calls onUpdate with empty array', () => {
      const { onUpdate } = renderEditor();
      const removeBtn = screen.getByRole('button', { name: /remove option/i });
      fireEvent.click(removeBtn);
      expect(onUpdate).toHaveBeenCalledWith({ valueSetOptions: [] });
    });
  });

  describe('empty valueSetOptions', () => {
    it('renders no option rows when valueSetOptions is undefined', () => {
      renderEditor({ valueSetOptions: undefined });
      expect(screen.queryAllByRole('textbox', { name: /option code/i })).toHaveLength(0);
    });
  });
});
