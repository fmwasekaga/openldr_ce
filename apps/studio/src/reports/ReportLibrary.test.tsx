import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@/i18n'; // side-effect: initialise i18next so useTranslation() resolves
import { ReportLibrary } from './ReportLibrary';
import type { ReportSummary } from '../api';
import type { ReportCategory } from './reportCategoriesApi';

const reports: ReportSummary[] = [
  { id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr', parameters: [] },
  { id: 'test-volume', name: 'Test Volume', description: '', category: 'operational', parameters: [] },
];

const categories: ReportCategory[] = [
  { id: 'amr', label: 'AMR / Surveillance', order: 0 },
  { id: 'operational', label: 'Operational', order: 1 },
];

function setup(extra?: Partial<React.ComponentProps<typeof ReportLibrary>>) {
  const onSelect = vi.fn();
  const onTogglePin = vi.fn();
  const onSearchChange = vi.fn();
  render(
    <ReportLibrary
      reports={reports}
      categories={categories}
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

  it('shows a Template badge for a design-sourced (data-driven) report only', () => {
    setup({
      reports: [
        { id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr', parameters: [], source: 'catalog' },
        { id: 'r1', name: 'Linked report', description: '', category: 'operational', parameters: [], source: 'design', designId: 'd1' },
      ],
    });
    expect(screen.getByText(/^Template$/)).toBeInTheDocument();
    expect(screen.getAllByText(/^Template$/)).toHaveLength(1);
  });

  it('groups reports by the dynamic category list, ordered by category.order', () => {
    setup({
      categories: [
        { id: 'operational', label: 'Operational', order: 0 },
        { id: 'amr', label: 'AMR / Surveillance', order: 1 },
      ],
    });
    const headings = screen.getAllByText(/^(Operational|AMR \/ Surveillance)$/);
    expect(headings.map((h) => h.textContent)).toEqual(['Operational', 'AMR / Surveillance']);
  });

  it('uses a custom category label from the dynamic list', () => {
    setup({
      categories: [
        { id: 'amr', label: 'AMR / Custom Label', order: 0 },
        { id: 'operational', label: 'Operational', order: 1 },
      ],
    });
    expect(screen.getByText('AMR / Custom Label')).toBeInTheDocument();
  });

  it('groups a report whose category matches no known id under Uncategorized, shown last', () => {
    setup({
      reports: [
        { id: 'amr-resistance', name: 'AMR Resistance Rate', description: '', category: 'amr', parameters: [] },
        { id: 'orphan', name: 'Orphan Report', description: '', category: 'deleted-category', parameters: [] },
      ],
    });
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
    expect(screen.getByText('Orphan Report')).toBeInTheDocument();
    const sectionLabels = screen.getAllByText(/AMR \/ Surveillance|Uncategorized/);
    expect(sectionLabels.map((el) => el.textContent)).toEqual(['AMR / Surveillance', 'Uncategorized']);
  });

  it('omits the Uncategorized section when every report has a known category', () => {
    setup();
    expect(screen.queryByText('Uncategorized')).not.toBeInTheDocument();
  });
});
