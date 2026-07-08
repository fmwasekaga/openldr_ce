import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasHeader } from './CanvasHeader';

function setup(overrides = {}) {
  const props = {
    name: 'AMR summary', zoom: 0.75,
    onNameChange: vi.fn(), onInsert: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn(),
    onPreview: vi.fn(), onSave: vi.fn(), onExportPdf: vi.fn(), onExportExcel: vi.fn(),
    onCheck: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), ...overrides,
  };
  render(<CanvasHeader {...props} />);
  return props;
}

describe('CanvasHeader', () => {
  it('shows the report name and zoom percentage', () => {
    setup();
    expect(screen.getByLabelText('Report name')).toHaveValue('AMR summary');
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('inserts a Text element from the Insert menu', async () => {
    const props = setup();
    const trigger = screen.getByRole('button', { name: /insert/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Text' })) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    expect(props.onInsert).toHaveBeenCalledWith('text');
  });

  it('fires Save from the kebab menu', async () => {
    const props = setup();
    const trigger = screen.getByRole('button', { name: /more actions/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Save' })) fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Save' }));
    expect(props.onSave).toHaveBeenCalled();
  });

  it('steps zoom and previews', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(props.onZoomIn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    expect(props.onPreview).toHaveBeenCalled();
  });
});
