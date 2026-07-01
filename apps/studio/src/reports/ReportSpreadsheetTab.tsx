import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download } from 'lucide-react';
import type { ReportResult, ReportColumn } from '../api';
import { downloadReportCsv } from '../api';
import { exportXlsx } from './lib/report-export';
import { useTableState } from '@/components/data-table/useTableState';
import { applyTableState } from '@/components/data-table/applyTableState';
import { DataTableToolbar } from '@/components/data-table/DataTableToolbar';
import type { ColumnDef, ColumnType } from '@/components/data-table/types';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { TablePagination } from '@/components/ui/table-pagination';
import { Button } from '@/components/ui/button';

type Row = Record<string, unknown>;

function formatCell(v: unknown, kind: ReportColumn['kind']): string {
  if (v === null || v === undefined || v === '') return '—';
  if (kind === 'percent') return `${v}%`;
  return String(v);
}

function colType(kind: ReportColumn['kind']): ColumnType {
  return kind === 'number' || kind === 'percent' ? 'number' : kind === 'date' ? 'date' : 'text';
}

interface Props {
  reportId: string;
  result: ReportResult;
  params: Record<string, string>;
  onExport?: (format: 'csv' | 'xlsx', rowCount: number) => void;
}

export function ReportSpreadsheetTab({ reportId, result, params, onExport }: Props) {
  const { t } = useTranslation();

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      result.columns.map((c) => ({
        id: c.key,
        labelKey: c.label,
        accessor: (row: Row) => formatCell(row[c.key], c.kind),
        type: colType(c.kind),
        defaultVisible: true,
        sortable: true,
        filterable: true,
      })),
    [result.columns],
  );

  const state = useTableState<Row>({ columns, defaultPageSize: 25 });
  const { filters, sorts, page, pageSize } = state;

  const { rows, total } = useMemo(
    () => applyTableState(result.rows, { filters, sorts, page, pageSize }, columns),
    [result.rows, filters, sorts, page, pageSize, columns],
  );

  const exportActions = (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        onClick={() => {
          void downloadReportCsv(reportId, params);
          onExport?.('csv', result.rows.length);
        }}
      >
        {t('reports.exportCsv')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs"
        onClick={() => {
          exportXlsx(
            reportId,
            result.columns,
            applyTableState(
              result.rows,
              { filters, sorts, page: 0, pageSize: result.rows.length || 1 },
              columns,
            ).rows,
          );
          onExport?.('xlsx', result.rows.length);
        }}
      >
        <Download className="mr-1.5 h-3.5 w-3.5" />
        {t('reports.exportXlsx')}
      </Button>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <DataTableToolbar
          columns={columns}
          filters={state.filters}
          onFiltersChange={state.setFilters}
          sorts={state.sorts}
          onSortsChange={state.setSorts}
          visibleIds={state.visibleIds}
          onVisibleIdsChange={state.setVisibleIds}
          onResetColumns={state.resetColumns}
          onResetAll={state.resetAll}
          actions={exportActions}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {state.visibleColumns.map((c) => (
                <TableHead key={c.id}>{t(c.labelKey)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={state.visibleColumns.length} className="text-muted-foreground">
                  {t('reports.noData')}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r, i) => (
                <TableRow key={i}>
                  {state.visibleColumns.map((c) => (
                    <TableCell key={c.id}>{c.accessor(r)}</TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <TablePagination
        page={state.page}
        pageSize={state.pageSize}
        total={total}
        onPageChange={state.setPage}
        onPageSizeChange={state.setPageSize}
      />
    </div>
  );
}
