import { describe, it, expect } from 'vitest';
import { buildExportRows } from './report-export';
import type { ReportColumn } from '../../api';

const columns: ReportColumn[] = [
  { key: 'antibiotic', label: 'Antibiotic', kind: 'string' },
  { key: 'percentR', label: '%R', kind: 'percent' },
];

describe('buildExportRows', () => {
  it('maps rows to label-keyed objects in column order', () => {
    const rows = [{ antibiotic: 'AMP', percentR: 40 }];
    expect(buildExportRows(columns, rows)).toEqual([{ Antibiotic: 'AMP', '%R': 40 }]);
  });
  it('blanks null/undefined cells', () => {
    expect(buildExportRows(columns, [{ antibiotic: null }])).toEqual([{ Antibiotic: '', '%R': '' }]);
  });
});
