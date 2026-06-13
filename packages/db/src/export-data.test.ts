import { describe, it, expect } from 'vitest';
import { EXTERNAL_TABLE_COLUMNS } from './export-data';

describe('EXTERNAL_TABLE_COLUMNS', () => {
  it('covers the 7 external flat tables', () => {
    expect(Object.keys(EXTERNAL_TABLE_COLUMNS).sort()).toEqual(
      ['diagnostic_reports', 'locations', 'observations', 'organizations', 'patients', 'service_requests', 'specimens'],
    );
  });
  it('every table includes id + provenance columns', () => {
    for (const cols of Object.values(EXTERNAL_TABLE_COLUMNS)) {
      expect(cols).toContain('id');
      expect(cols).toContain('source_system');
      expect(cols).toContain('batch_id');
    }
  });
});
