import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Dhis2Redirect } from './Dhis2Redirect';

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/dhis2/*" element={<Dhis2Redirect />} />
        <Route path="/settings/dhis2" element={<div>settings dhis2 home</div>} />
        <Route path="/settings/dhis2/mappings" element={<div>settings dhis2 mappings</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('Dhis2Redirect', () => {
  it('redirects /dhis2 to /settings/dhis2', () => {
    renderAt('/dhis2');
    expect(screen.getByText('settings dhis2 home')).toBeInTheDocument();
  });

  it('preserves the sub-path: /dhis2/mappings -> /settings/dhis2/mappings', () => {
    renderAt('/dhis2/mappings');
    expect(screen.getByText('settings dhis2 mappings')).toBeInTheDocument();
  });
});
