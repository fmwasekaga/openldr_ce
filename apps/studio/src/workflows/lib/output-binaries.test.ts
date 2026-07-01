import { describe, it, expect } from 'vitest';
import { outputBinaries } from './output-binaries';

describe('outputBinaries', () => {
  it('extracts BinaryRefs from output items', () => {
    const out = [{ json: {}, binary: { export: { objectKey: 'workflow-artifacts/u/r.csv', fileName: 'r.csv', contentType: 'text/csv', byteSize: 12 } } }];
    expect(outputBinaries(out)).toEqual([{ field: 'export', objectKey: 'workflow-artifacts/u/r.csv', fileName: 'r.csv', contentType: 'text/csv', byteSize: 12 }]);
  });
  it('returns [] for non-array / no-binary output', () => {
    expect(outputBinaries(undefined)).toEqual([]);
    expect(outputBinaries([{ json: { a: 1 } }])).toEqual([]);
  });
});
