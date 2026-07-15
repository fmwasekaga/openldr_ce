import { describe, it, expect } from 'vitest';
import { projectPatient } from './patient';

describe('projectPatient active/replaced_by_id', () => {
  it('defaults active to true and replaced_by_id to null for a plain patient', () => {
    const out = projectPatient({ resourceType: 'Patient', id: 'p1', name: [{ family: 'X' }] }, {});
    expect(out.active).toBe(true);
    expect(out.replaced_by_id).toBeNull();
  });
  it('reads active:false and extracts the replaced-by link target', () => {
    const out = projectPatient(
      { resourceType: 'Patient', id: 'p-dup', active: false, link: [{ type: 'replaced-by', other: { reference: 'Patient/p-surv' } }] },
      {},
    );
    expect(out.active).toBe(false);
    expect(out.replaced_by_id).toBe('p-surv');
  });
});
