import { describe, it, expect } from 'vitest';
import { AMR_ANTIBIOTICS, AMR_TEMPLATE_COLUMNS } from './amr-columns';

describe('amr columns', () => {
  it('has the full antibiotic pivot set', () => {
    expect(AMR_ANTIBIOTICS).toContain('Amikacin');
    expect(AMR_ANTIBIOTICS).toContain('Vancomycin');
    expect(AMR_ANTIBIOTICS.length).toBe(54);
  });
  it('template column order starts with identifiers and ends with Comment', () => {
    expect(AMR_TEMPLATE_COLUMNS[0]).toBe('cultureTestCode');
    expect(AMR_TEMPLATE_COLUMNS[AMR_TEMPLATE_COLUMNS.length - 1]).toBe('Comment');
  });
});
