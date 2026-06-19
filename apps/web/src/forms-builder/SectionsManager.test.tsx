import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FormSection } from '@openldr/forms/pure';
import { SectionsManager } from './SectionsManager';

const MAIN: FormSection = { id: 'main', label: 'Main', order: 0 };

function renderManager(
  sections: FormSection[] = [MAIN],
  onChange = vi.fn(),
  onFieldsClearSection = vi.fn(),
) {
  const utils = render(
    <SectionsManager
      sections={sections}
      onChange={onChange}
      onFieldsClearSection={onFieldsClearSection}
    />,
  );
  return { ...utils, onChange, onFieldsClearSection };
}

describe('SectionsManager', () => {
  it('renders the section label in an editable input', () => {
    renderManager();
    const input = screen.getByDisplayValue('Main');
    expect(input).toBeTruthy();
  });

  it('calls onChange with the updated label when the input is edited', () => {
    const { onChange } = renderManager();
    const input = screen.getByDisplayValue('Main');
    fireEvent.change(input, { target: { value: 'Demographics' } });
    expect(onChange).toHaveBeenCalledOnce();
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections).toHaveLength(1);
    expect(sections[0]).toMatchObject({ id: 'main', label: 'Demographics', order: 0 });
  });

  it('Add button is disabled when the Section name input is empty', () => {
    renderManager();
    const addBtn = screen.getByRole('button', { name: /^add$/i });
    expect((addBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('appends a new section when a name is typed and "Add" is clicked', () => {
    const { onChange } = renderManager();
    const nameInput = screen.getByLabelText('Section name');
    fireEvent.change(nameInput, { target: { value: 'Demographics' } });
    const addBtn = screen.getByRole('button', { name: /^add$/i });
    expect((addBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(addBtn);
    expect(onChange).toHaveBeenCalledOnce();
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ id: 'main', order: 0 });
    expect(sections[1].label).toBe('Demographics');
    expect(sections[1].id).toBeTruthy();
    expect(sections[1].id).not.toBe('main');
    expect(sections[1].order).toBe(1);
  });

  it('clears the input after a successful Add', () => {
    renderManager();
    const nameInput = screen.getByLabelText('Section name') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'Demographics' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(nameInput.value).toBe('');
  });

  it('appends when Enter is pressed in the Section name input', () => {
    const { onChange } = renderManager();
    const nameInput = screen.getByLabelText('Section name');
    fireEvent.change(nameInput, { target: { value: 'Vitals' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledOnce();
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections[1].label).toBe('Vitals');
  });

  it('deletes the section and calls onFieldsClearSection when delete is clicked', () => {
    const { onChange, onFieldsClearSection } = renderManager();
    fireEvent.click(screen.getByRole('button', { name: /delete.*main|remove.*main/i }));
    expect(onChange).toHaveBeenCalledOnce();
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections).toHaveLength(0);
    expect(onFieldsClearSection).toHaveBeenCalledOnce();
    expect(onFieldsClearSection).toHaveBeenCalledWith('main');
  });

  it('swaps order when move-down is clicked on the first of two sections', () => {
    const second: FormSection = { id: 'extra', label: 'Extra', order: 1 };
    const { onChange } = renderManager([MAIN, second]);
    // Move 'Main' down (first section's move-down button)
    const moveDownBtns = screen.getAllByRole('button', { name: /move down/i });
    fireEvent.click(moveDownBtns[0]);
    expect(onChange).toHaveBeenCalledOnce();
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections).toHaveLength(2);
    // After swapping, 'Main' should now have order 1 and 'Extra' order 0
    const mainSection = sections.find((s) => s.id === 'main')!;
    const extraSection = sections.find((s) => s.id === 'extra')!;
    expect(mainSection.order).toBe(1);
    expect(extraSection.order).toBe(0);
    // Array order should reflect new ordering (extra first)
    expect(sections[0].id).toBe('extra');
    expect(sections[1].id).toBe('main');
  });

  it('swaps order when move-up is clicked on the second of two sections', () => {
    const second: FormSection = { id: 'extra', label: 'Extra', order: 1 };
    const { onChange } = renderManager([MAIN, second]);
    // Move 'Extra' up (second section's move-up button)
    const moveUpBtns = screen.getAllByRole('button', { name: /move up/i });
    fireEvent.click(moveUpBtns[moveUpBtns.length - 1]);
    expect(onChange).toHaveBeenCalledOnce();
    const [sections] = onChange.mock.calls[0] as [FormSection[]];
    expect(sections).toHaveLength(2);
    const mainSection = sections.find((s) => s.id === 'main')!;
    const extraSection = sections.find((s) => s.id === 'extra')!;
    expect(mainSection.order).toBe(1);
    expect(extraSection.order).toBe(0);
  });

  it('disables move-up on the first section and move-down on the last', () => {
    const second: FormSection = { id: 'extra', label: 'Extra', order: 1 };
    renderManager([MAIN, second]);
    const moveUpBtns = screen.getAllByRole('button', { name: /move up/i });
    const moveDownBtns = screen.getAllByRole('button', { name: /move down/i });
    // First row: move-up disabled
    expect((moveUpBtns[0] as HTMLButtonElement).disabled).toBe(true);
    // Last row: move-down disabled
    expect((moveDownBtns[moveDownBtns.length - 1] as HTMLButtonElement).disabled).toBe(true);
  });
});
