import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { InstallBlock } from './InstallBlock';

describe('InstallBlock', () => {
  it('shows the Linux/macOS curl command by default', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByText(/curl -fsSL/)).toBeInTheDocument();
    expect(screen.getByText(/install\.sh \| bash/)).toBeInTheDocument();
  });

  it('shows the Windows PowerShell command when the Windows tab is selected', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    // Radix Tabs activates its trigger on mousedown (primary button), not on a
    // synthetic click, so jsdom's fireEvent.click never reaches the handler.
    // Exact name avoids also matching the "Windows Server (WSL2)" tab.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Windows' }), { button: 0, ctrlKey: false });
    expect(screen.getByText(/irm/)).toBeInTheDocument();
    expect(screen.getByText(/install\.ps1/)).toBeInTheDocument();
  });

  it('shows the Linux installer under the Windows Server (WSL2) tab', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    fireEvent.mouseDown(screen.getByRole('tab', { name: /wsl2/i }), { button: 0, ctrlKey: false });
    expect(screen.getByText(/install\.sh \| bash/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /setup guide/i })).toBeInTheDocument();
  });

  it('copies the active command to the clipboard', async () => {
    const original = navigator.clipboard;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      render(<InstallBlock />, { wrapper: MemoryRouter });
      fireEvent.click(screen.getByRole('button', { name: /copy/i }));
      expect(writeText).toHaveBeenCalledWith(expect.stringContaining('install.sh'));
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
    }
  });

  it('labels the install section for page navigation', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByRole('region', { name: /install openldr/i })).toHaveAttribute('id', 'install');
  });

  it('keeps the command area shrinkable so long commands scroll within the row', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByText(/curl -fsSL/)).toHaveClass('min-w-0');
  });

  it('keeps the install tab strip within the available width', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByRole('tablist')).toHaveClass('max-w-full', 'overflow-x-auto');
  });
});
