import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField, FormSchema } from '@openldr/forms/pure';
import { FieldEditorSheet } from './FieldEditorSheet';

const BASE_FIELD: FormField = {
  id: 'f-1',
  displayLabel: 'Patient name',
  fieldType: 'text',
  required: false,
  enabled: true,
  fhirPath: null,
  section: undefined,
  groupId: undefined,
  placeholder: undefined,
  unit: undefined,
  order: 0,
  cardinality: { min: 0, max: '1' },
  description: null,
};

const GROUP_FIELD: FormField = {
  id: 'g-1',
  displayLabel: 'Demographics',
  fieldType: 'group',
  required: false,
  enabled: true,
  fhirPath: null,
  order: 1,
  cardinality: { min: 0, max: '1' },
  description: null,
};

const SECTIONS: FormSchema['sections'] = [
  { id: 'main', label: 'Main', order: 0 },
];

function renderSheet(
  overrides: Partial<Parameters<typeof FieldEditorSheet>[0]> = {},
) {
  const onUpdate = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <FieldEditorSheet
      field={BASE_FIELD}
      allFields={[BASE_FIELD, GROUP_FIELD]}
      sections={SECTIONS}
      open={true}
      onUpdate={onUpdate}
      onOpenChange={onOpenChange}
      {...overrides}
    />,
  );
  return { ...utils, onUpdate, onOpenChange };
}

describe('FieldEditorSheet', () => {
  describe('header', () => {
    it('shows "Edit Field" as the sheet title', () => {
      renderSheet();
      expect(screen.getByText('Edit Field')).toBeTruthy();
    });

    it('shows the field displayLabel as subtitle', () => {
      renderSheet();
      expect(screen.getByText('Patient name')).toBeTruthy();
    });
  });

  describe('null field', () => {
    it('renders nothing when field is null', () => {
      renderSheet({ field: null });
      expect(screen.queryByText('Edit Field')).toBeNull();
    });
  });

  describe('Display Label input', () => {
    it('shows the current displayLabel value', () => {
      renderSheet();
      const input = screen.getByRole('textbox', { name: /display label/i });
      expect((input as HTMLInputElement).value).toBe('Patient name');
    });

    it('calls onUpdate with new displayLabel on change', () => {
      const { onUpdate } = renderSheet();
      const input = screen.getByRole('textbox', { name: /display label/i });
      fireEvent.change(input, { target: { value: 'Full Name' } });
      expect(onUpdate).toHaveBeenCalledWith({ displayLabel: 'Full Name' });
    });
  });

  describe('Field Type Select', () => {
    it('changing to "number" calls onUpdate with fieldType number', () => {
      const { onUpdate } = renderSheet();
      const trigger = screen.getByRole('combobox', { name: /field type/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('number'));
      expect(onUpdate).toHaveBeenCalledWith({ fieldType: 'number' });
    });
  });

  describe('Section Select', () => {
    it('has a "No section" option', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      // getAllByText because the closed trigger also holds the current value text
      expect(screen.getAllByText('No section').length).toBeGreaterThan(0);
    });

    it('lists section labels as options', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      expect(screen.getByText('Main')).toBeTruthy();
    });

    it('choosing a section calls onUpdate with the section id', () => {
      const { onUpdate } = renderSheet();
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('Main'));
      expect(onUpdate).toHaveBeenCalledWith({ section: 'main' });
    });

    it('choosing No section calls onUpdate with section undefined', () => {
      const { onUpdate } = renderSheet({
        field: { ...BASE_FIELD, section: 'main' },
      });
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('No section'));
      expect(onUpdate).toHaveBeenCalledWith({ section: undefined });
    });
  });

  describe('Group Select', () => {
    it('has a "No group" option', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /group/i });
      fireEvent.click(trigger);
      // getAllByText because the closed trigger also holds the current value text
      expect(screen.getAllByText('No group').length).toBeGreaterThan(0);
    });

    it('lists group-type fields as options', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /group/i });
      fireEvent.click(trigger);
      expect(screen.getByText('Demographics')).toBeTruthy();
    });

    it('choosing a group field calls onUpdate with groupId', () => {
      const { onUpdate } = renderSheet();
      const trigger = screen.getByRole('combobox', { name: /group/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('Demographics'));
      expect(onUpdate).toHaveBeenCalledWith({ groupId: 'g-1' });
    });

    it('choosing No group calls onUpdate with groupId undefined', () => {
      const { onUpdate } = renderSheet({
        field: { ...BASE_FIELD, groupId: 'g-1' },
      });
      const trigger = screen.getByRole('combobox', { name: /group/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('No group'));
      expect(onUpdate).toHaveBeenCalledWith({ groupId: undefined });
    });

    it('does not show Group Select when field is a group type', () => {
      renderSheet({ field: GROUP_FIELD });
      expect(screen.queryByRole('combobox', { name: /group/i })).toBeNull();
    });
  });

  describe('Placeholder input', () => {
    it('calls onUpdate with placeholder on change', () => {
      const { onUpdate } = renderSheet();
      const input = screen.getByRole('textbox', { name: /placeholder/i });
      fireEvent.change(input, { target: { value: 'Enter name' } });
      expect(onUpdate).toHaveBeenCalledWith({ placeholder: 'Enter name' });
    });

    it('calls onUpdate with undefined when placeholder cleared', () => {
      const { onUpdate } = renderSheet({
        field: { ...BASE_FIELD, placeholder: 'hint' },
      });
      const input = screen.getByRole('textbox', { name: /placeholder/i });
      fireEvent.change(input, { target: { value: '' } });
      expect(onUpdate).toHaveBeenCalledWith({ placeholder: undefined });
    });
  });

  describe('Unit input', () => {
    it('calls onUpdate with unit on change', () => {
      const { onUpdate } = renderSheet();
      const input = screen.getByRole('textbox', { name: /unit/i });
      fireEvent.change(input, { target: { value: 'mg/dL' } });
      expect(onUpdate).toHaveBeenCalledWith({ unit: 'mg/dL' });
    });

    it('calls onUpdate with undefined when unit cleared', () => {
      const { onUpdate } = renderSheet({
        field: { ...BASE_FIELD, unit: 'mg/dL' },
      });
      const input = screen.getByRole('textbox', { name: /unit/i });
      fireEvent.change(input, { target: { value: '' } });
      expect(onUpdate).toHaveBeenCalledWith({ unit: undefined });
    });
  });

  describe('Required checkbox', () => {
    it('reflects the current required state', () => {
      renderSheet();
      const cb = screen.getByRole('checkbox', { name: /required/i });
      expect((cb as HTMLInputElement).getAttribute('data-state')).toBe('unchecked');
    });

    it('calls onUpdate with required: true when toggled on', () => {
      const { onUpdate } = renderSheet();
      const cb = screen.getByRole('checkbox', { name: /required/i });
      fireEvent.click(cb);
      expect(onUpdate).toHaveBeenCalledWith({ required: true });
    });
  });

  describe('Enabled checkbox', () => {
    it('reflects the current enabled state', () => {
      renderSheet();
      const cb = screen.getByRole('checkbox', { name: /enabled/i });
      expect((cb as HTMLInputElement).getAttribute('data-state')).toBe('checked');
    });

    it('calls onUpdate with enabled: false when toggled off', () => {
      const { onUpdate } = renderSheet();
      const cb = screen.getByRole('checkbox', { name: /enabled/i });
      fireEvent.click(cb);
      expect(onUpdate).toHaveBeenCalledWith({ enabled: false });
    });
  });

  describe('sheet close', () => {
    it('calls onOpenChange(false) when the close button is clicked', () => {
      const { onOpenChange } = renderSheet();
      // The SheetContent renders a close button with sr-only "Close" text
      const closeBtn = screen.getByText('Close').closest('button') as HTMLElement;
      fireEvent.click(closeBtn);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
