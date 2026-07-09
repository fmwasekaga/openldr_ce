import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CanvasHeader } from './CanvasHeader';

function setup(overrides = {}) {
  const props = {
    name: 'AMR summary', zoom: 0.75, saveStatus: 'saved' as const,
    onNameChange: vi.fn(), onNewTemplate: vi.fn(), onInsert: vi.fn(), onZoomIn: vi.fn(), onZoomOut: vi.fn(),
    onUndo: vi.fn(), onRedo: vi.fn(), canUndo: false, canRedo: false,
    onPreview: vi.fn(), onSave: vi.fn(), onExportPdf: vi.fn(), onExportExcel: vi.fn(),
    onPublishAsReport: vi.fn(),
    onCheck: vi.fn(), onDuplicate: vi.fn(), onDelete: vi.fn(), ...overrides,
  };
  render(<CanvasHeader {...props} />);
  return props;
}

async function openKebab() {
  const trigger = screen.getByRole('button', { name: /more actions/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!screen.queryByRole('menuitem', { name: 'Save' })) fireEvent.keyDown(trigger, { key: 'Enter' });
  return screen.findByRole('menuitem', { name: 'Save' });
}

// Radix submenus open reliably in jsdom via the keyboard ArrowRight interaction
// on the focused sub-trigger.
async function openSub(name: string) {
  const sub = await screen.findByRole('menuitem', { name });
  sub.focus();
  fireEvent.keyDown(sub, { key: 'ArrowRight' });
  return sub;
}

describe('CanvasHeader', () => {
  it('shows the report name and zoom percentage', () => {
    setup();
    expect(screen.getByLabelText('Report name')).toHaveValue('AMR summary');
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('shows the save-status indicator text for each status', () => {
    setup({ saveStatus: 'saving' });
    expect(screen.getByTestId('save-status')).toHaveTextContent('Saving');
  });

  it('steps zoom from the header controls', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(props.onZoomIn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /zoom out/i }));
    expect(props.onZoomOut).toHaveBeenCalled();
  });

  it('disables undo/redo when there is no history', () => {
    setup();
    expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /redo/i })).toBeDisabled();
  });

  it('fires undo and redo when enabled', () => {
    const props = setup({ canUndo: true, canRedo: true });
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(props.onUndo).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /redo/i }));
    expect(props.onRedo).toHaveBeenCalled();
  });

  it('lists the actions in the kebab menu', async () => {
    setup();
    await openKebab();
    for (const name of ['New template', 'Insert', 'Preview', 'Save', 'Export', 'Publish as report', 'Check', 'Duplicate', 'Delete']) {
      expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
    }
  });

  it('fires Publish as report from the kebab', async () => {
    const props = setup();
    await openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Publish as report' }));
    expect(props.onPublishAsReport).toHaveBeenCalled();
  });

  it('creates a new template from the kebab', async () => {
    const props = setup();
    await openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: 'New template' }));
    expect(props.onNewTemplate).toHaveBeenCalled();
  });

  it('fires Preview from the kebab', async () => {
    const props = setup();
    await openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Preview' }));
    expect(props.onPreview).toHaveBeenCalled();
  });

  it('fires Save from the kebab', async () => {
    const props = setup();
    await openKebab();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save' }));
    expect(props.onSave).toHaveBeenCalled();
  });

  it('inserts a Text element via the Insert submenu', async () => {
    const props = setup();
    await openKebab();
    await openSub('Insert');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    expect(props.onInsert).toHaveBeenCalledWith('text');
  });

  it('exports PDF via the Export submenu', async () => {
    const props = setup();
    await openKebab();
    await openSub('Export');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'PDF' }));
    expect(props.onExportPdf).toHaveBeenCalled();
  });
});
