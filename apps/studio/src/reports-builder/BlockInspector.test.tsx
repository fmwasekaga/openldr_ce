import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BlockInspector } from './BlockInspector';

vi.mock('../api', () => ({ listModels: vi.fn().mockResolvedValue([]) }));

const titleBlock = { kind: 'title', text: 'Hi', style: {} } as never;

const base = {
  colSpan: 12,
  parameters: [],
  sqlEnabled: false,
  onPatchBlock: () => {},
  onSetColSpan: () => {},
  onMoveUp: () => {},
  onMoveDown: () => {},
  canMoveUp: true,
  canMoveDown: true,
  onDelete: () => {},
  onDuplicate: () => {},
  repeat: undefined,
  onSetRepeat: () => {},
};

describe('BlockInspector', () => {
  it('edits title text', () => {
    const onPatch = vi.fn();
    render(<BlockInspector {...base} block={titleBlock} onPatchBlock={onPatch} />);
    fireEvent.change(screen.getByLabelText(/^text$/i), { target: { value: 'New' } });
    expect(onPatch).toHaveBeenCalledWith({ text: 'New' });
  });
  it('changes width', () => {
    const onSet = vi.fn();
    render(<BlockInspector {...base} block={titleBlock} onSetColSpan={onSet} />);
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(onSet).toHaveBeenCalledWith(6);
  });
  it('deletes', () => {
    const onDelete = vi.fn();
    render(<BlockInspector {...base} block={titleBlock} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole('button', { name: /delete/i }));
    expect(onDelete).toHaveBeenCalled();
  });
  it('renders the QueryEditor for a chart block', async () => {
    render(<BlockInspector {...base} block={{ kind: 'chart', query: { mode: 'builder', model: '', metric: { key: 'count', agg: 'count' }, filters: [] } as never, chartType: 'bar', visual: {} } as never} colSpan={6} />);
    expect(await screen.findByRole('button', { name: /^bar$/i })).toBeInTheDocument();
  });
  it('moves the row up and down', () => {
    const onMoveUp = vi.fn();
    const onMoveDown = vi.fn();
    render(<BlockInspector {...base} block={titleBlock} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />);
    fireEvent.click(screen.getByRole('button', { name: /move row up/i }));
    fireEvent.click(screen.getByRole('button', { name: /move row down/i }));
    expect(onMoveUp).toHaveBeenCalled();
    expect(onMoveDown).toHaveBeenCalled();
  });
  it('disables up at the first row and down at the last row', () => {
    render(<BlockInspector {...base} block={titleBlock} canMoveUp={false} canMoveDown={false} />);
    expect(screen.getByRole('button', { name: /move row up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /move row down/i })).toBeDisabled();
  });
  it('calls onDuplicate when Duplicate is clicked', () => {
    const onDuplicate = vi.fn();
    render(<BlockInspector {...base} block={titleBlock} onDuplicate={onDuplicate} />);
    fireEvent.click(screen.getByRole('button', { name: /duplicate block/i }));
    expect(onDuplicate).toHaveBeenCalled();
  });

  it('reflects and sets the row repeat mode', () => {
    const onSetRepeat = vi.fn();
    render(<BlockInspector {...base} block={titleBlock} repeat="header" onSetRepeat={onSetRepeat} />);
    expect(screen.getByRole('button', { name: /^header$/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^footer$/i }));
    expect(onSetRepeat).toHaveBeenCalledWith('footer');
    fireEvent.click(screen.getByRole('button', { name: /^normal$/i }));
    expect(onSetRepeat).toHaveBeenCalledWith(undefined);
  });
});
