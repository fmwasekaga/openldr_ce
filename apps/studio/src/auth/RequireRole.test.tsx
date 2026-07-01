import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { RequireRole } from './RequireRole';

vi.mock('./AuthProvider', () => ({
  useAuth: vi.fn(),
}));
import { useAuth } from './AuthProvider';

function renderAt(roles: string[] | null, loading = false) {
  (useAuth as ReturnType<typeof vi.fn>).mockReturnValue({
    user: roles ? { id: 'u', username: 'u', displayName: null, roles } : null,
    loading,
    hasRole: (r: string) => roles?.includes(r) ?? false,
  });
  return render(
    <MemoryRouter initialEntries={['/users']}>
      <Routes>
        <Route path="/" element={<div>home</div>} />
        <Route path="/users" element={<RequireRole role="lab_admin"><div>admin-page</div></RequireRole>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('RequireRole', () => {
  it('renders children for an admin', () => {
    renderAt(['lab_admin']);
    expect(screen.getByText('admin-page')).toBeTruthy();
  });
  it('redirects a non-admin to home', () => {
    renderAt(['lab_technician']);
    expect(screen.getByText('home')).toBeTruthy();
  });
});
