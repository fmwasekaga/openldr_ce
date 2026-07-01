import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { ReportActionsMenu } from './ReportActionsMenu';

function openMenu() {
  const trigger = screen.getByRole('button', { name: /actions|more/i });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

describe('ReportActionsMenu', () => {
  it('fires onOpenHistory when Run History is clicked', async () => {
    const onOpenHistory = vi.fn();
    render(<ReportActionsMenu onOpenHistory={onOpenHistory} onOpenSchedules={() => {}} canManageSchedules />);
    openMenu();
    fireEvent.click(await screen.findByText(/run history|historique|histórico/i));
    expect(onOpenHistory).toHaveBeenCalled();
  });

  it('fires onOpenSchedules when a manager clicks Schedules', async () => {
    const onOpenSchedules = vi.fn();
    render(<ReportActionsMenu onOpenHistory={() => {}} onOpenSchedules={onOpenSchedules} canManageSchedules />);
    openMenu();
    fireEvent.click(await screen.findByText(/schedules|planifications|agendamentos/i));
    expect(onOpenSchedules).toHaveBeenCalled();
  });

  it('keeps Schedules disabled for a non-manager', async () => {
    render(<ReportActionsMenu onOpenHistory={() => {}} onOpenSchedules={() => {}} canManageSchedules={false} />);
    openMenu();
    const item = (await screen.findByText(/schedules|planifications|agendamentos/i)).closest('[role="menuitem"]');
    expect(item?.hasAttribute('data-disabled') || item?.getAttribute('aria-disabled') === 'true').toBe(true);
  });
});
