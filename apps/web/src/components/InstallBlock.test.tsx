import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('install.sh')));
    } finally {
      Object.defineProperty(navigator, 'clipboard', { value: original, configurable: true });
    }
  });

  it('labels the install section for page navigation', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByRole('region', { name: /openldr installation/i })).toHaveAttribute('id', 'install');
    expect(screen.queryByText('Install')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /install openldr in one line/i })).not.toBeInTheDocument();
  });

  it('keeps the command area shrinkable so long commands scroll within the row', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByText(/curl -fsSL/)).toHaveClass('min-w-0');
  });

  it('renders the command tabs inside a centered install panel', () => {
    render(<InstallBlock />, { wrapper: MemoryRouter });
    expect(screen.getByRole('region', { name: /openldr installation/i })).toHaveClass('text-center');
    expect(screen.getByLabelText(/openldr install command/i)).toContainElement(screen.getByRole('tablist'));
    expect(screen.getByLabelText(/openldr install command/i)).toHaveClass('mx-auto', 'max-w-4xl');
    expect(screen.getByRole('tablist')).toHaveClass('border-b', 'px-4');
  });
});
