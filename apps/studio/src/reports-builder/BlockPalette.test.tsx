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
});
