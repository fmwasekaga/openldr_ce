import { describe, it, expect } from 'vitest';
import { parseTermsCsv, TERMS_CSV_TEMPLATE } from './terms-csv';

describe('parseTermsCsv', () => {
  it('parses code/display/shortName/class/unit/status into concept rows', () => {
    const csv = 'code,display,shortName,class,unit,status\nAMP,Ampicillin,Amp,ABX,,ACTIVE\nCIP,Ciprofloxacin,,ABX,mg,DRAFT\n';
    const rows = parseTermsCsv(csv, 'http://x');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ system: 'http://x', code: 'AMP', display: 'Ampicillin', status: 'ACTIVE' });
    expect(rows[0].properties).toMatchObject({ shortName: 'Amp', class: 'ABX' });
    expect(rows[1].properties).toMatchObject({ class: 'ABX', unit: 'mg' });
  });
  it('skips rows with a blank code and defaults status to ACTIVE', () => {
    const rows = parseTermsCsv('code,display,status\n,nope,\nGEN,Gentamicin,\n', 'http://x');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'GEN', status: 'ACTIVE' });
  });
  it('exposes a header-only template', () => {
    expect(TERMS_CSV_TEMPLATE.trim()).toBe('code,display,shortName,class,unit,status');
  });
});
