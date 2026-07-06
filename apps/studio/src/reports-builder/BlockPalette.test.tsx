import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import { BlockPalette } from './BlockPalette';

describe('BlockPalette', () => {
  it('lists the block kinds and calls onAdd on click', () => {
    const onAdd = vi.fn();
    render(<DndContext><BlockPalette onAdd={onAdd} /></DndContext>);
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Chart')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Table'));
    expect(onAdd).toHaveBeenCalledWith('table');
  });

  it('collapsed: icon-only items still add a block on click', () => {
    const onAdd = vi.fn();
    render(<DndContext><BlockPalette collapsed onToggle={() => {}} onAdd={onAdd} /></DndContext>);
    fireEvent.click(screen.getByRole('button', { name: /table/i }));
    expect(onAdd).toHaveBeenCalledWith('table');
  });

  it('the collapse toggle calls onToggle', () => {
    const onToggle = vi.fn();
    render(<DndContext><BlockPalette collapsed={false} onToggle={onToggle} onAdd={() => {}} /></DndContext>);
    fireEvent.click(screen.getByRole('button', { name: /collapse palette/i }));
    expect(onToggle).toHaveBeenCalled();
  });
});
