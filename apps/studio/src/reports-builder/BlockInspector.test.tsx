import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BlockInspector } from './BlockInspector';

const titleBlock = { kind: 'title', text: 'Hi', style: {} } as never;

describe('BlockInspector', () => {
  it('edits title text', () => {
    const onPatch = vi.fn();
    render(<BlockInspector block={titleBlock} colSpan={12} onPatchBlock={onPatch} onSetColSpan={() => {}} onDelete={() => {}} />);
    fireEvent.change(screen.getByLabelText(/text/i), { target: { value: 'New' } });
    expect(onPatch).toHaveBeenCalledWith({ text: 'New' });
  });
  it('changes width', () => {
    const onSet = vi.fn();
    render(<BlockInspector block={titleBlock} colSpan={12} onPatchBlock={() => {}} onSetColSpan={onSet} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(onSet).toHaveBeenCalledWith(6);
  });
  it('deletes', () => {
    const onDelete = vi.fn();
    render(<BlockInspector block={titleBlock} colSpan={12} onPatchBlock={() => {}} onSetColSpan={() => {}} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalled();
  });
  it('shows a data-config note for chart blocks', () => {
    render(<BlockInspector block={{ kind: 'chart', query: {} as never, chartType: 'bar', visual: {} } as never} colSpan={6} onPatchBlock={() => {}} onSetColSpan={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(/data.*next step/i)).toBeInTheDocument();
  });
});
