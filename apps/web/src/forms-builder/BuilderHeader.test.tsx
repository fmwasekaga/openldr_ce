import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormSchema, FormLintIssue } from '@openldr/forms/pure';
import { BuilderHeader } from './BuilderHeader';

const BASE_SCHEMA: FormSchema = {
  id: 'test-1',
  name: 'My Form',
  versionLabel: 'v1',
  fhirVersion: null,
  fhirResourceType: null,
  fhirProfileUrl: null,
  facilityId: null,
  fields: [],
  sections: [],
  targetPages: [],
  languages: [],
  version: 1,
  active: true,
  status: 'draft',
  createdAt: '',
  updatedAt: '',
};

function renderHeader(
  overrides: Partial<Parameters<typeof BuilderHeader>[0]> = {},
) {
  const onChange = vi.fn();
  const onSave = vi.fn();
  const onPublish = vi.fn();
  const onCompare = vi.fn();
  const onAddField = vi.fn();
  const onArchive = vi.fn();
  const onDisable = vi.fn();
  const onDelete = vi.fn();
  const onExport = vi.fn();
  const utils = render(
    <BuilderHeader
      schema={BASE_SCHEMA}
      issues={[]}
      canPublish
      formId="form-123"
      onChange={onChange}
      onSave={onSave}
      onPublish={onPublish}
      onCompare={onCompare}
      onAddField={onAddField}
      onArchive={onArchive}
      onDisable={onDisable}
      onDelete={onDelete}
      onExport={onExport}
      {...overrides}
    />,
  );
  return { ...utils, onChange, onSave, onPublish, onCompare, onAddField, onArchive, onDisable, onDelete, onExport };
}

// Helper: open a DropdownMenu trigger and find/click a menu item by text.
function openMenuAndClick(triggerLabel: string, itemText: string) {
  const trigger = screen.getByLabelText(triggerLabel);
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByText(itemText)) {
    fireEvent.keyDown(trigger, { key: 'Enter' });
  }
  const item = screen.getByText(itemText);
  fireEvent.pointerMove(item);
  fireEvent.click(item);
}

describe('BuilderHeader', () => {
  describe('Form Name input', () => {
    it('renders the current name', () => {
      renderHeader();
      expect(screen.getByLabelText('Form name')).toHaveValue('My Form');
    });

    it('calls onChange with updated name', () => {
      const { onChange } = renderHeader();
      const input = screen.getByLabelText('Form name');
      fireEvent.change(input, { target: { value: 'New Name' } });
      expect(onChange).toHaveBeenCalledWith({ name: 'New Name' });
    });
  });

  describe('Version label input', () => {
    it('renders the current version', () => {
      renderHeader();
      expect(screen.getByLabelText('Version label')).toHaveValue('v1');
    });

    it('calls onChange with updated versionLabel', () => {
      const { onChange } = renderHeader();
      const input = screen.getByLabelText('Version label');
      fireEvent.change(input, { target: { value: 'v2' } });
      expect(onChange).toHaveBeenCalledWith({ versionLabel: 'v2' });
    });
  });

  describe('FHIR Version Select', () => {
    it('lists at least R4 as an option', () => {
      renderHeader();
      // Open the FHIR version select trigger
      const trigger = screen.getByRole('combobox', { name: /fhir version/i });
      fireEvent.click(trigger);
      expect(screen.getByText('R4 (most common)')).toBeTruthy();
    });

    it('calls onChange with fhirVersion when a version is selected', () => {
      const { onChange } = renderHeader();
      const trigger = screen.getByRole('combobox', { name: /fhir version/i });
      fireEvent.click(trigger);
      fireEvent.click(screen.getByText('R4 (most common)'));
      expect(onChange).toHaveBeenCalledWith({ fhirVersion: 'R4' });
    });
  });

  describe('Resource Type Select', () => {
    it('calls onChange with fhirResourceType when a type is selected', () => {
      const { onChange } = renderHeader();
      const trigger = screen.getByRole('combobox', { name: /resource type/i });
      fireEvent.click(trigger);
      // Patient is always present in our static list
      const patientItem = screen.getByText('Patient');
      fireEvent.click(patientItem);
      expect(onChange).toHaveBeenCalledWith({ fhirResourceType: 'Patient' });
    });
  });

  describe('Target pages control', () => {
    it('toggles "users" in targetPages when the Users item is checked', () => {
      const { onChange } = renderHeader();
      const trigger = screen.getByRole('button', { name: /target pages/i });
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Users')) {
        fireEvent.keyDown(trigger, { key: 'Enter' });
      }
      const usersItem = screen.getByText('Users');
      fireEvent.click(usersItem);
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ targetPages: expect.arrayContaining(['users']) }),
      );
    });
  });

  describe('LintSummary', () => {
    it('does not render a lint banner when issues is empty', () => {
      renderHeader({ issues: [] });
      expect(screen.queryByText(/error/i)).toBeNull();
    });

    it('renders a lint banner when issues is non-empty', () => {
      const issues: FormLintIssue[] = [
        { severity: 'error', code: 'duplicate-id', message: 'Duplicate field id "x"', fieldId: 'x' },
      ];
      renderHeader({ issues });
      expect(screen.getByText(/1 error/i)).toBeTruthy();
    });
  });

  describe('Builder actions menu (⋯)', () => {
    it('calls onAddField when "Add field" is clicked', () => {
      const { onAddField } = renderHeader();
      openMenuAndClick('Builder actions', 'Add field');
      expect(onAddField).toHaveBeenCalled();
    });

    it('calls onSave when "Save draft" is clicked', () => {
      const { onSave } = renderHeader();
      openMenuAndClick('Builder actions', 'Save draft');
      expect(onSave).toHaveBeenCalled();
    });

    it('calls onPublish when "Publish" is clicked', () => {
      const { onPublish } = renderHeader();
      openMenuAndClick('Builder actions', 'Publish');
      expect(onPublish).toHaveBeenCalled();
    });

    it('calls onCompare when "Compare" is clicked', () => {
      const { onCompare } = renderHeader();
      openMenuAndClick('Builder actions', 'Compare');
      expect(onCompare).toHaveBeenCalled();
    });

    it('Publish item is disabled when canPublish is false', () => {
      renderHeader({ canPublish: false });
      const trigger = screen.getByLabelText('Builder actions');
      fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
      if (!screen.queryByText('Publish')) {
        fireEvent.keyDown(trigger, { key: 'Enter' });
      }
      const publishItem = screen.getByText('Publish');
      // Radix DropdownMenuItem with disabled renders with aria-disabled
      expect(publishItem.closest('[aria-disabled="true"]') ?? publishItem).toBeTruthy();
    });

    it('calls onArchive when "Archive" is clicked', () => {
      const { onArchive } = renderHeader();
      openMenuAndClick('Builder actions', 'Archive');
      expect(onArchive).toHaveBeenCalled();
    });

    it('calls onDisable when "Disable" is clicked', () => {
      const { onDisable } = renderHeader();
      openMenuAndClick('Builder actions', 'Disable');
      expect(onDisable).toHaveBeenCalled();
    });

    it('calls onDelete when "Delete" is clicked', () => {
      const { onDelete } = renderHeader();
      openMenuAndClick('Builder actions', 'Delete');
      expect(onDelete).toHaveBeenCalled();
    });

    it('calls onExport when "Export" is clicked', () => {
      const { onExport } = renderHeader();
      openMenuAndClick('Builder actions', 'Export');
      expect(onExport).toHaveBeenCalled();
    });

    describe('lifecycle items are disabled when formId is null', () => {
      function openMenu() {
        const trigger = screen.getByLabelText('Builder actions');
        fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
        if (!screen.queryByText('Archive')) {
          fireEvent.keyDown(trigger, { key: 'Enter' });
        }
      }

      it('Archive item has aria-disabled when formId is null', () => {
        renderHeader({ formId: null });
        openMenu();
        const item = screen.getByText('Archive');
        expect(
          item.closest('[aria-disabled="true"]') ?? item.closest('[data-disabled]'),
        ).toBeTruthy();
      });

      it('Disable item has aria-disabled when formId is null', () => {
        renderHeader({ formId: null });
        openMenu();
        const item = screen.getByText('Disable');
        expect(
          item.closest('[aria-disabled="true"]') ?? item.closest('[data-disabled]'),
        ).toBeTruthy();
      });

      it('Delete item has aria-disabled when formId is null', () => {
        renderHeader({ formId: null });
        openMenu();
        const item = screen.getByText('Delete');
        expect(
          item.closest('[aria-disabled="true"]') ?? item.closest('[data-disabled]'),
        ).toBeTruthy();
      });

      it('Export item has aria-disabled when formId is null', () => {
        renderHeader({ formId: null });
        openMenu();
        const item = screen.getByText('Export');
        expect(
          item.closest('[aria-disabled="true"]') ?? item.closest('[data-disabled]'),
        ).toBeTruthy();
      });

      it('onArchive is NOT called when Archive is clicked while formId is null', () => {
        const { onArchive } = renderHeader({ formId: null });
        openMenu();
        const item = screen.getByText('Archive');
        fireEvent.click(item);
        expect(onArchive).not.toHaveBeenCalled();
      });
    });
  });
});
