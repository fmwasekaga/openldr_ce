import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }));

const { isManager } = vi.hoisted(() => ({ isManager: { current: true } }));
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ hasRole: (r: string) => isManager.current && (r === 'lab_admin' || r === 'lab_manager') }),
}));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div>pdf-viewer</div> }));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return { ...actual, listReportDesigns: vi.fn(async () => []) };
});
vi.mock('../query/api', () => ({ queryApi: { list: vi.fn(async () => []) } }));

import { LibraryActionsMenu } from './Reports';

function openMenu() {
  const trigger = screen.getByRole('button', { name: /actions|more/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('Library ⋯ menu', () => {
  beforeEach(() => { isManager.current = true; });

  it('shows only the ⋯ trigger for admin/manager (no standalone blue button)', () => {
    render(<MemoryRouter><LibraryActionsMenu /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /^new report$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /actions|more/i })).toBeInTheDocument();
  });

  it('opens the New-report sheet from the ⋯ menu when clicked (admin/manager)', async () => {
    render(<MemoryRouter><LibraryActionsMenu /></MemoryRouter>);
    openMenu();
    fireEvent.click(await screen.findByText(/new report/i));
    expect(await screen.findByText(/link a report-designer template/i)).toBeInTheDocument();
  });

  it('renders nothing for a non-manager', () => {
    isManager.current = false;
    const { container } = render(<MemoryRouter><LibraryActionsMenu /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
