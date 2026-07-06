import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }));
vi.mock('@/auth/AuthProvider', () => ({ useAuth: () => ({ hasRole: (r: string) => r === 'lab_admin' || r === 'lab_manager' }) }));
vi.mock('../reports/PdfCanvasViewer', () => ({ PdfCanvasViewer: () => <div>pdf-viewer</div> }));

import { NewReportButton } from './Reports';

describe('New report entry', () => {
  it('opens the starter gallery when clicked (admin/manager)', () => {
    render(<MemoryRouter><NewReportButton /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: /new report/i }));
    expect(screen.getByText('Blank report')).toBeInTheDocument();
  });
});
