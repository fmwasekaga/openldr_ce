import { describe, it, expect } from 'vitest';
import { DEFAULT_DASHBOARD } from './seed';
import { DashboardSchema } from './types';
import { getModel } from './models/registry';

describe('DEFAULT_DASHBOARD', () => {
  it('is a valid dashboard whose widgets reference real models', () => {
    const d = DashboardSchema.parse(DEFAULT_DASHBOARD);
    expect(d.isDefault).toBe(true);
    for (const w of d.widgets) {
      if (w.query.mode === 'builder') expect(getModel(w.query.model)).toBeDefined();
    }
    expect(d.layout.length).toBe(d.widgets.length);
  });
});
