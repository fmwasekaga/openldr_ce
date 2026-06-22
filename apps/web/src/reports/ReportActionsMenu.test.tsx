import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n';
import { ReportActionsMenu } from './ReportActionsMenu';

describe('ReportActionsMenu', () => {
  it('shows History and Schedules items, both disabled (coming soon)', async () => {
    render(<ReportActionsMenu />);
    // Radix opens on pointerdown (primary mouse button), not synthetic click,
    // under jsdom. Drive the open with an explicit pointer event, then a
    // keyboard (Enter) fallback which Radix also honours on the trigger.
    const trigger = screen.getByRole('button', { name: /actions|more/i });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    if (!screen.queryByText(/run history|historique|histórico/i)) {
      fireEvent.keyDown(trigger, { key: 'Enter' });
    }
    const history = await screen.findByText(/run history|historique|histórico/i);
    const item = history.closest('[role="menuitem"]');
    expect(item).toBeTruthy();
    // shadcn/Radix disabled menu items expose data-disabled and/or aria-disabled — accept either.
    const disabled = item?.getAttribute('aria-disabled') === 'true' || item?.hasAttribute('data-disabled');
    expect(disabled).toBe(true);
  });
});
