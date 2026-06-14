import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { DocPage } from './DocPage';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes><Route path="/docs/:slug" element={<DocPage />} /></Routes>
    </MemoryRouter>,
  );
}

describe('DocPage', () => {
  it('renders the page heading for a known slug', () => {
    renderAt('/docs/overview');
    expect(screen.getByRole('heading', { level: 1, name: 'OpenLDR Community Edition' })).toBeInTheDocument();
  });

  it('shows not-found for an unknown slug', () => {
    renderAt('/docs/nope');
    expect(screen.getByText(/not found/i)).toBeInTheDocument();
  });
});
