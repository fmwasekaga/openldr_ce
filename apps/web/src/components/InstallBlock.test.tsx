import { render, screen, fireEvent } from '@testing-library/react';
import { InstallBlock } from './InstallBlock';

describe('InstallBlock', () => {
  it('shows the Linux/macOS curl command by default', () => {
    render(<InstallBlock />);
    expect(screen.getByText(/curl -fsSL/)).toBeInTheDocument();
    expect(screen.getByText(/install\.sh \| bash/)).toBeInTheDocument();
  });

  it('shows the Windows PowerShell command when the Windows tab is selected', () => {
    render(<InstallBlock />);
    // Radix Tabs activates its trigger on mousedown (primary button), not on a
    // synthetic click, so jsdom's fireEvent.click never reaches the handler.
    fireEvent.mouseDown(screen.getByRole('tab', { name: /windows/i }), { button: 0, ctrlKey: false });
    expect(screen.getByText(/irm/)).toBeInTheDocument();
    expect(screen.getByText(/install\.ps1/)).toBeInTheDocument();
  });

  it('copies the active command to the clipboard', async () => {
    const original = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      render(<InstallBlock />);
      fireEvent.click(screen.getByRole('button', { name: /copy/i }));
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('install.sh'));
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
    }
  });
});
