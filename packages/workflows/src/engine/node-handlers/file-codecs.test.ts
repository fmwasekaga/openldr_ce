import { describe, it, expect } from 'vitest';
import { itemsToCsv, itemsToXlsx, fileToRows } from './file-codecs';

describe('file-codecs', () => {
  it('round-trips items → csv bytes → rows', () => {
    const items = [{ json: { a: 1, b: 'x' } }, { json: { a: 2, b: 'y' } }];
    const csv = itemsToCsv(items);
    expect(new TextDecoder().decode(csv)).toContain('a,b');
    expect(fileToRows(csv)).toEqual([{ a: 1, b: 'x' }, { a: 2, b: 'y' }]);
  });
  it('round-trips items → xlsx bytes → rows', () => {
    const items = [{ json: { name: 'Ann', age: 30 } }];
    const xlsx = itemsToXlsx(items);
    expect(xlsx.byteLength).toBeGreaterThan(0);
    expect(fileToRows(xlsx)).toEqual([{ name: 'Ann', age: 30 }]);
  });
  it('returns [] for an empty workbook', () => {
    expect(fileToRows(itemsToCsv([]))).toEqual([]);
  });
});
