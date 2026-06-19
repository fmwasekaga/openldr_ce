import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField } from '@openldr/forms/pure';
import { MappingEditor } from './MappingEditor';

const BASE_FIELD: FormField = {
  id: 'f-1',
  displayLabel: 'Patient name',
  fieldType: 'text',
  required: false,
  enabled: true,
  fhirPath: null,
  order: 0,
  cardinality: { min: 0, max: '1' },
  description: null,
};

function renderEditor(overrides: Partial<FormField> = {}) {
  const onUpdate = vi.fn();
  const field = { ...BASE_FIELD, ...overrides };
  const utils = render(<MappingEditor field={field} onUpdate={onUpdate} />);
  return { ...utils, onUpdate };
}

describe('MappingEditor', () => {
  describe('FHIR path input', () => {
    it('shows the current fhirPath value', () => {
      renderEditor({ fhirPath: 'Patient.name' });
      const input = screen.getByRole('textbox', { name: /fhir path/i });
      expect((input as HTMLInputElement).value).toBe('Patient.name');
    });

    it('calls onUpdate with fhirPath on change', () => {
      const { onUpdate } = renderEditor();
      const input = screen.getByRole('textbox', { name: /fhir path/i });
      fireEvent.change(input, { target: { value: 'Patient.name' } });
      expect(onUpdate).toHaveBeenCalledWith({ fhirPath: 'Patient.name' });
    });

    it('calls onUpdate with null when fhirPath cleared', () => {
      const { onUpdate } = renderEditor({ fhirPath: 'Patient.name' });
      const input = screen.getByRole('textbox', { name: /fhir path/i });
      fireEvent.change(input, { target: { value: '' } });
      expect(onUpdate).toHaveBeenCalledWith({ fhirPath: null });
    });
  });

  describe('apiProperty input', () => {
    it('calls onUpdate with apiProperty on change', () => {
      const { onUpdate } = renderEditor();
      const input = screen.getByRole('textbox', { name: /api property/i });
      fireEvent.change(input, { target: { value: 'patientName' } });
      expect(onUpdate).toHaveBeenCalledWith({ apiProperty: 'patientName' });
    });

    it('calls onUpdate with undefined when apiProperty cleared', () => {
      const { onUpdate } = renderEditor({ apiProperty: 'patientName' });
      const input = screen.getByRole('textbox', { name: /api property/i });
      fireEvent.change(input, { target: { value: '' } });
      expect(onUpdate).toHaveBeenCalledWith({ apiProperty: undefined });
    });
  });

  describe('observationExtract checkbox', () => {
    it('calls onUpdate with observationExtract: true when checked', () => {
      const { onUpdate } = renderEditor({ observationExtract: false });
      const cb = screen.getByRole('checkbox', { name: /observation extract/i });
      fireEvent.click(cb);
      expect(onUpdate).toHaveBeenCalledWith({ observationExtract: true });
    });
  });

  describe('valueSetUrl input', () => {
    it('calls onUpdate with valueSetUrl on change', () => {
      const { onUpdate } = renderEditor();
      const input = screen.getByRole('textbox', { name: /value set url/i });
      fireEvent.change(input, { target: { value: 'http://example.com/vs' } });
      expect(onUpdate).toHaveBeenCalledWith({ valueSetUrl: 'http://example.com/vs' });
    });

    it('calls onUpdate with undefined when valueSetUrl cleared', () => {
      const { onUpdate } = renderEditor({ valueSetUrl: 'http://example.com/vs' });
      const input = screen.getByRole('textbox', { name: /value set url/i });
      fireEvent.change(input, { target: { value: '' } });
      expect(onUpdate).toHaveBeenCalledWith({ valueSetUrl: undefined });
    });
  });

  describe('bindingStrength Select', () => {
    it('calls onUpdate with bindingStrength: required when selected', () => {
      const { onUpdate } = renderEditor();
      const trigger = screen.getByRole('combobox', { name: /binding strength/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('required'));
      expect(onUpdate).toHaveBeenCalledWith({ bindingStrength: 'required' });
    });

    it('calls onUpdate with bindingStrength: extensible when selected', () => {
      const { onUpdate } = renderEditor();
      const trigger = screen.getByRole('combobox', { name: /binding strength/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('extensible'));
      expect(onUpdate).toHaveBeenCalledWith({ bindingStrength: 'extensible' });
    });
  });

  describe('Advanced section', () => {
    // The advanced section may be inside a collapsible — open it first.
    function openAdvanced() {
      const btn = screen.getByRole('button', { name: /advanced/i });
      fireEvent.click(btn);
    }

    describe('constraints — maxLength', () => {
      it('calls onUpdate merging maxLength into existing constraints', () => {
        const { onUpdate } = renderEditor({ constraints: { min: 1 } });
        openAdvanced();
        const input = screen.getByRole('spinbutton', { name: /max length/i });
        fireEvent.change(input, { target: { value: '255' } });
        expect(onUpdate).toHaveBeenCalledWith({
          constraints: { min: 1, maxLength: 255 },
        });
      });

      it('omits maxLength from constraints when cleared', () => {
        const { onUpdate } = renderEditor({ constraints: { maxLength: 255 } });
        openAdvanced();
        const input = screen.getByRole('spinbutton', { name: /max length/i });
        fireEvent.change(input, { target: { value: '' } });
        expect(onUpdate).toHaveBeenCalledWith({
          constraints: { maxLength: undefined },
        });
      });
    });

    describe('referenceTarget input', () => {
      it('calls onUpdate with referenceTarget on change', () => {
        const { onUpdate } = renderEditor();
        openAdvanced();
        const input = screen.getByRole('textbox', { name: /reference target/i });
        fireEvent.change(input, { target: { value: 'Patient' } });
        expect(onUpdate).toHaveBeenCalledWith({ referenceTarget: 'Patient' });
      });

      it('calls onUpdate with undefined when referenceTarget cleared', () => {
        const { onUpdate } = renderEditor({ referenceTarget: 'Patient' });
        openAdvanced();
        const input = screen.getByRole('textbox', { name: /reference target/i });
        fireEvent.change(input, { target: { value: '' } });
        expect(onUpdate).toHaveBeenCalledWith({ referenceTarget: undefined });
      });
    });

    describe('adminNote textarea', () => {
      it('calls onUpdate with adminNote on change', () => {
        const { onUpdate } = renderEditor();
        openAdvanced();
        const textarea = screen.getByRole('textbox', { name: /admin note/i });
        fireEvent.change(textarea, { target: { value: 'Internal note' } });
        expect(onUpdate).toHaveBeenCalledWith({ adminNote: 'Internal note' });
      });

      it('calls onUpdate with undefined when adminNote cleared', () => {
        const { onUpdate } = renderEditor({ adminNote: 'Internal note' });
        openAdvanced();
        const textarea = screen.getByRole('textbox', { name: /admin note/i });
        fireEvent.change(textarea, { target: { value: '' } });
        expect(onUpdate).toHaveBeenCalledWith({ adminNote: undefined });
      });
    });
  });
});
