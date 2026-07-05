import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise i18next so useTranslation() resolves
import { ReportLibrary } from './ReportLibrary';
import type { ReportSummary } from '../api';

const reports: ReportSummary[] = [
  { id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr', parameters: [] },
  { id: 'test-volume', name: 'Test Volume', description: '', category: 'operational', parameters: [] },
];

function setup(extra?: Partial<React.ComponentProps<typeof ReportLibrary>>) {
  const onSelect = vi.fn();
  const onTogglePin = vi.fn();
  const onSearchChange = vi.fn();
  render(
    <ReportLibrary
      reports={reports}
      selectedId={null}
      onSelect={onSelect}
      pinnedIds={[]}
      onTogglePin={onTogglePin}
      search=""
      onSearchChange={onSearchChange}
      collapsed={false}
      onToggleCollapse={() => {}}
      {...extra}
    />,
  );
  return { onSelect, onTogglePin, onSearchChange };
}

describe('ReportLibrary', () => {
  it('lists reports and fires onSelect', () => {
    const { onSelect } = setup();
    fireEvent.click(screen.getByText('AMR Resistance Rate'));
    expect(onSelect).toHaveBeenCalledWith('amr-resistance');
  });

  it('filters by search text (case-insensitive)', () => {
    setup({ search: 'volume' });
    expect(screen.queryByText('AMR Resistance Rate')).not.toBeInTheDocument();
    expect(screen.getByText('Test Volume')).toBeInTheDocument();
  });

  it('shows a Custom badge for builder-source reports only', () => {
    setup({
      reports: [
        { id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr', parameters: [], source: 'catalog' },
        { id: 'custom-1', name: 'My Custom Report', description: '', category: 'operational', parameters: [], source: 'builder' },
      ],
    });
    expect(screen.getByText(/^Custom$/)).toBeInTheDocument();
    // The catalog report row must NOT carry the badge — exactly one badge exists.
    expect(screen.getAllByText(/^Custom$/)).toHaveLength(1);
  });

  it('shows no Custom badge when source is catalog or absent', () => {
    setup({
      reports: [
        { id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr', parameters: [] },
        { id: 'test-volume', name: 'Test Volume', description: '', category: 'operational', parameters: [], source: 'catalog' },
      ],
    });
    expect(screen.queryByText(/^Custom$/)).not.toBeInTheDocument();
  });
});
