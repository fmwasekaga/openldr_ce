import { describe, it, expect } from 'vitest';
import type { ReportCategory, ReportParamMeta, ReportMetricMeta } from './types';

describe('reporting UI metadata types', () => {
  it('allows constructing valid metadata objects', () => {
    const cat: ReportCategory = 'amr';
    const param: ReportParamMeta = { id: 'facility', label: 'Facility', type: 'select', required: false, optionsKey: 'facility' };
    const metric: ReportMetricMeta = { id: 'avgR', label: 'Avg %R', type: 'avg', column: 'percentR' };
    expect(cat).toBe('amr');
    expect(param.type).toBe('select');
    expect(metric.type).toBe('avg');
  });
});
