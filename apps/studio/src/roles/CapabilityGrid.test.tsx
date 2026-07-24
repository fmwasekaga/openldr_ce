import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@/i18n';
import type { CapabilityGroup } from '@/api';
import { CapabilityGrid } from './CapabilityGrid';

const groups: CapabilityGroup[] = [
  {
    key: 'users', label: 'Users',
    capabilities: [
      { key: 'users.view', group: 'users', label: 'View users', description: 'See the user list' },
    ],
  },
];

describe('CapabilityGrid (render smoke tests — selection logic itself is covered by capabilityGrid.model.test.ts)', () => {
  it('renders group cards and the selected/total counter', () => {
    render(<CapabilityGrid groups={groups} selected={new Set()} onChange={vi.fn()} />);
    expect(screen.getByText('Users')).toBeTruthy();
    expect(screen.getByText('View users')).toBeTruthy();
    expect(screen.getByTestId('capability-count').textContent).toMatch(/0 of 1 selected/);
  });

  it('there is no select-all control, global or per-group', () => {
    render(<CapabilityGrid groups={groups} selected={new Set()} onChange={vi.fn()} />);
    expect(screen.queryByTestId('capability-select-all')).toBeNull();
    expect(screen.queryByText(/select all/i)).toBeNull();
  });

  it('clicking a capability switch calls onChange with the toggled set', () => {
    const onChange = vi.fn();
    render(<CapabilityGrid groups={groups} selected={new Set()} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('capability-users.view'));
    expect(onChange).toHaveBeenCalledWith(new Set(['users.view']));
  });

  it('renders a checked switch for a selected capability', () => {
    render(<CapabilityGrid groups={groups} selected={new Set(['users.view'])} onChange={vi.fn()} />);
    expect(screen.getByTestId('capability-users.view')).toHaveAttribute('aria-checked', 'true');
  });

  it('readOnly disables every switch', () => {
    render(<CapabilityGrid groups={groups} selected={new Set(['users.view'])} onChange={vi.fn()} readOnly />);
    const group = screen.getByTestId('capability-group-users');
    expect(within(group).getByTestId('capability-users.view')).toBeDisabled();
  });

  it('renders a "no capabilities" message for an empty catalog', () => {
    render(<CapabilityGrid groups={[]} selected={new Set()} onChange={vi.fn()} />);
    expect(screen.getByText(/no capabilities available/i)).toBeTruthy();
  });
});
