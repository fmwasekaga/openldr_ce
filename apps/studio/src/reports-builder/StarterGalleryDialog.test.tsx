import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

import { StarterGalleryDialog } from './StarterGalleryDialog';

function open() {
  return render(<MemoryRouter><StarterGalleryDialog open onOpenChange={() => {}} /></MemoryRouter>);
}

describe('StarterGalleryDialog', () => {
  it('renders a card per starter, including Blank', () => {
    open();
    expect(screen.getByText('Blank report')).toBeInTheDocument();
    expect(screen.getByText('AMR Resistance')).toBeInTheDocument();
    expect(screen.getByText('Test Volume')).toBeInTheDocument();
    expect(screen.getByText('Patient Demographics')).toBeInTheDocument();
    expect(screen.getByText('Specimen & Results')).toBeInTheDocument();
  });

  it('navigates to /new?starter=<id> when a card is picked', () => {
    navigate.mockClear();
    open();
    fireEvent.click(screen.getByText('Test Volume'));
    expect(navigate).toHaveBeenCalledWith('/reports/builder/new?starter=test-volume');
  });

  it('navigates to a blank new report for the Blank card', () => {
    navigate.mockClear();
    open();
    fireEvent.click(screen.getByText('Blank report'));
    expect(navigate).toHaveBeenCalledWith('/reports/builder/new?starter=blank');
  });
});
