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
});
