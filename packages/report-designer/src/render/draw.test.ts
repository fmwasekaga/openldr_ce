import { describe, it, expect } from 'vitest';
import { interpolate, paramMap } from './draw';
import type { ReportDesign } from '../schema';

const NOW = new Date('2026-07-08T00:00:00Z');

function design(over: Partial<ReportDesign> = {}): ReportDesign {
  return {
    id: 'd', name: 'N', paper: 'A4', orientation: 'portrait', pages: [], parameters: [], ...over,
  } as ReportDesign;
}

describe('paramMap', () => {
  it('maps string params by key, expands daterange to from/to, and sets date from now', () => {
    const m = paramMap(design({ parameters: [
      { key: 'lab', label: 'Lab', type: 'text', value: 'Ndola' },
      { key: 'range', label: 'Range', type: 'daterange', value: { from: '2026-01-01', to: '2026-06-30' } },
    ] }), NOW);
    expect(m.get('lab')).toBe('Ndola');
    expect(m.get('from')).toBe('2026-01-01');
    expect(m.get('to')).toBe('2026-06-30');
    expect(m.get('date')).toBe(NOW.toLocaleDateString());
  });

  it('ignores params with no value but still sets date', () => {
    const m = paramMap(design({ parameters: [{ key: 'empty', label: 'E', type: 'text' }] }), NOW);
    expect(m.has('empty')).toBe(false);
    expect(m.get('date')).toBe(NOW.toLocaleDateString());
  });
});

describe('interpolate', () => {
  const tokens = new Map<string, string>([['lab', 'Ndola'], ['date', '2026-07-08']]);

  it('replaces {{param.x}} and {{ param.x }} (inner whitespace)', () => {
    expect(interpolate('Lab {{param.lab}}', tokens)).toBe('Lab Ndola');
    expect(interpolate('Lab {{ param.lab }}', tokens)).toBe('Lab Ndola');
  });

  it('replaces {{date}} and {{ date }}', () => {
    expect(interpolate('as of {{date}}', tokens)).toBe('as of 2026-07-08');
    expect(interpolate('as of {{ date }}', tokens)).toBe('as of 2026-07-08');
  });

  it('yields empty string for an unknown {{param.missing}} token', () => {
    expect(interpolate('x{{param.missing}}y', tokens)).toBe('xy');
  });

  it('leaves non-token text untouched', () => {
    expect(interpolate('plain text', tokens)).toBe('plain text');
  });
});
