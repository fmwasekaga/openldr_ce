import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportDesignerPage } from './ReportDesignerPage';

function renderPage() {
  return render(<MemoryRouter><ReportDesignerPage /></MemoryRouter>);
}

describe('ReportDesignerPage', () => {
  it('renders explorer, canvas header for the first template, and inspector', () => {
    renderPage();
    expect(screen.getByTestId('templates-explorer')).toBeInTheDocument();
    expect(screen.getByLabelText('Report name')).toHaveValue('AMR summary');
    expect(screen.getByTestId('inspector')).toBeInTheDocument();
  });

  it('collapses the explorer to a rail', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /collapse explorer/i }));
    expect(screen.queryByTestId('templates-explorer')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /expand explorer/i })).toBeInTheDocument();
  });

  it('switches the open template when another card is selected', () => {
    renderPage();
    fireEvent.click(screen.getByText('Lab TAT'));
    expect(screen.getByLabelText('Report name')).toHaveValue('Lab TAT');
  });

  it('inserts a Text element which then appears in the Layers list', async () => {
    renderPage();
    // Insert now lives inside the kebab (More actions) as a submenu.
    const kebab = screen.getByRole('button', { name: /more actions/i });
    fireEvent.pointerDown(kebab, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Insert' })) fireEvent.keyDown(kebab, { key: 'Enter' });
    const insertSub = await screen.findByRole('menuitem', { name: 'Insert' });
    insertSub.focus();
    fireEvent.keyDown(insertSub, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    fireEvent.click(within(screen.getByTestId('inspector')).getByRole('button', { name: 'Layers' }));
    // mock AMR page 1 already has a "Title" text element; inserting adds another "Text" layer
    expect(within(screen.getByTestId('inspector')).getByRole('button', { name: /^Text$/ })).toBeInTheDocument();
  });

  it('undoes an inserted element', async () => {
    renderPage();
    const kebab = screen.getByRole('button', { name: /more actions/i });
    fireEvent.pointerDown(kebab, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Insert' })) fireEvent.keyDown(kebab, { key: 'Enter' });
    const insertSub = await screen.findByRole('menuitem', { name: 'Insert' });
    insertSub.focus();
    fireEvent.keyDown(insertSub, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    // the inserted generic "Text" layer exists...
    fireEvent.click(within(screen.getByTestId('inspector')).getByRole('button', { name: 'Layers' }));
    expect(within(screen.getByTestId('inspector')).getByRole('button', { name: /^Text$/ })).toBeInTheDocument();
    // ...and undo removes it (the seeded Title/Subtitle/Notes text layers remain, none named exactly "Text")
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(screen.getByTestId('inspector')).queryByRole('button', { name: /^Text$/ })).not.toBeInTheDocument();
  });

  it('deletes the selected element with the Delete key', async () => {
    renderPage();
    // insert a Text element (kebab → Insert → Text), which becomes selected
    const kebab = screen.getByRole('button', { name: /more actions/i });
    fireEvent.pointerDown(kebab, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Insert' })) fireEvent.keyDown(kebab, { key: 'Enter' });
    const insertSub = await screen.findByRole('menuitem', { name: 'Insert' });
    insertSub.focus();
    fireEvent.keyDown(insertSub, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    fireEvent.click(within(screen.getByTestId('inspector')).getByRole('button', { name: 'Layers' }));
    expect(within(screen.getByTestId('inspector')).getByRole('button', { name: /^Text$/ })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(within(screen.getByTestId('inspector')).queryByRole('button', { name: /^Text$/ })).not.toBeInTheDocument();
  });

  it('reconciles the selection after undo removes a selected element', async () => {
    renderPage();
    const inspector = () => screen.getByTestId('inspector');
    // insert a Text element (auto-selected)
    const kebab = screen.getByRole('button', { name: /more actions/i });
    fireEvent.pointerDown(kebab, { button: 0, pointerType: 'mouse' });
    if (!screen.queryByRole('menuitem', { name: 'Insert' })) fireEvent.keyDown(kebab, { key: 'Enter' });
    const insertSub = await screen.findByRole('menuitem', { name: 'Insert' });
    insertSub.focus();
    fireEvent.keyDown(insertSub, { key: 'ArrowRight' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Text' }));
    // extend the selection to also include the seeded 'Title' element (now 2 selected)
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }), { shiftKey: true });
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    expect(within(inspector()).getByText('2 elements selected')).toBeInTheDocument();
    // undo the insert → the Text element is gone; reconcile must drop its stale id (→ 1 left)
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(inspector()).queryByText('2 elements selected')).not.toBeInTheDocument();
  });

  it('undo reverses a committed drag', () => {
    renderPage();
    const inspector = () => screen.getByTestId('inspector');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    expect(within(inspector()).getByLabelText('X')).toHaveValue(48);
    // drag Title to the right on the canvas → x changes
    fireEvent.pointerDown(screen.getByTestId('el-amr-title'), { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(window, { clientX: 190, clientY: 100 });
    fireEvent.pointerUp(window, { clientX: 190, clientY: 100 });
    expect(within(inspector()).getByLabelText('X')).not.toHaveValue(48);
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(inspector()).getByLabelText('X')).toHaveValue(48);
  });

  it('arrow keys nudge the selection and coalesce into one undo step', () => {
    renderPage();
    const inspector = () => screen.getByTestId('inspector');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    expect(within(inspector()).getByLabelText('X')).toHaveValue(48);
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    fireEvent.keyDown(document.body, { key: 'ArrowRight' });
    expect(within(inspector()).getByLabelText('X')).toHaveValue(50); // 48 → 50
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(inspector()).getByLabelText('X')).toHaveValue(48); // single undo restores both nudges
  });

  it('edits a selected element geometry and undo restores it', () => {
    renderPage();
    const inspector = () => screen.getByTestId('inspector');
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Layers' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Title' }));
    fireEvent.click(within(inspector()).getByRole('button', { name: 'Properties' }));
    fireEvent.change(within(inspector()).getByLabelText('X'), { target: { value: '200' } });
    expect(within(inspector()).getByLabelText('X')).toHaveValue(200);
    fireEvent.click(screen.getByRole('button', { name: /undo/i }));
    expect(within(inspector()).getByLabelText('X')).toHaveValue(48);
  });
});
