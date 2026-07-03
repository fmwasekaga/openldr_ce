import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LintSummary } from './LintSummary';
import type { ReportLintIssue } from '@openldr/report-builder/pure';

const issues: ReportLintIssue[] = [
  { severity: 'error', code: 'empty-query', message: 'Data block has no query configured', rowIndex: 0, cellIndex: 0 },
  { severity: 'warning', code: 'unused-parameter', message: 'Parameter "x" is defined but never used', paramId: 'x' },
];

describe('LintSummary', () => {
  it('renders nothing when there are no issues', () => {
    const { container } = render(<LintSummary issues={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the error/warning counts', () => {
    render(<LintSummary issues={issues} />);
    expect(screen.getByText(/1 error/i)).toBeTruthy();
    expect(screen.getByText(/1 warning/i)).toBeTruthy();
  });

  it('expands to the messages and selects a located block on click', async () => {
    const onSelectBlock = vi.fn();
    render(<LintSummary issues={issues} onSelectBlock={onSelectBlock} />);
    fireEvent.click(screen.getByRole('button', { name: /lint issues/i }));
    const item = await screen.findByText(/no query configured/i);
    fireEvent.click(item);
    expect(onSelectBlock).toHaveBeenCalledWith(0, 0);
  });
});
