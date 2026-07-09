import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@/i18n';
import { ReportActionsMenu } from './ReportActionsMenu';

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig() as object), useNavigate: () => navigate }));

function openMenu() {
  const trigger = screen.getByRole('button', { name: /actions|more/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  if (!document.querySelector('[role="menu"]')) fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('ReportActionsMenu', () => {
  beforeEach(() => navigate.mockClear());

  it('fires onOpenHistory when Run History is clicked', async () => {
    const onOpenHistory = vi.fn();
    render(<MemoryRouter><ReportActionsMenu onOpenHistory={onOpenHistory} onOpenSchedules={() => {}} canManageSchedules /></MemoryRouter>);
    openMenu();
    fireEvent.click(await screen.findByText(/run history|historique|histórico/i));
    expect(onOpenHistory).toHaveBeenCalled();
  });

  it('fires onOpenSchedules when a manager clicks Schedules', async () => {
    const onOpenSchedules = vi.fn();
    render(<MemoryRouter><ReportActionsMenu onOpenHistory={() => {}} onOpenSchedules={onOpenSchedules} canManageSchedules /></MemoryRouter>);
    openMenu();
    fireEvent.click(await screen.findByText(/schedules|planifications|agendamentos/i));
    expect(onOpenSchedules).toHaveBeenCalled();
  });

  it('keeps Schedules disabled for a non-manager', async () => {
    render(<MemoryRouter><ReportActionsMenu onOpenHistory={() => {}} onOpenSchedules={() => {}} canManageSchedules={false} /></MemoryRouter>);
    openMenu();
    const item = (await screen.findByText(/schedules|planifications|agendamentos/i)).closest('[role="menuitem"]');
    expect(item?.hasAttribute('data-disabled') || item?.getAttribute('aria-disabled') === 'true').toBe(true);
  });

  it('does not show Edit template when there is no linked design', async () => {
    render(<MemoryRouter><ReportActionsMenu onOpenHistory={() => {}} onOpenSchedules={() => {}} canManageSchedules /></MemoryRouter>);
    openMenu();
    expect(screen.queryByText(/edit template/i)).not.toBeInTheDocument();
  });

  it('navigates to the designer when a manager clicks Edit template', async () => {
    render(
      <MemoryRouter>
        <ReportActionsMenu onOpenHistory={() => {}} onOpenSchedules={() => {}} canManageSchedules designId="d1" />
      </MemoryRouter>,
    );
    openMenu();
    fireEvent.click(await screen.findByText(/edit template/i));
    expect(navigate).toHaveBeenCalledWith('/report-designer/d1');
  });

  it('disables Edit template for a non-manager', async () => {
    render(
      <MemoryRouter>
        <ReportActionsMenu onOpenHistory={() => {}} onOpenSchedules={() => {}} canManageSchedules={false} designId="d1" />
      </MemoryRouter>,
    );
    openMenu();
    const item = (await screen.findByText(/edit template/i)).closest('[role="menuitem"]');
    expect(item?.hasAttribute('data-disabled') || item?.getAttribute('aria-disabled') === 'true').toBe(true);
    fireEvent.click(await screen.findByText(/edit template/i));
    expect(navigate).not.toHaveBeenCalled();
  });
});
