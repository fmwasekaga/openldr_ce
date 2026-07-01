import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { SortableContext } from '@dnd-kit/sortable';
import type { FormField, FormLintIssue } from '@openldr/forms/pure';
import { SortableFieldRow } from './SortableFieldRow';

const FIELD: FormField = {
  id: 'f-1',
  displayLabel: 'Patient name',
  fieldType: 'select',
  required: true,
  enabled: true,
  fhirPath: 'name',
  section: 'main',
  order: 0,
  cardinality: { min: 0, max: '1' },
  description: null,
};

function renderRow(overrides: Partial<Parameters<typeof SortableFieldRow>[0]> = {}) {
  const onSelect = vi.fn();
  const onToggleEnabled = vi.fn();
  const onToggleRequired = vi.fn();
  const onDuplicate = vi.fn();
  const onDelete = vi.fn();

  const utils = render(
    <DndContext>
      <SortableContext items={[FIELD.id]}>
        <SortableFieldRow
          field={FIELD}
          selected={false}
          onSelect={onSelect}
          onToggleEnabled={onToggleEnabled}
          onToggleRequired={onToggleRequired}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
          {...overrides}
        />
      </SortableContext>
    </DndContext>,
  );

  return { ...utils, onSelect, onToggleEnabled, onToggleRequired, onDuplicate, onDelete };
}

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

describe('SortableFieldRow', () => {
  it('renders the displayLabel', () => {
    renderRow();
    expect(screen.getByText(/Patient name/)).toBeTruthy();
  });

  it('renders a required asterisk (*) next to the label', () => {
    renderRow();
    expect(screen.getByText('*')).toBeTruthy();
  });

  it('renders the fhirPath as subtitle', () => {
    renderRow();
    expect(screen.getByText('name')).toBeTruthy();
  });

  it('renders a type badge with the fieldType text', () => {
    renderRow();
    expect(screen.getByText('select')).toBeTruthy();
  });

  it('renders a section badge with the section text', () => {
    renderRow();
    expect(screen.getByText('main')).toBeTruthy();
  });

  it('renders an enabled checkbox', () => {
    renderRow();
    expect(screen.getByRole('checkbox')).toBeTruthy();
  });

  it('calls onToggleEnabled when the checkbox is clicked', () => {
    const { onToggleEnabled } = renderRow();
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onToggleEnabled).toHaveBeenCalledWith(FIELD.id);
  });

  it('calls onSelect when the label/select area is clicked', () => {
    const { onSelect } = renderRow();
    // Click the card container (not the checkbox)
    const card = screen.getByRole('checkbox').closest('[data-sortable-card]') ??
      screen.getByText(/Patient name/).closest('div[class]');
    if (card) fireEvent.click(card as HTMLElement);
    expect(onSelect).toHaveBeenCalled();
  });

  it('renders the ⋯ menu trigger with the correct aria-label', () => {
    renderRow();
    expect(screen.getByLabelText('Actions for Patient name')).toBeTruthy();
  });

  it('calls onDuplicate when "Duplicate" is clicked in the ⋯ menu', () => {
    const { onDuplicate } = renderRow();
    openMenuAndClick('Actions for Patient name', 'Duplicate');
    expect(onDuplicate).toHaveBeenCalledWith(FIELD.id);
  });

  it('calls onToggleRequired when "Required" is clicked in the ⋯ menu', () => {
    const { onToggleRequired } = renderRow();
    openMenuAndClick('Actions for Patient name', 'Required');
    expect(onToggleRequired).toHaveBeenCalledWith(FIELD.id);
  });

  it('calls onDelete when "Delete" is clicked in the ⋯ menu', () => {
    const { onDelete } = renderRow();
    openMenuAndClick('Actions for Patient name', 'Delete');
    expect(onDelete).toHaveBeenCalledWith(FIELD.id);
  });

  it('renders a lint marker when lintIssue is provided (error)', () => {
    const lintIssue: FormLintIssue = {
      severity: 'error',
      code: 'choice-missing-options',
      message: 'Field is missing options',
      fieldId: FIELD.id,
    };
    renderRow({ lintIssue });
    // Lint marker should have a title containing the issue message or a '!' indicator
    const marker = document.querySelector('[title="Field is missing options"]') ??
      screen.queryByTitle('Field is missing options') ??
      screen.queryByText('!');
    expect(marker).toBeTruthy();
  });

  it('renders a lint marker when lintIssue is provided (warning)', () => {
    const lintIssue: FormLintIssue = {
      severity: 'warning',
      code: 'choice-missing-options',
      message: 'Field might be missing options',
      fieldId: FIELD.id,
    };
    renderRow({ lintIssue });
    const marker = document.querySelector('[title="Field might be missing options"]') ??
      screen.queryByTitle('Field might be missing options') ??
      screen.queryByText('?');
    expect(marker).toBeTruthy();
  });
});
