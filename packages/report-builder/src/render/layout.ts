import type { ReportResult } from '@openldr/reporting';
import type { Block, ReportTemplate } from '../schema';

export interface CellData { result?: ReportResult; error?: string }

export interface ResolvedTemplate {
  template: ReportTemplate;
  params: Record<string, string>;
  primary?: CellData;                 // resolution of template.dataset (if present)
  cells: Record<string, CellData>;    // key `${rowIndex}:${cellIndex}` for data-bearing blocks
}

export type BlockKind = Block['kind'];
