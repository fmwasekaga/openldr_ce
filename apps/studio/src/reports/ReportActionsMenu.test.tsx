import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

  it('shows Unpublish and Delete for a design-sourced report when the user can manage', async () => {
    render(
      <MemoryRouter>
        <ReportActionsMenu
          onOpenHistory={() => {}} onOpenSchedules={() => {}} canManageSchedules
          reportId="r1" source="design" canManage
        />
      </MemoryRouter>,
    );
    openMenu();
    expect(await screen.findByText(/unpublish|dépublier|despublicar/i)).toBeInTheDocument();
    expect(await screen.findByText(/delete report|supprimer le rapport|excluir relatório/i)).toBeInTheDocument();
  });

  it('hides Unpublish/Delete for a catalog (built-in) report', async () => {
    render(
      <MemoryRouter>
        <ReportActionsMenu
          onOpenHistory={() => {}} onOpenSchedules={() => {}} canManageSchedules
          reportId="r1" source="catalog" canManage
        />
      </MemoryRouter>,
    );
    openMenu();
    expect(screen.queryByText(/unpublish|dépublier|despublicar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/delete report|supprimer le rapport|excluir relatório/i)).not.toBeInTheDocument();
  });

  it('hides Unpublish/Delete for a non-manager, even on a design-sourced report', async () => {
    render(
      <MemoryRouter>
        <ReportActionsMenu
          onOpenHistory={() => {}} onOpenSchedules={() => {}} canManageSchedules={false}
          reportId="r1" source="design" canManage={false}
        />
      </MemoryRouter>,
    );
    openMenu();
    expect(screen.queryByText(/unpublish|dépublier|despublicar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/delete report|supprimer le rapport|excluir relatório/i)).not.toBeInTheDocument();
  });

  it('fires onUnpublish when Unpublish is clicked', async () => {
    const onUnpublish = vi.fn();
    render(
      <MemoryRouter>
        <ReportActionsMenu
          onOpenHistory={() => {}} onOpenSchedules={() => {}} canManageSchedules
          reportId="r1" source="design" canManage onUnpublish={onUnpublish}
        />
      </MemoryRouter>,
    );
    openMenu();
    fireEvent.click(await screen.findByText(/unpublish|dépublier|despublicar/i));
    expect(onUnpublish).toHaveBeenCalled();
  });

  it('requires confirmation before firing onDelete', async () => {
    const onDelete = vi.fn();
    render(
      <MemoryRouter>
        <ReportActionsMenu
          onOpenHistory={() => {}} onOpenSchedules={() => {}} canManageSchedules
          reportId="r1" source="design" canManage onDelete={onDelete}
        />
      </MemoryRouter>,
    );
    openMenu();
    fireEvent.click(await screen.findByText(/delete report|supprimer le rapport|excluir relatório/i));
    expect(onDelete).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    const confirmButton = within(dialog).getByRole('button', { name: /delete report|supprimer le rapport|excluir relatório/i });
    fireEvent.click(confirmButton);
    expect(onDelete).toHaveBeenCalled();
  });
});
