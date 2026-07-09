import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@/i18n';
import { CategoryPicker } from './CategoryPicker';
import type { ReportCategory } from './reportCategoriesApi';

const CATEGORIES: ReportCategory[] = [
  { id: 'amr', label: 'AMR / Surveillance', order: 0 },
  { id: 'operational', label: 'Operational', order: 1 },
];

function openPicker() {
  const trigger = screen.getByRole('button', { name: /AMR \/ Surveillance|Operational|New category/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.click(trigger);
}

function setup(extra?: Partial<React.ComponentProps<typeof CategoryPicker>>) {
  const onChange = vi.fn();
  const onCategoriesChange = vi.fn();
  const utils = render(
    <CategoryPicker
      value="amr"
      onChange={onChange}
      categories={CATEGORIES}
      onCategoriesChange={onCategoriesChange}
      canEdit
      {...extra}
    />,
  );
  return { ...utils, onChange, onCategoriesChange };
}

describe('CategoryPicker', () => {
  it("shows the selected category's label on the trigger", () => {
    setup();
    expect(screen.getByRole('button', { name: /AMR \/ Surveillance/i })).toBeInTheDocument();
  });

  it('shows a placeholder when nothing is selected', () => {
    setup({ value: '' });
    expect(screen.getByRole('button', { name: /new category/i })).toBeInTheDocument();
  });

  it('highlights the currently-selected row', async () => {
    setup();
    openPicker();
    const selectedBtn = await screen.findByRole('button', { name: /select category amr \/ surveillance/i });
    const otherBtn = screen.getByRole('button', { name: /select category operational/i });
    expect(selectedBtn.getAttribute('aria-pressed')).toBe('true');
    expect(otherBtn.getAttribute('aria-pressed')).toBe('false');
  });

  it('calls onChange when a category row is selected', async () => {
    const { onChange } = setup();
    openPicker();
    fireEvent.click(await screen.findByRole('button', { name: /select category operational/i }));
    expect(onChange).toHaveBeenCalledWith('operational');
  });

  it('non-manager: selecting via the label still works', async () => {
    const { onChange } = setup({ canEdit: false });
    openPicker();
    fireEvent.click(await screen.findByText('Operational'));
    expect(onChange).toHaveBeenCalledWith('operational');
  });

  it('manager: renaming a category calls onCategoriesChange', async () => {
    const { onCategoriesChange } = setup();
    openPicker();
    const input = await screen.findByLabelText('Category label for amr');
    fireEvent.change(input, { target: { value: 'AMR / Resistance' } });
    expect(onCategoriesChange).toHaveBeenCalledOnce();
    const [list] = onCategoriesChange.mock.calls[0] as [ReportCategory[]];
    expect(list.find((c) => c.id === 'amr')?.label).toBe('AMR / Resistance');
  });

  it('manager: adding a category calls onCategoriesChange and selects it', async () => {
    const { onCategoriesChange, onChange } = setup();
    openPicker();
    const nameInput = await screen.findByPlaceholderText(/new category/i);
    fireEvent.change(nameInput, { target: { value: 'Custom' } });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));
    expect(onCategoriesChange).toHaveBeenCalledOnce();
    const [list] = onCategoriesChange.mock.calls[0] as [ReportCategory[]];
    expect(list).toHaveLength(3);
    expect(list[2].label).toBe('Custom');
    expect(onChange).toHaveBeenCalledWith(list[2].id);
  });

  it('manager: Add is disabled while the input is empty', async () => {
    setup();
    openPicker();
    const addBtn = await screen.findByRole('button', { name: /^add$/i });
    expect((addBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('manager: move-down swaps order with the next category', async () => {
    const { onCategoriesChange } = setup();
    openPicker();
    const moveDownBtns = await screen.findAllByRole('button', { name: /move down/i });
    fireEvent.click(moveDownBtns[0]);
    expect(onCategoriesChange).toHaveBeenCalledOnce();
    const [list] = onCategoriesChange.mock.calls[0] as [ReportCategory[]];
    expect(list[0].id).toBe('operational');
    expect(list[1].id).toBe('amr');
  });

  it('manager: deleting the selected category re-selects the next one', async () => {
    const { onCategoriesChange, onChange } = setup();
    openPicker();
    fireEvent.click(await screen.findByRole('button', { name: /delete category amr/i }));
    expect(onCategoriesChange).toHaveBeenCalledOnce();
    const [list] = onCategoriesChange.mock.calls[0] as [ReportCategory[]];
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('operational');
    expect(onChange).toHaveBeenCalledWith('operational');
  });

  it('non-manager: hides add/rename/move/delete controls', async () => {
    setup({ canEdit: false });
    openPicker();
    const dialog = await screen.findByRole('dialog');
    within(dialog).getByText('Operational');
    expect(screen.queryByLabelText('Category label for amr')).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/new category/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /move up/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /move down/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /delete category/i })).not.toBeInTheDocument();
  });
});
