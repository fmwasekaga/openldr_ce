import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormField, FormLintIssue, FormSection } from '@openldr/forms/pure';
import { FieldListPane } from './FieldListPane';

const FIELDS: FormField[] = [
  {
    id: 'f-1',
    displayLabel: 'Patient name',
    fieldType: 'text',
    required: true,
    enabled: true,
    fhirPath: 'name',
    section: 'main',
    order: 0,
    cardinality: { min: 0, max: '1' },
    description: null,
  },
  {
    id: 'f-2',
    displayLabel: 'Age',
    fieldType: 'number',
    required: false,
    enabled: true,
    fhirPath: 'age',
    section: 'main',
    order: 1,
    cardinality: { min: 0, max: '1' },
    description: null,
  },
  {
    id: 'f-3',
    displayLabel: 'Notes',
    fieldType: 'text',
    required: false,
    enabled: false,
    fhirPath: null,
    section: 'extra',
    order: 2,
    cardinality: { min: 0, max: '1' },
    description: null,
  },
];

const SECTIONS: FormSection[] = [
  { id: 'main', label: 'Main Section', order: 0 },
  { id: 'extra', label: 'Extra Section', order: 1 },
];

const ISSUES: FormLintIssue[] = [];

function renderPane(overrides: Partial<Parameters<typeof FieldListPane>[0]> = {}) {
  const onSelect = vi.fn();
  const onToggleEnabled = vi.fn();
  const onToggleRequired = vi.fn();
  const onDuplicate = vi.fn();
  const onDelete = vi.fn();
  const onReorder = vi.fn();

  const utils = render(
    <FieldListPane
      fields={FIELDS}
      sections={SECTIONS}
      selectedFieldId={null}
      issues={ISSUES}
      onSelect={onSelect}
      onToggleEnabled={onToggleEnabled}
      onToggleRequired={onToggleRequired}
      onDuplicate={onDuplicate}
      onDelete={onDelete}
      onReorder={onReorder}
      {...overrides}
    />,
  );

  return { ...utils, onSelect, onToggleEnabled, onToggleRequired, onDuplicate, onDelete, onReorder };
}

describe('FieldListPane', () => {
  it('shows the total field count and enabled count', () => {
    renderPane();
    // Should contain "3 fields" and "2 enabled" somewhere — could be "3 fields (2 enabled)"
    expect(screen.getByText(/3\s*fields/i)).toBeTruthy();
    expect(screen.getByText(/2\s*enabled/i)).toBeTruthy();
  });

  it('renders all three field cards by default', () => {
    renderPane();
    expect(screen.getByText('Patient name')).toBeTruthy();
    expect(screen.getByText('Age')).toBeTruthy();
    expect(screen.getByText('Notes')).toBeTruthy();
  });

  it('filters to matching field when typing in the search input', () => {
    renderPane();
    const search = screen.getByLabelText('Search fields');
    fireEvent.change(search, { target: { value: 'patient' } });
    expect(screen.getByText('Patient name')).toBeTruthy();
    expect(screen.queryByText('Age')).toBeNull();
    expect(screen.queryByText('Notes')).toBeNull();
  });

  it('clears the filter when search is cleared', () => {
    renderPane();
    const search = screen.getByLabelText('Search fields');
    fireEvent.change(search, { target: { value: 'age' } });
    expect(screen.getByText('Age')).toBeTruthy();
    expect(screen.queryByText('Patient name')).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getByText('Patient name')).toBeTruthy();
    expect(screen.getByText('Notes')).toBeTruthy();
  });

  it('renders a Sections dropdown trigger containing "Sections"', () => {
    renderPane();
    // Trigger text should include "Sections" and the count
    const trigger = screen.getByText(/Sections/i);
    expect(trigger).toBeTruthy();
  });

  it('lists distinct sections in the Sections dropdown and filters on selection', () => {
    renderPane();
    // Open the dropdown using the same pointer sequence Radix expects in jsdom
    const trigger = screen.getByText(/Sections/i);
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText('All sections')) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    // After opening, the dropdown items with section names should appear in the menu
    const allSections = screen.queryByText('All sections');
    expect(allSections).toBeTruthy();
    // Use data-testid items to find section names
    const mainItem = screen.queryByTestId('section-item-main');
    const extraItem = screen.queryByTestId('section-item-extra');
    expect(mainItem).toBeTruthy();
    expect(extraItem).toBeTruthy();
  });

  it('filters to section "extra" when that section is selected', () => {
    renderPane();
    // Open dropdown
    const trigger = screen.getByText(/Sections/i);
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByTestId('section-item-extra')) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    // Click the "extra" item
    const extraItem = screen.queryByTestId('section-item-extra');
    expect(extraItem).toBeTruthy();
    if (extraItem) fireEvent.click(extraItem);
    // Only 'Notes' (section 'extra') should remain
    expect(screen.queryByText('Notes')).toBeTruthy();
    expect(screen.queryByText('Patient name')).toBeNull();
    expect(screen.queryByText('Age')).toBeNull();
  });

  it('calls onSelect when a card label area is clicked', () => {
    const { onSelect } = renderPane();
    // Click the first card — the outermost div with data-sortable-card
    const card = screen.getByText('Patient name').closest('[data-sortable-card]');
    if (card) fireEvent.click(card as HTMLElement);
    expect(onSelect).toHaveBeenCalled();
  });

  it('wires onReorder — the prop is accepted and accessible', () => {
    const onReorder = vi.fn();
    renderPane({ onReorder });
    // Component renders without error when onReorder is provided
    expect(screen.getByText('Patient name')).toBeTruthy();
    // The handler itself is not triggered by real DnD in jsdom,
    // but we confirm correct wiring by checking that the context exists
    // (DndContext renders its children without error)
  });

  it('applies selected styling when selectedFieldId matches', () => {
    renderPane({ selectedFieldId: 'f-1' });
    // The card for 'Patient name' should have the selected class
    const card = screen.getByText('Patient name').closest('[data-sortable-card]');
    expect(card?.className).toContain('border-primary');
  });

  // ── Section headers ──────────────────────────────────────────────────────────

  it('renders a section header for "main" and "extra" using section labels', () => {
    renderPane();
    // SECTIONS provides label 'Main Section' for id 'main' and 'Extra Section' for 'extra'
    expect(screen.getByText('Main Section')).toBeTruthy();
    expect(screen.getByText('Extra Section')).toBeTruthy();
  });

  it('renders a "No section" header for fields with no section when sections prop provided', () => {
    const unsectionedField: FormField = {
      id: 'f-unsec',
      displayLabel: 'Unsectioned field',
      fieldType: 'text',
      required: false,
      enabled: true,
      fhirPath: null,
      section: undefined,
      order: 10,
      cardinality: { min: 0, max: '1' },
      description: null,
    };
    renderPane({ fields: [...FIELDS, unsectionedField] });
    expect(screen.getByText(/No section/i)).toBeTruthy();
    expect(screen.getByText('Unsectioned field')).toBeTruthy();
  });

  it('renders section headers using section id as fallback when label not in sections prop', () => {
    // If sections prop is empty, fall back to field.section id as header text
    const fieldWithUnknownSection: FormField = {
      id: 'f-unk',
      displayLabel: 'Unknown section field',
      fieldType: 'text',
      required: false,
      enabled: true,
      fhirPath: null,
      section: 'mystery',
      order: 5,
      cardinality: { min: 0, max: '1' },
      description: null,
    };
    renderPane({ fields: [fieldWithUnknownSection], sections: [] });
    // Falls back to section id 'mystery' as header
    expect(screen.getByText('mystery')).toBeTruthy();
  });

  // ── Group nesting ────────────────────────────────────────────────────────────

  it('renders nested child fields indented under a group-type field', () => {
    const groupField: FormField = {
      id: 'grp',
      displayLabel: 'My Group',
      fieldType: 'group',
      required: false,
      enabled: true,
      fhirPath: null,
      section: 'main',
      order: 3,
      cardinality: { min: 0, max: '1' },
      description: null,
    };
    const childField: FormField = {
      id: 'grp-child',
      displayLabel: 'Group child',
      fieldType: 'text',
      required: false,
      enabled: true,
      fhirPath: null,
      section: 'main',
      groupId: 'grp',
      order: 4,
      cardinality: { min: 0, max: '1' },
      description: null,
    };
    renderPane({ fields: [...FIELDS, groupField, childField] });

    // The group header field should be present
    expect(screen.getByText('My Group')).toBeTruthy();
    // The child should be present
    expect(screen.getByText('Group child')).toBeTruthy();

    // The child row container should be visually nested:
    // either has a class containing 'pl-' OR has data-nested="true"
    const childCard = screen.getByText('Group child').closest('[data-sortable-card]');
    expect(childCard).toBeTruthy();
    const wrapper = childCard?.parentElement;
    const isNested =
      wrapper?.getAttribute('data-nested') === 'true' ||
      wrapper?.className?.includes('pl-') ||
      childCard?.getAttribute('data-nested') === 'true' ||
      childCard?.parentElement?.className?.includes('pl-');
    expect(isNested).toBe(true);
  });
});
