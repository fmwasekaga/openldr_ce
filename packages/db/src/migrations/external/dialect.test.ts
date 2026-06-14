import { describe, it, expect } from 'vitest';
import { textType, keyType, floatType, timestampType } from './dialect';

describe('dialect type map', () => {
  it('maps postgres types', () => {
    expect(textType('postgres')).toBe('text');
    expect(keyType('postgres')).toBe('text');
    expect(floatType('postgres')).toBe('double precision');
    expect(timestampType('postgres')).toBe('timestamptz');
  });
  it('maps mssql types', () => {
    expect(textType('mssql')).toBe('nvarchar(max)');
    expect(keyType('mssql')).toBe('varchar(450)');
    expect(floatType('mssql')).toBe('float');
    expect(timestampType('mssql')).toBe('datetime2');
  });
});
