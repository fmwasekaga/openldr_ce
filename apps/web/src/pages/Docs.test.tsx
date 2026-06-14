import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Docs } from './Docs';

function renderDocs() {
  return render(<MemoryRouter initialEntries={['/docs']}><Docs /></MemoryRouter>);
}

describe('Docs index', () => {
  it('lists the documentation pages', () => {
    renderDocs();
    expect(screen.getByRole('link', { name: 'Getting Started' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'DHIS2 Aggregate Reporting' })).toBeInTheDocument();
  });

  it('narrows to matching pages when searching', () => {
    renderDocs();
    fireEvent.change(screen.getByLabelText('Search documentation'), { target: { value: 'dhis2' } });
    expect(screen.getByRole('link', { name: /DHIS2/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Getting Started' })).toBeNull();
  });

  it('keeps English content when an untranslated locale is selected', () => {
    renderDocs();
    fireEvent.change(screen.getByLabelText('Language'), { target: { value: 'fr' } });
    expect(screen.getByRole('link', { name: 'Getting Started' })).toBeInTheDocument();
  });
});
