import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField, VisibilityRule } from '@openldr/forms/pure';
import { VisibilityRuleEditor } from './VisibilityRuleEditor';

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

const SEX_FIELD: FormField = {
  id: 'sex',
  displayLabel: 'Sex',
  fieldType: 'select',
  required: false,
  enabled: true,
  fhirPath: null,
  order: 1,
  cardinality: { min: 0, max: '1' },
  description: null,
};

const ALL_FIELDS = [BASE_FIELD, SEX_FIELD];

function renderEditor(
  overrides: Partial<Parameters<typeof VisibilityRuleEditor>[0]> = {},
) {
  const onUpdate = vi.fn();
  const utils = render(
    <VisibilityRuleEditor
      field={BASE_FIELD}
      allFields={ALL_FIELDS}
      onUpdate={onUpdate}
      {...overrides}
    />,
  );
  return { ...utils, onUpdate };
}

describe('VisibilityRuleEditor', () => {
  describe('combinator select', () => {
    it('renders a combinator combobox with all/any options', () => {
      renderEditor();
      const trigger = screen.getByRole('combobox', { name: /combinator/i });
      expect(trigger).toBeTruthy();
      fireEvent.click(trigger);
      // 'all' appears in both the trigger value and the dropdown item
      expect(screen.getAllByText('all').length).toBeGreaterThan(0);
      expect(screen.getAllByText('any').length).toBeGreaterThan(0);
    });
  });

  describe('Add condition', () => {
    it('clicking "Add condition" calls onUpdate with one condition using first other field', () => {
      const { onUpdate } = renderEditor();
      const addBtn = screen.getByRole('button', { name: /add condition/i });
      fireEvent.click(addBtn);
      expect(onUpdate).toHaveBeenCalledOnce();
      const call = onUpdate.mock.calls[0][0] as { visibility: VisibilityRule };
      expect(call.visibility).toBeDefined();
      expect(call.visibility.conditions).toHaveLength(1);
      expect(call.visibility.conditions[0].fieldId).toBe('sex');
    });
  });

  describe('with an existing condition', () => {
    const EXISTING_RULE: VisibilityRule = {
      combinator: 'all',
      conditions: [{ fieldId: 'sex', operator: 'isNotEmpty' }],
    };

    function renderWithCondition() {
      return renderEditor({
        field: { ...BASE_FIELD, visibility: EXISTING_RULE },
      });
    }

    it('renders a controlling field select excluding self, with other fields as options', () => {
      renderWithCondition();
      // The field select (first combobox for condition row, excludes f-1 / "Patient name")
      const fieldTrigger = screen.getByRole('combobox', { name: /controlling field/i });
      fireEvent.click(fieldTrigger);
      // Only SEX_FIELD should appear (self excluded)
      expect(screen.getAllByText('Sex').length).toBeGreaterThan(0);
      // Self should NOT appear as an option
      const patientOptions = screen.queryAllByRole('option', { name: /patient name/i });
      expect(patientOptions).toHaveLength(0);
    });

    it('choosing a controlling field calls onUpdate updating conditions[0].fieldId', () => {
      // Use field with no conditions so we can add one and test fieldId update
      const { onUpdate } = renderEditor({
        field: {
          ...BASE_FIELD,
          visibility: {
            combinator: 'all',
            conditions: [{ fieldId: 'sex', operator: 'isNotEmpty' }],
          },
        },
        allFields: [
          BASE_FIELD,
          SEX_FIELD,
          {
            id: 'dob',
            displayLabel: 'Date of Birth',
            fieldType: 'date',
            required: false,
            enabled: true,
            fhirPath: null,
            order: 2,
            cardinality: { min: 0, max: '1' },
            description: null,
          },
        ],
      });
      const fieldTrigger = screen.getByRole('combobox', { name: /controlling field/i });
      fireEvent.click(fieldTrigger);
      fireEvent.click(screen.getByText('Date of Birth'));
      const call = onUpdate.mock.calls[0][0] as { visibility: VisibilityRule };
      expect(call.visibility.conditions[0].fieldId).toBe('dob');
    });

    it('choosing the operator select calls onUpdate updating operator', () => {
      const { onUpdate } = renderWithCondition();
      const opTrigger = screen.getByRole('combobox', { name: /operator/i });
      fireEvent.click(opTrigger);
      fireEvent.click(screen.getByText('equals'));
      const call = onUpdate.mock.calls[0][0] as { visibility: VisibilityRule };
      expect(call.visibility.conditions[0].operator).toBe('equals');
    });

    it('value input is hidden for isEmpty/isNotEmpty operators', () => {
      renderWithCondition(); // operator = isNotEmpty
      expect(screen.queryByRole('textbox', { name: /value/i })).toBeNull();
    });

    it('value input is visible for operators other than isEmpty/isNotEmpty', () => {
      renderEditor({
        field: {
          ...BASE_FIELD,
          visibility: {
            combinator: 'all',
            conditions: [{ fieldId: 'sex', operator: 'equals', value: '' }],
          },
        },
      });
      expect(screen.getByRole('textbox', { name: /value/i })).toBeTruthy();
    });

    it('changing value input calls onUpdate updating conditions[0].value', () => {
      const { onUpdate } = renderEditor({
        field: {
          ...BASE_FIELD,
          visibility: {
            combinator: 'all',
            conditions: [{ fieldId: 'sex', operator: 'equals', value: '' }],
          },
        },
      });
      const input = screen.getByRole('textbox', { name: /value/i });
      fireEvent.change(input, { target: { value: 'male' } });
      const call = onUpdate.mock.calls[0][0] as { visibility: VisibilityRule };
      expect(call.visibility.conditions[0].value).toBe('male');
    });

    it('removing the last condition calls onUpdate({ visibility: undefined })', () => {
      const { onUpdate } = renderWithCondition();
      const removeBtn = screen.getByRole('button', { name: /remove condition/i });
      fireEvent.click(removeBtn);
      expect(onUpdate).toHaveBeenCalledWith({ visibility: undefined });
    });
  });
});
