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
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const onOpenChange = vi.fn();
  const utils = render(
    <FieldEditorSheet
      field={BASE_FIELD}
      allFields={[BASE_FIELD, GROUP_FIELD]}
      sections={SECTIONS}
      open={true}
      onSave={onSave}
      onCancel={onCancel}
      onOpenChange={onOpenChange}
      {...overrides}
    />,
  );
  return { ...utils, onSave, onCancel, onOpenChange };
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

    it('has a ⋯ (Field actions) menu trigger', () => {
      renderSheet();
      expect(screen.getByRole('button', { name: 'Field actions' })).toBeTruthy();
    });
  });

  describe('null field', () => {
    it('renders nothing when field is null', () => {
      renderSheet({ field: null });
      expect(screen.queryByText('Edit Field')).toBeNull();
    });
  });

  describe('draft editing — does NOT call onSave immediately', () => {
    it('shows the current displayLabel value', () => {
      renderSheet();
      const input = screen.getByRole('textbox', { name: /display label/i });
      expect((input as HTMLInputElement).value).toBe('Patient name');
    });

    it('editing Display Label updates the draft but does NOT call onSave', () => {
      const { onSave } = renderSheet();
      const input = screen.getByRole('textbox', { name: /display label/i });
      fireEvent.change(input, { target: { value: 'Full Name' } });
      // onSave must NOT have been called yet
      expect(onSave).not.toHaveBeenCalled();
      // The input reflects the draft value
      expect((input as HTMLInputElement).value).toBe('Full Name');
    });
  });

  describe('⋯ menu — Save', () => {
    it('clicking ⋯ → Save calls onSave with the current draft (including edits)', () => {
      const { onSave } = renderSheet();
      // Edit display label in draft
      const input = screen.getByRole('textbox', { name: /display label/i });
      fireEvent.change(input, { target: { value: 'Full Name' } });

      // Open the ⋯ menu
      const trigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Save')) {
        fireEvent.keyDown(trigger, { key: 'Enter' });
      }
      fireEvent.click(screen.getByText('Save'));

      expect(onSave).toHaveBeenCalledOnce();
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ displayLabel: 'Full Name' }),
      );
    });

    it('⋯ → Save with no edits calls onSave with the original field', () => {
      const { onSave } = renderSheet();
      const trigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Save')) {
        fireEvent.keyDown(trigger, { key: 'Enter' });
      }
      fireEvent.click(screen.getByText('Save'));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'f-1', displayLabel: 'Patient name' }),
      );
    });
  });

  describe('⋯ menu — Cancel', () => {
    it('clicking ⋯ → Cancel calls onCancel', () => {
      const { onCancel } = renderSheet();
      const trigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Cancel')) {
        fireEvent.keyDown(trigger, { key: 'Enter' });
      }
      fireEvent.click(screen.getByText('Cancel'));
      expect(onCancel).toHaveBeenCalledOnce();
    });
  });

  describe('sheet close button calls onCancel', () => {
    it('clicking the X/Close button calls onCancel (not onSave)', () => {
      const { onSave, onCancel } = renderSheet();
      const closeBtn = screen.getByText('Close').closest('button') as HTMLElement;
      fireEvent.click(closeBtn);
      expect(onCancel).toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('draft reset when field prop changes', () => {
    it('rerendering with a different field resets the shown display label', () => {
      const { rerender } = renderSheet();
      // Initially shows BASE_FIELD label
      expect((screen.getByRole('textbox', { name: /display label/i }) as HTMLInputElement).value).toBe('Patient name');

      // Rerender with a different field
      const OTHER_FIELD: FormField = { ...BASE_FIELD, id: 'f-2', displayLabel: 'Sample ID' };
      rerender(
        <FieldEditorSheet
          field={OTHER_FIELD}
          allFields={[OTHER_FIELD, GROUP_FIELD]}
          sections={SECTIONS}
          open={true}
          onSave={vi.fn()}
          onCancel={vi.fn()}
          onOpenChange={vi.fn()}
        />,
      );
      expect((screen.getByRole('textbox', { name: /display label/i }) as HTMLInputElement).value).toBe('Sample ID');
    });
  });

  describe('Field Type Select', () => {
    it('changing to "number" updates the draft (does not call onSave)', () => {
      const { onSave } = renderSheet();
      const trigger = screen.getByRole('combobox', { name: /field type/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('number'));
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Section Select', () => {
    it('has a "No section" option', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      expect(screen.getAllByText('No section').length).toBeGreaterThan(0);
    });

    it('lists section labels as options', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      expect(screen.getByText('Main')).toBeTruthy();
    });

    it('choosing a section updates the draft without calling onSave', () => {
      const { onSave } = renderSheet();
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('Main'));
      expect(onSave).not.toHaveBeenCalled();
    });

    it('choosing a section, then Save, emits the section id in the saved field', () => {
      const { onSave } = renderSheet();
      const trigger = screen.getByRole('combobox', { name: /section/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('Main'));

      const menuTrigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Save')) fireEvent.keyDown(menuTrigger, { key: 'Enter' });
      fireEvent.click(screen.getByText('Save'));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ section: 'main' }));
    });
  });

  describe('Group Select', () => {
    it('has a "No group" option', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /group/i });
      fireEvent.click(trigger);
      expect(screen.getAllByText('No group').length).toBeGreaterThan(0);
    });

    it('lists group-type fields as options', () => {
      renderSheet();
      const trigger = screen.getByRole('combobox', { name: /group/i });
      fireEvent.click(trigger);
      expect(screen.getByText('Demographics')).toBeTruthy();
    });

    it('choosing a group field updates the draft (does not call onSave)', () => {
      const { onSave } = renderSheet();
      const trigger = screen.getByRole('combobox', { name: /group/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('Demographics'));
      expect(onSave).not.toHaveBeenCalled();
    });

    it('does not show Group Select when field is a group type', () => {
      renderSheet({ field: GROUP_FIELD });
      expect(screen.queryByRole('combobox', { name: /group/i })).toBeNull();
    });
  });

  describe('Placeholder input', () => {
    it('updates the draft but does not call onSave', () => {
      const { onSave } = renderSheet();
      const input = screen.getByRole('textbox', { name: /placeholder/i });
      fireEvent.change(input, { target: { value: 'Enter name' } });
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Unit input', () => {
    it('updates the draft but does not call onSave', () => {
      const { onSave } = renderSheet();
      const input = screen.getByRole('textbox', { name: /unit/i });
      fireEvent.change(input, { target: { value: 'mg/dL' } });
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Required checkbox', () => {
    it('reflects the current required state', () => {
      renderSheet();
      const cb = screen.getByRole('checkbox', { name: /required/i });
      expect((cb as HTMLInputElement).getAttribute('data-state')).toBe('unchecked');
    });

    it('toggling Required updates the draft (does not call onSave)', () => {
      const { onSave } = renderSheet();
      const cb = screen.getByRole('checkbox', { name: /required/i });
      fireEvent.click(cb);
      expect(onSave).not.toHaveBeenCalled();
    });
  });

  describe('Enabled checkbox', () => {
    it('reflects the current enabled state (checked)', () => {
      renderSheet();
      const cb = screen.getByRole('checkbox', { name: /enabled/i });
      expect((cb as HTMLInputElement).getAttribute('data-state')).toBe('checked');
    });

    it('toggling Enabled updates the draft and Save emits enabled: false', () => {
      const { onSave } = renderSheet();
      const cb = screen.getByRole('checkbox', { name: /enabled/i });
      fireEvent.click(cb);
      expect(onSave).not.toHaveBeenCalled();

      const menuTrigger = screen.getByRole('button', { name: 'Field actions' });
      fireEvent.pointerDown(menuTrigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Save')) fireEvent.keyDown(menuTrigger, { key: 'Enter' });
      fireEvent.click(screen.getByText('Save'));

      expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
    });
  });
});
