import { describe, it, expect } from 'vitest';
import { substituteParams } from './query-sql';
import type { CustomQueryParam } from '@openldr/dashboards';

const dateRange: CustomQueryParam = { id: 'dateRange', label: 'Date range', type: 'daterange', required: false };
const facility: CustomQueryParam = { id: 'facility', label: 'Facility', type: 'select', required: false };

describe('substituteParams', () => {
  it('expands daterange to from/to as quoted date literals', () => {
    const out = substituteParams(
      "select * from t where d between {{param.from}} and {{param.to}}",
      [dateRange], { dateRange: { from: '2026-01-01', to: '2026-06-30' } },
    );
    expect(out).toBe("select * from t where d between '2026-01-01' and '2026-06-30'");
  });

  it('quotes and escapes text/select values', () => {
    const out = substituteParams(
      "select * from t where f = {{param.facility}}", [facility], { facility: "O'Brien" },
    );
    expect(out).toBe("select * from t where f = 'O''Brien'");
  });

  it('rejects a daterange value that is not an ISO date', () => {
    expect(() => substituteParams(
      "{{param.from}}", [dateRange], { dateRange: { from: 'nope', to: '2026-01-01' } },
    )).toThrow(/invalid date/i);
  });

  it('throws when a required param has no value', () => {
    expect(() => substituteParams("{{param.facility}}",
      [{ ...facility, required: true }], {})).toThrow(/required/i);
  });
});
